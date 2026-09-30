// 禁用词扫描的核心词表与纯函数（UI-SPEC〔禁用〕Banned-term rules 规则 1–4，PRIV-06）。
//
// **一份定义，两个消费者**（与 retention-words.ts 同一条理由）：
//   1. tools/ci/banned-terms.test.ts 的源码层扫描（apps/web 下全部文案来源）；
//   2. apps/web 的 RTL 渲染层断言 —— 只扫源码扫不到渲染结果（RESEARCH §11.3 的第四个
//      静默失效），两个消费者必须跑**同一张词表**，所以它不能定义在任何一个 .test 文件里。
//
// 归一化直接复用 normalizeForRetentionMatch —— 它已经实现了「去空白（含全角/零宽）→
// 全角转半角 → 去常见标点 → 小写」，正是禁用词扫描要的那条管道。再写一份的差异迟早
// 出现在「匿 名」与「ａnonymous」这类绕过上，而那正是归一化存在的理由。

import { RETENTION_PHRASES } from './retention-words.ts';

export { normalizeForRetentionMatch as normalizeForScan } from './retention-words.ts';
import { normalizeForRetentionMatch as normalizeForScan } from './retention-words.ts';

/**
 * 规则 1（PRIV-06 · 阶段成功标准 3）：隐私政策与隐私中心全文不得出现的词。
 * 'anonymous' 一项覆盖 Anonymous / ANONYMOUS —— 归一化已统一小写，逐个大小写变体
 * 是同一张表的三个冗余项。L0 配有 ID 映射表，属**去标识化**而非匿名化，写「匿名」的
 * 性质不是技术风险，而是虚假陈述（个保法第七十三条）。
 */
export const BANNED_TERMS = [
  '匿名',
  'anonymous',
  '无法关联到你',
  '无法关联到您',
  '不可追溯到你',
] as const;

/**
 * 规则 3（PROJECT.md Out of Scope 明文）：研究平台抗辩表述。
 * 「及其同义表述」天然列不全 —— 这张表是机械下界，不是语义判定；UI-SPEC 对该规则的
 * 引述本身也写明了枚举的困难。列表里是能被逐字识别的几种最短形式。
 */
export const RESEARCH_DEFENSE_PHRASES = [
  '研究平台所以不适用',
  '研究平台不适用',
  '研究用途不受本办法',
  '研究目的不受本办法',
] as const;

/**
 * 规则 4：AI 标识可关闭表述 —— 任何用户可见文案不得把 AI 标识写成可选或可关闭。
 * 明示标识是《人工智能拟人化互动服务管理暂行办法》的硬要求，「关闭提示」类的控制
 * 文案等于提供一个关掉法定标识的开关。
 */
export const AI_LABEL_OFF_PHRASES = ['关闭 AI 提示', '隐藏 AI 标识', '不再显示'] as const;

export type BannedTermRule = 1 | 2 | 3 | 4;

/** 一次命中：哪条规则、哪个词。 */
export interface BannedTermHit {
  readonly rule: BannedTermRule;
  readonly term: string;
}

/**
 * 扫一段文本（源码、Markdown、渲染后的 textContent —— 对调用方一视同仁）。
 * **纯函数**：不读盘、不连库、不连网，负向 fixture 可以直接喂输入。
 * 返回全部命中；空数组 = 通过。命中信息带规则号与词本身，失败时能直接指出问题。
 */
export function scanBannedTerms(text: string): readonly BannedTermHit[] {
  const normalized = normalizeForScan(text);
  const hits: BannedTermHit[] = [];
  const check = (terms: readonly string[], rule: BannedTermRule): void => {
    for (const term of terms) {
      if (normalized.includes(normalizeForScan(term))) hits.push({ rule, term });
    }
  };
  check(BANNED_TERMS, 1);
  // 规则 2 的词表**只有这一处定义**（retention-words.ts）—— 运行时出站断言（gateway）
  // 与源码 / 渲染层扫描共享同一份，复制第二份的两处会分叉。
  check(RETENTION_PHRASES, 2);
  check(RESEARCH_DEFENSE_PHRASES, 3);
  check(AI_LABEL_OFF_PHRASES, 4);
  return hits;
}
