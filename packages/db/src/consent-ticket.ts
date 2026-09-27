// ConsentTicket —— 合法性基础的运行时表达（PRIV-02，RESEARCH §6.3）。
//
// 这是 D-15 的 branded-type 手法在本项目的**第二次、也是最后一次**复用。
// 不要把它泛化成一个「品牌类型框架」：两个边界各有各的理由，抽象出来的第三个东西
// 会让两条约束都变得可配置，而可配置的约束就是可关掉的约束。
//
// ── 它挡住的是什么 ─────────────────────────────────────────────────────────
// 「消息落库本身就是敏感个人信息处理」。于是 insertUserMessage / insertCharacterMessage
// 的参数里必须有一张 ConsentTicket<'sensitive_pi'>，而这张票**只能**由本文件的
// requireConsent() 在查过 consent 表之后发出。结果是：撤回 sensitive_pi 之后仍然把消息
// 写进库这件事，在编译期就写不出来 —— 而不是靠每个写入点各自记得去查一次。
//
// ── 写法必须是下面这一种 ───────────────────────────────────────────────────
// unique symbol 只允许出现在 declare const 上（写在类型字面量成员位置是 TS1335），
// 再用计算属性键放进交叉类型。退化形态（把它写成 `type ConsentTicket<S> = { scope: S }`）
// **没有任何报错**：消费方会静默变成「接受任意带 scope 字段的对象」。
// tools/ci/type-fixtures/consent-ticket-escape.ts 是这几行的唯一守卫。
//
// ── 为什么本文件是唯一产出点 ───────────────────────────────────────────────
// eslint.config.js 的 REQUIRED_RESTRICTED_SYNTAX 里有两条 `as ConsentTicket` 禁令
// （`as` 与尖括号两种形态）。下面那一行 eslint-disable 是全仓唯一的豁免，写在使用点上
// 而不是配置的 ignores 里 —— 让「谁绕过了这条禁令」在 diff 里看得见。

import { and, eq } from 'drizzle-orm';

import { type ConsentScope } from '@drift/contract';

import type { Executor } from './client.ts';
import { consent } from './schema/consent.ts';

declare const TICKET: unique symbol;

/**
 * 「本次处理在 scope 上有合法性基础」的凭证。
 *
 * `scope` 是真实存在的运行时字段（便于排障与断言）；`[TICKET]` 是幻影键，
 * 在本文件之外无法构造，因此整个类型在外部不可伪造。
 */
export type ConsentTicket<S extends ConsentScope> = {
  readonly scope: S;
} & { readonly [TICKET]: true };

/** 未授权的两种形态。分开记：「从没收过」与「收过又撤回了」的处置不同。 */
export const CONSENT_DENIAL_REASONS = ['missing', 'revoked'] as const;
export type ConsentDenialReason = (typeof CONSENT_DENIAL_REASONS)[number];

export class ConsentNotGrantedError extends Error {
  readonly scope: ConsentScope;
  readonly reason: ConsentDenialReason;

  constructor(scope: ConsentScope, reason: ConsentDenialReason) {
    super(
      reason === 'missing'
        ? `同意项 ${scope} 没有记录 —— 缺失一律视为未授权，不是「还没走完 onboarding」`
        : `同意项 ${scope} 已被撤回，相应数据流必须立即停止`,
    );
    this.name = 'ConsentNotGrantedError';
    this.scope = scope;
    this.reason = reason;
  }
}

/**
 * 查 consent 表，授权则发票，未授权即抛错。**全仓唯一的票据产出点。**
 *
 * ⚠️ 读取逻辑是「缺失视为未授权」：一个没有 consent 行的账号拿不到票。这条与
 * consent-reconcile 的日对账是同一件事的两面 —— 前者让残缺账号用不了，后者让它被看见。
 */
export async function requireConsent<S extends ConsentScope>(
  executor: Executor,
  userId: string,
  scope: S,
): Promise<ConsentTicket<S>> {
  const rows = await executor
    .select({ granted: consent.granted })
    .from(consent)
    .where(and(eq(consent.userId, userId), eq(consent.scope, scope)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new ConsentNotGrantedError(scope, 'missing');
  if (!row.granted) throw new ConsentNotGrantedError(scope, 'revoked');
  // eslint-disable-next-line no-restricted-syntax -- 全仓唯一一处 as ConsentTicket（见文件头）
  return { scope } as unknown as ConsentTicket<S>;
}
