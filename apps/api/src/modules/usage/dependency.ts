// 依赖信号的日扫（COMPLY-04 / D-13）—— 阈值判定在 thresholds.ts（纯函数），
// 这里只做取数、去重、留证与告知。
//
// ── 72 小时去重 ────────────────────────────────────────────────────────────
// 同一 user_id 在 72 小时内已有**任一** rule_id 的 dependency_signal 行 ⇒ 整个
// 跳过（不是按 rule_id 分别去重）：告知的语义是「系统注意到你的使用模式」，
// 三条阈值只是同一件事的三个侧面，48 小时内弹三次是骚扰不是告知。
//
// ── 告知只发 active 会话 ───────────────────────────────────────────────────
// 与 usage.reminder 同一条执行点：硬退出后的会话房间一个字节都收不到
//（COMPLY-05 的 worker 侧二次检查）。
//
// ── evidence 只存聚合值 ────────────────────────────────────────────────────
// T-12-07：命中依据是时长 / 天数 / 占比，不是对话内容的任何形态 —— 类型层
//（Record<string, number>）与集成断言（序列化后不含消息正文子串）双保险。

import { and, eq, gt, gte } from 'drizzle-orm';

import {
  conversation,
  dependencySignal,
  usageSegment,
  type Executor,
  user,
} from '@drift/db';

import { logEvent } from '../../obs/logger.ts';
import { publish } from '../../ws/server.ts';
import {
  evaluateDependencyRules,
  type DependencyRuleHit,
  type UsageSession,
} from './thresholds.ts';

/**
 * 时区偏移（分钟）：东八区。
 *
 * Phase 1 的用户全部是境内用户，产品语言与法域都是中国 —— 写死 480 是如实反映
 * 而不是猜测。Phase 2 校准阈值时若引入用户级时区档案，把它挪进用户数据。
 */
const TIMEZONE_OFFSET_MINUTES = 480;

export interface DependencyScanReport {
  readonly scannedUsers: number;
  readonly signalsInserted: number;
  readonly eventsPublished: number;
  /** 命中被 72h 去重挡下的用户数（留证用，不是失败）。 */
  readonly dedupedUsers: number;
}

function activeConversationIds(target: readonly { id: string }[]): string[] {
  return target.map((row) => row.id);
}

/**
 * 执行一次依赖信号扫描。幂等性由 72h 去重窗口保证：窗口内的第二次运行不写
 * 行、不发事件。
 */
export async function runDependencyScan(executor: Executor, now: Date): Promise<DependencyScanReport> {
  const windowStart = new Date(now.getTime() - 7 * 86_400_000);
  const users = await executor.select({ id: user.id }).from(user);

  let signalsInserted = 0;
  let eventsPublished = 0;
  let dedupedUsers = 0;

  for (const u of users) {
    const segmentRows = await executor
      .select({ startedAt: usageSegment.startedAt, lastActivityAt: usageSegment.lastActivityAt })
      .from(usageSegment)
      .where(and(eq(usageSegment.userId, u.id), gte(usageSegment.lastActivityAt, windowStart)));
    const sessions: UsageSession[] = segmentRows.map((row) => ({
      start: row.startedAt.getTime(),
      end: row.lastActivityAt.getTime(),
    }));

    const hits = evaluateDependencyRules({
      sessions,
      timezoneOffsetMinutes: TIMEZONE_OFFSET_MINUTES,
      now: now.getTime(),
    });
    if (hits.length === 0) continue;

    // 72h 去重：已有任一记录 ⇒ 跳过整个用户。
    const recent = await executor
      .select({ id: dependencySignal.id })
      .from(dependencySignal)
      .where(
        and(
          eq(dependencySignal.userId, u.id),
          gt(dependencySignal.observedAt, new Date(now.getTime() - 72 * 3_600_000)),
        ),
      )
      .limit(1);
    if (recent.length > 0) {
      dedupedUsers += 1;
      continue;
    }

    await executor.insert(dependencySignal).values(
      hits.map((hit: DependencyRuleHit) => ({
        userId: u.id,
        ruleId: hit.ruleId,
        observedAt: now,
        evidence: hit.evidence,
      })),
    );
    signalsInserted += hits.length;

    // 告知：只发 active 会话（COMPLY-05 worker 侧执行点）。
    const targets = await executor
      .select({ id: conversation.id })
      .from(conversation)
      .where(and(eq(conversation.userId, u.id), eq(conversation.status, 'active')));
    for (const hit of hits) {
      for (const conversationId of activeConversationIds(targets)) {
        eventsPublished += publish(conversationId, {
          type: 'dependency.notice',
          payload: { ruleId: hit.ruleId },
        });
      }
    }
  }

  logEvent('dependency.scan_completed', {
    actualCount: users.length,
    expectedCount: signalsInserted,
    count: eventsPublished,
  });
  return { scannedUsers: users.length, signalsInserted, eventsPublished, dedupedUsers };
}
