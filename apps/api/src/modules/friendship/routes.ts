// 加为好友（CHAT-02）—— 建 friendship 与 conversation。
//
// 幂等：已经是好友时返回既有 conversation 而不是再建一个。重复建会让「消息在哪个
// 会话里」变成一个取决于点击次数的问题，而用户看到的是消息凭空消失。

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { character, conversation, db, friendship, tx } from '@drift/db';

import { currentUserId } from '../auth/session.ts';
import { logEvent } from '../../obs/logger.ts';

export const friendshipRoutes = new Hono();

friendshipRoutes.post('/characters/:id/friend', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  const characterId = c.req.param('id');

  const existingCharacter = await db
    .select({ id: character.id })
    .from(character)
    .where(eq(character.id, characterId));
  if (existingCharacter[0] === undefined) return c.json({ error: 'not_found' }, 404);

  const existingConversation = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.userId, userId), eq(conversation.characterId, characterId)));
  const already = existingConversation[0];
  if (already !== undefined) {
    return c.json({ conversationId: already.id, created: false }, 200);
  }

  const created = await tx(async (t) => {
    await t.insert(friendship).values({
      userId,
      characterId,
      relationship: 'stranger',
    });
    const rows = await t
      .insert(conversation)
      .values({
        userId,
        characterId,
        counterpartKind: 'ai_character',
        status: 'active',
      })
      .returning({ id: conversation.id });
    const row = rows[0];
    if (row === undefined) throw new Error('conversation 插入未返回行');
    return row.id;
  });

  logEvent('friendship.created', {
    userId,
    characterId,
    conversationId: created,
    route: '/characters/:id/friend',
    statusCode: 201,
  });
  return c.json({ conversationId: created, created: true }, 201);
});
