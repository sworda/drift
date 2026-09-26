// 角色库（CHAT-01 / CHAT-02）。真实 DB 读，不是静态 JSON。

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { character, db, personaVersion } from '@drift/db';

import { currentUserId } from '../auth/session.ts';
import { logEvent } from '../../obs/logger.ts';

export const characterRoutes = new Hono();

/**
 * 角色列表。
 *
 * 返回 `isAi: true` 而不是返回标识文案 —— 这是 COMPLY-01 的分工：服务端回答
 * 「对手方是不是 AI」，标识说什么由 @drift/contract 的常量决定（RESEARCH §8.1）。
 */
characterRoutes.get('/characters', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  const rows = await db
    .select({
      id: character.id,
      name: character.name,
      avatar: character.avatar,
      blurb: character.blurb,
    })
    .from(character)
    .orderBy(character.createdAt);

  logEvent('characters.listed', { userId, route: '/characters', count: rows.length });
  return c.json({ characters: rows.map((row) => ({ ...row, isAi: true })) });
});

characterRoutes.get('/characters/:id', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  const rows = await db
    .select({
      id: character.id,
      name: character.name,
      avatar: character.avatar,
      blurb: character.blurb,
      dossier: personaVersion.dossier,
      personaVersionId: personaVersion.id,
    })
    .from(character)
    .innerJoin(personaVersion, eq(character.currentPersonaVersionId, personaVersion.id))
    .where(eq(character.id, id));

  const row = rows[0];
  if (row === undefined) return c.json({ error: 'not_found' }, 404);
  return c.json({ character: { ...row, isAi: true } });
});
