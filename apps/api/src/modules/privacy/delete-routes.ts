// 一键删除的路由（PRIV-05 / D-19）—— POST /me/delete 与回执读取。
//
// ── 短语闸门 ────────────────────────────────────────────────────────────────
// 删除是单向门（D-19 one-way）：服务端在没有拿到逐字短语时返回 confirmation_
// required（409），前端据此打开 AlertDialog。把二次确认只做在前端是不够的 ——
// 绕过 UI 的一次请求就能把账号删了。短语与撤回必选项是同一个（@drift/contract：
// 两种入口在后果上是同一件事）。
//
// ── 回执在删除完成后怎么读 ─────────────────────────────────────────────────
// 用户行与 session 行都被删掉之后，/me/* 全部 401 —— 回执页因此有一条**不依赖
// session** 的读取路径：GET /privacy-receipts/:actionId?token=。token 是 POST
// /me/delete 响应里的一次性回执凭证（122 位随机 UUID，不可枚举；与导出下载链接
// 同一「持有即有权」的形态）。跨用户访问（错 token / 无 token）返回 404 —— 不
// 披露回执是否存在（T-11-05）。
//
// 轮询形态：GET /me/privacy-actions/:actionId 在作业未完成时返回 202（等价的
// 未完成态）；作业完成即删除了 session，同一路由转 401 —— 前端收到 401 时切换
// 到 token 路径。两条路读的是同一行 privacy_action。

import { timingSafeEqual } from 'node:crypto';

import { ACCOUNT_DELETION_CONFIRMATION_PHRASE } from '@drift/contract';
import { db, privacyAction, tx } from '@drift/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { logError, logEvent } from '../../obs/logger.ts';
import { currentUserId } from '../auth/session.ts';
import { createDeletionAction } from '../../worker/jobs/account-deletion.ts';

const DeleteBody = z
  .object({
    /** 必须逐字等于 ACCOUNT_DELETION_CONFIRMATION_PHRASE（「删除我的全部数据」）。 */
    confirmationPhrase: z.string().max(64).optional(),
  })
  .default(() => ({}));

export const deleteRoutes = new Hono();

/**
 * 回执 token 的恒时比对（01-REVIEW #2 修复：注释曾声称恒时，实现却是普通 !==）。
 *
 * 长度不等时先短路：回执 token 是 createDeletionAction 生成的固定长度随机 UUID，
 * 真值长度恒定 —— 短路只暴露「来者长度不对」，而这个信息本来就握在来者自己手里，
 * 不构成旁路。长度相等后的逐字节比较走 node:crypto 的 timingSafeEqual。
 */
function receiptTokenMatches(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'));
}

deleteRoutes.post('/me/delete', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  const parsed = DeleteBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);

  if (parsed.data.confirmationPhrase !== ACCOUNT_DELETION_CONFIRMATION_PHRASE) {
    // 409 而不是 400：请求本身没有格式错误，它只是还缺一次人的确认。
    return c.json(
      {
        error: 'confirmation_required',
        requiresConfirmation: true,
        confirmationPhrase: ACCOUNT_DELETION_CONFIRMATION_PHRASE,
      },
      409,
    );
  }

  try {
    // privacy_action 的 pending 行 + 作业入队发生在**同一个事务**里：先建行再入队
    // 的任何间隙都可能留下「动作存在但删除从未开始」的半状态。
    const credentials = await tx(async (t) =>
      createDeletionAction(t, userId, 'user_request'),
    );
    logEvent('privacy.deletion_requested', { userId, route: '/me/delete', statusCode: 202 });
    return c.json(credentials, 202);
  } catch (error) {
    // boss 未注册（worker 没起）等入队失败 ⇒ 503：一个「稍后重试仍可能成功」的
    // 状态。此时**什么都没发生**（事务回滚）—— 这是诚实的失败形态。
    logError('privacy.deletion_request_failed', error, { userId, route: '/me/delete', statusCode: 503 });
    return c.json({ error: 'deletion_not_started' }, 503);
  }
});

/** 读回执（session 仍有效时 —— 作业执行期间的轮询路径）。 */
deleteRoutes.get('/me/privacy-actions/:actionId', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  const actionId = c.req.param('actionId');
  const rows = await db
    .select({ payload: privacyAction.payload })
    .from(privacyAction)
    .where(and(eq(privacyAction.id, actionId), eq(privacyAction.userId, userId)))
    .limit(1);
  const payload = rows[0]?.payload as { readonly status?: string } | undefined;
  if (payload === undefined) return c.json({ error: 'not_found' }, 404);
  if (payload.status === 'pending' || payload.status === undefined) {
    // 202 = 等价的未完成态（PLAN 的集成断言：作业未完成时请求回执返回 202）。
    return c.json({ status: 'pending' }, 202);
  }
  return c.json(payload);
});

/** 读回执（删除完成后 —— session 已随账号消失，token 是唯一凭证）。 */
deleteRoutes.get('/privacy-receipts/:actionId', async (c) => {
  const actionId = c.req.param('actionId');
  const token = c.req.query('token') ?? '';

  const rows = await db
    .select({ payload: privacyAction.payload })
    .from(privacyAction)
    .where(eq(privacyAction.id, actionId))
    .limit(1);
  const payload = rows[0]?.payload as { readonly receiptToken?: string } | undefined;
  const expected = payload?.receiptToken;
  if (expected === undefined || !receiptTokenMatches(expected, token)) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json(payload);
});
