// 注册路由（COMPLY-06 / COMPLY-07 / PRIV-01）。
//
// ── 三件在这一层就定死的事 ─────────────────────────────────────────────────
//
//  1. **policy_version 不接受客户端传入。** 它是 privacy.md 的服务端内容哈希。
//     一个由请求体带进来的版本号等于让用户自己声明「我同意的是哪一版」，而那正是
//     这条留证要回答的问题 —— 可伪造的留证不是留证。（01-04 的前身是由调用方传的，
//     那是当时没有政策正文的权宜；Plan 15 交付正文后这条口子必须闭上。）
//
//  2. **18 岁校验是服务端硬校验。** UI 侧的法定终态拒绝页（Plan 09 Task 3）是给人看的，
//     这条 403 是给绕过 UI 的请求看的。两者缺一不可：只有 UI 就意味着「不走 UI 就能
//     注册未成年账号」。
//
//  3. **响应体里没有明文联系方式。** 只回 maskedContact（138****1234）。
//     tests/integration/register.test.ts 的 (e) 断言整个响应体不含 11 位连续数字。

import { Hono } from 'hono';
import { z } from 'zod';

import { CONSENT_SCOPES, CONTACT_PHONE_PATTERN, EMERGENCY_CONTACT_KINDS } from '@drift/contract';

import { logError, logEvent } from '../../obs/logger.ts';
import { InviteCodeUnavailableError } from './invite.ts';
import { ContactFormatError, registerWithInvite, RequiredConsentMissingError } from './register.ts';

/** 18 周岁。用出生日期算，不用「是否成年」布尔值（后者会在生日那天变成错的）。 */
const MIN_AGE_YEARS = 18;

const RegisterBody = z.object({
  inviteCode: z.string().min(1).max(64),
  email: z.email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(64),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'birthDate 需为 YYYY-MM-DD' }),
  /** 五项同意。缺项视为未授权 —— 不是默认同意。 */
  consents: z.partialRecord(z.enum(CONSENT_SCOPES), z.boolean()).default(() => ({})),
  /** 监护人或紧急联系人二选一，填一个即完整（COMPLY-06）。 */
  emergencyContact: z.object({
    kind: z.enum(EMERGENCY_CONTACT_KINDS),
    name: z.string().min(1).max(64),
    phone: z.string().regex(CONTACT_PHONE_PATTERN, { error: '需为 11 位手机号' }),
  }),
});

export function isAdult(birthDate: string, now: Date = new Date()): boolean {
  const born = new Date(`${birthDate}T00:00:00.000Z`);
  if (Number.isNaN(born.getTime())) return false;
  const eighteenth = new Date(born);
  eighteenth.setUTCFullYear(eighteenth.getUTCFullYear() + MIN_AGE_YEARS);
  return eighteenth.getTime() <= now.getTime();
}

export const authRoutes = new Hono();

authRoutes.post('/auth/register', async (c) => {
  const parsed = RegisterBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues.map((i) => i.message) }, 400);
  }
  const body = parsed.data;

  if (!isAdult(body.birthDate)) {
    // COMPLY-07：法定终态拒绝。不解释成「稍后再来」——它不是一次可重试的失败。
    logEvent('auth.register_rejected_underage', { route: '/auth/register', statusCode: 403 }, 'warn');
    return c.json({ error: 'underage' }, 403);
  }

  try {
    const result = await registerWithInvite({
      inviteCode: body.inviteCode,
      email: body.email,
      password: body.password,
      name: body.name,
      birthDate: body.birthDate,
      consents: body.consents,
      emergencyContact: body.emergencyContact,
    });
    logEvent('auth.registered', { userId: result.userId, route: '/auth/register', statusCode: 201 });
    return c.json(
      {
        userId: result.userId,
        sessionToken: result.sessionToken,
        policyVersion: result.policyVersion,
        emergencyContact: { kind: body.emergencyContact.kind, maskedContact: result.maskedContact },
      },
      201,
    );
  } catch (error) {
    if (error instanceof InviteCodeUnavailableError) {
      return c.json({ error: 'invite_code_unavailable' }, 409);
    }
    if (error instanceof RequiredConsentMissingError) {
      return c.json({ error: 'required_consent_missing' }, 400);
    }
    if (error instanceof ContactFormatError) {
      return c.json({ error: 'contact_format_invalid' }, 400);
    }
    // 唯一约束（同一邮箱重复注册）与 better-auth 自己的 APIError 都走这里 —— 409 而不是 500。
    logError('auth.register_failed', error, { route: '/auth/register' });
    return c.json({ error: 'register_failed' }, 409);
  }
});
