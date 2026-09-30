// 一键导出的路由（PRIV-04 / COMPLY-02）—— POST /me/export 与状态/下载。
//
// 下载链接绑定用户（T-11-05）：文件路径从 privacy_action（session.userId 的行）
// 派生，:exportId 是 128 位随机 id（不可枚举），跨用户访问返回 404。

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { db, privacyAction, tx } from '@drift/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { env } from '../../config/env.ts';
import { logError, logEvent } from '../../obs/logger.ts';
import { currentUserId } from '../auth/session.ts';
import { createExportAction, EXPORT_TTL_DAYS } from '../../worker/jobs/export-build.ts';
import { requireExportBoss } from './export-boss.ts';

export const exportRoutes = new Hono();

exportRoutes.post('/me/export', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  try {
    const { exportId } = await tx(async (t) =>
      createExportAction(requireExportBoss(), t, userId),
    );
    logEvent('privacy.export_requested', { userId, route: '/me/export', statusCode: 202 });
    return c.json({ exportId, ttlDays: EXPORT_TTL_DAYS }, 202);
  } catch (error) {
    logError('privacy.export_request_failed', error, { userId, route: '/me/export', statusCode: 503 });
    return c.json({ error: 'export_not_started' }, 503);
  }
});

exportRoutes.get('/me/export/:exportId', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  const exportId = c.req.param('exportId');
  const rows = await db
    .select({ payload: privacyAction.payload })
    .from(privacyAction)
    .where(and(eq(privacyAction.id, exportId), eq(privacyAction.userId, userId)))
    .limit(1);
  const payload = rows[0]?.payload as { readonly status?: string } | undefined;
  if (payload === undefined) return c.json({ error: 'not_found' }, 404);
  if (payload.status === 'pending') return c.json({ status: 'pending' }, 202);
  return c.json(payload);
});

exportRoutes.get('/me/export/:exportId/download', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  const exportId = c.req.param('exportId');
  const format = c.req.query('format') === 'json' ? 'json' : 'md';
  const rows = await db
    .select({ payload: privacyAction.payload })
    .from(privacyAction)
    .where(and(eq(privacyAction.id, exportId), eq(privacyAction.userId, userId)))
    .limit(1);
  const payload = rows[0]?.payload as
    | { readonly status?: string; readonly md?: string; readonly json?: string }
    | undefined;
  // 404 而不是 403：不披露这份产物是否存在（T-11-05）。
  if (payload === undefined || payload.status !== 'complete') return c.json({ error: 'not_found' }, 404);

  const fileName = format === 'json' ? payload.json : payload.md;
  if (fileName === undefined) return c.json({ error: 'not_found' }, 404);
  try {
    const body = await readFile(join(env.EXPORT_ARTIFACTS_DIR, userId, fileName), 'utf8');
    return c.body(body, 200, {
      'content-type': format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${exportId}.${format}"`,
    });
  } catch (error) {
    logError('privacy.export_download_failed', error, { route: '/me/export/:exportId/download', statusCode: 404 });
    return c.json({ error: 'not_found' }, 404);
  }
});
