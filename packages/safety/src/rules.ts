// 入站规则层（R1.20 的第一层）—— 正则 + 词典，高召回、宁可误报。
//
// 它在**用户消息落库之后、人格渲染之前**跑，作用是抬升 session_risk_state，
// 而不是做出决定性判定（决定性判定是 safety.classify，在人格渲染之后）。
//
// ── 三条设计约束 ────────────────────────────────────────────────────────────
//
//  1. **只升不降。** 本层返回的是一个「建议等级」，resolveRisk 取它与分类结果中较高的
//     那一个。本层永远不会让等级下降，因此一条误报的代价是一次误升级（用户看到关怀
//     卡片而不是回复），而不是一次漏判。
//  2. **不做金额阈值推断**（Q7）。「被骗了 3 万」与「被套走了房款」都算重大财产损失；
//     但我们不去猜「多少钱算重大」—— 阈值会把一个法定判据变成一次拍脑袋的参数，而
//     猜错的方向无法预测。判据是**明确的表述形态**（被骗 / 赌输全部 / 积蓄没了 /
//     房款被套走），不是金额大小。
//  3. **词表是词表，不是语义模型。** 同义、隐喻、外语与角色扮演包装的绕过不在本层的
//     能力范围内 —— 那是第二层（分类器）与 L6 探针集（Plan 08）的职责。把本层当成
//     完整防线，是本文件唯一的误用方式。
//
// ⚠️ 归一化复用 retention-words.ts 的 normalizeForRetentionMatch：全角转半角、去掉
// 空白/零宽/标点。理由与那里相同 —— 一个 U+200B 不会被任何人看见，却足以让朴素的
// includes 匹配失手。因此规则里的 pattern 一律写成**归一化后**的形态（无标点、无空格）。

import { normalizeForRetentionMatch } from './retention-words.ts';
import type { RiskLevel } from './risk.ts';
import { maxRisk } from './risk.ts';

/** 命中类别。与 packages/prompts 的 SAFETY_HIT_CATEGORIES 同域，便于事后合并复核。 */
export const INBOUND_RULE_CATEGORIES = [
  'self_harm',
  'suicidal_intent',
  'major_property_loss',
  'extreme_emotion',
] as const;
export type InboundRuleCategory = (typeof INBOUND_RULE_CATEGORIES)[number];

export interface InboundRule {
  /** 稳定 id。safety_event.rule_hits 存的就是它 —— 不存用户原文。 */
  readonly id: string;
  readonly category: InboundRuleCategory;
  /**
   * 建议等级。
   *
   * 自残自杀意图与重大财产损失 = 第十三条第二级 ⇒ crisis（会联络）。
   * 极端情绪 = 第十三条第一级 ⇒ elevated（**不联络**，SAFE-03 明文）。
   */
  readonly level: Extract<RiskLevel, 'elevated' | 'crisis'>;
  /** 归一化后文本上的匹配式。 */
  readonly pattern: RegExp;
}

/**
 * 规则表。
 *
 * ⚠️ 新增规则时先回答它的建议等级：写成 crisis 就意味着「命中即可能有人的手机响」。
 * 拿不准就写 elevated —— elevated 不联络第三方，代价是用户看到一张一级关怀卡片。
 */
export const INBOUND_RULES = [
  // ── 二级：自残自杀意图（SAFE-04）──────────────────────────────────────────
  {
    id: 'suicidal_intent.not_want_to_live',
    category: 'suicidal_intent',
    level: 'crisis',
    pattern: /不想活|不想再活|活不下去|活着没意义|活着好累不想撑|没有活下去的理由/u,
  },
  {
    id: 'suicidal_intent.end_life',
    category: 'suicidal_intent',
    level: 'crisis',
    pattern: /想死|求死|想自杀|要自杀|自杀的方法|结束自己的生命|结束这一切的生命|一了百了/u,
  },
  {
    id: 'suicidal_intent.farewell',
    category: 'suicidal_intent',
    level: 'crisis',
    pattern: /遗书|遗言|最后一条消息了|等我走了以后|我走了就不会回来了/u,
  },
  {
    id: 'self_harm.cutting',
    category: 'self_harm',
    level: 'crisis',
    pattern: /割腕|自残|划自己|伤害自己|弄伤自己|烫自己|吞药|过量吃药|吃很多药/u,
  },
  // ── 二级：重大财产损失（SAFE-04 / Q7：不做金额阈值推断）───────────────────
  {
    id: 'major_property_loss.scammed',
    category: 'major_property_loss',
    level: 'crisis',
    pattern: /被骗了|被诈骗|杀猪盘|电信诈骗|被套走了|被卷走了|钱被转走了/u,
  },
  {
    id: 'major_property_loss.gambling',
    category: 'major_property_loss',
    level: 'crisis',
    pattern: /赌输了|赌光了|输光了|借网贷还不上|欠了一堆网贷|高利贷还不上/u,
  },
  {
    id: 'major_property_loss.savings_gone',
    category: 'major_property_loss',
    level: 'crisis',
    pattern: /全部积蓄|所有存款都没了|积蓄没了|房款|首付没了|倾家荡产|血本无归/u,
  },
  // ── 一级：极端情绪（SAFE-03，**不联络**）──────────────────────────────────
  {
    id: 'extreme_emotion.cannot_hold_on',
    category: 'extreme_emotion',
    level: 'elevated',
    pattern: /撑不住了|扛不住了|受不了了|快崩溃了|崩溃了|绝望|喘不上气|心里空了/u,
  },
  {
    id: 'extreme_emotion.worthless',
    category: 'extreme_emotion',
    level: 'elevated',
    pattern: /我是个废物|一无是处|没人需要我|没人在乎我|都是我的错|恨自己|讨厌自己/u,
  },
  {
    id: 'extreme_emotion.hopeless_future',
    category: 'extreme_emotion',
    level: 'elevated',
    pattern: /看不到希望|没有出路|无处可去|没有人可以说|谁都帮不了我/u,
  },
] as const satisfies readonly InboundRule[];

export interface InboundScan {
  /** 命中的规则 id（按表序）。存进 safety_event.rule_hits —— 不含用户原文。 */
  readonly hits: readonly string[];
  /** 建议等级。无命中即 'none'。 */
  readonly suggestedLevel: RiskLevel;
}

/**
 * 扫一条入站用户消息。
 *
 * 纯函数、无 I/O，因此可以在 L3 穷举。返回的 hits 是**规则 id**而不是命中的文本片段
 * —— 后者是用户原文，会把一条留证记录变成一份对话副本（safety_event 无正文列）。
 */
export function scanInbound(text: string): InboundScan {
  const normalized = normalizeForRetentionMatch(text);
  const hits: string[] = [];
  let suggestedLevel: RiskLevel = 'none';
  for (const rule of INBOUND_RULES) {
    if (!rule.pattern.test(normalized)) continue;
    hits.push(rule.id);
    suggestedLevel = maxRisk(suggestedLevel, rule.level);
  }
  return { hits, suggestedLevel };
}
