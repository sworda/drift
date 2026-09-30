// 隐私中心的同意读取与撤回（PRIV-02）。
//
// 两条路由，一条不可协商的行为：**必选项的撤回必须先拿到二次确认**。服务端在没有拿到
// 逐字短语时返回 `requiresConfirmation`，前端据此打开 AlertDialog（文案与短语都由服务端
// 给出，来自 @drift/contract 的同一份常量 —— 抄两份会让两端在「撤回会发生什么」上各说
// 各话）。把二次确认只做在前端是不够的：绕过 UI 的一次请求就能把账号删了。

import {
  ACCOUNT_DELETION_CONFIRMATION_PHRASE,
  CONSENT_SCOPES,
  CONSENT_SCOPE_SPECS,
  isRequiredScope,
  revokeConfirmationCopy,
} from '@drift/contract';
import { db } from '@drift/db';
import { Hono } from 'hono';
import { z } from 'zod';

import { logError, logEvent } from '../../obs/logger.ts';
import { currentUserId } from '../auth/session.ts';
import { ConsentNotFoundError, listConsents, revokeConsent } from './service.ts';

const RevokeBody = z
  .object({
    /** 必选项撤回时必须逐字等于 ACCOUNT_DELETION_CONFIRMATION_PHRASE。 */
    confirmationPhrase: z.string().max(64).optional(),
  })
  .default(() => ({}));

export const consentRoutes = new Hono();

consentRoutes.get('/me/consents', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ consents: await listConsents(db, userId) });
});

consentRoutes.post('/me/consents/:scope/revoke', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  const scopeParam = c.req.param('scope');
  const scope = CONSENT_SCOPES.find((candidate) => candidate === scopeParam);
  if (scope === undefined) return c.json({ error: 'unknown_scope' }, 404);

  const parsed = RevokeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);

  if (isRequiredScope(scope) && parsed.data.confirmationPhrase !== ACCOUNT_DELETION_CONFIRMATION_PHRASE) {
    // 409 而不是 400：请求本身没有格式错误，它只是还缺一次人的确认。
    return c.json(
      {
        error: 'confirmation_required',
        requiresConfirmation: true,
        scope,
        label: CONSENT_SCOPE_SPECS[scope].label,
        confirmationPhrase: ACCOUNT_DELETION_CONFIRMATION_PHRASE,
        confirmationCopy: revokeConfirmationCopy(scope),
      },
      409,
    );
  }

  try {
    const result = await revokeConsent(userId, scope);
    logEvent('consent.revoked', { userId, route: '/me/consents/:scope/revoke', statusCode: 200 });
    return c.json(result);
  } catch (error) {
    if (error instanceof ConsentNotFoundError) return c.json({ error: 'consent_not_found' }, 404);
    // 入队删除作业失败（Plan 11 之前恒失败）⇒ 整条撤回已回滚。
    // 这里回 503 而不是 500：它是一个「稍后重试仍可能成功」的状态，而 UI-SPEC 的
    // 「这项同意没有撤回成功 —— 对应的数据流仍在继续」正是这一支的文案。
    logError('consent.revoke_failed', error, { userId, route: '/me/consents/:scope/revoke' });
    return c.json({ error: 'revoke_failed', dataFlowContinues: true }, 503);
  }
});
