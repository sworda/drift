// 会话级风险状态机 + safety_event 的**全仓唯一写入点**（R1.21 / R1.25）。
//
// ── 只升不降 ────────────────────────────────────────────────────────────────
// raiseRisk 是一条带条件的 upsert：`ON CONFLICT ... DO UPDATE ... WHERE` 里比较的是
// 两个等级在 RISK_LEVELS 里的序号，低于当前等级的写入**在数据库里**被丢掉，而不是在
// 应用层判断后跳过。差别在并发下才显形：两条并发消息一条判 crisis 一条判 watch，
// 「先读再判再写」的写法有一个交错顺序会让 watch 覆盖掉 crisis，而条件 upsert 没有。
//
// 这同时就是「acute 之后不因下一条看起来正常的消息而清零」的执行点：全仓库除了
// clearRisk 之外没有任何地方写 session_risk_state.level，而 clearRisk 要求人工确认者
// 标识 + 冷静期已过。**没有任何自动降级路径。**
//
// ── decay_after 的确切含义 ──────────────────────────────────────────────────
// 它是「人工清除的最早时刻」，**不是**「到期自动降级的时刻」。Phase 1 没有任何代码
// 读它来降低等级 —— 自动衰减会让「表达痛苦 → 一段时间后系统若无其事」变成产品行为，
// 而 R1.21 明文要求显式冷静期 + 人工确认。把它叫成「冷静期终点」而不是「过期时间」，
// 是为了让下一个读这段代码的人不去加那条自动降级。

import { eq, sql } from 'drizzle-orm';

import { RISK_LEVELS, type RiskLevel } from '@drift/safety';
import { safetyEvent, sessionRiskState, type Executor } from '@drift/db';

/**
 * 各档位的冷静期长度 —— 即人工清除的最早时刻距进入该档位的时间。
 *
 * elevated / crisis 取 72 小时，直接对应 R1.35 的「会话内 risk_level >= concern 之后
 * 72 小时」禁止降温窗口。watch 取 24 小时。这三个数需要实测校准，但**窗口的存在**
 * 不需要校准。
 */
export const RISK_COOL_DOWN_MS: Readonly<Record<Exclude<RiskLevel, 'none'>, number>> = {
  watch: 24 * 60 * 60 * 1000,
  elevated: 72 * 60 * 60 * 1000,
  crisis: 72 * 60 * 60 * 1000,
};

/** `ARRAY['none','watch','elevated','crisis']::text[]` —— 序号由同一个常量数组生成。 */
const LEVEL_ORDER_SQL = `array[${RISK_LEVELS.map((level) => `'${level}'`).join(', ')}]::text[]`;

export interface RiskState {
  readonly level: RiskLevel;
  readonly enteredAt: Date;
  readonly decayAfter: Date | null;
  readonly clearedBy: string | null;
  readonly clearedAt: Date | null;
}

/** 读当前会话风险态。没有行 = 从未被抬升过 = 'none'。 */
export async function readRiskState(
  executor: Executor,
  conversationId: string,
): Promise<RiskState> {
  const rows = await executor
    .select({
      level: sessionRiskState.level,
      enteredAt: sessionRiskState.enteredAt,
      decayAfter: sessionRiskState.decayAfter,
      clearedBy: sessionRiskState.clearedBy,
      clearedAt: sessionRiskState.clearedAt,
    })
    .from(sessionRiskState)
    .where(eq(sessionRiskState.conversationId, conversationId));
  const row = rows[0];
  if (row === undefined) {
    return { level: 'none', enteredAt: new Date(0), decayAfter: null, clearedBy: null, clearedAt: null };
  }
  return row;
}

export async function readRiskLevel(
  executor: Executor,
  conversationId: string,
): Promise<RiskLevel> {
  return (await readRiskState(executor, conversationId)).level;
}

/**
 * 抬升会话风险态。**只升不降。**
 *
 * @returns 抬升后的实际等级（传入等级低于当前等级时返回的是当前等级，不是传入值）。
 */
export async function raiseRisk(
  executor: Executor,
  input: {
    readonly conversationId: string;
    readonly level: Exclude<RiskLevel, 'none'>;
    readonly now?: Date;
  },
): Promise<RiskLevel> {
  const now = input.now ?? new Date();
  const decayAfter = new Date(now.getTime() + RISK_COOL_DOWN_MS[input.level]);
  // ⚠️ 时间戳以 ISO 字符串 + 显式 ::timestamptz 传入，不传 Date 对象：drizzle 的裸
  // `sql` 模板会把 Date 直接交给 postgres.js 的预处理参数通道，而那条通道在
  // postgres@3.4.9 下对 Date 报 ERR_INVALID_ARG_TYPE（本 plan 实测）。这是裸 SQL 与
  // drizzle 的表达式构造器之间的一处真实差异，不是风格问题。
  await executor.execute(sql`
    insert into session_risk_state (conversation_id, level, entered_at, decay_after)
    values (
      ${input.conversationId},
      ${input.level},
      ${now.toISOString()}::timestamptz,
      ${decayAfter.toISOString()}::timestamptz
    )
    on conflict (conversation_id) do update
      set level = excluded.level,
          entered_at = excluded.entered_at,
          decay_after = excluded.decay_after,
          cleared_by = null,
          cleared_at = null
      where array_position(${sql.raw(LEVEL_ORDER_SQL)}, session_risk_state.level)
          < array_position(${sql.raw(LEVEL_ORDER_SQL)}, excluded.level)
  `);
  return readRiskLevel(executor, input.conversationId);
}

export class RiskClearRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RiskClearRefusedError';
  }
}

/**
 * 清除会话风险态 —— **人工动作**，两个前提缺一不可（R1.21）。
 *
 *  1. `clearedBy` 非空：清除留名。一次没有署名的清除在事后无法归因，而办法第二十三条
 *     的安全评估问的正是「干预管理情况」。
 *  2. 冷静期已过：`decay_after` 非空且不晚于 now。这条阻止「用户说完重话又若无其事，
 *     运营者顺手清掉」——那正是 R1.21 点名要防的行为。
 */
export async function clearRisk(
  executor: Executor,
  input: {
    readonly conversationId: string;
    readonly clearedBy: string;
    readonly now?: Date;
  },
): Promise<RiskState> {
  const clearedBy = input.clearedBy.trim();
  if (clearedBy.length === 0) {
    throw new RiskClearRefusedError(
      '清除会话风险态必须传入人工确认者标识（cleared_by）—— 没有署名的清除在事后无法归因',
    );
  }
  const now = input.now ?? new Date();
  const current = await readRiskState(executor, input.conversationId);
  if (current.level === 'none') {
    throw new RiskClearRefusedError(`会话 ${input.conversationId} 的风险态已是 none，无需清除`);
  }
  if (current.decayAfter === null || current.decayAfter.getTime() > now.getTime()) {
    throw new RiskClearRefusedError(
      `会话 ${input.conversationId} 的冷静期尚未结束（decay_after=${current.decayAfter?.toISOString() ?? 'null'}），拒绝清除`,
    );
  }
  await executor
    .update(sessionRiskState)
    .set({ level: 'none', clearedBy, clearedAt: now })
    .where(eq(sessionRiskState.conversationId, input.conversationId));
  return readRiskState(executor, input.conversationId);
}

/** safety_event 落库所需的主体信息（由调用方补，网关不知道它们）。 */
export interface SafetyEventSubject {
  readonly userId: string;
  readonly conversationId: string;
  /** 触发这次判定的那条用户消息。候选回复没有落库（它被拦下了）。 */
  readonly messageId: string | null;
}

/**
 * safety_event 的**全仓唯一** insert 点（R1.25 的全量留证）。
 *
 * 为什么必须收敛到一处：字段集合就是留证的内容，而多处 insert 会分叉 —— 某一处少写
 * classifier_model_snapshot，SAFE-02 的事后复核对那些行就失效了，而不会有任何报错。
 * tools/ci 侧由一条 grep 断言（Task 3 的 `<verify>`）挡住第二处 insert。
 *
 * 表属审计表族（0001 迁移对 app_role REVOKE UPDATE, DELETE），所以这里只有 insert。
 */
export async function writeSafetyEvent(
  executor: Executor,
  draft: {
    readonly previousLevel: RiskLevel;
    readonly level: RiskLevel;
    readonly ruleHits: readonly string[];
    readonly classifierStatus: 'ok' | 'failed';
    readonly classifierModelSnapshot: string | null;
    readonly candidateReplyHash: string;
    readonly candidateReplyLen: number;
    readonly overrideApplied: boolean;
  },
  subject: SafetyEventSubject,
): Promise<string> {
  const rows = await executor
    .insert(safetyEvent)
    .values({
      userId: subject.userId,
      conversationId: subject.conversationId,
      messageId: subject.messageId,
      // R1.25 的 risk 轨迹：前一等级 → 新等级，各占一列。
      previousLevel: draft.previousLevel,
      level: draft.level,
      ruleHits: [...draft.ruleHits],
      classifierStatus: draft.classifierStatus,
      classifierModelSnapshot: draft.classifierModelSnapshot,
      candidateReplyHash: draft.candidateReplyHash,
      candidateReplyLen: draft.candidateReplyLen,
      overrideApplied: draft.overrideApplied,
    })
    .returning({ id: safetyEvent.id });
  const row = rows[0];
  if (row === undefined) throw new Error('safety_event 插入未返回行');
  return row.id;
}
