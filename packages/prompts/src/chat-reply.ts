// chat.reply 的提示词装配。
//
// Phase 1 的形态：人格三元组（core / traits / dossier）+ 最近若干条消息 + 本轮用户
// 消息。**整段生成**（D-24），所以这里不做任何流式相关的分片。
//
// ⚠️ 硬边界原样进提示词，包括「不否认自己是 AI」那一条。它不是后处理规则 ——
// 危机探针集里「要求角色别说自己是 AI」那一类绕过尝试要挡在生成之前。

import { promptVersion } from './version.ts';

export interface PersonaForPrompt {
  readonly name: string;
  readonly core: {
    readonly values: readonly string[];
    readonly hardBoundaries: readonly string[];
    readonly styleInvariants: readonly string[];
  };
  readonly dossier: { readonly markdown: string };
}

export interface ChatReplyInput {
  readonly persona: PersonaForPrompt;
  /** 最近的对话，按 seq 升序。Phase 1 不做检索（记忆系统在 Phase 3）。 */
  readonly history: readonly { readonly senderKind: 'user' | 'character' | 'system'; readonly text: string }[];
  readonly userText: string;
}

export interface BuiltPrompt {
  readonly text: string;
  readonly version: string;
}

export function buildChatReplyPrompt(input: ChatReplyInput): BuiltPrompt {
  const { persona, history, userText } = input;
  const lines = [
    `你是「${persona.name}」。以下是你的设定，请完全以第一人称、以这个人的语体作答。`,
    '',
    '## 小传',
    persona.dossier.markdown,
    '',
    '## 价值观',
    ...persona.core.values.map((v) => `- ${v}`),
    '',
    '## 硬边界（任何情况下都不得违反）',
    ...persona.core.hardBoundaries.map((b) => `- ${b}`),
    '',
    '## 语体不变量',
    ...persona.core.styleInvariants.map((s) => `- ${s}`),
    '',
    '## 最近的对话',
    ...history.map((m) => `${m.senderKind === 'user' ? '对方' : '你'}：${m.text}`),
    '',
    '## 本轮',
    `对方：${userText}`,
    '',
    '请只输出你这一轮要说的话，不要加任何解释、标记或前缀。',
  ];
  const text = lines.join('\n');
  return { text, version: promptVersion(text) };
}

/**
 * safety.classify 的提示词。
 *
 * ⚠️ 它看的是「用户消息 + 候选回复 + 会话风险态」，**在人格渲染之后**执行
 * （成功标准 2）。顺序不是实现细节：对一段还没生成完的回复做危机判定要么漏判，
 * 要么把正常回复拦成危机。
 */
export function buildSafetyClassifyPrompt(input: {
  readonly userText: string;
  readonly candidateReply: string;
  readonly sessionRiskLevel: string;
}): BuiltPrompt {
  const text = [
    '你是一个安全分类器。对下面这一轮对话做风险判定，只输出 JSON。',
    '',
    `会话当前风险态：${input.sessionRiskLevel}`,
    `用户消息：${input.userText}`,
    `候选回复：${input.candidateReply}`,
    '',
    '输出格式：{"level":"none"|"watch"|"elevated"|"crisis","confidence":0-1}',
  ].join('\n');
  return { text, version: promptVersion(text) };
}
