// 提示词注册表（PLAT-08）。
//
// ── 真相源在 git，且只在 git ──────────────────────────────────────────────────
// Langfuse v4 有完整的 Prompt Management（版本控制、label 部署、trace 关联），
// 诱惑是把提示词托管在那里。但那会让一个**可观测性组件变成聊天主链路的运行时
// 依赖** —— Langfuse 挂了，角色就不会说话了。更糟的是它会让 git 里的版本与实际
// 生效的版本无声分叉，而 prompt_version 的全部价值就在于「这一行数据是哪一版
// 提示词产生的」这个问题有唯一答案。
//
// 所以本文件里**没有**任何网络读取、任何数据库查询、任何环境变量读取：
// text 只能来自同目录下 .ts 文件里的字符串常量。
// tools/ci/prompt-version.test.ts 对 packages/prompts/src 做一次字面扫描守这条。

import {
  CHAT_REPLY_SYSTEM_PROMPT,
  CHAT_REPLY_SYSTEM_VERSION,
} from './chat-reply.ts';
import {
  SAFETY_CLASSIFY_SYSTEM_PROMPT,
  SAFETY_CLASSIFY_SYSTEM_VERSION,
} from './safety-classify.ts';

/** 提示词 id。与 llm_call.purpose 相关但不相等：一个角色可以有多段提示词。 */
export type PromptId = 'chat.reply.system' | 'safety.classify.system';

export interface RegisteredPrompt {
  readonly id: PromptId;
  readonly text: string;
  /** promptVersion(text)。与各自模块里的常量是**同一个值**，不是重新算一遍。 */
  readonly version: string;
}

/**
 * 注册表。
 *
 * version 复用各模块导出的常量而不是在这里重算：重算会产生第二个计算点，
 * 而两个计算点在归一化规则被改动时会分叉 —— 那正是本文件要防的形态。
 */
export const PROMPTS: Readonly<Record<PromptId, RegisteredPrompt>> = Object.freeze({
  'chat.reply.system': {
    id: 'chat.reply.system',
    text: CHAT_REPLY_SYSTEM_PROMPT,
    version: CHAT_REPLY_SYSTEM_VERSION,
  },
  'safety.classify.system': {
    id: 'safety.classify.system',
    text: SAFETY_CLASSIFY_SYSTEM_PROMPT,
    version: SAFETY_CLASSIFY_SYSTEM_VERSION,
  },
});

export const PROMPT_IDS = ['chat.reply.system', 'safety.classify.system'] as const satisfies readonly PromptId[];
