// 三条依赖阈值的单元断言（COMPLY-04 / D-13 / Plan 12 Task 2）。
//
// 六个边界 + 时区窗口 + 72h 去重窗口 = 八条。阈值判定是纯函数，当前时间由入参
// 传入 —— 这里不需要任何时钟注入技巧。

import { describe, expect, it } from 'vitest';

import {
  DEPENDENCY_THRESHOLDS,
  evaluateDependencyRules,
  withinDedupeHours,
  type UsageSession,
} from './thresholds.ts';

/** 一个固定「今天」：2026-06-07（周日）12:00 UTC。 */
const NOW = Date.UTC(2026, 5, 7, 12, 0, 0);
/** 东八区。 */
const TZ_BEIJING = 480;

/** 在指定本地日的 [h1, h2) 时段生成一次会话（epoch 毫秒）。 */
function sessionOn(dayFromToday: number, localStartHour: number, localEndHour: number): UsageSession {
  const today = Math.floor((NOW + TZ_BEIJING * 60_000) / 86_400_000);
  const dayStart = (today + dayFromToday) * 86_400_000 - TZ_BEIJING * 60_000;
  return { start: dayStart + localStartHour * 3_600_000, end: dayStart + localEndHour * 3_600_000 };
}

function ruleIds(hits: readonly { ruleId: string }[]): string[] {
  return hits.map((h) => h.ruleId);
}

describe('① 单日累计 ≥ 3 小时', () => {
  it('2h59m59s 不触发', () => {
    // 同一天内两段，合计恰好 10799 秒（2h59m59s）。
    const dayStart = sessionOn(0, 0, 1).start;
    const sessions: UsageSession[] = [
      { start: dayStart + 9 * 3_600_000, end: dayStart + 9 * 3_600_000 + 7_199_000 },
      { start: dayStart + 12 * 3_600_000, end: dayStart + 12 * 3_600_000 + 3_600_000 },
    ];
    const hits = evaluateDependencyRules({ sessions, timezoneOffsetMinutes: TZ_BEIJING, now: NOW });
    expect(ruleIds(hits)).not.toContain('daily_usage_over_3h');
  });

  it('3h00m00s 触发（「不少于」= ≥）', () => {
    const dayStart = sessionOn(0, 0, 1).start;
    const sessions: UsageSession[] = [
      { start: dayStart + 9 * 3_600_000, end: dayStart + 9 * 3_600_000 + 10_800_000 },
    ];
    const hits = evaluateDependencyRules({ sessions, timezoneOffsetMinutes: TZ_BEIJING, now: NOW });
    expect(ruleIds(hits)).toContain('daily_usage_over_3h');
    const daily = hits.find((h) => h.ruleId === 'daily_usage_over_3h');
    expect(daily?.evidence['daySeconds']).toBe(10_800);
  });
});

describe('② 连续 7 天', () => {
  it('连续 6 天不触发', () => {
    const sessions: UsageSession[] = [];
    for (let i = 0; i < 6; i += 1) sessions.push(sessionOn(-i, 10, 11));
    const hits = evaluateDependencyRules({ sessions, timezoneOffsetMinutes: TZ_BEIJING, now: NOW });
    expect(ruleIds(hits)).not.toContain('seven_consecutive_days');
  });

  it('第 7 天触发', () => {
    const sessions: UsageSession[] = [];
    for (let i = 0; i < 7; i += 1) sessions.push(sessionOn(-i, 10, 11));
    const hits = evaluateDependencyRules({ sessions, timezoneOffsetMinutes: TZ_BEIJING, now: NOW });
    expect(ruleIds(hits)).toContain('seven_consecutive_days');
    const streak = hits.find((h) => h.ruleId === 'seven_consecutive_days');
    expect(streak?.evidence['consecutiveDays']).toBe(7);
  });
});

describe('③ 夜间占比 > 40%', () => {
  it('40.0% 不触发（严格大于）', () => {
    // 夜间 4 小时（23:00–03:00）+ 白天 6 小时 = 40.0%。
    const sessions: UsageSession[] = [
      { ...sessionOn(-1, 23, 24), end: sessionOn(-1, 23, 24).start + 4 * 3_600_000 },
      sessionOn(0, 9, 15),
    ];
    const hits = evaluateDependencyRules({ sessions, timezoneOffsetMinutes: TZ_BEIJING, now: NOW });
    expect(ruleIds(hits)).not.toContain('late_night_share_over_40pct');
  });

  it('40.1% 触发', () => {
    // 夜间 4 小时 + 白天 5 小时 59 分 ≈ 40.1%。
    const nightStart = sessionOn(-1, 23, 24).start;
    const sessions: UsageSession[] = [
      { start: nightStart, end: nightStart + 4 * 3_600_000 },
      { start: sessionOn(0, 9, 0).start, end: sessionOn(0, 9, 0).start + 5 * 3_600_000 + 59 * 60_000 },
    ];
    const hits = evaluateDependencyRules({ sessions, timezoneOffsetMinutes: TZ_BEIJING, now: NOW });
    expect(ruleIds(hits)).toContain('late_night_share_over_40pct');
    const night = hits.find((h) => h.ruleId === 'late_night_share_over_40pct');
    expect(night?.evidence['nightRatioPermille']).toBe(401);
  });
});

describe('时区偏移下的 23:00–06:00 窗口判定', () => {
  // UTC 15:00–16:00 的同一段会话：北京本地 23:00–00:00（夜间），UTC 本地 15:00–16:00（白天）。
  const session: UsageSession = { start: Date.UTC(2026, 5, 6, 15, 0, 0), end: Date.UTC(2026, 5, 6, 16, 0, 0) };

  it('东八区：算夜间', () => {
    const hits = evaluateDependencyRules({ sessions: [session], timezoneOffsetMinutes: TZ_BEIJING, now: NOW });
    // 只有 1 小时且全在夜间 ⇒ 占比 100% > 40%。
    expect(ruleIds(hits)).toContain('late_night_share_over_40pct');
  });

  it('UTC：算白天', () => {
    const hits = evaluateDependencyRules({ sessions: [session], timezoneOffsetMinutes: 0, now: NOW });
    expect(ruleIds(hits)).not.toContain('late_night_share_over_40pct');
  });
});

describe('72 小时去重窗口（纯函数）', () => {
  it('71h59m 在窗口内；72h01m 不在', () => {
    const now = NOW;
    expect(withinDedupeHours(now - (71 * 60 + 59) * 60_000, now)).toBe(true);
    expect(withinDedupeHours(now - (72 * 60 + 1) * 60_000, now)).toBe(false);
  });
});

describe('常量钉住（Phase 2 校准的锚点）', () => {
  it('五个常量都有具名且取值是 D-13 的保守起点', () => {
    expect(DEPENDENCY_THRESHOLDS.DAILY_SECONDS).toBe(10_800);
    expect(DEPENDENCY_THRESHOLDS.CONSECUTIVE_DAYS).toBe(7);
    expect(DEPENDENCY_THRESHOLDS.NIGHT_RATIO).toBe(0.4);
    expect(DEPENDENCY_THRESHOLDS.NIGHT_WINDOW).toEqual({ startHour: 23, endHour: 6 });
    expect(DEPENDENCY_THRESHOLDS.DEDUPE_HOURS).toBe(72);
  });

  it('不实现「单一角色集中度」维度（D-13 否决 —— 3 个角色下恒接近 100%，持续误报）', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync(new URL('./thresholds.ts', import.meta.url), 'utf8'));
    expect(source.includes('单一角色集中度'), '注释里的否决说明除外，代码中不应出现该维度').toBe(false);
    expect(source.includes('characterConcentration')).toBe(false);
  });
});
