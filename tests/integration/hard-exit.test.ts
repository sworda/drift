// 硬退出的六条集成断言（COMPLY-05 / D-12 / Plan 12 Task 3）。
//
//   (a) 排定一个延迟作业后硬退出，再触发该作业 ⇒ 0 条出站消息（成功标准 5 核心）
//   (b) 硬退出后网关对该会话返回 conversation_ended 的 refused 态
//   (c) 硬退出后 message 表新增的只有一条 sender_kind = system 的卡片，无 character 行
//   (d) 硬退出后 usage-reminder 作业触发时不发出任何消息（worker 事务内重读）
//   (e) 对整个会话历史跑 hitsRetentionPhrase，命中数为 0（挽留触发率恒为 0）
//   (f) tier 2 用语只写 exit_intent 且 conversation.status 仍为 active
//
// ── (a) 的「延迟投递作业」说明 ─────────────────────────────────────────────
// Phase 1 没有拟真延迟投递队列（Phase 2 的 REAL-04）。本测试用两个真实形态补位：
// 一个会话级探针队列（验证 executeHardExit 的按 singletonKey 取消真的取消了），
// 加一个真实排定的 usage-reminder 作业（验证「取消不掉的作业也发不出消息」——
// worker 侧重读才是竞态的兜底）。两个方向合起来才是 PLAN 要的断言。

import type { AddressInfo } from 'node:net';

import { serve } from '@hono/node-server';
import { and, asc, eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'hard-exit-operator-token-0123456789abc';
process.env['BETTER_AUTH_SECRET'] ??= 'hard-exit-better-auth-secret-0123456789ab';
process.env['CONTACT_ENCRYPTION_KEY'] ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

const { createApp } = await import('../../apps/api/src/http/app.ts');
const { attachWebSocket } = await import('../../apps/api/src/ws/server.ts');
const { closeDb, conversation, db, exitIntent, message, ownerSql, usageSegment } = await import(
  '@drift/db'
);
const { hitsRetentionPhrase, safetyGateway } = await import('@drift/safety');
const { runTurn } = await import('../../apps/api/src/modules/chat/turn.ts');
const {
  cancelConversationJobs,
  executeHardExit,
  registerConversationScopedQueue,
  setHardExitBoss,
} = await import('../../apps/api/src/modules/chat/exit.ts');
const { runUsageReminder } = await import('../../apps/api/src/modules/usage/segment.ts');
const { createUsageReminderQueue, sendUsageReminder } = await import(
  '../../apps/api/src/worker/jobs/usage-reminder.ts'
);
const { seedConversation } = await import('./fixtures.ts');

const BOSS_SCHEMA = 'pgboss_hard_exit';
/** 会话级探针队列：验证「按 singletonKey 显式取消」在真实 pg-boss 上成立。 */
const PROBE_QUEUE = 'hard-exit-probe';

let wsUrl: string;
let stopServer: () => Promise<void>;
let boss: PgBoss;

function openSocket(conversationId: string, sessionToken: string): Promise<WebSocket> {
  // WS 握手鉴权（01-REVIEW #1）：连接必须带 session token，服务端校验会话归属。
  const socket = new WebSocket(
    `${wsUrl}?conversationId=${encodeURIComponent(conversationId)}&token=${encodeURIComponent(sessionToken)}`,
  );
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', () => reject(new Error('WebSocket 连接失败')));
  });
}

interface Frame {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

function collectFrames(socket: WebSocket, ms: number): Promise<Frame[]> {
  return new Promise((resolve) => {
    const frames: Frame[] = [];
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      resolve(frames);
    }, ms);
    function onMessage(event: MessageEvent): void {
      frames.push(JSON.parse(String(event.data)) as Frame);
    }
    socket.addEventListener('message', onMessage);
    void timer;
  });
}

beforeAll(async () => {
  const app = createApp();
  const listener = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  const ws = attachWebSocket(listener as never);
  stopServer = async (): Promise<void> => {
    await ws.close();
    await new Promise<void>((resolve) => {
      listener.close(() => resolve());
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
  wsUrl = `ws://127.0.0.1:${String(address.port)}/ws`;

  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined) throw new Error('DATABASE_URL 未设置');
  boss = new PgBoss({ connectionString, schema: BOSS_SCHEMA, application_name: 'hard-exit-test' });
  boss.on('error', () => undefined);
  await boss.start();
  await createUsageReminderQueue(boss);
  await boss.createQueue(PROBE_QUEUE);
  registerConversationScopedQueue(PROBE_QUEUE);
  setHardExitBoss(boss);
}, 120_000);

afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5_000 });
  await stopServer();
  await closeDb();
  await ownerSql.end({ timeout: 5 });
});

describe('硬退出（COMPLY-05 / D-12）', () => {
  it('(a) 排定延迟作业后硬退出，触发作业 ⇒ 0 条出站消息；会话级作业被显式取消', async () => {
    const seeded = await seedConversation('exit-a');
    const socket = await openSocket(seeded.conversationId, seeded.sessionToken);

    // ① 会话级探针作业（singletonKey = conversationId，远期 startAfter —— 不自动跑）。
    await boss.send(PROBE_QUEUE, { note: 'probe' }, { startAfter: 3_600, singletonKey: seeded.conversationId });

    // ② 用户级 usage-reminder 作业（真实延迟出站作业，模拟取消不掉的那一类）。
    const inserted = await db
      .insert(usageSegment)
      .values({
        userId: seeded.userId,
        startedAt: new Date(Date.now() - 7_199_000),
        lastActivityAt: new Date(),
        accumulatedSeconds: 7_199,
      })
      .returning({ id: usageSegment.id });
    const segmentId = inserted[0]?.id;
    if (segmentId === undefined) throw new Error('段插入未返回行');
    await sendUsageReminder(boss, segmentId, 3_600);

    // 硬退出（关键词路径）。
    const turn = await runTurn({
      conversationId: seeded.conversationId,
      userId: seeded.userId,
      text: '退出',
    });
    expect(turn.reply.outcome).toBe('exited');

    // 会话级作业被显式取消（findJobs 查不到排队中的）。
    const remaining = await boss.findJobs(PROBE_QUEUE, {
      key: seeded.conversationId,
      queued: true,
    });
    expect(remaining, '按 singletonKey 的显式取消必须真的取消').toHaveLength(0);

    // 取消不掉的作业（usage-reminder）被强制触发：worker 侧重读 status ⇒ 零投递。
    const published = await runUsageReminder(db, segmentId, new Date());
    expect(published, '硬退出后的会话一个事件都不能收到').toBe(0);

    // WS 房间在窗口期内只见过 conversation.ended（退出机制本身），没有任何
    // 出站消息（message.created / usage.reminder / dependency.notice）。
    const frames = await collectFrames(socket, 2_500);
    const outbound = frames.filter(
      (f) => f.type !== 'conversation.ended' && f.type !== 'typing.stop',
    );
    expect(outbound, `不应有出站帧，实际 ${JSON.stringify(outbound)}`).toHaveLength(0);
    socket.close();
  });

  it('(b) 硬退出后网关对该会话返回 conversation_ended 的 refused 态', async () => {
    const seeded = await seedConversation('exit-b');
    await executeHardExit(seeded.conversationId, { cancelScheduledJobs: async () => 0 }, {
      userId: seeded.userId,
      matchedRule: 'window_control',
    });
    const gated = await safetyGateway({
      candidateText: '我还在这儿呢。',
      classification: { classifierStatus: 'ok', level: 'none' },
      readConversationStatus: async () => {
        const rows = await db
          .select({ status: conversation.status })
          .from(conversation)
          .where(eq(conversation.id, seeded.conversationId));
        return rows[0]?.status === 'active' ? 'active' : 'ended';
      },
      recordSafetyEvent: () => {
        throw new Error('ended 会话不应写 safety_event');
      },
      contactChannel: () => {
        throw new Error('ended 会话不应联络第三方');
      },
    });
    expect(gated).toEqual({ outcome: 'refused', reason: 'conversation_ended' });
    expect('text' in gated).toBe(false);
  });

  it('(c) 硬退出后 message 表新增的只有一条 system 卡片，无 character 行', async () => {
    const seeded = await seedConversation('exit-c');
    // 先来一轮正常对话（1 user + 1 character），再硬退出。
    await runTurn({ conversationId: seeded.conversationId, userId: seeded.userId, text: '你好' });
    const beforeRows = await db
      .select({ id: message.id })
      .from(message)
      .where(eq(message.conversationId, seeded.conversationId));
    expect(beforeRows).toHaveLength(2);

    await executeHardExit(seeded.conversationId, { cancelScheduledJobs: async () => 0 }, {
      userId: seeded.userId,
      matchedRule: 'window_control',
    });

    const rows = await db
      .select({ senderKind: message.senderKind, text: message.text, disclosure: message.disclosure })
      .from(message)
      .where(eq(message.conversationId, seeded.conversationId))
      .orderBy(asc(message.seq));
    expect(rows).toHaveLength(3);
    const added = rows[2];
    expect(added?.senderKind).toBe('system');
    expect(added?.text).toBe('已停止本次会话。你随时可以回来。');
    // 系统卡片是平台文案，不是 AI 生成内容 —— disclosure 为 null 且不违反
    // message_disclosure_required（该 CHECK 只约束 character）。
    expect(added?.disclosure).toBeNull();
    // 无 character 新行（上面只加了一行 system）。
    expect(rows.filter((r) => r.senderKind === 'character')).toHaveLength(1);
  });

  it('(d) 硬退出后 usage-reminder 作业触发时不发出任何消息（用户已无 active 会话）', async () => {
    const seeded = await seedConversation('exit-d');
    const inserted = await db
      .insert(usageSegment)
      .values({
        userId: seeded.userId,
        startedAt: new Date(Date.now() - 7_199_000),
        lastActivityAt: new Date(),
        accumulatedSeconds: 7_199,
      })
      .returning({ id: usageSegment.id });
    const segmentId = inserted[0]?.id;
    if (segmentId === undefined) throw new Error('段插入未返回行');

    await executeHardExit(seeded.conversationId, { cancelScheduledJobs: async () => 0 }, {
      userId: seeded.userId,
      matchedRule: 'window_control',
    });

    const published = await runUsageReminder(db, segmentId, new Date(Date.now() + 5_000));
    expect(published).toBe(0);
    // 段本身的条件更新照常发生（提醒计数不是投递的前提）—— 但一个字节都
    // 不该进任何 WS 房间。
    const socket = await openSocket(seeded.conversationId, seeded.sessionToken);
    const frames = await collectFrames(socket, 1_500);
    expect(frames.filter((f) => f.type === 'usage.reminder')).toHaveLength(0);
    socket.close();
  });

  it('(e) 对整个会话历史跑 hitsRetentionPhrase，命中数为 0（挽留触发率恒为 0）', async () => {
    const seeded = await seedConversation('exit-e');
    await runTurn({ conversationId: seeded.conversationId, userId: seeded.userId, text: '你好' });
    await runTurn({ conversationId: seeded.conversationId, userId: seeded.userId, text: '退出' });

    const rows = await db
      .select({ senderKind: message.senderKind, text: message.text })
      .from(message)
      .where(eq(message.conversationId, seeded.conversationId));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(
        hitsRetentionPhrase(row.text),
        `${row.senderKind} 消息「${row.text}」命中挽留词表 —— 挽留触发率的验收目标是恒为 0`,
      ).toHaveLength(0);
    }
  });

  it('(f) tier 2 用语只写 exit_intent 且 conversation.status 仍为 active', async () => {
    const seeded = await seedConversation('exit-f');
    const turn = await runTurn({
      conversationId: seeded.conversationId,
      userId: seeded.userId,
      text: '明天聊',
    });
    // tier 2 不触发任何动作：正常生成角色回复。
    expect(turn.reply.outcome).toBe('gated');

    const convRows = await db
      .select({ status: conversation.status })
      .from(conversation)
      .where(eq(conversation.id, seeded.conversationId));
    expect(convRows[0]?.status).toBe('active');

    const intents = await db
      .select({ tier: exitIntent.tier, matchedRule: exitIntent.matchedRule })
      .from(exitIntent)
      .where(and(eq(exitIntent.conversationId, seeded.conversationId)));
    expect(intents).toHaveLength(1);
    expect(intents[0]?.tier).toBe(2);
    expect(intents[0]?.matchedRule).toBe('明天聊');
  });

  it('幂等：对已结束的会话再次执行不插第二张卡片', async () => {
    const seeded = await seedConversation('exit-idem');
    await executeHardExit(seeded.conversationId, { cancelScheduledJobs: async () => 0 }, {
      userId: seeded.userId,
      matchedRule: 'window_control',
    });
    const again = await executeHardExit(
      seeded.conversationId,
      { cancelScheduledJobs: async () => 0 },
      { userId: seeded.userId, matchedRule: 'window_control' },
    );
    expect(again.alreadyEnded).toBe(true);
    expect(again.systemMessage).toBeNull();

    const systemRows = await db
      .select({ id: message.id })
      .from(message)
      .where(and(eq(message.conversationId, seeded.conversationId), eq(message.senderKind, 'system')));
    expect(systemRows).toHaveLength(1);
  });

  it('取消端口在组合中被真实调用（注入式）', async () => {
    const seeded = await seedConversation('exit-port');
    let called = 0;
    await executeHardExit(
      seeded.conversationId,
      {
        cancelScheduledJobs: async () => {
          called += 1;
          return 0;
        },
      },
      { userId: seeded.userId, matchedRule: 'window_control' },
    );
    expect(called).toBe(1);
  });

  it('cancelConversationJobs 对注册过的队列按 key 取消（真实 pg-boss）', async () => {
    const seeded = await seedConversation('exit-cancel');
    await boss.send(PROBE_QUEUE, { note: 'x' }, { startAfter: 3_600, singletonKey: seeded.conversationId });
    const cancelled = await cancelConversationJobs(boss, seeded.conversationId);
    expect(cancelled).toBe(1);
  });
});
