// contact_attempt 的四态推进（D-10 / D-11 / D-22 + SAFE-04 / SAFE-16）。
//
// ── 四态的判据（RESEARCH §4.5 的表，逐条落在下面的代码里）────────────────────
//
//   pending     —— IM 告警**投递成功**（2xx 且业务码成功）后，由系统置
//   delivered   —— 运营者在后台确认「已与该联系人通话」，**人工**推进
//   failed      —— pending 超时 10 分钟（服务端）或运营者标记联系不上
//   unavailable —— 无可用联络通道（无联系人记录 / 引用为空 / **告警投递本身失败**），
//                  由系统**立即**置，不经 pending
//
// ── 一处必须澄清的语义（否则四态静默退化成两态）──────────────────────────────
// D-22 规定 R1.23 的可达性在 Phase 1 一律记为 `unconfirmed`。UI-SPEC 说「若联系人记录
// 为可达性未确认**且本次无可用联络通道**」→ unavailable。Phase 1 **有**通道（运营者），
// 所以 `unconfirmed` 本身**不**导致 unavailable —— 只有告警投递失败才导致。
// 把它读成「未确认 ⇒ 永远 unavailable」的后果是 pending 与 delivered 两个分支永不执行，
// 四态实现只剩两态，**而这不会被任何现有断言发现**。下面代码里读 reachability 的地方
// 一处也没有，这不是遗漏 —— 它是这条语义的执行形态。
//
// ── 为什么先排超时作业、后发告警 ────────────────────────────────────────────
// pending 必须**有界**（UI-SPEC 明文）。如果先发告警后排作业，而排作业失败，就会留下
// 一个永远停在「正在联系」的卡片。反过来，先排作业再发告警：告警失败时这一行会是
// unavailable，而那个已排定的超时作业跑起来时是一次条件更新（WHERE status='pending'），
// 影响 0 行且不报错 —— 多排一个无害的作业比留一个无界的 pending 便宜得多。
//
// ── 为什么 contact_attempt 的插入只有一次 ────────────────────────────────────
// 状态由投递结果决定，所以插入发生在结果已知之后（id 在应用侧先生成，因为超时作业的
// singletonKey 需要它）。「先插 pending 再按结果改」会让 DB 里短暂存在一个判据不成立的
// pending 行 —— 而 0003 迁移的 contact_attempt_pending_requires_alert 会直接拒绝它。

import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import type { ContactAttemptStatus } from '@drift/safety';
import {
  contactAttempt,
  decryptContact,
  emergencyContact,
  type Executor,
  maskContact,
} from '@drift/db';

import type { AcuteAlert, AlertDeliveryResult, AlertTransport } from './alert.ts';
import { notifyOperator } from './alert.ts';
import type { ContactAttemptTimeoutScheduler } from '../../worker/jobs/contact-attempt-timeout.ts';

/** 进入 unavailable 的三个成因。只进日志与 note，不进告警载荷。 */
export const UNAVAILABLE_REASONS = [
  'no_contact_record',
  'contact_ref_missing',
  // 密文读不回来（密钥轮换出错、行被改坏）。与 contact_ref_missing 分开记：
  // 「没存下来」与「存下来了但读不回来」的处置完全不同，混成一个会让运维查错方向。
  'contact_ref_undecryptable',
  'alert_delivery_failed',
  'timeout_not_schedulable',
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export interface ContactAttemptResult {
  readonly id: string;
  readonly status: ContactAttemptStatus;
  readonly contactName: string | null;
  /** 遮蔽后的联系方式（`138****1234`）。unavailable 态为 null。 */
  readonly maskedContact: string | null;
  readonly unavailableReason: UnavailableReason | null;
  readonly delivery: AlertDeliveryResult | null;
}

export interface ContactAttemptDeps {
  readonly transport: AlertTransport;
  readonly scheduleTimeout: ContactAttemptTimeoutScheduler;
  /** 观察点。日志由调用方按白名单字段记 —— 本模块不 import logger。 */
  readonly onEvent?: (event: {
    readonly name: string;
    readonly status: ContactAttemptStatus;
    readonly reason: UnavailableReason | null;
  }) => void;
}

export interface ContactAttemptInput {
  readonly safetyEventId: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly occurredAt?: Date;
  /**
   * 触发本次联络的用户消息。
   *
   * ⚠️ 它**只**被传给 notifyOperator 的构造期自检当作子串检查的针，
   * **不进任何载荷、不落任何库、不进日志**。这个参数存在的理由是：那条自检需要
   * 一根针，而针只能从触发点传下来。看到它在这里不要顺手把它拼进告警正文 ——
   * 那正是它被用来检测的那件事（T-07-04）。
   */
  readonly triggeringMessage: string;
}

interface InsertArgs {
  readonly id: string;
  readonly safetyEventId: string;
  readonly userId: string;
  readonly contactRef: string | null;
  readonly status: ContactAttemptStatus;
  readonly alertSentAt: Date | null;
  readonly note: string | null;
}

async function insertAttempt(executor: Executor, args: InsertArgs): Promise<void> {
  await executor.insert(contactAttempt).values({
    id: args.id,
    safetyEventId: args.safetyEventId,
    userId: args.userId,
    contactRef: args.contactRef,
    status: args.status,
    alertSentAt: args.alertSentAt,
    note: args.note,
  });
}

/**
 * 开始一次联络尝试。**只插入一行**，状态由判据决定。
 *
 * ⚠️ `maskedContact` 只在 pending / delivered 两态非空：它由
 * `maskContact(decryptContact(contact_ref_encrypted))` 得到（Plan 09 落地了
 * packages/db/src/crypto.ts）。unavailable 态一律 null —— 那几条分支本来就不该出现
 * 一个号码。**本模块是全仓唯一允许 import decryptContact 的目录**（eslint 目录级禁令），
 * 因为危机流程是唯一需要把第三方号码显示给用户的地方，而显示的是遮蔽形态。
 * 渲染层仍必须容忍 null（UI-SPEC 的 failed / unavailable 两条文案里没有该占位）。
 */
export async function startContactAttempt(
  executor: Executor,
  input: ContactAttemptInput,
  deps: ContactAttemptDeps,
): Promise<ContactAttemptResult> {
  const id = randomUUID();

  const contacts = await executor
    .select({
      name: emergencyContact.name,
      contactRef: emergencyContact.contactRefEncrypted,
    })
    .from(emergencyContact)
    .where(eq(emergencyContact.userId, input.userId))
    .limit(1);
  const contact = contacts[0];

  // (1) 无联系人记录 ⇒ 立即 unavailable，不经 pending。
  if (contact === undefined) {
    return finishUnavailable(executor, deps, {
      id,
      input,
      contactRef: null,
      contactName: null,
      reason: 'no_contact_record',
      delivery: null,
    });
  }
  // (2) 引用为空白（号码在收集时就没存下来）⇒ 同样没有可用通道。
  if (contact.contactRef.trim().length === 0) {
    return finishUnavailable(executor, deps, {
      id,
      input,
      contactRef: null,
      contactName: contact.name,
      reason: 'contact_ref_missing',
      delivery: null,
    });
  }

  // (2.5) 解密 + 遮蔽。读不回来就没有可用通道 —— 运营者也拨不了一串密文。
  let maskedContact: string;
  try {
    maskedContact = maskContact(decryptContact(contact.contactRef));
  } catch {
    return finishUnavailable(executor, deps, {
      id,
      input,
      contactRef: null,
      contactName: contact.name,
      reason: 'contact_ref_undecryptable',
      delivery: null,
    });
  }

  // (3) 先排超时作业 —— pending 必须有界（见文件头）。
  try {
    await deps.scheduleTimeout(id);
  } catch {
    return finishUnavailable(executor, deps, {
      id,
      input,
      contactRef: null,
      contactName: contact.name,
      reason: 'timeout_not_schedulable',
      delivery: null,
    });
  }

  // (4) 投递 acute 告警。载荷里只有五个字段，没有对话文本（SAFE-16 / T-07-04）。
  const alert: AcuteAlert = {
    userId: input.userId,
    conversationId: input.conversationId,
    riskLevel: 'crisis',
    occurredAt: input.occurredAt ?? new Date(),
    safetyEventId: input.safetyEventId,
  };
  const delivery = await notifyOperator(alert, deps.transport, {
    triggeringMessage: input.triggeringMessage,
  });

  // (5) 投递失败 ⇒ 直接 unavailable，**不经 pending**（SAFE-16 明文）。
  if (!delivery.delivered) {
    return finishUnavailable(executor, deps, {
      id,
      input,
      contactRef: null,
      contactName: contact.name,
      reason: 'alert_delivery_failed',
      delivery,
    });
  }

  // (6) 投递成功 ⇒ pending，并记 alert_sent_at（0003 的 CHECK 要求它非空）。
  await insertAttempt(executor, {
    id,
    safetyEventId: input.safetyEventId,
    userId: input.userId,
    contactRef: contact.contactRef,
    status: 'pending',
    alertSentAt: new Date(),
    note: null,
  });
  deps.onEvent?.({ name: 'contact_attempt.pending', status: 'pending', reason: null });
  return {
    id,
    status: 'pending',
    contactName: contact.name,
    maskedContact,
    unavailableReason: null,
    delivery,
  };
}

async function finishUnavailable(
  executor: Executor,
  deps: ContactAttemptDeps,
  args: {
    readonly id: string;
    readonly input: ContactAttemptInput;
    readonly contactRef: string | null;
    readonly contactName: string | null;
    readonly reason: UnavailableReason;
    readonly delivery: AlertDeliveryResult | null;
  },
): Promise<ContactAttemptResult> {
  await insertAttempt(executor, {
    id: args.id,
    safetyEventId: args.input.safetyEventId,
    userId: args.input.userId,
    contactRef: args.contactRef,
    status: 'unavailable',
    // alert_sent_at 保持 null —— 它同时是「本次从未进入 pending」的判据
    // （本表允许 UPDATE，所以不能靠 status 的历史来回答这个问题）。
    alertSentAt: null,
    note: args.reason,
  });
  deps.onEvent?.({
    name: 'contact_attempt.unavailable',
    status: 'unavailable',
    reason: args.reason,
  });
  return {
    id: args.id,
    status: 'unavailable',
    contactName: args.contactName,
    maskedContact: null,
    unavailableReason: args.reason,
    delivery: args.delivery,
  };
}

export class OperatorActionRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperatorActionRefusedError';
  }
}

/**
 * 运营者确认「已与该联系人通话」⇒ delivered。**人工动作。**
 *
 * ⚠️ `note` 必须非空：它就是那次真人确认的记录。D-10 明文 delivered 的唯一判据是
 * 真人确认已通话，**不是**短信 API 返回 200，也不是任何自动回执。本函数因此**不引用**
 * 任何投递结果 —— 它连 notifyOperator 的返回值都拿不到。
 *
 * @returns 是否真的推进了（非 pending 时返回 false，不报错）。
 */
export async function ackDelivered(
  executor: Executor,
  input: {
    readonly attemptId: string;
    readonly operatorId: string;
    readonly note: string;
    readonly now?: Date;
  },
): Promise<boolean> {
  const note = input.note.trim();
  if (note.length === 0) {
    throw new OperatorActionRefusedError(
      'ackDelivered 要求非空 note —— delivered 的判据是真人确认已通话，而 note 就是那次确认的记录',
    );
  }
  const operatorId = input.operatorId.trim();
  if (operatorId.length === 0) {
    throw new OperatorActionRefusedError('ackDelivered 要求非空 operatorId —— 人工动作必须留名');
  }
  const now = input.now ?? new Date();
  const rows = await executor
    .update(contactAttempt)
    .set({
      status: 'delivered',
      deliveredAt: now,
      operatorAckAt: now,
      note: `${operatorId}: ${note}`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(contactAttempt.id, input.attemptId), eq(contactAttempt.status, 'pending')))
    .returning({ id: contactAttempt.id });
  return rows.length > 0;
}

/**
 * 运营者标记联系不上 ⇒ failed。**人工动作。**
 *
 * 与超时作业写的是同一个终态，且用的是同一条条件更新（WHERE status='pending'），
 * 所以「运营者刚标 failed，超时作业又跑了一次」影响 0 行而不是把 note 覆盖掉。
 */
export async function markFailed(
  executor: Executor,
  input: {
    readonly attemptId: string;
    readonly operatorId: string;
    readonly note?: string;
    readonly now?: Date;
  },
): Promise<boolean> {
  const operatorId = input.operatorId.trim();
  if (operatorId.length === 0) {
    throw new OperatorActionRefusedError('markFailed 要求非空 operatorId —— 人工动作必须留名');
  }
  const now = input.now ?? new Date();
  const note = input.note?.trim();
  const rows = await executor
    .update(contactAttempt)
    .set({
      status: 'failed',
      operatorAckAt: now,
      note: note === undefined || note.length === 0 ? operatorId : `${operatorId}: ${note}`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(contactAttempt.id, input.attemptId), eq(contactAttempt.status, 'pending')))
    .returning({ id: contactAttempt.id });
  return rows.length > 0;
}
