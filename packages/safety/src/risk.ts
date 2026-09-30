// 风险等级与 fail-closed 的合并规则（SAFE-05）。
//
// 这个文件从 gateway.ts 拆出来的理由不是整洁：**判定规则与判定的执行点必须可以分别
// 被单元测试**。合并规则是一个纯函数（入站建议等级 + 分类结果 → 最终等级），它没有
// 任何 I/O，因此可以被穷举；而网关有 safety_event 落库回调与关怀卡片构造，穷举它的
// 代价高得多。把规则留在网关里的后果是：resolveRisk 的每一条分支都只能经由网关被间接
// 验证，于是「规则层只能抬升」这件事会没有一条直接断言。
//
// ⚠️ RISK_LEVELS / CLASSIFIER_STATUSES / Classification 的**定义**在本文件（gateway.ts
// 从这里 import，不再自己声明）。packages/db 的 schema/safety.ts 与 packages/prompts 的
// safety-classify.ts 各有一份同名取值域 —— 那两份是刻意的独立声明（叶子包不依赖会读库
// 的包），分叉由 tools/ci/prompt-version.test.ts 的集合相等断言挡着。

/** R1.21 的四个取值：none 加三个触发档。 */
export const RISK_LEVELS = ['none', 'watch', 'elevated', 'crisis'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * SAFE-05 明文的「三档」。
 *
 * ⚠️ 只有 crisis 触发联络通道。watch 与 elevated 都**不联络** —— 一级（极端情绪）
 * 走 elevated，而 SAFE-03 明文「不联络紧急联系人」。
 */
export const TRIGGERING_RISK_LEVELS = ['watch', 'elevated', 'crisis'] as const;
export type TriggeringRiskLevel = (typeof TRIGGERING_RISK_LEVELS)[number];

/** 唯一会触发联络通道的等级。写成常量而不是字面量散落各处，便于 grep「谁会联络」。 */
export const CONTACT_TRIGGERING_LEVEL = 'crisis' satisfies RiskLevel;

export const CLASSIFIER_STATUSES = ['ok', 'failed'] as const;
export type ClassifierStatus = (typeof CLASSIFIER_STATUSES)[number];

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

/** 严重度序号。比较用它而不是字符串序 —— 字符串序下 'crisis' < 'none' < 'watch'。 */
export function riskRank(level: RiskLevel): number {
  return RISK_LEVELS.indexOf(level);
}

/** 两个等级中较高的那个。 */
export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return riskRank(a) >= riskRank(b) ? a : b;
}

export function isEscalatedLevel(level: RiskLevel): level is EscalatedLevel {
  return level === 'elevated' || level === 'crisis';
}

/**
 * 入站规则层建议等级 + 分类结果 → 最终等级。
 *
 * 两条规则，都不可协商：
 *
 *  1. **规则层只能抬升，不能降低。** 分类器判 none 而规则层建议 elevated 时最终仍是
 *     elevated（取两者中较高者）。规则层是高召回层（宁可误报），它的判定不具决定性
 *     ——「不具决定性」的正确含义是「不能用来降级」，不是「可以被忽略」。
 *
 *  2. **分类器失败 ⇒ 恒为 elevated，且封顶在 elevated。**「封顶」是这里唯一可能被
 *     读错的一处，所以写清理由：crisis 是唯一会联络第三方的档位，而按 SAFE-01/02 的
 *     设计，具决定性的判定是分类器给的。分类器失败意味着我们**没有**决定性判定 ——
 *     此时靠一条高召回正则去发起一次针对第三方的个人信息使用 + 一次可能的虚假警报，
 *     方向是错的。所以失败分支既不向下（不回落 none），也不向上（不升 crisis）。
 *     这同时让「三类失败全部映射为 elevated 而非 crisis」成为一条可以穷举的断言。
 */
export function resolveRisk(
  inboundSuggested: RiskLevel,
  classification: Classification,
): RiskLevel {
  if (classification.classifierStatus === 'failed') return 'elevated';
  return maxRisk(inboundSuggested, classification.level);
}
