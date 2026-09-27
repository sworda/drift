// 出站安全网关 —— **全仓库唯一**把 string 提升为 GatedText 的地方（D-15）。
//
// 三个出口（WS 投递、消息落库、导出渲染）的签名只接受 GatedText，于是「有没有一条
// 生成路径绕过了网关」这件事由编译器回答，而不是由 code review 回答。第四个出口
// （acute 告警）不承载对话文本，它的约束在 egress.ts 的注册表里，而非这里的类型。
//
// 本文件里有全仓唯一一处 `as GatedText`。eslint.config.js 对这条断言设了仓库级禁令，
// 豁免写在使用点上而不是配置的 ignores 里 —— 让「谁绕过了这条禁令」在 diff 里看得见。
//
// ── 四条不可协商的行为 ──────────────────────────────────────────────────────
//
//  1. **会话已结束 ⇒ 拒绝产出**（COMPLY-05 硬退出的「当前会话零出站」）。判据是
//     fail-closed：网关不产出 GatedText，于是三个出口在类型层拿不到可投递的东西。
//     这比在 UI 层隐藏消息强得多 —— 队列里的延迟任务同样过不去。
//     （worker 侧在同一事务内二次重读 conversation.status 是这条约束的第二处执行点，
//     在 Plan 12 Task 3；取消已排定任务与 worker 取件之间有竞态，两处都需要。）
//  2. **classifierStatus === 'failed' ⇒ level 强制 elevated**（SAFE-05）。实现手段是
//     类型：Classification 是一个 discriminated union，`failed` 分支**没有 level 字段**，
//     所以调用方无法构造 `{ level: 'none', classifierStatus: 'failed' }`。
//     为什么是 elevated 而不是 crisis：crisis 会联络紧急联系人 —— 那是一次针对第三方
//     的个人信息使用 + 一次虚假警报。分类器 bug 不该让别人的手机响。
//  3. **elevated / crisis ⇒ 不产出 GatedText**。Phase 1 不填关怀卡片内容（Plan 07），
//     但也**不放人格回复过去**。「出错了就降级为直接下发人格回复」在功能上正确、
//     在合规上是一条绕过网关的路径 —— 这正是成功标准 2 要求证明不存在的东西。
//  4. **候选文本命中挽留词表 ⇒ 拒绝产出并记一条 safety_event**（COMPLY-05 / R1.33）。
//     挽留话术的真实来源是模型输出，源码 grep 抓不到它，只有这条出站运行时断言能把
//     触发率压到恒为 0。
//
// ── 返回形态：没有「原样透传」这一档 ────────────────────────────────────────
// GatedResult 是一个可判别联合，只有 outcome === 'gated' 的那一支带 text。其余三支
// **在类型层就没有 text 字段**，因此调用方既不能忘记处理它们，也不能用一个非空断言
// 把它们当成有文本 —— 「turn 外层 catch 里降级为直接下发」在这里不是被禁止，而是
// 不可表达（T-06-03）。

import { createHash } from 'node:crypto';

import type { GatedText } from '@drift/contract';

import { hitsRetentionPhrase, type RetentionPhrase } from './retention-words.ts';

export const RISK_LEVELS = ['none', 'watch', 'elevated', 'crisis'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const CLASSIFIER_STATUSES = ['ok', 'failed'] as const;
export type ClassifierStatus = (typeof CLASSIFIER_STATUSES)[number];

/** 通过网关的等级（可以带回复出站）与必须覆写的等级。 */
export type PassableLevel = 'none' | 'watch';
export type EscalatedLevel = 'elevated' | 'crisis';

/**
 * 置信度下限。低于它视为 SAFE-05 的第三类分类器失败（前两类是 provider 报错与
 * 结构化输出 schema 校验失败）。
 *
 * 取 0.5 的理由：低于 0.5 的判定在四档取值域上不比抛硬币更有信息量，把它当成一次
 * 有效判定就等于让 fail-closed 只覆盖「报错」而不覆盖「猜的」。抬高这个值会换来
 * 更多误升级（用户看到关怀卡片而不是回复），因此它是一个可调参数而不是常识 ——
 * 调整它需要 L6 探针集的实测分布（Plan 08）作为依据。
 */
export const SAFETY_CONFIDENCE_FLOOR = 0.5;

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

/**
 * 一条待落库的 safety_event（字段与 packages/db 的 safety_event 表逐一对应，减去
 * 由调用方补的 user_id / conversation_id / message_id）。
 *
 * ⚠️ 只有哈希与长度，**没有正文列**。正文是个人信息，存进审计表等于把对话原文再存
 * 一份，一键删除（PRIV-05）的面积随之翻倍；而留证需要回答的是「当时判的是哪段文本」，
 * 哈希就能回答。
 */
export interface SafetyEventDraft {
  readonly level: RiskLevel;
  /** 命中的规则/词表项。挽留拦截写命中的挽留词（那是我们自己的词表，不是用户数据）。 */
  readonly ruleHits: readonly string[];
  readonly classifierStatus: ClassifierStatus;
  readonly candidateReplyHash: string;
  readonly candidateReplyLen: number;
  readonly overrideApplied: boolean;
}

/**
 * safety_event 的落库回调。
 *
 * ⚠️ 它是 GatewayInput 的**必填**字段，不是可选项。挽留拦截必须同时留下一条证据，
 * 而一个可选的 sink 等于把「这次拦截有没有被记下来」变成调用方的选择题 —— 那正是
 * 「挽留话术触发率恒为 0」这句话失去可验证性的方式。packages/safety 自己不连数据库
 * （它的依赖只有 @drift/contract），所以写入动作必须由调用方在事务里完成。
 */
export type SafetyEventRecorder = (draft: SafetyEventDraft) => void | Promise<void>;

export interface GatewayInput {
  readonly candidateText: string;
  readonly classification: Classification;
  /**
   * 会话当前状态。Phase 1 由调用方在**同一个事务里**读出来传进来；
   * Plan 12 把这次读挪进网关内部，让调用方连「传一个过期状态」都做不到。
   */
  readonly conversationStatus: 'active' | 'ended';
  readonly recordSafetyEvent: SafetyEventRecorder;
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

/** classifierStatus 与 level 的合并规则（SAFE-05 的 fail-closed 就在这里）。 */
function effectiveLevel(classification: Classification): RiskLevel {
  return classification.classifierStatus === 'failed' ? 'elevated' : classification.level;
}

function hashCandidate(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 出站安全网关。
 *
 * 返回 `gated` 时才有 GatedText；其余三种结果**不含任何可投递的文本**。
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

  const level = effectiveLevel(input.classification);
  if (level === 'elevated' || level === 'crisis') {
    // 这一支的 safety_event 与会话级风险状态机一起在 Plan 07 落地（它还要写
    // session_risk_state 与 contact_attempt，是一次事务性更大的写入）。
    return {
      outcome: 'escalated',
      level,
      classifierStatus: input.classification.classifierStatus,
      overrideApplied: true,
    };
  }

  const retentionHits = hitsRetentionPhrase(input.candidateText);
  if (retentionHits.length > 0) {
    // level 保持原值：挽留话术不是危机，把它记成 elevated 会污染会话风险态，
    // 而会话风险态决定着关系温度是否允许回暖（SAFE-06）。
    await input.recordSafetyEvent({
      level,
      ruleHits: retentionHits.map((phrase) => `retention:${phrase}`),
      classifierStatus: input.classification.classifierStatus,
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

/**
 * 解析 safety.classify 的模型输出。
 *
 * 解析失败 ⇒ `{ classifierStatus: 'failed' }`，而不是「当成 none」。SAFE-05 的三类
 * 失败在这里覆盖两类：
 *   - 结构化输出 schema 校验失败（非 JSON / 缺 level / level 不在取值域 / confidence 缺失或越界）
 *   - 置信度低于 SAFETY_CONFIDENCE_FLOOR
 * 第三类（provider 报错/超时）由调用方直接构造 `{ classifierStatus: 'failed' }`。
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
  // confidence 缺失同样算 failed：契约里它是必填（SafetyClassifyOutput），一个没有
  // confidence 的响应说明模型没按契约回答 —— 把它当成「满信心」正是 fail-open。
  const confidence = (parsed as { confidence?: unknown }).confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    return { classifierStatus: 'failed' };
  }
  if (confidence < 0 || confidence > 1) {
    return { classifierStatus: 'failed' };
  }
  if (confidence < SAFETY_CONFIDENCE_FLOOR) {
    return { classifierStatus: 'failed' };
  }
  return { classifierStatus: 'ok', level: level as RiskLevel };
}
