// 硬退出的执行（COMPLY-05 / D-12 / UI-SPEC ## 硬退出呈现契约）。
//
// ── 三件事在一个函数里 ─────────────────────────────────────────────────────
//   1. 条件置 conversation.status = 'ended'（+ ended_at）—— 幂等：已结束的会话
//      不会插出第二张系统卡片；
//   2. 按 singletonKey 显式取消该会话已排定的 pg-boss 作业 —— 经由必填的
//      cancelScheduledJobs 端口；
//   3. 插入一张 sender_kind = 'system' 的中性系统卡片（**不计入出站消息**：
//      UI-SPEC 明文它是退出确认，必须存在才能证明「已及时停止」）。
//
// ── 取消不是兜底，是第一道；worker 的事务内重读才是兜底 ─────────────────────
// 取消与 worker 取件之间有竞态（RESEARCH §9.2）：一个已出队、正要执行的作业
// 取消不掉。所以零出站是**双处执行**：这里取消 + 所有可能出站的 worker 在发送
// 前重读会话状态（usage-reminder / dependency-scan / contact-status 三处，见
// 各自文件）。只靠任何一处都不够。
//
// ── 会话级队列注册表 ───────────────────────────────────────────────────────
// Phase 1 **没有**以 conversationId 为 singletonKey 的队列（拟真延迟投递属
// Phase 2；usage-reminder 是用户级计时，取消它会让「换个会话继续读」的用户
// 丢掉 COMPLY-03 的提醒 —— 详见注册表处的注释）。注册表与取消逻辑先于第一个
// 消费者存在：Phase 2 接入延迟投递时在 worker 注册处调
// registerConversationScopedQueue() 即可，executeHardExit 不需要再改。

import type { PgBoss } from 'pg-boss';

import { and, eq, sql } from 'drizzle-orm';

import { EXIT_SYSTEM_CARD_COPY } from '@drift/contract';
import { conversation, exitIntent, insertSystemMessage, tx } from '@drift/db';

import { logEvent } from '../../obs/logger.ts';
import { publish } from '../../ws/server.ts';

/** 取消端口的返回：实际取消的排队作业数（0 = 没有可取消的，不是失败）。 */
export type CancelScheduledJobs = (conversationId: string) => Promise<number>;

export interface HardExitPorts {
  /** 必填端口 —— 硬退出的「显式取消」这一环。注入使组合可测（T-12-01）。 */
  readonly cancelScheduledJobs: CancelScheduledJobs;
}

export interface HardExitContext {
  readonly userId: string;
  /**
   * 触发来源的标识：关键词路径是命中的词条（如「退出」），窗口操作路径是
   * 'window_control'（第十九条的窗口操作退出途径）。进 exit_intent.matched_rule。
   */
  readonly matchedRule: string;
}

export interface HardExitResult {
  readonly conversationId: string;
  readonly endedAt: Date;
  /** 系统卡片消息（幂等重入时为 null —— 不插第二张）。 */
  readonly systemMessage: { readonly id: string; readonly seq: number } | null;
  readonly cancelledJobs: number;
  /** true = 会话此前已结束，本次没有产生任何新的写入或事件。 */
  readonly alreadyEnded: boolean;
}

/**
 * 以 conversationId 为 singletonKey 的队列注册表。
 *
 * ⚠️ Phase 1 为空是**事实陈述**而不是装饰：全仓现有队列里，contact-attempt-
 * timeout 以 attemptId 为 key（危机联络的状态机**不能**被硬退出取消 —— 运营者
 * 侧的流程要继续走完，只有它的 WS 广播被 worker 侧的状态重读拦下），
 * usage-reminder 以 segmentId 为 key（用户级义务，见文件头）。
 */
const conversationScopedQueues = new Set<string>();

/** 注册一个会话级队列（singletonKey = conversationId）。worker 注册处调用。 */
export function registerConversationScopedQueue(queueName: string): void {
  conversationScopedQueues.add(queueName);
}

/**
 * 按 singletonKey 取消该会话排队中的全部作业。
 *
 * pg-boss 12 没有按 key 取消的 API：findJobs(name, { key, queued: true }) 找到
 * 排队中的作业，再 boss.cancel(name, ids)。已出队（正在执行）的作业取消不掉 ——
 * 那正是 worker 侧状态重读存在的原因。
 */
export async function cancelConversationJobs(boss: PgBoss, conversationId: string): Promise<number> {
  let cancelled = 0;
  for (const queue of conversationScopedQueues) {
    const jobs = await boss.findJobs(queue, { key: conversationId, queued: true });
    if (jobs.length === 0) continue;
    const ids = jobs.map((job) => job.id);
    await boss.cancel(queue, ids);
    cancelled += ids.length;
  }
  return cancelled;
}

/** 进程级 boss 引用（HTTP 链路取不到 startWorker 的实例 —— 与其余排定器同一条形态）。 */
let bossRef: PgBoss | null = null;

export function setHardExitBoss(boss: PgBoss): void {
  bossRef = boss;
}

/**
 * 生产端口：用进程级 boss 做取消。boss 未注册（worker 未起，如测试进程）时记
 * warn 并跳过取消 —— 退出本身（置状态 + 卡片 + 网关拒绝）不依赖它，取消是
 * 竞态窗口的收窄而不是正确性的前提。
 */
export function defaultHardExitPorts(): HardExitPorts {
  return {
    cancelScheduledJobs: async (conversationId) => {
      if (bossRef === null) {
        logEvent('hard_exit.cancel_unavailable', { conversationId }, 'warn');
        return 0;
      }
      return cancelConversationJobs(bossRef, conversationId);
    },
  };
}

/**
 * 执行硬退出。三件事（见文件头）在一个函数里；DB 写入在一个事务里，取消与
 * conversation.ended 事件在提交之后。
 *
 * @throws Error 会话不存在。
 */
export async function executeHardExit(
  conversationId: string,
  ports: HardExitPorts,
  context: HardExitContext,
): Promise<HardExitResult> {
  const outcome = await tx(async (t) => {
    // 条件置 ended：WHERE 带 status = 'active'，已结束的会话影响 0 行 —— 幂等。
    const updated = await t
      .update(conversation)
      .set({ status: 'ended', endedAt: sql`now()` })
      .where(and(eq(conversation.id, conversationId), eq(conversation.status, 'active')))
      .returning({ endedAt: conversation.endedAt });
    const row = updated[0];

    if (row === undefined) {
      const existing = await t
        .select({ status: conversation.status, endedAt: conversation.endedAt })
        .from(conversation)
        .where(eq(conversation.id, conversationId))
        .limit(1);
      const found = existing[0];
      if (found === undefined || found.status !== 'ended') {
        throw new Error(`conversation ${conversationId} 不存在`);
      }
      return { alreadyEnded: true, endedAt: found.endedAt ?? new Date(), systemMessage: null };
    }

    // 系统卡片：中性、平台常量、不计入出站消息（见 insertSystemMessage 的说明）。
    const systemMessage = await insertSystemMessage(t, {
      conversationId,
      text: EXIT_SYSTEM_CARD_COPY,
    });
    // 留证：第一档命中（或窗口操作）也是一次退出意图。
    await t.insert(exitIntent).values({
      userId: context.userId,
      conversationId,
      tier: 1,
      matchedRule: context.matchedRule,
    });
    return { alreadyEnded: false, endedAt: row.endedAt ?? new Date(), systemMessage };
  });

  if (outcome.alreadyEnded) {
    // 幂等重入不是状态变化 —— 不取消、不发事件（与 contact_status 的「影响 0 行
    // 的重复投递不是状态变化」同一条判据）。
    return {
      conversationId,
      endedAt: outcome.endedAt,
      systemMessage: null,
      cancelledJobs: 0,
      alreadyEnded: true,
    };
  }

  const cancelledJobs = await ports.cancelScheduledJobs(conversationId);

  // conversation.ended：让正盯着页面的客户端锁输入框。它是退出机制的一环，
  // 不是「出站消息」—— 出站消息指角色消息与推送（COMPLY-05 的措辞）。
  publish(conversationId, {
    type: 'conversation.ended',
    payload: { conversationId, endedAt: outcome.endedAt.toISOString() },
  });
  logEvent('conversation.hard_exited', {
    conversationId,
    count: cancelledJobs,
    riskLevel: 'none',
  });

  return {
    conversationId,
    endedAt: outcome.endedAt,
    systemMessage:
      outcome.systemMessage === null
        ? null
        : { id: outcome.systemMessage.id, seq: outcome.systemMessage.seq },
    cancelledJobs,
    alreadyEnded: false,
  };
}
