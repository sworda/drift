// 注册路由。
//
// ── 与 PLAN 的偏离（Rule 2）────────────────────────────────────────────────────
// 注册链路的完整形态（better-auth、紧急联系人加密、ConsentTicket、注册 UI、
// 18 岁法定终态拒绝）属 **Plan 09**，better-auth 也还不在依赖里（T-04-SC：本 plan
// 不新增未经核验的包）。但本 plan 的 tracer 验收第 (1)(2) 条要求「同一邀请码并发
// 注册恰好一个成功」与「注册后 consent 恰好 5 行」—— 没有注册入口就无从断言。
// 这里交付 tracer 需要的那一刀，形态与 Plan 09 对齐、由它替换其中建账号那一步。
//
// COMPLY-07 的 18 岁校验在这里是一条 400，**不是** UI 的法定终态拒绝页面
// （那个页面与它的文案属 Plan 09）。服务端先有硬校验，UI 后补 —— 反过来会有一段
// 时间「只要不走 UI 就能注册未成年账号」。

import { Hono } from 'hono';
import { z } from 'zod';

import {
  CONSENT_SCOPES,
  InviteCodeUnavailableError,
  registerWithInvite,
  RequiredConsentMissingError,
} from '@drift/db';

import { logError, logEvent } from '../../obs/logger.ts';

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
  policyVersion: z.string().min(1).max(128),
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
      policyVersion: body.policyVersion,
    });
    logEvent('auth.registered', { userId: result.userId, route: '/auth/register', statusCode: 201 });
    return c.json({ userId: result.userId, sessionToken: result.sessionToken }, 201);
  } catch (error) {
    if (error instanceof InviteCodeUnavailableError) {
      return c.json({ error: 'invite_code_unavailable' }, 409);
    }
    if (error instanceof RequiredConsentMissingError) {
      return c.json({ error: 'required_consent_missing' }, 400);
    }
    // 唯一约束（同一邮箱重复注册）也走这里 —— 409 而不是 500。
    logError('auth.register_failed', error, { route: '/auth/register' });
    return c.json({ error: 'register_failed' }, 409);
  }
});
