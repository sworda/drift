// 依赖信号日扫的集成断言（COMPLY-04 / Plan 12 Task 2）。
//
//   (a) dependency-scan 已被 boss.schedule 注册（cron 0 4 * * *，Asia/Shanghai）
//   (b) 命中三阈值之一 ⇒ 写 dependency_signal + 向 active 会话发 dependency.notice
//   (c) evidence 序列化后不含任何消息正文子串（T-12-07）
//   (d) 72 小时内的第二次命中被去重（不写行、不发事件）
//   (e) 会话已结束的用户：留证照写，但 WS 房间零投递（COMPLY-05 worker 侧）

import type { AddressInfo } from 'node:net';

import { serve } from '@hono/node-server';
import { and, eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'dep-scan-operator-token-0123456789abcdef';
process.env['BETTER_AUTH_SECRET'] ??= 'dep-scan-better-auth-secret-0123456789ab';
process.env['CONTACT_ENCRYPTION_KEY'] ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

const { createApp } = await import('../../apps/api/src/http/app.ts');
const { attachWebSocket } = await import('../../apps/api/src/ws/server.ts');
const { closeDb, conversation, db, dependencySignal, ownerSql, usageSegment } = await import(
  '@drift/db'
);
const { runDependencyScan } = await import('../../apps/api/src/modules/usage/dependency.ts');
const { DEPENDENCY_SCAN_CRON, DEPENDENCY_SCAN_QUEUE, registerDependencyScan } = await import(
  '../../apps/api/src/worker/jobs/dependency-scan.ts'
);
const { seedConversation } = await import('./fixtures.ts');

const BOSS_SCHEMA = 'pgboss_dependency_scan';

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

function waitForFrame(
  socket: WebSocket,
  predicate: (frame: Frame) => boolean,
  timeoutMs = 10_000,
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

/**
 * 给用户种一个「单日 3 小时」的段（阈值①命中，且**不**命中③）。
 *
 * ⚠️ 时段必须钉在**昨天北京白天 10:00–13:00**：种子段若以「现在」为锚（例如
 * now−3h），测试在什么时刻跑就决定它落进夜间窗口还是白天窗口 —— 凌晨跑会
 * 命中夜间占比规则，断言的 ruleId 就随一天里的时刻漂移。昨天的白天窗口保证
 * 与运行时刻无关。
 */
async function seedThreeHourSegment(userId: string): Promise<void> {
  const tzMs = 480 * 60_000;
  const todayLocal = Math.floor((Date.now() + tzMs) / 86_400_000);
  const yesterdayLocalNoonUtc = (todayLocal - 1) * 86_400_000 - tzMs;
  await db.insert(usageSegment).values({
    userId,
    startedAt: new Date(yesterdayLocalNoonUtc + 10 * 3_600_000),
    lastActivityAt: new Date(yesterdayLocalNoonUtc + 13 * 3_600_000),
    accumulatedSeconds: 10_800,
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
  boss = new PgBoss({ connectionString, schema: BOSS_SCHEMA, application_name: 'dep-scan-test' });
  boss.on('error', () => undefined);
  await boss.start();
  await registerDependencyScan(boss, { executor: db });
}, 120_000);

afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5_000 });
  await stopServer();
  await closeDb();
  await ownerSql.end({ timeout: 5 });
});

describe('依赖信号日扫（COMPLY-04）', () => {
  it('(a) dependency-scan 已被 boss.schedule 注册', async () => {
    const schedules = await boss.getSchedules();
    const entry = schedules.find((s) => s.name === DEPENDENCY_SCAN_QUEUE);
    expect(entry, 'schedule 列表里必须有 dependency-scan').toBeDefined();
    expect(entry?.cron).toBe(DEPENDENCY_SCAN_CRON);
    expect(entry?.cron).toBe('0 4 * * *');
    // pg-boss 12 的 getSchedules 返回字段名是 timezone（不是入参的 tz）。
    expect(entry?.timezone).toBe('Asia/Shanghai');
  });

  it('(b)(c) 命中 ⇒ 写行 + 发事件；evidence 不含消息正文', async () => {
    const seeded = await seedConversation('dep-hit');
    const socket = await openSocket(seeded.conversationId, seeded.sessionToken);
    // 一条带唯一标记的用户消息 —— evidence 序列化后不得含它的任何子串。
    const marker = 'DEP-SCAN-MARKER-x7q9';
    await db.execute(
      (await import('drizzle-orm')).sql`insert into message (id, conversation_id, seq, sender_kind, text, provenance, audience)
        values (gen_random_uuid()::text, ${seeded.conversationId}, 1, 'user', ${marker}, '{"sourceUserId":null,"sourceConversationId":null,"acquiredVia":"direct"}'::jsonb, 'user')`,
    );
    await seedThreeHourSegment(seeded.userId);

    const arriving = waitForFrame(socket, (f) => f.type === 'dependency.notice');
    const report = await runDependencyScan(db, new Date());
    const frame = await arriving;

    expect(report.signalsInserted).toBeGreaterThanOrEqual(1);
    expect(frame.payload['ruleId']).toBe('daily_usage_over_3h');

    const rows = await db
      .select({ ruleId: dependencySignal.ruleId, evidence: dependencySignal.evidence })
      .from(dependencySignal)
      .where(eq(dependencySignal.userId, seeded.userId));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.ruleId === 'daily_usage_over_3h')).toBe(true);
    // T-12-07：evidence 只存聚合值 —— 序列化后不含消息正文的任何子串。
    for (const row of rows) {
      expect(JSON.stringify(row.evidence)).not.toContain(marker);
      expect(JSON.stringify(row.evidence)).not.toContain('text');
    }
    socket.close();
  });

  it('(d) 72 小时内的第二次命中被去重', async () => {
    const seeded = await seedConversation('dep-dedupe');
    await seedThreeHourSegment(seeded.userId);
    const now = new Date();
    const first = await runDependencyScan(db, now);
    expect(first.signalsInserted).toBeGreaterThanOrEqual(1);
    const second = await runDependencyScan(db, now);
    expect(second.signalsInserted, '去重窗口内不写新行').toBe(0);
    expect(second.dedupedUsers).toBeGreaterThanOrEqual(1);

    const rows = await db
      .select({ id: dependencySignal.id })
      .from(dependencySignal)
      .where(eq(dependencySignal.userId, seeded.userId));
    expect(rows).toHaveLength(first.signalsInserted);
  });

  it('(e) 会话已结束的用户：留证照写，WS 零投递（COMPLY-05 worker 侧）', async () => {
    const seeded = await seedConversation('dep-ended');
    await seedThreeHourSegment(seeded.userId);
    await db
      .update(conversation)
      .set({ status: 'ended', endedAt: new Date() })
      .where(and(eq(conversation.id, seeded.conversationId)));

    const report = await runDependencyScan(db, new Date());
    expect(report.signalsInserted).toBeGreaterThanOrEqual(1);
    expect(report.eventsPublished, '结束的会话房间一个事件都不发').toBe(0);

    const rows = await db
      .select({ id: dependencySignal.id })
      .from(dependencySignal)
      .where(eq(dependencySignal.userId, seeded.userId));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
