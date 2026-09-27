// 聊天路由（CHAT-03 / CHAT-06 / CHAT-07）。
//
// ⚠️ 两条路由的 WHERE 里都带 `conversation.user_id = <session 里的 userId>`
// （T-04-01）。跨用户访问返回 404 而不是 403 —— 403 会告诉攻击者「这个 id 存在」。

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { MESSAGE_TEXT_MAX } from '@drift/contract';
import { conversation, db, listMessagesAfterSeq } from '@drift/db';

import { currentUserId } from '../auth/session.ts';
import { logError, logEvent } from '../../obs/logger.ts';
import { ConversationNotFoundError, runTurn } from './turn.ts';
import { defaultHardExitPorts, executeHardExit } from './exit.ts';

/** 入参上限来自 contract 的同一个常量 —— UI 的 2000 字视觉测试（Plan 14）与它同源。 */
const SendBody = z.object({
  text: z.string().min(1).max(MESSAGE_TEXT_MAX),
});

const AfterSeqQuery = z.coerce.number().int().nonnegative().default(0);

export const chatRoutes = new Hono();

async function assertOwnedConversation(userId: string, conversationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), eq(conversation.userId, userId)));
  return rows[0] !== undefined;
}

chatRoutes.post('/conversations/:id/messages', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  const parsed = SendBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues.map((i) => i.message) }, 400);
  }

  try {
    const result = await runTurn({
      conversationId: c.req.param('id'),
      userId,
      text: parsed.data.text,
    });
    return c.json(result, 201);
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return c.json({ error: 'not_found' }, 404);
    }
    logError('chat.send_failed', error, { userId, route: '/conversations/:id/messages' });
    return c.json({ error: 'turn_failed' }, 500);
  }
});

/**
 * 窗口操作退出（第十九条 / UI-SPEC ## 硬退出呈现契约）：「更多」Sheet 的
 * 「结束本次会话」入口。与关键词路径走同一个 executeHardExit —— 两条退出
 * 途径在服务端是同一套保证（零出站双处执行 + 中性系统卡片）。
 */
chatRoutes.post('/conversations/:id/exit', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  const conversationId = c.req.param('id');
  if (!(await assertOwnedConversation(userId, conversationId))) {
    return c.json({ error: 'not_found' }, 404);
  }

  try {
    const result = await executeHardExit(conversationId, defaultHardExitPorts(), {
      userId,
      matchedRule: 'window_control',
    });
    return c.json(
      {
        endedAt: result.endedAt.toISOString(),
        systemMessage: result.systemMessage,
        alreadyEnded: result.alreadyEnded,
      },
      200,
    );
  } catch (error) {
    logError('chat.exit_failed', error, { userId, route: '/conversations/:id/exit' });
    return c.json({ error: 'exit_failed' }, 500);
  }
});

/**
 * 重连补拉（CHAT-07 / CHAT-06）。
 *
 * 离线期间不推送、上线时按游标补齐。返回按 seq 升序，客户端据此判断有无空洞。
 */
chatRoutes.get('/conversations/:id/messages', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  const conversationId = c.req.param('id');
  if (!(await assertOwnedConversation(userId, conversationId))) {
    return c.json({ error: 'not_found' }, 404);
  }

  const parsedSeq = AfterSeqQuery.safeParse(c.req.query('after_seq') ?? 0);
  if (!parsedSeq.success) return c.json({ error: 'invalid_after_seq' }, 400);

  const messages = await listMessagesAfterSeq(db, conversationId, parsedSeq.data);
  logEvent('chat.backfilled', {
    userId,
    conversationId,
    count: messages.length,
    route: '/conversations/:id/messages',
  });
  return c.json({
    messages: messages.map((m) => ({
      messageId: m.id,
      conversationId,
      seq: m.seq,
      senderKind: m.senderKind,
      text: m.text,
      disclosure: m.disclosure,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});
