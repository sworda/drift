// 出站安全网关 —— **全仓库唯一**把 string 提升为 GatedText 的地方（D-15）。
//
// 三个出口（WS 投递、消息落库、导出渲染）的签名只接受 GatedText，于是「有没有一条
// 生成路径绕过了网关」这件事由编译器回答，而不是由 code review 回答。第四、第五个出口
// （acute 告警、公开性对账告警）不承载对话文本，它们的约束在 egress.ts 的注册表里。
//
// 本文件里有全仓唯一一处 `as GatedText`。eslint.config.js 对这条断言设了仓库级禁令，
// 豁免写在使用点上而不是配置的 ignores 里 —— 让「谁绕过了这条禁令」在 diff 里看得见。
//
// ── 五条不可协商的行为 ──────────────────────────────────────────────────────
//
//  1. **会话已结束 ⇒ 拒绝产出**（COMPLY-05 硬退出的「当前会话零出站」）。判据是
//     fail-closed：网关不产出 GatedText，于是三个出口在类型层拿不到可投递的东西。
//     这比在 UI 层隐藏消息强得多 —— 队列里的延迟任务同样过不去。
//     （worker 侧在同一事务内二次重读 conversation.status 是这条约束的第二处执行点，
//     在 Plan 12 Task 3；取消已排定任务与 worker 取件之间有竞态，两处都需要。）
//  2. **classifierStatus === 'failed' ⇒ level 强制 elevated**（SAFE-05）。实现手段是
//     类型 + resolveRisk：Classification 是一个 discriminated union，`failed` 分支
//     **没有 level 字段**，所以调用方无法构造 `{ level: 'none', classifierStatus:
//     'failed' }`；而 resolveRisk 对该分支恒返回 elevated 并**封顶在 elevated**。
//     为什么不是 crisis：crisis 会联络紧急联系人 —— 那是一次针对第三方的个人信息
//     使用 + 一次虚假警报。分类器 bug 不该让别人的手机响。
//  3. **入站规则层只能抬升。** inboundSuggestedLevel 与分类结果取较高者（resolveRisk）。
//     规则层是高召回层，它的判定不具决定性 ——「不具决定性」的含义是不能用来降级，
//     而不是可以被忽略。
//  4. **elevated / crisis ⇒ 不产出 GatedText，改为产出关怀卡片**（SAFE-03/04）。
//     elevated 用一级卡片（**类型上就没有 contactStatus**），crisis 用二级卡片。
//     「出错了就降级为直接下发人格回复」在功能上正确、在合规上是一条绕过网关的路径
//     —— 这正是成功标准 2 要求证明不存在的东西。
//  5. **候选文本命中挽留词表 ⇒ 拒绝产出并记一条 safety_event**（COMPLY-05 / R1.33）。
//     挽留话术的真实来源是模型输出，源码 grep 抓不到它，只有这条出站运行时断言能把
//     触发率压到恒为 0。
//
// ── 返回形态：没有「原样透传」这一档 ────────────────────────────────────────
// GatedResult 是一个可判别联合，只有 outcome === 'gated' 的那一支带 `text: GatedText`。
// escalated 那一支带的是 `careCard`（结构化对象，由本包从常量构造），**不是候选回复**；
// 其余两支连内容字段都没有。因此「turn 外层 catch 里降级为直接下发」在这里不是被
// 禁止，而是不可表达（T-06-03 / T-07-01）。
//
// ⚠️ 关怀卡片刻意**不**经 GatedText：它不是模型输出，而是本包从 care-cards.ts 的常量
// 构造的平台文案。把它提升成 GatedText 就必须给 escalated 分支加一个 text 字段（于是
// 「escalated 不带可投递文本」这条类型保证消失），并且会让它以角色消息 + ai_generated
// 标识的形态落库 —— 而 R1.24 明文要求覆写内容不得伪装成角色的自然发言。

import { createHash } from 'node:crypto';

import type { GatedText } from '@drift/contract';

import { buildCareCard, type CareCard, type CareCardLevel2Context, type HelpResource } from './care-cards.ts';
import { hitsRetentionPhrase, type RetentionPhrase } from './retention-words.ts';
import {
  isEscalatedLevel,
  resolveRisk,
  type Classification,
  type ClassifierStatus,
  type EscalatedLevel,
  type PassableLevel,
  type RiskLevel,
} from './risk.ts';

/**
 * 一条待落库的 safety_event（字段与 packages/db 的 safety_event 表逐一对应，减去
 * 由调用方补的 user_id / conversation_id / message_id）。
 *
 * ⚠️ 只有哈希与长度，**没有正文列**。正文是个人信息，存进审计表等于把对话原文再存
 * 一份，一键删除（PRIV-05）的面积随之翻倍；而留证需要回答的是「当时判的是哪段文本」，
 * 哈希就能回答。
 *
 * previousLevel → level 是 R1.25 要求的 **risk 轨迹**：只存终值的话，「这一轮是从
 * 哪一档跳上来的」事后答不出来，而安全评估问的正是这件事（办法第二十三条）。
 */
export interface SafetyEventDraft {
  /** 本轮判定之前的会话风险态。 */
  readonly previousLevel: RiskLevel;
  readonly level: RiskLevel;
  /** 命中的规则/词表项 id。挽留拦截写命中的挽留词（那是我们自己的词表，不是用户数据）。 */
  readonly ruleHits: readonly string[];
  readonly classifierStatus: ClassifierStatus;
  /** 执行判定的模型快照。SAFE-02 的事后复核靠它。 */
  readonly classifierModelSnapshot: string | null;
  readonly candidateReplyHash: string;
  readonly candidateReplyLen: number;
  readonly overrideApplied: boolean;
}

/**
 * safety_event 的落库回调，**返回落库行的 id**。
 *
 * ⚠️ 它是 GatewayInput 的**必填**字段，不是可选项：每一次覆写与拦截都必须同时留下
 * 一条证据，而一个可选的 sink 等于把「这次拦截有没有被记下来」变成调用方的选择题。
 * 返回 id 也是必填的原因：crisis 分支的 contact_attempt 以 safety_event_id 为外键，
 * 「先联络、事后补留证」这个顺序在 append-only 表上补不回来。
 * packages/safety 自己不连数据库（它的依赖只有 @drift/contract 与 @drift/prompts），
 * 所以写入动作必须由调用方在事务里完成。
 */
export type SafetyEventRecorder = (draft: SafetyEventDraft) => string | Promise<string>;

export interface GatewayInput {
  readonly candidateText: string;
  readonly classification: Classification;
  /**
   * 会话当前状态。Phase 1 由调用方在**同一个事务里**读出来传进来；
   * Plan 12 把这次读挪进网关内部，让调用方连「传一个过期状态」都做不到。
   */
  readonly conversationStatus: 'active' | 'ended';
  readonly recordSafetyEvent: SafetyEventRecorder;
  /** 入站规则层的建议等级。省略 = 'none'（规则层没命中）。**只能抬升。** */
  readonly inboundSuggestedLevel?: RiskLevel;
  /** 入站规则层命中的规则 id。进 safety_event.rule_hits。 */
  readonly inboundRuleHits?: readonly string[];
  /** 本轮之前的会话风险态。进 safety_event 的 risk 轨迹。省略 = 'none'。 */
  readonly previousLevel?: RiskLevel;
  /** 执行判定的模型快照。省略 = null（分类器在拿到回包之前就失败了）。 */
  readonly classifierModelSnapshot?: string | null;
  /** 二级卡片的联络状态与联系人展示信息。crisis 分支必需之外的字段可省。 */
  readonly careContext?: {
    readonly resources?: readonly HelpResource[];
    readonly contactStatus?: CareCardLevel2Context['contactStatus'];
    readonly contactName?: string | null;
    readonly maskedContact?: string | null;
  };
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
      readonly classifierStatus: ClassifierStatus;
      readonly overrideApplied: true;
      /** 确定性覆写的产物。**不是候选回复**，而是本包从常量构造的平台文案。 */
      readonly careCard: CareCard;
      /** 本次覆写留证行的 id。crisis 分支的 contact_attempt 以它为外键。 */
      readonly safetyEventId: string;
      readonly ruleHits: readonly string[];
    }
  | {
      readonly outcome: 'refused';
      readonly reason: 'conversation_ended';
    }
  | {
      readonly outcome: 'refused';
      readonly reason: 'retention_phrase';
      readonly retentionHits: readonly RetentionPhrase[];
    };

function hashCandidate(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 出站安全网关。
 *
 * 返回 `gated` 时才有 GatedText；`escalated` 带的是关怀卡片；其余两种结果**不含任何
 * 可投递的内容**。
 *
 * 判定顺序是 会话状态 → 风险等级 → 挽留词表，这个顺序不是实现细节：
 * 一条同时命中 crisis 与挽留词的候选回复必须被报成 escalated，否则一次真实危机会被
 * 一条文案问题**掩盖**掉，而 crisis 是唯一会触发联络通道的那一档。挽留拦截放在最后
 * 不会削弱它的效力 —— 前两档本来就不出站。
 */
export async function safetyGateway(input: GatewayInput): Promise<GatedResult> {
  if (input.conversationStatus !== 'active') {
    // fail-closed。硬退出之后队列里残留的延迟任务也走这一条。
    return { outcome: 'refused', reason: 'conversation_ended' };
  }

  const previousLevel = input.previousLevel ?? 'none';
  const inboundSuggestedLevel = input.inboundSuggestedLevel ?? 'none';
  const inboundRuleHits = input.inboundRuleHits ?? [];
  const classifierModelSnapshot = input.classifierModelSnapshot ?? null;

  // SAFE-05 的 fail-closed 与「规则层只能抬升」都在 resolveRisk 里（risk.ts）。
  const level = resolveRisk(inboundSuggestedLevel, input.classification);

  if (isEscalatedLevel(level)) {
    const ruleHits = [
      ...inboundRuleHits,
      ...(input.classification.classifierStatus === 'failed' ? ['classifier:failed'] : []),
    ];
    // 留证先写、卡片后发：safety_event_id 是 contact_attempt 的外键，而 safety_event
    // 属 append-only 表族 —— 顺序反过来就再也补不回来（R1.25）。
    const safetyEventId = await input.recordSafetyEvent({
      previousLevel,
      level,
      ruleHits,
      classifierStatus: input.classification.classifierStatus,
      classifierModelSnapshot,
      candidateReplyHash: hashCandidate(input.candidateText),
      candidateReplyLen: input.candidateText.length,
      overrideApplied: true,
    });

    // ⚠️ elevated（含分类器故障 fail-closed 上来的那一批）一律是**一级**卡片：
    // 它在类型上就没有 contactStatus，于是 SAFE-03 的「不联络」在渲染层也无从违反。
    // UI-SPEC 明文要求故障时的界面与一级完全相同 —— 用户不该看到「系统出错了」。
    const resources = input.careContext?.resources;
    const careCard: CareCard =
      level === 'crisis'
        ? buildCareCard('level2', {
            ...(resources === undefined ? {} : { resources }),
            contactStatus: input.careContext?.contactStatus ?? 'unavailable',
            contactName: input.careContext?.contactName ?? null,
            maskedContact: input.careContext?.maskedContact ?? null,
          })
        : buildCareCard('level1', resources === undefined ? {} : { resources });

    return {
      outcome: 'escalated',
      level,
      classifierStatus: input.classification.classifierStatus,
      overrideApplied: true,
      careCard,
      safetyEventId,
      ruleHits,
    };
  }

  const retentionHits = hitsRetentionPhrase(input.candidateText);
  if (retentionHits.length > 0) {
    // level 保持原值：挽留话术不是危机，把它记成 elevated 会污染会话风险态，
    // 而会话风险态决定着关系温度是否允许回暖（SAFE-06）。
    await input.recordSafetyEvent({
      previousLevel,
      level,
      ruleHits: [...inboundRuleHits, ...retentionHits.map((phrase) => `retention:${phrase}`)],
      classifierStatus: input.classification.classifierStatus,
      classifierModelSnapshot,
      candidateReplyHash: hashCandidate(input.candidateText),
      candidateReplyLen: input.candidateText.length,
      overrideApplied: true,
    });
    return { outcome: 'refused', reason: 'retention_phrase', retentionHits };
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
