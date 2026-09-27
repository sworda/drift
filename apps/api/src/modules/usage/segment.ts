// 连续使用计时（COMPLY-03 / D-14）—— DB 为真相，pg-boss 推一把。
//
// ── 计时权威在服务端，且状态按 user_id 归集 ────────────────────────────────
// 前端 setTimeout 会在刷新 / 重登录 / 后台标签页时清零或说谎，使「连续使用满
// 2 小时」永远不触发而界面看不出异常（PITFALLS 点名的失效模式）。真相源是
// usage_segment 表，跨页面刷新、跨 WS 重连、跨重新登录都有效 —— 因为它根本
// 不在客户端。段按 **user_id** 归集、不按会话归集：多角色会话的时长合并
// 计入同一计时器（R1.03 明文「累计计时、跨角色合并」）。
//
// ── 不做 tick ──────────────────────────────────────────────────────────────
// 每条入站/出站消息在同一事务内 touch 一次：距上次活动超过 15 分钟则关闭旧段
// 开新段（累计清零），否则累加差值。没有后台计数进程 —— 累计值是两次活动之间
// 的差值和，只在实际发生消息时前进。
//
// 「用户只读不发」由 pg-boss 补齐：touch 时排一个到点作业（startAfter = 距
// 下一个 7200 倍数的剩余秒数，singletonKey = segmentId）。作业到点时若段仍
//新鲜（距 last_activity_at 不超过 15 分钟），把流逝时间计入有效累计再判定 ——
// 纯阅读 2 小时也会被提醒。段已过期则什么都不发。
//
// ── 「每超过 2 小时」是重复的，不是一次性的 ────────────────────────────────
// 判据恒为 accumulated >= 7200 * (reminded_count + 1)。4 小时触发两次。
// reminded_count 的自增是**条件更新**（WHERE 里带同一条判据）：pg-boss 是
// at-least-once 投递，同一个作业跑两次时第二次影响 0 行 —— 幂等由 WHERE 子句
// 保证，而不是由「我们应该不会重复投递」这个假设保证（与
// contact-attempt-timeout 同一条原则）。

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { conversation, tx, usageSegment, type Executor, type Tx } from '@drift/db';

import { logEvent } from '../../obs/logger.ts';
import { publish } from '../../ws/server.ts';

/** D-14：距上次消息收发超过 15 分钟算本段结束，累计清零。分段边界两侧（14/16 分钟）由集成测试钉住。 */
export const USAGE_SEGMENT_IDLE_SECONDS = 900;

/** COMPLY-03：每满 2 小时提醒一次（重复，不是一次性）。 */
export const USAGE_REMINDER_INTERVAL_SECONDS = 7200;

/** pg-boss 队列名。 */
export const USAGE_REMINDER_QUEUE = 'usage-reminder';

/**
 * 队列策略必须是 short：standard 下 singletonKey 不去重（pg-boss 12.34 实测，
 * contact-attempt-timeout 的注释里同一条纠正），同一个段会排进两个到点作业。
 */
export const USAGE_REMINDER_QUEUE_POLICY = 'short';

/** touch 的结果：调用方在事务提交**之后**才做 WS 投递与作业排定（副作用不进事务）。 */
export interface TouchUsageResult {
  readonly segmentId: string;
  /** touch 之后的累计秒数（整数）。 */
  readonly accumulatedSeconds: number;
  /** 本次 touch 是否跨越了下一个 7200 倍数并已自增 reminded_count —— 提醒待发。 */
  readonly reminderDue: boolean;
  /** 距下一个 7200 倍数的剩余秒数（供排定 pg-boss 作业；恒为正）。 */
  readonly secondsToNextThreshold: number;
}

function secondsBetween(later: Date, earlier: Date): number {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 1000));
}

/**
 * 在调用方的事务内 touch 一次使用计时。
 *
 * ⚠️ 必须与触发它的消息落库在**同一个事务**里（turn.ts 的入站与出站两处各一次）：
 * 分开写会留下「消息在了、计时没走」或反过来的半状态，而计时是合规义务
 * （COMPLY-03）不是统计 —— 半状态就是一次漏报。
 *
 * 对同一用户的并发 touch 由行锁（for update）串行化：否则两条并发消息可能各开
 * 一个新段，usage_segment_user_open_idx 不是唯一索引，谁都不会报错。
 */
export async function touchUsageSegment(
  tx: Tx,
  userId: string,
  at: Date,
): Promise<TouchUsageResult> {
  const openRows = await tx
    .select({
      id: usageSegment.id,
      lastActivityAt: usageSegment.lastActivityAt,
      accumulatedSeconds: usageSegment.accumulatedSeconds,
      remindedCount: usageSegment.remindedCount,
    })
    .from(usageSegment)
    .where(and(eq(usageSegment.userId, userId), isNull(usageSegment.closedAt)))
    .orderBy(desc(usageSegment.startedAt))
    .limit(1)
    .for('update');
  const open = openRows[0];

  let segmentId: string;
  let accumulated: number;
  let remindedCount: number;

  if (open === undefined) {
    // 没有进行中的段：开新段（累计从 0 起）。
    const inserted = await tx
      .insert(usageSegment)
      .values({ userId, startedAt: at, lastActivityAt: at, accumulatedSeconds: 0 })
      .returning({ id: usageSegment.id });
    const row = inserted[0];
    if (row === undefined) throw new Error('usage_segment 插入未返回行');
    segmentId = row.id;
    accumulated = 0;
    remindedCount = 0;
  } else {
    const elapsed = secondsBetween(at, open.lastActivityAt);
    if (elapsed > USAGE_SEGMENT_IDLE_SECONDS) {
      // 15 分钟无消息：关闭旧段（累计清零留在旧段里），开新段。
      await tx
        .update(usageSegment)
        .set({ closedAt: at })
        .where(eq(usageSegment.id, open.id));
      const inserted = await tx
        .insert(usageSegment)
        .values({ userId, startedAt: at, lastActivityAt: at, accumulatedSeconds: 0 })
        .returning({ id: usageSegment.id });
      const row = inserted[0];
      if (row === undefined) throw new Error('usage_segment 插入未返回行');
      segmentId = row.id;
      accumulated = 0;
      remindedCount = 0;
    } else {
      accumulated = open.accumulatedSeconds + elapsed;
      await tx
        .update(usageSegment)
        .set({ accumulatedSeconds: accumulated, lastActivityAt: at })
        .where(eq(usageSegment.id, open.id));
      segmentId = open.id;
      remindedCount = open.remindedCount;
    }
  }

  // 条件自增：判据进 WHERE，事务外的重复执行（以及 worker 侧的同形判定）影响 0 行。
  let reminderDue = false;
  if (accumulated >= USAGE_REMINDER_INTERVAL_SECONDS * (remindedCount + 1)) {
    const bumped = await tx
      .update(usageSegment)
      .set({ remindedCount: sql`${usageSegment.remindedCount} + 1` })
      .where(
        and(
          eq(usageSegment.id, segmentId),
          sql`${usageSegment.accumulatedSeconds} >= ${USAGE_REMINDER_INTERVAL_SECONDS} * (${usageSegment.remindedCount} + 1)`,
        ),
      )
      .returning({ remindedCount: usageSegment.remindedCount });
    if (bumped.length > 0) {
      reminderDue = true;
      remindedCount = bumped[0]?.remindedCount ?? remindedCount;
    }
  }

  const secondsToNextThreshold = Math.max(
    1,
    USAGE_REMINDER_INTERVAL_SECONDS * (remindedCount + 1) - accumulated,
  );

  return { segmentId, accumulatedSeconds: accumulated, reminderDue, secondsToNextThreshold };
}

/**
 * 把 usage.reminder 投给该用户**当前 active** 的会话房间。
 *
 * 提醒是用户级义务，但 WS 房间按 conversationId 组织 —— 于是逐个 active 会话发。
 * 只发 active 会话这一步同时就是 COMPLY-05 的 worker 侧执行点：硬退出后的会话
 * 房间一个字节都收不到（同一事务内重读 status，而不是发送时猜）。
 */
export async function publishUsageReminderToUser(
  userId: string,
  accumulatedSeconds: number,
): Promise<number> {
  const targets = await tx(async (t) =>
    t
      .select({ id: conversation.id })
      .from(conversation)
      .where(and(eq(conversation.userId, userId), eq(conversation.status, 'active'))),
  );
  let sent = 0;
  for (const target of targets) {
    sent += publish(target.id, {
      type: 'usage.reminder',
      payload: { accumulatedSeconds },
    });
  }
  return sent;
}

/**
 * usage-reminder 作业体：到点时重读 usage_segment，把流逝时间计入有效累计后
 * 条件判定，命中才自增并投递。
 *
 * 三种安静返回（0）：段不存在 / 段已关闭 / 距上次活动已超过 15 分钟（「连续
 * 使用」的定义已断开，此时提醒反而是一次虚假陈述）。
 *
 * @returns 实际投递的事件数（不是提醒次数 —— 一个用户可能有多个 active 会话房间）。
 */
export async function runUsageReminder(executor: Executor, segmentId: string, now: Date): Promise<number> {
  const rows = (await executor.execute(sql`
    update usage_segment set reminded_count = reminded_count + 1
    where id = ${segmentId}
      and closed_at is null
      and extract(epoch from (${now.toISOString()}::timestamptz - last_activity_at)) <= ${USAGE_SEGMENT_IDLE_SECONDS}
      and accumulated_seconds + extract(epoch from (${now.toISOString()}::timestamptz - last_activity_at))
          >= ${USAGE_REMINDER_INTERVAL_SECONDS} * (reminded_count + 1)
    returning user_id, accumulated_seconds + extract(epoch from (${now.toISOString()}::timestamptz - last_activity_at)) as effective
  `)) as unknown as readonly { readonly user_id: string; readonly effective: number | string }[];
  const hit = rows[0];
  if (hit === undefined) return 0;
  return publishUsageReminderToUser(hit.user_id, Math.floor(Number(hit.effective)));
}

/**
 * touch 之后的排定动作（事务提交后由调用方执行）。
 *
 * 提醒投递与作业排定都留在事务外：WS 投递是进程内副作用，pg-boss 入队是另一个
 * 连接上的写 —— 放进消息事务里会让一次投递失败回滚一条已经落库的消息。
 */
export async function afterTouchUsage(
  result: TouchUsageResult,
  userId: string,
  schedule: (segmentId: string, startAfterSeconds: number) => Promise<void>,
): Promise<void> {
  if (result.reminderDue) {
    await publishUsageReminderToUser(userId, result.accumulatedSeconds);
  }
  try {
    await schedule(result.segmentId, result.secondsToNextThreshold);
  } catch (error) {
    // 排不上作业不该让消息失败（那是 COMPLY-03 之外的另一条链路），但必须留痕：
    // 「只读不发」的提醒路径从这一刻起缺位，静默吞掉它等于让缺口不可见。
    logEvent('usage.reminder_unschedulable', { segmentId: result.segmentId }, 'warn');
    void error;
  }
}
