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

import { APIError } from 'better-auth/api';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  CONSENT_SCOPES,
  CONTACT_PHONE_PATTERN,
  EMERGENCY_CONTACT_KINDS,
  isAdult,
} from '@drift/contract';

import { logError, logEvent } from '../../obs/logger.ts';
import { InviteCodeUnavailableError } from './invite.ts';
import { ContactFormatError, registerWithInvite, RequiredConsentMissingError } from './register.ts';

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
    // better-auth 自己抛的 APIError 按 body.code 细分 —— 「邮箱已注册」和「密码不符
    // 策略」是可以让用户自己修正的失败，混进一个笼统的 register_failed 会让前端只能
    // 显示「网络中断」级别的兜底文案（2026-09-30 实测：重复邮箱被渲染成网络错误，
    // 排查走了弯路）。细分码与 UI 的文案映射一一对应（onboarding/copy.ts）。
    if (error instanceof APIError) {
      const authCode =
        typeof error.body === 'object' && error.body !== null
          ? (error.body as { code?: string }).code
          : undefined;
      // 诊断日志：status 与 body.code 都是枚举/数字，不是文本（errorCode 在白名单里）。
      // better-auth 按 patch version 会改错误的形状 —— 这一行让「细分没命中」当场可见。
      logEvent('auth.register_api_error', {
        route: '/auth/register',
        statusCode: error.status,
        errorCode: authCode ?? 'status_' + String(error.status),
      }, 'warn');
      if (authCode?.startsWith('USER_ALREADY_EXISTS') || String(error.status) === 'UNPROCESSABLE_ENTITY') {
        logEvent('auth.register_rejected_email_used', { route: '/auth/register', statusCode: 409 }, 'warn');
        return c.json({ error: 'email_already_used' }, 409);
      }
      if (authCode === 'PASSWORD_TOO_SHORT' || authCode === 'PASSWORD_TOO_LONG') {
        logEvent('auth.register_rejected_password', { route: '/auth/register', statusCode: 409 }, 'warn');
        return c.json({ error: 'password_policy' }, 409);
      }
    }
    // 其余（唯一约束兜底、未知 better-auth 错误、库层故障）仍走笼统 409 —— 日志里有
    // 原始错误，前端给可重试的兜底文案。
    logError('auth.register_failed', error, { route: '/auth/register' });
    return c.json({ error: 'register_failed' }, 409);
  }
});
