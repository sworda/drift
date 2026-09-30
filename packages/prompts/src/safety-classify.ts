// safety.classify 的系统提示词与输出契约（SAFE-02 / SAFE-05）。
//
// ⚠️ 这段提示词里**不得出现任何角色名、人格描述或语体指令**。理由不是整洁：
// 人格指令会与安全指令竞争，并系统性降低分类器的敏感度 —— 一个被要求「温柔、
// 不要否定对方」的分类器会倾向于把危机表达读成情绪表达。这正是 SAFE-02 要求
// 「危机判定由与扮演角色不同的模型执行」的同一条理由，在提示词层面的表现。
// tools/ci/prompt-version.test.ts 断言本文件的提示词文本不含任何种子角色的名字。
//
// 输出契约用 zod 声明而不是「让模型自由回答再解析」：结构化输出校验失败是 SAFE-05
// 三类失败中的第二类，必须能被判定为 failed 并 fail-closed 到 elevated，
// 而不是被当成 none 放过去。

import { z } from 'zod';

import { promptVersion } from './version.ts';

/**
 * 风险四档。
 *
 * ⚠️ 取值与 packages/safety 的 RISK_LEVELS、packages/db 的 session_risk_state
 * 取值域必须逐字一致 —— tools/ci/prompt-version.test.ts 用一条集合相等断言守着。
 * 这里独立声明而不是 import：packages/prompts 是**零业务依赖**的叶子包（真相源在
 * git 的这一条要求它不依赖任何会读库的包），所以用断言而不是共享符号来防分叉。
 */
export const SAFETY_CLASSIFY_LEVELS = ['none', 'watch', 'elevated', 'crisis'] as const;
export type SafetyClassifyLevel = (typeof SAFETY_CLASSIFY_LEVELS)[number];

/** 命中类别。判定依据的分类，用于事后复核「为什么判了这一档」。 */
export const SAFETY_HIT_CATEGORIES = [
  'self_harm',
  'suicidal_intent',
  'harm_to_others',
  'abuse_disclosure',
  'medical_emergency',
  'minor_at_risk',
  'none',
] as const;
export type SafetyHitCategory = (typeof SAFETY_HIT_CATEGORIES)[number];

/** 分类器的输出契约。校验失败 ⇒ classifierStatus='failed' ⇒ fail-closed 到 elevated。 */
export const SafetyClassifyOutput = z.object({
  level: z.enum(SAFETY_CLASSIFY_LEVELS),
  /** 低于阈值同样走 fail-closed（SAFE-05 的第三类失败）。 */
  confidence: z.number().min(0).max(1),
  categories: z.array(z.enum(SAFETY_HIT_CATEGORIES)),
});
export type SafetyClassifyOutput = z.infer<typeof SafetyClassifyOutput>;

/**
 * 系统提示词。
 *
 * 判定对象是「用户消息 + 候选回复 + 会话风险态」三者，且**在人格渲染之后**执行
 * （成功标准 2）。顺序不是实现细节：对一段还没生成完的回复做危机判定要么漏判，
 * 要么把正常回复拦成危机。
 */
export const SAFETY_CLASSIFY_SYSTEM_PROMPT = [
  '你是一个安全分类器。你的唯一任务是对一轮对话做风险判定，并只输出 JSON。',
  '',
  '判定原则：',
  `- 只输出 JSON，不要解释、不要复述输入、不要给建议。`,
  '- 宁可判高不可判低：漏判的代价是一条真实危机被当成普通情绪处理。',
  '- 你判定的是「这一轮是否需要危机干预」，不是「这段回复写得好不好」。',
  '- 候选回复本身如果在鼓励、美化或提供自我伤害的方法，同样算命中。',
  '',
  `level 取值（严重度升序）：${SAFETY_CLASSIFY_LEVELS.join(' < ')}`,
  `categories 取值：${SAFETY_HIT_CATEGORIES.join(' | ')}`,
  '',
  '输出格式（且只有这一个对象）：',
  '{"level":"none","confidence":0.0,"categories":["none"]}',
].join('\n');

/** 系统提示词的内容哈希。注册表与 buildSafetyClassifyPrompt 共用这一个值。 */
export const SAFETY_CLASSIFY_SYSTEM_VERSION = promptVersion(SAFETY_CLASSIFY_SYSTEM_PROMPT);

export interface BuiltPrompt {
  readonly text: string;
  readonly version: string;
}

export function buildSafetyClassifyPrompt(input: {
  readonly userText: string;
  readonly candidateReply: string;
  readonly sessionRiskLevel: string;
}): BuiltPrompt {
  const text = [
    SAFETY_CLASSIFY_SYSTEM_PROMPT,
    '',
    `会话当前风险态：${input.sessionRiskLevel}`,
    `用户消息：${input.userText}`,
    `候选回复：${input.candidateReply}`,
  ].join('\n');
  // ⚠️ version 是**系统提示词**的哈希，不是拼装后整段文本的哈希。
  // 拼装后的文本每轮都不同（它带着用户消息），那样的 prompt_version 每行都不重复，
  // 于是「当时生效的是哪一版提示词」这个问题反而答不出来 —— 而那正是 PLAT-08
  // 要回答的问题。逐轮输入的同一性由 llm_call.input_hash 负责。
  return { text, version: SAFETY_CLASSIFY_SYSTEM_VERSION };
}
