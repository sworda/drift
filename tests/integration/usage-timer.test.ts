// 连续使用计时的六条集成断言（COMPLY-03 / D-14 / Plan 12 Task 1）。
//
//   (a) 7199 秒 + 一条消息 ⇒ 恰好一次提醒事件（且到点作业重放不产生第二次）
//   (b) 断开重连后累计不变；换会话（多角色）继续累计 —— 状态在 DB 按 user_id 归集
//   (c) 14 分钟间隔不清零 / 16 分钟间隔清零（分段边界两侧）
//   (d) 累计到 4 小时触发两次而非一次（7200 × (reminded_count + 1) 的重复语义）
//   (e) 只读不发：不经过任何消息，仅靠 pg-boss 到点作业也收到提醒
//   (f) 同一提醒作业重复执行两次只产生一次提醒（条件更新幂等）
//
// ⚠️ (b) 的「换 session 重新登录」以机制等价形态断言：计时状态不在客户端也不在
// session 里，而在 usage_segment 表按 user_id 归集 —— 于是「跨刷新/重登录有效」
// 的充分条件是「断开重连后值不变 + 新会话上下文继续累计」。真正再走一次 HTTP
// 登录只会把注册链路的失败模式混进计时测试（fixtures.ts 拒绝这么做的同一条理由）。

import type { AddressInfo } from 'node:net';

import { serve } from '@hono/node-server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// env.ts 在 import 时校验环境并在缺失时 exit(1) —— 必须在任何 apps/api 模块之前。
process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'usage-timer-operator-token-0123456789abcd';
process.env['BETTER_AUTH_SECRET'] ??= 'usage-timer-better-auth-secret-0123456789ab';
process.env['CONTACT_ENCRYPTION_KEY'] ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

const { createApp } = await import('../../apps/api/src/http/app.ts');
const { attachWebSocket } = await import('../../apps/api/src/ws/server.ts');
const {
  closeDb,
  conversation,
  db,
  ownerDb,
  ownerSql,
  tx,
  usageSegment,
} = await import('@drift/db');
const { runTurn } = await import('../../apps/api/src/modules/chat/turn.ts');
const {
  runUsageReminder,
  touchUsageSegment,
  USAGE_REMINDER_INTERVAL_SECONDS,
  USAGE_SEGMENT_IDLE_SECONDS,
} = await import('../../apps/api/src/modules/usage/segment.ts');
const {
  registerUsageReminder,
  sendUsageReminder,
} = await import('../../apps/api/src/worker/jobs/usage-reminder.ts');
const { seedConversation } = await import('./fixtures.ts');

/** 独立 schema：与其它测试文件的 boss 并发跑时不互相迁移同一套表。 */
const BOSS_SCHEMA = 'pgboss_usage_timer';

let wsUrl: string;
let stopServer: () => Promise<void>;
let boss: PgBoss;

function openSocket(conversationId: string): Promise<WebSocket> {
  const socket = new WebSocket(`${wsUrl}?conversationId=${encodeURIComponent(conversationId)}`);
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', () => reject(new Error('WebSocket 连接失败')));
  });
}

interface Frame {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

/** 收集窗口期内到达的全部下行帧。超时必须失败 —— 静默等下去会让测试挂而不是红。 */
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

function waitForFrame(
  socket: WebSocket,
  predicate: (frame: Frame) => boolean,
  timeoutMs = 15_000,
): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error(`等待下行帧超时（${String(timeoutMs)}ms）`));
    }, timeoutMs);
    function onMessage(event: MessageEvent): void {
      const parsed = JSON.parse(String(event.data)) as Frame;
      if (!predicate(parsed)) return;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      resolve(parsed);
    }
    socket.addEventListener('message', onMessage);
  });
}

/** 直接把段的累计与最后活动写到指定值（测试的「时间快进」）。 */
async function forceSegment(userId: string, fields: { accumulated: number; lastActivityAgoMs: number }): Promise<void> {
  await db
    .update(usageSegment)
    .set({
      accumulatedSeconds: fields.accumulated,
      lastActivityAt: new Date(Date.now() - fields.lastActivityAgoMs),
    })
    .where(and(eq(usageSegment.userId, userId), isNull(usageSegment.closedAt)));
}

async function openSegment(userId: string): Promise<{ id: string; accumulated: number; reminded: number } | null> {
  const rows = await db
    .select({
      id: usageSegment.id,
      accumulated: usageSegment.accumulatedSeconds,
      reminded: usageSegment.remindedCount,
    })
    .from(usageSegment)
    .where(and(eq(usageSegment.userId, userId), isNull(usageSegment.closedAt)))
    .orderBy(desc(usageSegment.startedAt))
    .limit(1);
  return rows[0] ?? null;
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
  if (connectionString === undefined) throw new Error('DATABASE_URL 未设置（globalSetup 应已指向测试库）');
  boss = new PgBoss({ connectionString, schema: BOSS_SCHEMA, application_name: 'usage-timer-test' });
  boss.on('error', () => {
    // 连接层错误由断言本身暴露；空 handler 只是防止 EventEmitter 打挂进程。
  });
  await boss.start();
  await registerUsageReminder(boss, { executor: db });
}, 120_000);

afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5_000 });
  await stopServer();
  await closeDb();
  await ownerSql.end({ timeout: 5 });
});

describe('连续使用计时（COMPLY-03 / D-14）', () => {
  it('(a) 7199 秒 + 一条消息 ⇒ 恰好一次提醒事件', async () => {
    const seeded = await seedConversation('usage-a');
    const socket = await openSocket(seeded.conversationId);

    // 第一条消息只是把段建起来。
    await runTurn({ conversationId: seeded.conversationId, userId: seeded.userId, text: '你好' });
    // 时间快进到 7199 秒，且 last_activity_at 落在 1 秒前 —— 下一次 touch 的入站
    // 差值恰好把它推过 7200（floor(1s)=1），提醒必须在这一条消息上发生。
    await forceSegment(seeded.userId, { accumulated: 7199, lastActivityAgoMs: 1_000 });

    const first = waitForFrame(socket, (f) => f.type === 'usage.reminder');
    await runTurn({ conversationId: seeded.conversationId, userId: seeded.userId, text: '还在吗' });
    const frame = await first;
    expect(Number(frame.payload['accumulatedSeconds'])).toBeGreaterThanOrEqual(7200);

    // 到点作业重放（排定的作业晚于内联提醒到达）不得产生第二次提醒：
    // 窗口盖过 boss 的默认轮询周期。
    const more = await collectFrames(socket, 5_000);
    expect(more.filter((f) => f.type === 'usage.reminder')).toHaveLength(0);

    const segment = await openSegment(seeded.userId);
    expect(segment?.reminded, 'reminded_count 应恰好自增一次').toBe(1);
    socket.close();
  });

  it('(b) 断开重连后累计不变；换一个会话（多角色）继续累计在同一计时器上', async () => {
    const seeded = await seedConversation('usage-b');
    await runTurn({ conversationId: seeded.conversationId, userId: seeded.userId, text: '你好' });
    const before = await openSegment(seeded.userId);
    expect(before).not.toBeNull();

    // 两次消息之间隔超过 1 秒 —— 计时按整秒向下取整，同秒内的两条消息差值为 0。
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    // 重连（新 WS 连接）本身不改变累计 —— 计时状态不在连接上。
    const socket = await openSocket(seeded.conversationId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterReconnect = await openSegment(seeded.userId);
    expect(afterReconnect?.id).toBe(before?.id);
    expect(afterReconnect?.accumulated).toBe(before?.accumulated);

    // 第二个角色、第二个会话：时长必须合并进**同一个**段（R1.03 跨角色合并）。
    // 排除当前角色，取另一个种子角色。
    const otherRows = (await ownerDb.execute(
      sql`select id from "character" where id <> ${seeded.characterId} order by id limit 1`,
    )) as unknown as readonly { readonly id: string }[];
    const otherCharacterId = (otherRows as readonly { readonly id: string }[])[0]?.id;
    if (otherCharacterId === undefined) throw new Error('种子角色不足两个');
    const convRows = await ownerDb
      .insert(conversation)
      .values({ userId: seeded.userId, characterId: otherCharacterId })
      .returning({ id: conversation.id });
    const secondConversationId = convRows[0]?.id;
    if (secondConversationId === undefined) throw new Error('第二个会话插入未返回行');

    await runTurn({ conversationId: secondConversationId, userId: seeded.userId, text: '换个角色聊聊' });
    const merged = await openSegment(seeded.userId);
    // 同一个段，且累计因第二个会话的消息前进了。
    expect(merged?.id).toBe(before?.id);
    expect(merged?.accumulated ?? 0, '第二个会话的时长必须合并进同一段').toBeGreaterThan(
      before?.accumulated ?? Number.NaN,
    );
    socket.close();
  });

  it('(c) 14 分钟间隔不清零；16 分钟间隔清零（分段边界两侧）', async () => {
    const t0 = new Date('2026-01-01T08:00:00Z');
    const seeded14 = await seedConversation('usage-c14');
    await tx(async (t) => {
      await touchUsageSegment(t, seeded14.userId, t0);
    });
    // 14 分钟后的活动：仍在同一段内累计。
    await tx(async (t) => {
      await touchUsageSegment(t, seeded14.userId, new Date(t0.getTime() + 14 * 60 * 1000));
    });
    const seg14 = await openSegment(seeded14.userId);
    expect(seg14?.accumulated, '14 分钟 ≤ 15 分钟阈值，不应清零').toBeGreaterThanOrEqual(840);

    const seeded16 = await seedConversation('usage-c16');
    await tx(async (t) => {
      await touchUsageSegment(t, seeded16.userId, t0);
    });
    const before16 = await openSegment(seeded16.userId);
    expect(before16).not.toBeNull();
    // 16 分钟后的活动：旧段必须被关闭、新段从零累计。
    await tx(async (t) => {
      await touchUsageSegment(t, seeded16.userId, new Date(t0.getTime() + 16 * 60 * 1000));
    });
    const closedRows = await db
      .select({ id: usageSegment.id })
      .from(usageSegment)
      .where(and(eq(usageSegment.id, before16?.id ?? ''), isNull(usageSegment.closedAt)));
    expect(closedRows, '16 分钟 > 15 分钟阈值，旧段应已关闭').toHaveLength(0);
    const seg16 = await openSegment(seeded16.userId);
    expect(seg16?.id).not.toBe(before16?.id);
    expect(seg16?.accumulated, '新段累计清零').toBe(0);
  });

  it('(d) 累计到 4 小时触发两次而非一次（重复语义）', async () => {
    const seeded = await seedConversation('usage-d');
    const socket = await openSocket(seeded.conversationId);
    await runTurn({ conversationId: seeded.conversationId, userId: seeded.userId, text: '你好' });

    // 第一次提醒：跨过 7200 × (0 + 1)。
    await forceSegment(seeded.userId, { accumulated: 7199, lastActivityAgoMs: 1_000 });
    const first = waitForFrame(socket, (f) => f.type === 'usage.reminder');
    await runTurn({ conversationId: seeded.conversationId, userId: seeded.userId, text: '继续聊' });
    await first;

    // 第二次提醒：跨过 7200 × (1 + 1) = 14400。一次性触发的错误实现在这里收不到。
    await forceSegment(seeded.userId, { accumulated: 14_399, lastActivityAgoMs: 1_000 });
    const second = waitForFrame(socket, (f) => f.type === 'usage.reminder');
    await runTurn({ conversationId: seeded.conversationId, userId: seeded.userId, text: '还在' });
    const frame = await second;
    expect(Number(frame.payload['accumulatedSeconds'])).toBeGreaterThanOrEqual(14_400);

    const segment = await openSegment(seeded.userId);
    expect(segment?.reminded, '4 小时应触发两次').toBe(2);
    socket.close();
  });

  it('(e) 只读不发：仅靠 pg-boss 到点作业也收到提醒', async () => {
    const seeded = await seedConversation('usage-e');
    const socket = await openSocket(seeded.conversationId);
    // 直接插段（fixtures 形态），不经任何 touch —— touch 会给段排一个 7200s 的
    // 同 singletonKey 作业，short 策略会让本用例的 1s 作业被拒绝。本用例考的
    // 是「到点作业自己就能提醒」，段怎么来的不重要。
    const inserted = await db
      .insert(usageSegment)
      .values({
        userId: seeded.userId,
        startedAt: new Date(Date.now() - 7_199_000),
        lastActivityAt: new Date(),
        accumulatedSeconds: 7199,
      })
      .returning({ id: usageSegment.id });
    const segmentId = inserted[0]?.id;
    if (segmentId === undefined) throw new Error('段插入未返回行');

    const arriving = waitForFrame(socket, (f) => f.type === 'usage.reminder', 20_000);
    const jobId = await sendUsageReminder(boss, segmentId, 1);
    expect(jobId, '作业应被接受（该段此前没有排队中的作业）').not.toBeNull();
    const frame = await arriving;
    expect(Number(frame.payload['accumulatedSeconds'])).toBeGreaterThanOrEqual(7200);
    socket.close();
  });

  it('(f) 同一提醒作业重复执行两次只产生一次提醒（条件更新幂等）', async () => {
    const seeded = await seedConversation('usage-f');
    const socket = await openSocket(seeded.conversationId);
    await runTurn({ conversationId: seeded.conversationId, userId: seeded.userId, text: '你好' });
    await forceSegment(seeded.userId, { accumulated: 7199, lastActivityAgoMs: 2_000 });
    const segment = await openSegment(seeded.userId);
    if (segment === null) throw new Error('段不存在');

    const collect = collectFrames(socket, 3_000);
    const first = await runUsageReminder(db, segment.id, new Date());
    const second = await runUsageReminder(db, segment.id, new Date());
    const frames = await collect;

    // 第一次执行投递了提醒（幂等的判据是「第二次不投」，不是「第一次投了几间房」）。
    expect(first, '第一次执行应产生提醒').toBeGreaterThanOrEqual(1);
    expect(second, '重复执行不得再产生提醒（pg-boss 是 at-least-once 投递）').toBe(0);
    expect(frames.filter((f) => f.type === 'usage.reminder')).toHaveLength(1);

    const after = await openSegment(seeded.userId);
    expect(after?.reminded, 'reminded_count 只自增一次').toBe(1);
    socket.close();
  });

  it('常量钉住：15 分钟分段阈值与 7200 秒提醒间隔是具名常量', () => {
    expect(USAGE_SEGMENT_IDLE_SECONDS).toBe(900);
    expect(USAGE_REMINDER_INTERVAL_SECONDS).toBe(7200);
  });
});
