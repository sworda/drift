// 会话列表与已读标记（CHAT-05 / CHAT-06）。
//
// ⚠️ 两条路由的 WHERE 里都带 `conversation.user_id = <session 里的 userId>`（T-04-01，
// 与 chat/routes.ts 同一条纪律）：跨用户访问返回 404 而不是 403 —— 403 会告诉攻击者
// 「这个 id 存在」。
//
// ── last_read_seq 的存储形态（与 PLAN 字面不同的实现，Rule 1）──────────────────
// PLAN 写「未读清零并记录 last_read_seq」，但 conversation 表没有（也不需要）这个
// 列：read 点由 `unread_count = 0` 隐式记录 —— 角色消息只在插入时 +1、读取点之后
// 插入的角色消息恰好是「最后 unreadCount 条角色消息」，于是 first_unread_seq 可以
// 从 (message, unread_count) 派生，不需要第二份会与消息表漂移的游标状态。

import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { character, conversation, db } from '@drift/db';

import { currentUserId } from '../auth/session.ts';
import { logEvent } from '../../obs/logger.ts';

export const conversationsRoutes = new Hono();

/** 最后一条消息的摘要（会话行第二行）。 correlated subquery，避免 N+1。 */
const lastMessagePreview = sql<string | null>`(
  select m.text from message m
  where m.conversation_id = ${conversation.id}
  order by m.seq desc
  limit 1
)`;

/**
 * 全部会话（含未读数）。按 last_message_at desc nulls last 排序 —— 没有消息的
 * 新会话沉底而不是置顶（PG 的 DESC 默认 NULLS FIRST，与直觉相反）。
 */
conversationsRoutes.get('/conversations', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  const rows = await db
    .select({
      id: conversation.id,
      characterId: conversation.characterId,
      characterName: character.name,
      characterAvatar: character.avatar,
      counterpartKind: conversation.counterpartKind,
      status: conversation.status,
      unreadCount: conversation.unreadCount,
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview,
    })
    .from(conversation)
    .innerJoin(character, eq(conversation.characterId, character.id))
    .where(eq(conversation.userId, userId))
    .orderBy(sql`${conversation.lastMessageAt} desc nulls last`, sql`${conversation.createdAt} desc`);

  logEvent('conversations.listed', { userId, route: '/conversations', count: rows.length });
  return c.json({
    conversations: rows.map((row) => ({
      ...row,
      lastMessageAt: row.lastMessageAt === null ? null : row.lastMessageAt.toISOString(),
    })),
  });
});

/**
 * 进入会话时的已读标记：把 unread_count 清零。
 *
 * 「记录 last_read_seq」的等价物：清零时刻的 read 点 = 当时库里最大 seq
 *（next_seq - 1，作为返回值给客户端）。条件更新（unread_count > 0）保证幂等 ——
 * 重复调用不产生第二次写入。
 */
conversationsRoutes.post('/conversations/:id/read', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  const conversationId = c.req.param('id');
  const rows = await db
    .update(conversation)
    .set({ unreadCount: 0 })
    .where(
      and(
        eq(conversation.id, conversationId),
        eq(conversation.userId, userId),
        // 条件更新：已经是 0 就不再写（幂等）。
        sql`${conversation.unreadCount} > 0`,
      ),
    )
    .returning({ id: conversation.id, nextSeq: conversation.nextSeq });

  // 不属于该用户 / 不存在 ⇒ 404（不披露存在性）。
  const owned = await db
    .select({ id: conversation.id, nextSeq: conversation.nextSeq })
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), eq(conversation.userId, userId)));
  if (rows.length === 0 && owned.length === 0) {
    return c.json({ error: 'not_found' }, 404);
  }

  const meta = rows[0] ?? owned[0];
  logEvent('conversations.read', { userId, conversationId, route: '/conversations/:id/read' });
  return c.json({ ok: true, lastReadSeq: meta === undefined ? 0 : meta.nextSeq - 1 });
});
