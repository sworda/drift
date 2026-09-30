// 同意的读取与撤回（PRIV-02）。
//
// ── 撤回必选项不是一个开关，是一条删除流程 ──────────────────────────────────
// Q2 已裁决：撤回 basic_service 或 sensitive_pi **等同于停止服务并进入 PRIV-05 的
// 删除流程**。这里因此**不存在**「撤回后继续聊天」的降级只读分支 —— 那种状态的含义是
// 「没有合法性基础，但数据还在被处理」。ConsentTicket 已经让消息落库在撤回后不可执行；
// 这个模块负责把那一刻变成一次删除，而不是一次静默降级。
//
// ── 为什么整条撤回在一个事务里，连排删除作业也在里面 ────────────────────────
// 三条写入（consent.granted=false / consent_event / privacy_action）加一次入队必须同生
// 共死。反过来（先提交撤回，再尽力排作业）会在排作业失败时留下「同意已撤回、删除从未
// 开始」—— 界面说停了，数据还在。回滚则是诚实的失败：用户看到 UI-SPEC 的「这项同意
// **没有**撤回成功 —— 对应的数据流**仍在继续**」，那一行文案存在的理由就是这个分支。

import {
  type ConsentScope,
  CONSENT_SCOPE_SPECS,
  CONSENT_SCOPES,
  isRequiredScope,
} from '@drift/contract';
import { consent, consentEvent, privacyAction, tx, type Executor } from '@drift/db';
import { and, eq } from 'drizzle-orm';

import {
  type AccountDeletionEnqueue,
  enqueueAccountDeletion as defaultEnqueueAccountDeletion,
} from '../../worker/jobs/account-deletion.ts';

/** 变更来源。写进 consent_event.source，回答「这次变更是在哪个界面发生的」。 */
export const CONSENT_SOURCE_PRIVACY_CENTER = 'privacy_center';

export interface ConsentView {
  readonly scope: ConsentScope;
  readonly label: string;
  readonly description: string;
  readonly required: boolean;
  readonly granted: boolean;
  readonly policyVersion: string | null;
}

/**
 * 读某个用户的五项同意。
 *
 * ⚠️ **缺失一律视为未授权**（granted: false），不是「还没走完 onboarding」。
 * 顺序取 CONSENT_SCOPES —— 界面渲染顺序与法定披露口径同源。
 */
export async function listConsents(
  executor: Executor,
  userId: string,
): Promise<readonly ConsentView[]> {
  const rows = await executor
    .select({
      scope: consent.scope,
      granted: consent.granted,
      policyVersion: consent.policyVersion,
    })
    .from(consent)
    .where(eq(consent.userId, userId));
  const byScope = new Map(rows.map((row) => [row.scope, row]));
  return CONSENT_SCOPES.map((scope) => {
    const spec = CONSENT_SCOPE_SPECS[scope];
    const row = byScope.get(scope);
    return {
      scope,
      label: spec.label,
      description: spec.description,
      required: spec.required,
      granted: row?.granted ?? false,
      policyVersion: row?.policyVersion ?? null,
    };
  });
}

export class ConsentNotFoundError extends Error {
  constructor(scope: ConsentScope) {
    super(`用户没有 ${scope} 的同意记录 —— 无法撤回一件从未授权的事`);
    this.name = 'ConsentNotFoundError';
  }
}

export interface RevokeResult {
  readonly scope: ConsentScope;
  /** 必选项撤回时非空：本次入队的删除作业 id。 */
  readonly deletionJobId: string | null;
  readonly enteredDeletion: boolean;
}

export interface RevokeConsentDeps {
  /** 注入以便断言「必选项撤回确实触发了删除」。默认是 Plan 11 将实现的那一个。 */
  readonly enqueueAccountDeletion?: AccountDeletionEnqueue;
}

/**
 * 撤回一项同意。
 *
 * 必选项 ⇒ 同一事务内入队删除作业。入队失败 ⇒ 整条回滚并把错误抛给调用方。
 */
export async function revokeConsent(
  userId: string,
  scope: ConsentScope,
  deps: RevokeConsentDeps = {},
): Promise<RevokeResult> {
  const enqueue = deps.enqueueAccountDeletion ?? defaultEnqueueAccountDeletion;
  const policyVersionOf = async (t: Executor): Promise<string> => {
    const rows = await t
      .select({ policyVersion: consent.policyVersion })
      .from(consent)
      .where(and(eq(consent.userId, userId), eq(consent.scope, scope)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) throw new ConsentNotFoundError(scope);
    return row.policyVersion;
  };

  return tx(async (t) => {
    // 撤回留证记的是**当时那一版政策**，不是今天这一版：这一行要回答的是
    // 「用户撤回的是他当初同意的哪一版」。
    const policyVersion = await policyVersionOf(t);

    await t
      .update(consent)
      .set({ granted: false })
      .where(and(eq(consent.userId, userId), eq(consent.scope, scope)));
    await t.insert(consentEvent).values({
      userId,
      scope,
      action: 'revoke',
      policyVersion,
      source: CONSENT_SOURCE_PRIVACY_CENTER,
    });
    await t.insert(privacyAction).values({
      userId,
      kind: 'revoke',
      // 载荷只有枚举与布尔，没有任何文本 —— privacy_action 是 append-only 的审计表。
      payload: { scope, required: isRequiredScope(scope) },
    });

    if (!isRequiredScope(scope)) {
      return { scope, deletionJobId: null, enteredDeletion: false };
    }

    // 必选项：同一事务内进入删除流程。**没有**「撤回后继续聊天」这一支。
    const deletionJobId = await enqueue(t, userId, { reason: 'revoke_required_consent' });
    return { scope, deletionJobId, enteredDeletion: true };
  });
}
