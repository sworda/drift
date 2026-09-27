// 未读与断连补拉的六条集成断言（CHAT-05 / CHAT-06 / CHAT-07 / Plan 14 Task 1）。
//
//   (a) 「离线」期间服务端写入 M 条角色消息 ⇒ GET /conversations 的 unread_count = M
//   (b) 重连按 after_seq 补拉：恰好取回缺失的消息、seq 连续无空洞无重复
//   (c) 补拉期间发出的新消息 seq 大于补拉最大 seq，全列表无重复
//   (d) POST /conversations/:id/read 把未读清零；未读为 0 时列表返回 0
//   (e) 未读 150 渲染 99+ —— RTL 断言在 apps/web（react 只装在 apps/web，
//       见 vitest.config.ts unit 项目的 include 注释）
//   (f) 跨用户读写他人会话一律 404（T-14-03：userId 是查询条件的一部分）
//
// ── 「离线」在 Phase 1 的形态 ────────────────────────────────────────────────
// DB 是真相源（STACK §4）：客户端不在线 = WS 房间为空，deliver 返回 0，消息只落库。
// 本测试用「不连 WS 的 HTTP 客户端」模拟离线 —— 与真实离线的差别只有投递计数，
// 而落库与未读计数走的是同一条生产路径。

import type { AddressInfo } from 'node:net';

import { serve } from '@hono/node-server';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'unread-operator-token-0123456789abcd';
process.env['BETTER_AUTH_SECRET'] ??= 'unread-better-auth-secret-0123456789ab';
process.env['CONTACT_ENCRYPTION_KEY'] ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

const { createApp } = await import('../../apps/api/src/http/app.ts');
const { closeDb, message, ownerDb, ownerSql, session } = await import('@drift/db');
const { seedConversation } = await import('./fixtures.ts');

let baseUrl: string;
let stopServer: () => Promise<void>;

interface ListConversationsRow {
  readonly id: string;
  readonly characterName: string;
  readonly counterpartKind: string;
  readonly unreadCount: number;
  readonly lastMessageAt: string | null;
  readonly lastMessagePreview: string | null;
}

async function withToken(
  path: string,
  init: { readonly method?: string; readonly body?: unknown } = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${tokenHolder.token ?? ''}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

/** 每个用例换 token 的最小载体 —— withToken 读它。 */
const tokenHolder: { token: string | null } = { token: null };

async function createSessionToken(userId: string): Promise<string> {
  const token = randomUUID().replace(/-/gu, '') + randomUUID().replace(/-/gu, '');
  await ownerDb.insert(session).values({
    token,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return token;
}

beforeAll(async () => {
  const app = createApp();
  const listener = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  const address = await new Promise<AddressInfo>((resolve, reject) => {
    const existing = listener.address() as AddressInfo | null;
    if (existing !== null) {
      resolve(existing);
      return;
    }
    listener.once('listening', () => resolve(listener.address() as AddressInfo));
    listener.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
  stopServer = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      listener.close(() => resolve());
    });
  };
}, 60_000);

afterAll(async () => {
  await stopServer();
  await closeDb();
  await ownerSql.end({ timeout: 5 });
}, 30_000);

describe('未读与断连补拉（CHAT-05/06/07）', () => {
  it('(a)(b)(d)(f) 离线未读计数、after_seq 补拉连续性、已读清零、跨用户 404', async () => {
    const seeded = await seedConversation('unread-main');
    tokenHolder.token = await createSessionToken(seeded.userId);

    // ── 在线一轮（seq 1 user / seq 2 character），随后标记已读 ──────────────
    let response = await withToken(`/conversations/${seeded.conversationId}/messages`, {
      method: 'POST',
      body: { text: '在吗？' },
    });
    expect(response.status).toBe(201);

    response = await withToken(`/conversations/${seeded.conversationId}/read`, { method: 'POST' });
    expect(response.status).toBe(200);
    const readBody = (await response.json()) as { ok: boolean; lastReadSeq: number };
    expect(readBody.ok).toBe(true);
    expect(readBody.lastReadSeq).toBe(2);

    // ── 「离线」：不再连 WS，服务端再写 2 轮（4 条消息，其中 M=2 条角色消息）──
    for (const text of ['离线期间的第一条', '离线期间的第二条']) {
      const turn = await withToken(`/conversations/${seeded.conversationId}/messages`, {
        method: 'POST',
        body: { text },
      });
      expect(turn.status).toBe(201);
    }

    // (a) 未读数 = 角色消息数 M = 2。
    response = await withToken('/conversations');
    expect(response.status).toBe(200);
    const listBody = (await response.json()) as { conversations: ListConversationsRow[] };
    const mine = listBody.conversations.find((row) => row.id === seeded.conversationId);
    expect(mine, '会话列表必须包含该用户的会话').toBeDefined();
    expect(mine?.unreadCount).toBe(2);
    expect(mine?.counterpartKind).toBe('ai_character');
    expect(mine?.characterName).toBeTruthy();

    // 首条未读定位：读点在 seq 2，其后第一条角色消息是 seq 4。
    response = await withToken(`/conversations/${seeded.conversationId}/messages?after_seq=0`);
    expect(response.status).toBe(200);
    const fullBody = (await response.json()) as {
      firstUnreadSeq: number | null;
      messages: readonly { readonly seq: number; readonly senderKind: string }[];
    };
    expect(fullBody.firstUnreadSeq).toBe(4);

    // (b) 补拉：客户端最后持有 seq 2，重连补拉恰好 4 条、seq 连续无空洞。
    response = await withToken(`/conversations/${seeded.conversationId}/messages?after_seq=2`);
    expect(response.status).toBe(200);
    const backfillBody = (await response.json()) as {
      messages: readonly { readonly seq: number; readonly senderKind: string }[];
    };
    expect(backfillBody.messages.map((m) => m.seq)).toEqual([3, 4, 5, 6]);

    // (c) 补拉期间发出的新消息：seq 严格大于补拉最大 seq，全表无重复 seq。
    response = await withToken(`/conversations/${seeded.conversationId}/messages`, {
      method: 'POST',
      body: { text: '补拉期间新发的一条' },
    });
    expect(response.status).toBe(201);
    const turnBody = (await response.json()) as {
      reply: { readonly outcome: string; readonly seq?: number };
    };
    expect(['gated', 'escalated', 'refused', 'exited']).toContain(turnBody.reply.outcome);

    const allRows = await ownerDb
      .select({ seq: message.seq })
      .from(message)
      .where(eq(message.conversationId, seeded.conversationId))
      .orderBy(asc(message.seq));
    const seqs = allRows.map((row) => row.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs[seqs.length - 1]).toBeGreaterThan(6);

    // (d) 已读清零：read 之后未读为 0（接口如实返回 0，不隐藏字段）。
    response = await withToken(`/conversations/${seeded.conversationId}/read`, { method: 'POST' });
    expect(response.status).toBe(200);
    response = await withToken('/conversations');
    const afterRead = (await response.json()) as { conversations: ListConversationsRow[] };
    const mineAfter = afterRead.conversations.find((row) => row.id === seeded.conversationId);
    expect(mineAfter?.unreadCount).toBe(0);
  });

  it('(f) 跨用户：他人会话的读消息 / 已读标记 / 列表一律不可见（404 / 不出现）', async () => {
    const owner = await seedConversation('unread-owner');
    const attacker = await seedConversation('unread-attacker');
    tokenHolder.token = await createSessionToken(owner.userId);

    // owner 先产生 1 条未读（负向对照的「之前」值）。
    const turn = await withToken(`/conversations/${owner.conversationId}/messages`, {
      method: 'POST',
      body: { text: '这条是 owner 的' },
    });
    expect(turn.status).toBe(201);

    // 换攻击者身份。
    tokenHolder.token = await createSessionToken(attacker.userId);
    // 列表只含自己的会话。
    const response = await withToken('/conversations');
    const body = (await response.json()) as { conversations: ListConversationsRow[] };
    expect(body.conversations.some((row) => row.id === owner.conversationId)).toBe(false);

    // 读他人会话 ⇒ 404（不是 403 —— 不披露存在性）。
    const readForeign = await withToken(`/conversations/${owner.conversationId}/messages`);
    expect(readForeign.status).toBe(404);

    // 标记他人会话已读 ⇒ 404。
    const markForeign = await withToken(`/conversations/${owner.conversationId}/read`, {
      method: 'POST',
    });
    expect(markForeign.status).toBe(404);

    // 换回 owner：未读没有被攻击者的任何请求清零。
    tokenHolder.token = await createSessionToken(owner.userId);
    const ownerList = (await (await withToken('/conversations')).json()) as {
      conversations: ListConversationsRow[];
    };
    const ownerRow = ownerList.conversations.find((row) => row.id === owner.conversationId);
    expect(ownerRow?.unreadCount).toBe(1);
  });
});
