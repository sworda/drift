// 出站安全网关 —— **全仓库唯一**把 string 提升为 GatedText 的地方（D-15）。
//
// 三个出口（WS 投递、消息落库、导出渲染）的签名只接受 GatedText，于是「有没有一条
// 生成路径绕过了网关」这件事由编译器回答，而不是由 code review 回答。
//
// 本文件里有全仓唯一一处 `as GatedText`。eslint.config.js 对这条断言设了仓库级禁令，
// 豁免写在使用点上而不是配置的 ignores 里 —— 让「谁绕过了这条禁令」在 diff 里看得见。
//
// ── 三条不可协商的行为 ──────────────────────────────────────────────────────
//
//  1. **会话已结束 ⇒ 拒绝产出**（COMPLY-05 硬退出的「当前会话零出站」）。判据是
//     fail-closed：网关不产出 GatedText，于是三个出口在类型层拿不到可投递的东西。
//     这比在 UI 层隐藏消息强得多 —— 队列里的延迟任务同样过不去。
//  2. **classifierStatus === 'failed' ⇒ level 强制 elevated**（SAFE-05）。实现手段是
//     类型：Classification 是一个 discriminated union，`failed` 分支**没有 level 字段**，
//     所以调用方无法构造 `{ level: 'none', classifierStatus: 'failed' }`。
//     为什么是 elevated 而不是 crisis：crisis 会联络紧急联系人 —— 那是一次针对第三方
//     的个人信息使用 + 一次虚假警报。分类器 bug 不该让别人的手机响。
//  3. **elevated / crisis ⇒ 不产出 GatedText**。Phase 1 不填关怀卡片内容（Plan 07），
//     但也**不放人格回复过去**。「出错了就降级为直接下发人格回复」在功能上正确、
//     在合规上是一条绕过网关的路径 —— 这正是成功标准 2 要求证明不存在的东西。

import type { GatedText } from '@drift/contract';

export const RISK_LEVELS = ['none', 'watch', 'elevated', 'crisis'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** 通过网关的等级（可以带回复出站）与必须覆写的等级。 */
export type PassableLevel = 'none' | 'watch';
export type EscalatedLevel = 'elevated' | 'crisis';

/**
 * 分类结果。
 *
 * ⚠️ 两个分支不对称是**故意的**：`failed` 分支没有 level 字段，因此
 * `{ level: 'none', classifierStatus: 'failed' }` 在类型层不可表达。
 * 如果改成 `{ level: RiskLevel; classifierStatus: 'ok' | 'failed' }`，
 * SAFE-05 的 fail-closed 就退化成一句「记得在调用方把 level 改掉」。
 */
export type Classification =
  | { readonly classifierStatus: 'ok'; readonly level: RiskLevel }
  | { readonly classifierStatus: 'failed' };

export interface GatewayInput {
  readonly candidateText: string;
  readonly classification: Classification;
  /**
   * 会话当前状态。Phase 1 由调用方在**同一个事务里**读出来传进来；
   * Plan 12 把这次读挪进网关内部，让调用方连「传一个过期状态」都做不到。
   */
  readonly conversationStatus: 'active' | 'ended';
}

export type GatedResult =
  | {
      readonly outcome: 'gated';
      readonly text: GatedText;
      readonly level: PassableLevel;
      readonly classifierStatus: 'ok';
      readonly overrideApplied: false;
    }
  | {
      readonly outcome: 'escalated';
      readonly level: EscalatedLevel;
      readonly classifierStatus: 'ok' | 'failed';
      readonly overrideApplied: true;
    }
  | {
      readonly outcome: 'refused';
      readonly reason: 'conversation_ended';
    };

/** classifierStatus 与 level 的合并规则（SAFE-05 的 fail-closed 就在这里）。 */
function effectiveLevel(classification: Classification): RiskLevel {
  return classification.classifierStatus === 'failed' ? 'elevated' : classification.level;
}

/**
 * 出站安全网关。
 *
 * 返回 `gated` 时才有 GatedText；其余两种结果**不含任何可投递的文本**。
 */
export function safetyGateway(input: GatewayInput): GatedResult {
  if (input.conversationStatus !== 'active') {
    // fail-closed。硬退出之后队列里残留的延迟任务也走这一条。
    return { outcome: 'refused', reason: 'conversation_ended' };
  }

  const level = effectiveLevel(input.classification);
  if (level === 'elevated' || level === 'crisis') {
    return {
      outcome: 'escalated',
      level,
      classifierStatus: input.classification.classifierStatus,
      overrideApplied: true,
    };
  }

  // ⬇⬇⬇ 全仓库唯一的 GatedText 产出点。这一行之外的任何 as GatedText 都是绕过。
  // eslint-disable-next-line no-restricted-syntax -- 见文件头：唯一产出点的豁免写在使用点上
  const text = input.candidateText as GatedText;

  return {
    outcome: 'gated',
    text,
    level,
    classifierStatus: 'ok',
    overrideApplied: false,
  };
}

/**
 * 解析 safety.classify 的模型输出。
 *
 * 解析失败 ⇒ `{ classifierStatus: 'failed' }`，而不是「当成 none」。
 * 这是 SAFE-05 三类失败里的第二类（结构化输出 schema 校验失败）。
 */
export function parseClassification(raw: string): Classification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { classifierStatus: 'failed' };
  }
  if (typeof parsed !== 'object' || parsed === null || !('level' in parsed)) {
    return { classifierStatus: 'failed' };
  }
  const level = (parsed as { level: unknown }).level;
  if (typeof level !== 'string' || !(RISK_LEVELS as readonly string[]).includes(level)) {
    return { classifierStatus: 'failed' };
  }
  return { classifierStatus: 'ok', level: level as RiskLevel };
}
