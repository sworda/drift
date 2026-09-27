// 依赖信号的三条硬阈值（COMPLY-04 / SAFE-14 / D-13）—— 纯函数，配置常量在此。
//
// ── 阈值是保守起点，待 Phase 2 用真实数据校准 ──────────────────────────────
// 10 人样本只支持定性观察（CONTEXT D-13 原文）。改这几个值不需要改判定逻辑 ——
// 它们是具名常量而不是散落的魔法数字，就是为了校准那天只动一处。
//
// ── 明确不实现角色集中度维度 ───────────────────────────────────────────────
// Phase 1 只有 3 个角色，该值恒接近 100%，会持续误报（D-13 明文否决：单一
// 角色的占比不是一条可判定的依赖信号）。
//
// ── 纯函数契约 ─────────────────────────────────────────────────────────────
// 不读盘、不连库、不读时钟：会话序列、时区、扫描时刻全部由入参传入。六个边界
//（2h59m59s / 3h00m00s / 6 天 / 7 天 / 40.0% / 40.1%）由此可单测。
//
// ⚠️ rule_id 的取值域与 packages/db 的 DEPENDENCY_RULE_IDS（DB CHECK 消费）一致；
// 一致性由 tools/ci/exit-ui-contract.test.ts 的集合相等断言守着。这里不 import
// @drift/db —— 包入口会在模块加载期读 DATABASE_URL 并构造连接池，而本模块要能
// 在不连库的 L3 单元层跑。

/** 三条硬阈值（D-13）。值为保守起点，Phase 2 用真实数据校准。 */
export const DEPENDENCY_THRESHOLDS = {
  /** ① 单日累计使用 ≥ 3 小时（秒）。 */
  DAILY_SECONDS: 10_800,
  /** ② 连续 7 天每天都有会话。 */
  CONSECUTIVE_DAYS: 7,
  /** ③ 近 7 天 23:00–06:00 会话占比 > 40%（严格大于）。 */
  NIGHT_RATIO: 0.4,
  /** 夜间窗口：本地 23:00 起、次日 06:00 止。 */
  NIGHT_WINDOW: { startHour: 23, endHour: 6 } as const,
  /** 同一用户 72 小时内不重复告知。 */
  DEDUPE_HOURS: 72,
} as const;

/**
 * rule_id 取值域 —— 与 packages/db 的 DEPENDENCY_RULE_IDS 逐字一致（DB CHECK
 * 只认这三个值，写别的会插不进 dependency_signal）。
 */
export const DEPENDENCY_RULE_IDS = [
  'daily_usage_over_3h',
  'seven_consecutive_days',
  'late_night_share_over_40pct',
] as const;
export type DependencyRuleId = (typeof DEPENDENCY_RULE_IDS)[number];

/** 一次使用会话（usage_segment 的 [started_at, last_activity_at]）。epoch 毫秒。 */
export interface UsageSession {
  readonly start: number;
  readonly end: number;
}

export interface DependencyScanInput {
  readonly sessions: readonly UsageSession[];
  /** 时区偏移（分钟）：本地时间 = UTC + offset。东八区 = 480。 */
  readonly timezoneOffsetMinutes: number;
  /** 扫描时刻（epoch 毫秒）。「近 7 天」窗口与「今天」由它决定。 */
  readonly now: number;
}

/** 一次命中。evidence **只存聚合值** —— 类型上不含任何文本字段（T-12-07：
 *  命中依据是时长/天数/占比，不是对话内容的任何形态）。 */
export interface DependencyRuleHit {
  readonly ruleId: DependencyRuleId;
  readonly evidence: Record<string, number>;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function localMs(t: number, tzMinutes: number): number {
  return t + tzMinutes * 60_000;
}

/** 本地日编号（本地零点所在的栅格索引）。 */
function localDayIndex(t: number, tzMinutes: number): number {
  return Math.floor(localMs(t, tzMinutes) / DAY_MS);
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** 会话落在某个本地日（[day, day+1) 本地零点栅格）内的毫秒数。 */
function sessionMsInDay(session: UsageSession, tzMinutes: number, day: number): number {
  const start = localMs(session.start, tzMinutes);
  const end = localMs(session.end, tzMinutes);
  return overlapMs(start, end, day * DAY_MS, (day + 1) * DAY_MS);
}

/** 会话触及的全部本地日编号。 */
function touchedDays(session: UsageSession, tzMinutes: number): number[] {
  const first = localDayIndex(session.start, tzMinutes);
  const last = localDayIndex(session.end, tzMinutes);
  const days: number[] = [];
  for (let d = first; d <= last; d += 1) days.push(d);
  return days;
}

/**
 * 会话的「夜间毫秒数」= 总长 − 与本地白天窗口 [06:00, 23:00) 的重叠。
 *
 * 用白天做补集而不是直接枚举夜间窗口：夜间跨零点（23:00→次日 06:00），直接
 * 枚举要处理两段拼接；补集只需一个不跨零点的区间族。
 */
function nightMsOf(session: UsageSession, tzMinutes: number): number {
  const total = Math.max(0, session.end - session.start);
  if (total === 0) return 0;
  const start = localMs(session.start, tzMinutes);
  const end = localMs(session.end, tzMinutes);
  const firstDay = localDayIndex(session.start, tzMinutes) - 1;
  const lastDay = localDayIndex(session.end, tzMinutes) + 1;
  let dayOverlap = 0;
  for (let d = firstDay; d <= lastDay; d += 1) {
    const dayStart = d * DAY_MS + DEPENDENCY_THRESHOLDS.NIGHT_WINDOW.endHour * HOUR_MS;
    const dayEnd = d * DAY_MS + DEPENDENCY_THRESHOLDS.NIGHT_WINDOW.startHour * HOUR_MS;
    dayOverlap += overlapMs(start, end, dayStart, dayEnd);
  }
  return Math.max(0, total - dayOverlap);
}

/**
 * 三条硬阈值的判定（纯函数）。
 *
 * 窗口 = 以 now 的本地日为「今天」的近 7 个本地日（含今天）。
 */
export function evaluateDependencyRules(input: DependencyScanInput): readonly DependencyRuleHit[] {
  const tz = input.timezoneOffsetMinutes;
  const today = localDayIndex(input.now, tz);
  const windowDays: number[] = [];
  for (let i = DEPENDENCY_THRESHOLDS.CONSECUTIVE_DAYS - 1; i >= 0; i -= 1) {
    windowDays.push(today - i);
  }
  const windowStartMs = (windowDays[0] ?? today) * DAY_MS - tz * 60_000; // 转回 UTC 毫秒

  // 只统计与窗口有重叠的会话。
  const inWindow = input.sessions.filter((s) => s.end > windowStartMs && s.end > s.start);
  const hits: DependencyRuleHit[] = [];

  // ① 单日累计
  const perDay = new Map<number, number>();
  for (const session of inWindow) {
    for (const day of touchedDays(session, tz)) {
      if (!windowDays.includes(day)) continue;
      perDay.set(day, (perDay.get(day) ?? 0) + sessionMsInDay(session, tz, day));
    }
  }
  const maxDaySeconds = Math.max(0, ...windowDays.map((d) => (perDay.get(d) ?? 0) / 1000));
  if (maxDaySeconds >= DEPENDENCY_THRESHOLDS.DAILY_SECONDS) {
    hits.push({
      ruleId: 'daily_usage_over_3h',
      evidence: {
        daySeconds: Math.round(maxDaySeconds),
        thresholdSeconds: DEPENDENCY_THRESHOLDS.DAILY_SECONDS,
      },
    });
  }

  // ② 连续天数：从今天往回数；今天还没有会话则从昨天起算（日扫跑在凌晨 4 点，
  // 昨晚活跃的用户不该因为「今天还没聊」而丢掉已成立的连续天数）。
  let streak = 0;
  let anchor = today;
  if ((perDay.get(today) ?? 0) === 0) anchor = today - 1;
  for (let i = 0; ; i += 1) {
    const day = anchor - i;
    if ((perDay.get(day) ?? 0) > 0) {
      streak += 1;
    } else {
      break;
    }
  }
  if (streak >= DEPENDENCY_THRESHOLDS.CONSECUTIVE_DAYS) {
    hits.push({
      ruleId: 'seven_consecutive_days',
      evidence: { consecutiveDays: streak, thresholdDays: DEPENDENCY_THRESHOLDS.CONSECUTIVE_DAYS },
    });
  }

  // ③ 夜间占比（严格大于 NIGHT_RATIO）
  let nightMs = 0;
  let totalMs = 0;
  for (const session of inWindow) {
    totalMs += session.end - session.start;
    nightMs += nightMsOf(session, tz);
  }
  if (totalMs > 0) {
    const ratio = nightMs / totalMs;
    if (ratio > DEPENDENCY_THRESHOLDS.NIGHT_RATIO) {
      hits.push({
        ruleId: 'late_night_share_over_40pct',
        evidence: {
          nightSeconds: Math.round(nightMs / 1000),
          totalSeconds: Math.round(totalMs / 1000),
          nightRatioPermille: Math.round(ratio * 1000),
          thresholdPermille: Math.round(DEPENDENCY_THRESHOLDS.NIGHT_RATIO * 1000),
        },
      });
    }
  }

  return hits;
}

/**
 * 72 小时去重窗口的判定（纯函数）：上次告知距今不足 72 小时 ⇒ 跳过。
 *
 * 独立导出（而不是埋在扫描器里）：去重边界（71h59m 在窗口内 / 72h01m 不在）
 * 与阈值边界同属「必须可单测」的一类。
 */
export function withinDedupeHours(lastObservedMs: number, nowMs: number): boolean {
  return nowMs - lastObservedMs < DEPENDENCY_THRESHOLDS.DEDUPE_HOURS * HOUR_MS;
}
