// 两档硬退出关键词过滤器（COMPLY-05 / D-12 / RESEARCH §9.1）。
//
// ── 代码级过滤器，不是 prompt 约束 ─────────────────────────────────────────
// prompt 约束会在长上下文里失效（PITFALLS-SAFETY R1.33），且不可测。本文件
// 不 import、不调用任何模型路由 —— 退出意图判定是纯代码，20+ 条含阴性的
// 测试集（tests/probes/exit-keywords/）钉住它。
//
// ── 子串匹配会误杀，这是本文件存在的理由 ───────────────────────────────────
// 「我不想聊这个话题」包含第一档词条「不想聊」。按子串（includes/indexOf）
// 实现，会在用户只是想**换话题**时硬退出整个会话 —— 没有任何报错，只会被
// 读成「这个产品有 bug」。因此匹配是**整句锚定 + 长度上限**：
//   归一化后的整句 == 某词条，或（整句以某词条结尾 且 全句长度 ≤ 词条长度 + 4）
// 4 个字符的余量只够容纳「我想退出」「那就结束」这类前缀/语气成分，装不下
// 一个新话题。tools/ci/exit-ui-contract.test.ts grep 禁止本文件出现子串匹配。
//
// ── 两档（D-12 原文）──────────────────────────────────────────────────────
//   第一档 —— 明确指令 ⇒ 立即硬退出（executeHardExit，走 COMPLY-05 全套）。
//   第二档 —— 模糊告别 ⇒ 只落 exit_intent 事件、不触发任何动作（为 Phase 5
//   的 SAFE-11「退出意图处只能减少消息、永不增加」预留数据）。
//
// ⚠️ 不做繁→简转换：Phase 1 的用户输入以简体为主，引入转换表是一份新的词表
// 面积；测试集里有一条繁体阴性样本（exit.neg.traditional-01）钉住「繁体输入
// 不会被误判」这个方向。Phase 2 若引入转换，阴性样本随之升级为正样本。

/** 第一档（D-12 逐字）：明确指令 ⇒ 立即硬退出。 */
export const EXIT_TIER1 = ['退出', '结束', '停', '别发了', '不想聊了', '不想聊'] as const;

/** 第二档（D-12 逐字）：模糊告别 ⇒ 只落 exit_intent，不动作。 */
export const EXIT_TIER2 = ['明天聊', '先这样', '睡了'] as const;

export type ExitTier1Word = (typeof EXIT_TIER1)[number];
export type ExitTier2Word = (typeof EXIT_TIER2)[number];

/** 整句锚定的长度余量：词条结尾匹配时全句最多比词条长这么多（见文件头）。 */
export const EXIT_ANCHOR_SLACK = 4;

/** 归一化时被去掉的字符：空白、零宽、常见中英标点、emoji。 */
const STRIPPED_CHARACTERS =
  /[\s\u3000\u200b\u200c\u200d\ufeff，。、；：！？…—·～,.;:!?~'“”‘’()（）\[\]【】《》<>\-_*#]/gu;

/** emoji 与符号类字符（Extended_Pictographic —— 归一化时整类剥掉）。 */
const EMOJI_CHARACTERS = /\p{Extended_Pictographic}/gu;

/** 全角 ASCII（U+FF01–U+FF5E）到半角的偏移量。 */
const FULLWIDTH_OFFSET = 0xfee0;

/**
 * 归一化：全角转半角 → 去掉 emoji/空白/零宽/标点 → 小写。纯函数。
 *
 * 与 retention-words.ts 的 normalizeForRetentionMatch 同一条管道形态，差异
 * 只在多剥一层 emoji —— 挽留匹配管的是模型输出（中文短语），退出匹配管的
 * 是用户输入（表情包时代的真实句子）。
 */
export function normalizeUtterance(text: string): string {
  const halfWidth = text.replace(/[\uff01-\uff5e]/gu, (character) =>
    String.fromCodePoint((character.codePointAt(0) ?? 0) - FULLWIDTH_OFFSET),
  );
  return halfWidth
    .replace(EMOJI_CHARACTERS, '')
    .replace(STRIPPED_CHARACTERS, '')
    .toLowerCase();
}

/** 整句锚定判定：归一化后的句子等于词条，或以词条结尾且长度在余量内。 */
function anchoredMatch(normalized: string, word: string): boolean {
  if (normalized === word) return true;
  return normalized.endsWith(word) && normalized.length <= word.length + EXIT_ANCHOR_SLACK;
}

export interface ExitIntent {
  /** 1 = 第一档（硬退出）；2 = 第二档（只落事件）；null = 不是退出意图。 */
  readonly tier: 1 | 2 | null;
  /** 命中的词条原文。tier 为 null 时也为 null。 */
  readonly matched: ExitTier1Word | ExitTier2Word | null;
}

/**
 * 判定一段用户输入是否表达退出意图。
 *
 * 判定顺序：先第一档后第二档（同一句同时命中两档时按更重的一档走）。词表
 * 内部按长度降序尝试，让「不想聊了」先于「不想聊」命中 —— matched 报更
 * 具体的那一条。
 */
export function matchExitIntent(text: string): ExitIntent {
  const normalized = normalizeUtterance(text);
  if (normalized.length === 0) return { tier: null, matched: null };

  const tier1 = [...EXIT_TIER1].sort((a, b) => b.length - a.length);
  for (const word of tier1) {
    if (anchoredMatch(normalized, word)) {
      return { tier: 1, matched: word };
    }
  }
  const tier2 = [...EXIT_TIER2].sort((a, b) => b.length - a.length);
  for (const word of tier2) {
    if (anchoredMatch(normalized, word)) {
      return { tier: 2, matched: word };
    }
  }
  return { tier: null, matched: null };
}
