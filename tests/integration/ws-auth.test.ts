// WS 握手鉴权的集成断言（01-REVIEW Finding #1 修复）。
//
//   (a) 无 token 连接：收不到**任何**下行帧，且被 4400 'unauthorized' 关闭
//   (b) 无归属连接（他人有效 session + 本会话 id）：同样 0 帧、同样 4400 同一句
//       reason —— 不区分「token 无效」与「无权限」（T-09-06）
//   (c) 合法连接（本人 session + 本人会话）：照常收到 message.created，
//       seq 与库里的角色消息一致
//
// 关键形态：三条连接**同时**挂在同一会话上，然后打一个真实 turn —— 若鉴权被删，
// (a)(b) 的 frames 数组立刻非空，断言失败。零帧断言在合法连接收到帧**之后**再做，
// 证明「投递确实发生了，只是没到不该到的人手里」，而不是「压根没人发」。
//
// ⚠️ 用全局 WebSocket（Node 22+）而不是 import 'ws'：eslint 只允许 apps/api/src/ws/**
// 导入 ws —— 那条包边界在测试文件里同样成立（见 tracer.test.ts 文件头）。

import type { AddressInfo } from 'node:net';

import { serve } from '@hono/node-server';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'ws-auth-operator-token-0123456789abcdef';
process.env['BETTER_AUTH_SECRET'] ??= 'ws-auth-better-auth-secret-0123456789ab';
process.env['CONTACT_ENCRYPTION_KEY'] ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

const { createApp } = await import('../../apps/api/src/http/app.ts');
const { attachWebSocket } = await import('../../apps/api/src/ws/server.ts');
const { closeDb, db, message, ownerSql } = await import('@drift/db');
const { seedConversation } = await import('./fixtures.ts');

let baseUrl: string;
let wsUrl: string;
let stopServer: () => Promise<void>;

beforeAll(async () => {
  const app = createApp();
  const listener = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  const ws = attachWebSocket(listener as never);
  stopServer = async (): Promise<void> => {
    await ws.close();
    await new Promise<void>((resolve) => {
      listener.close(() => {
        resolve();
      });
    });
  };
  const address = await new Promise<AddressInfo>((resolve, reject) => {
    const existing = listener.address() as AddressInfo | null;
    if (existing !== null) {
      resolve(existing);
      return;
    }
    listener.once('listening', () => {
      const bound = listener.address() as AddressInfo | null;
      if (bound === null) reject(new Error('测试服务器未绑定端口'));
      else resolve(bound);
    });
    listener.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
  wsUrl = `ws://127.0.0.1:${String(address.port)}/ws`;
});

afterAll(async () => {
  await stopServer();
  await closeDb();
  await ownerSql.end({ timeout: 5 });
});

interface RecordedSocket {
  readonly frames: string[];
  /** 服务端主动关闭时的 (code, reason)；连接仍开着为 null。 */
  closedWith: { readonly code: number; readonly reason: string } | null;
}

/** 连上并开始记录全部下行帧与关闭事件（open 在鉴权**之前**到达，不能当「已入房间」）。 */
function connect(url: string): Promise<RecordedSocket> {
  const socket = new WebSocket(url);
  const record: RecordedSocket = { frames: [], closedWith: null };
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(record));
    socket.addEventListener('error', () => reject(new Error('WebSocket 连接失败')));
    socket.addEventListener('message', (event: MessageEvent) => {
      record.frames.push(String(event.data));
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      record.closedWith = { code: event.code, reason: event.reason };
    });
  });
}

describe('WS 握手鉴权（01-REVIEW #1）', () => {
  it('无 token / 无归属 / 合法三条连接：前两者 0 帧 + 4400，第三者照常收到 message.created', async () => {
    // 本人会话 + 本人 session（合法）；攻击者是另一个真实账号（有自己的有效 session）。
    const owner = await seedConversation('ws-auth-owner');
    const attacker = await seedConversation('ws-auth-attacker');

    // (a) 无 token —— 任何人拿到 conversationId 就能发起的形态。
    const noToken = await connect(
      `${wsUrl}?conversationId=${encodeURIComponent(owner.conversationId)}`,
    );
    // (b) 他人有效 session + 本会话 id —— 「我是合法用户但会话不是我的」。
    const noOwnership = await connect(
      `${wsUrl}?conversationId=${encodeURIComponent(owner.conversationId)}&token=${encodeURIComponent(attacker.sessionToken)}`,
    );
    // (c) 合法连接。
    const legit = await connect(
      `${wsUrl}?conversationId=${encodeURIComponent(owner.conversationId)}&token=${encodeURIComponent(owner.sessionToken)}`,
    );

    // 入房间发生在鉴权 resolve 之后（open 事件不等于已入房间）。等拒绝路径先落地：
    // 无 token / 无归属的连接应当已被 4400 关闭 —— 这本身就是要断言的 (a)(b)。
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(
      noToken.closedWith,
      '无 token 连接未被关闭 —— 鉴权缺失会让旁听无限期挂着',
    ).toEqual({ code: 4400, reason: 'unauthorized' });
    expect(
      noOwnership.closedWith,
      '无归属连接未被关闭 —— 他人有效 session 不应进入本会话房间',
    ).toEqual({ code: 4400, reason: 'unauthorized' });
    // T-09-06：两种失败对客户端不可区分（同一 code + 同一句 reason）。
    expect(noToken.closedWith).toEqual(noOwnership.closedWith);
    expect(legit.closedWith, '合法连接不应被关闭').toBeNull();

    // 合法连接入房间同样发生在 open 之后 —— 给它一点时间完成登记再打真实 turn。
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 打一个真实 turn（mock provider）：落库 + deliver() 向房间投 message.created。
    const response = await fetch(
      `${baseUrl}/conversations/${owner.conversationId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.sessionToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: '这条消息只应到达本人连接。' }),
      },
    );
    expect(response.status).toBe(201);

    // (c) 合法连接收到 message.created，seq 与库里角色消息一致。
    const deadline = Date.now() + 10_000;
    let legitFrame: { readonly type: string; readonly payload: Record<string, unknown> } | null =
      null;
    while (Date.now() < deadline && legitFrame === null) {
      legitFrame =
        legit.frames
          .map((raw) => JSON.parse(raw) as { type: string; payload: Record<string, unknown> })
          .find((frame) => frame.type === 'message.created') ?? null;
      if (legitFrame === null) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(
      legitFrame,
      '合法连接未收到 message.created —— 鉴权把合法用户也挡了',
    ).not.toBeNull();
    if (legitFrame === null) return;

    const characterRow = (
      await db
        .select({ seq: message.seq })
        .from(message)
        .where(eq(message.conversationId, owner.conversationId))
        .orderBy(asc(message.seq))
    )[1];
    expect(legitFrame.payload['seq']).toBe(characterRow?.seq);
    expect(legitFrame.payload['senderKind']).toBe('character');

    // (a)(b) 零帧断言：投递确实发生了（上一段已证明），这两条连接必须一帧都没收到。
    // 在合法连接收到帧之后再等一个宽限期，排除「只是还没送到」的侥幸。
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      noToken.frames,
      '无 token 连接收到了下行帧 —— 01-REVIEW #1 的旁听路径仍然存在',
    ).toEqual([]);
    expect(
      noOwnership.frames,
      '无归属连接收到了下行帧 —— conversationId 外流即旁听仍然成立',
    ).toEqual([]);
  });

  it('不存在的会话 id + 有效 session：同样 4400 unauthorized（不披露会话是否存在）', async () => {
    const someone = await seedConversation('ws-auth-ghost');
    const record = await connect(
      `${wsUrl}?conversationId=${encodeURIComponent('00000000-0000-0000-0000-000000000000')}&token=${encodeURIComponent(someone.sessionToken)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(record.closedWith).toEqual({ code: 4400, reason: 'unauthorized' });
    expect(record.frames).toEqual([]);
  });
});
