// 邀请码准入 + 建账号 + 五项同意，**单事务**。
//
// ── 与 PLAN 的偏离（Rule 2：缺失关键功能）─────────────────────────────────────
// 本 plan 的 tracer 验收第 (1)(2) 条要求「同一个邀请码并发注册两次恰好一个成功」与
// 「注册成功后 consent 恰好 5 行」，而注册链路的完整形态（better-auth 邮箱密码、
// 紧急联系人加密、ConsentTicket 守卫、注册 UI、18 岁终态拒绝）由 **Plan 09** 拥有，
// 且 better-auth 至今不在依赖里（本 plan 不得新增未经核验的包，T-04-SC）。
//
// 因此这里交付 tracer 需要的那一刀，形态刻意与 Plan 09 对齐、由它替换其中一步：
//   - 表结构就是 better-auth 的期望形状（user / account / session），Plan 09 把
//     「插 user + account」换成 better-auth 的 server API 调用，其余三步不动；
//   - 凭证用 node:crypto 的 scrypt 哈希，**不存明文** —— 一个没有凭证的账号比一个
//     多余的实现更糟；
//   - 会话用 DB 里的不透明随机 token（就是 better-auth 的 session 表），所以路由的
//     身份校验从第一天起就是真的，不存在「请求里带 userId 就当成登录」的路径。
//
// 本文件**不做**：紧急联系人（Plan 09 要加密）、ConsentTicket（Plan 09）、
// policy_version 的真实来源（Plan 15 才产出隐私政策正文，此刻由调用方传入）。

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { tx, type Tx } from './client.ts';
import { consentEvent } from './schema/audit.ts';
import { account, session, user } from './schema/auth.ts';
import { consent, CONSENT_SCOPES, REQUIRED_CONSENT_SCOPES, type ConsentScope } from './schema/consent.ts';
import { inviteCode } from './schema/invite.ts';

const SCRYPT_KEYLEN = 64;
/** 会话有效期。Phase 1 取 30 天；续期策略由 Plan 09 的 better-auth 接管。 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, derived] = stored.split(':');
  if (scheme !== 'scrypt' || salt === undefined || derived === undefined) return false;
  const expected = Buffer.from(derived, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(expected, actual);
}

export class InviteCodeUnavailableError extends Error {
  constructor(code: string) {
    super(`邀请码 ${code} 不可用（不存在 / 已被使用 / 已撤销）`);
    this.name = 'InviteCodeUnavailableError';
  }
}

export class RequiredConsentMissingError extends Error {
  constructor(scope: ConsentScope) {
    super(`必选同意项 ${scope} 未授权，注册不能继续`);
    this.name = 'RequiredConsentMissingError';
  }
}

/**
 * 一次性消耗邀请码（T-04-03）。
 *
 * ⚠️ **条件更新 + RETURNING**，不是「先 select 判断再 update」。并发下两个请求都会
 * 读到 used_by is null，于是两个都往下走、两个都建账号 —— 而一次性凭证的全部意义
 * 就在这里丢掉。条件更新让「恰好一个成功」由行锁保证。
 */
export async function consumeInviteCode(t: Tx, code: string, userId: string): Promise<void> {
  const rows = await t
    .update(inviteCode)
    .set({ usedBy: userId, usedAt: new Date() })
    .where(
      and(eq(inviteCode.code, code), isNull(inviteCode.usedBy), isNull(inviteCode.revokedAt)),
    )
    .returning({ code: inviteCode.code });
  if (rows[0] === undefined) throw new InviteCodeUnavailableError(code);
}

export interface RegisterInput {
  readonly inviteCode: string;
  readonly email: string;
  readonly password: string;
  readonly name: string;
  /** YYYY-MM-DD。COMPLY-07 的 18 岁校验由调用方在这之前做（法定终态拒绝有自己的 UI）。 */
  readonly birthDate: string;
  /** 五项同意的勾选状态。缺项视为未授权（不是默认同意）。 */
  readonly consents: Readonly<Partial<Record<ConsentScope, boolean>>>;
  readonly policyVersion: string;
}

export interface RegisterResult {
  readonly userId: string;
  readonly sessionToken: string;
}

/**
 * 单事务注册。任一步失败整体回滚 —— 不产生「账号存在但同意缺失」的残缺账号，
 * 而那种账号在「缺失视为未授权」的读取逻辑下看起来完全正常。
 */
export async function registerWithInvite(input: RegisterInput): Promise<RegisterResult> {
  for (const scope of REQUIRED_CONSENT_SCOPES) {
    if (input.consents[scope] !== true) throw new RequiredConsentMissingError(scope);
  }

  return tx(async (t) => {
    const userId = randomUUID();
    // 顺序：先消耗码（最可能冲突的一步先做，失败就不必白建账号），再建账号。
    await consumeInviteCode(t, input.inviteCode, userId);

    await t.insert(user).values({
      id: userId,
      name: input.name,
      email: input.email,
      emailVerified: false,
      birthDate: input.birthDate,
      inviteCodeId: input.inviteCode,
    });

    await t.insert(account).values({
      accountId: input.email,
      providerId: 'credential',
      userId,
      password: hashPassword(input.password),
    });

    // 五条 consent + 五条 consent_event。**逐 scope 各一行**，没有任何一行能表达
    // 「全部同意」—— PRIV-01 的「无全选控件」在这里是结构性的，不是 UI 约定。
    for (const scope of CONSENT_SCOPES) {
      const granted = input.consents[scope] === true;
      await t.insert(consent).values({
        userId,
        scope,
        granted,
        policyVersion: input.policyVersion,
      });
      await t.insert(consentEvent).values({
        userId,
        scope,
        action: granted ? 'grant' : 'revoke',
        policyVersion: input.policyVersion,
        source: 'registration',
      });
    }

    const sessionToken = randomBytes(32).toString('base64url');
    await t.insert(session).values({
      token: sessionToken,
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });

    return { userId, sessionToken };
  });
}

export interface ResolvedSession {
  readonly userId: string;
}

/** 按不透明 token 解析会话。过期即视为未登录（不自动续期）。 */
export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  const rows = await tx(async (t) =>
    t
      .select({ userId: session.userId })
      .from(session)
      .where(and(eq(session.token, token), sql`${session.expiresAt} > now()`)),
  );
  return rows[0] ?? null;
}
