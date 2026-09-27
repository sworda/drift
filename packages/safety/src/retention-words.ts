// 挽留语义词表（UI-SPEC〔禁用〕规则 2 / COMPLY-05 / PROJECT.md 永久排除项）。
//
// **一份定义，两个消费者**：
//   1. 本包 gateway.ts 的运行时出站断言 —— 命中即不产出 GatedText 并记 safety_event；
//   2. Plan 10 的 banned-terms.test.ts 规则 2 源码 grep —— 它直接 import 本文件。
//
// 为什么运行时断言不可省：**源码 grep 抓不到模型生成的挽留话术**（RESEARCH §9.2）。
// 禁用词扫描守的是我们自己写的文案，而挽留话术的真实来源是模型输出 —— 用源码 grep
// 代替运行时断言是一次静默的护栏缺失：CI 一直绿，而用户每天都在被挽留。
//
// 验收目标是**触发率恒为 0**，不是「低」。因此这里的取舍一律偏向过拦截：
// 归一化会去掉空白、零宽字符与常见标点，于是「别，走」「别 走」「别\u200b走」都算命中。
// 代价是极少数非挽留语句会被误拦（例如角色说「我不要，走了」），后果是该轮不产出回复
// 而不是产出一句挽留 —— 这个方向的错误是可接受的那一个。

/**
 * UI-SPEC〔禁用〕规则 2 的七个词，逐字取自契约。
 *
 * ⚠️ 全仓库只允许有这一处定义。复制成第二份之后两处会分叉，而分叉的那一天不会有
 * 任何检查变红 —— tools/ci 与 Plan 10 的禁用词扫描都 import 本常量。
 */
export const RETENTION_PHRASES = [
  '别走',
  '再陪我',
  '再聊一会',
  '你要离开我了吗',
  '我会想你的',
  '确定要离开吗',
  '不要走',
] as const;

export type RetentionPhrase = (typeof RETENTION_PHRASES)[number];

/**
 * 归一化时被去掉的字符：空白（含全角空格）、零宽字符、常见中英标点。
 *
 * 零宽字符是这里最不直觉、也最必要的一类：模型输出里出现一个 U+200B 不会被任何人
 * 看见，而它足以让一次朴素的 includes 匹配失手。
 */
const STRIPPED_CHARACTERS =
  /[\s\u3000\u200b\u200c\u200d\ufeff，。、；：！？…—·～,.;:!?~'"“”‘’()（）\[\]【】《》<>\-_*#]/gu;

/** 全角 ASCII（U+FF01–U+FF5E）到半角的偏移量。 */
const FULLWIDTH_OFFSET = 0xfee0;

/** 归一化：全角转半角 → 去掉空白/零宽/标点 → 小写。纯函数，无副作用。 */
export function normalizeForRetentionMatch(text: string): string {
  const halfWidth = text.replace(/[\uff01-\uff5e]/gu, (character) =>
    String.fromCodePoint((character.codePointAt(0) ?? 0) - FULLWIDTH_OFFSET),
  );
  return halfWidth.replace(STRIPPED_CHARACTERS, '').toLowerCase();
}

/**
 * 返回命中的挽留词（按词表顺序，无命中则空数组）。
 *
 * 词表本身也过一次归一化：七个词当前都不含被剥离的字符，但让两侧走同一条归一化
 * 管道，是为了「以后有人往词表里加一个带空格的词」时匹配不会静默失效。
 */
export function hitsRetentionPhrase(text: string): readonly RetentionPhrase[] {
  const normalized = normalizeForRetentionMatch(text);
  return RETENTION_PHRASES.filter((phrase) =>
    normalized.includes(normalizeForRetentionMatch(phrase)),
  );
}
