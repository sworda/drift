// 一键导出的八条集成断言 (a)–(h)（PRIV-04 / COMPLY-02 / D-17）。
//
// 本文件属 L5：真实 PostgreSQL + 真实 pg-boss + 真实文件系统（临时导出目录）。
// (e)(f) 是时间旅行：产物 mtime / 行 created_at 拨到过期时刻再跑清理 —— 期限在
// Phase 1 无法自然到达，时间旅行是唯一可判定的验证形态。
//
// (g) 断言两个日清理作业**已被 boss.schedule 注册**（查 boss 的 schedule 列表）。

process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'export-test-operator-token-0123456789abcd';
process.env['BETTER_AUTH_SECRET'] ??= 'export-test-better-auth-secret-0123456789a';
process.env['CONTACT_ENCRYPTION_KEY'] ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PgBoss } from 'pg-boss';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { runExportBuildJob, collectExportBundle, createExportAction, EXPORT_BUILD_QUEUE } = await import(
  '../../apps/api/src/worker/jobs/export-build.ts'
);
const { runExportArtifactGc, registerExportArtifactGc, EXPORT_ARTIFACT_GC_QUEUE } = await import(
  '../../apps/api/src/worker/jobs/export-artifact-gc.ts'
);
const { runRetentionCleanup, registerRetentionCleanup, buildRetentionRules, RETENTION_CLEANUP_QUEUE } = await import(
  '../../apps/api/src/worker/jobs/retention-cleanup.ts'
);
const {
  closeDb,
  friendship,
  ownerDb,
  ownerSql,
  purgeDb,
  DATA_INVENTORY,
  emergencyContact,
  usageSegment,
  consentEvent,
  safetyEvent,
} = await import('@drift/db');
const { seedConversation } = await import('./fixtures.ts');
const { tx, db } = await import('@drift/db');
const { gatedFromStoredCharacterMessage } = await import('@drift/safety');
const { encryptContact } = await import('@drift/db');

const EXPORT_DIR = mkdtempSync(join(tmpdir(), 'drift-export-test-'));

function testDatabaseUrl(): string {
  const url = process.env['DRIFT_TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) throw new Error('测试库 URL 未设置');
  return url;
}

let boss: PgBoss;
let sql: postgres.Sql;

beforeAll(async () => {
  boss = new PgBoss({ connectionString: testDatabaseUrl(), schema: 'pgboss', max: 2 });
  boss.on('error', () => undefined);
  await boss.start();
  await boss.createQueue(EXPORT_BUILD_QUEUE, { policy: 'short' });
  // schedule 注册走真实的 register 函数（断言 (g) 的对象就是它们挂上的 schedule）。
  await registerExportArtifactGc(boss, { exportArtifactsDir: EXPORT_DIR });
  await registerRetentionCleanup(boss, { executor: purgeDb });
  sql = postgres(testDatabaseUrl(), { max: 2, onnotice: () => undefined });
}, 120_000);

afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5_000 });
  await sql.end({ timeout: 5 });
  await closeDb();
  await ownerSql.end({ timeout: 5 });
  rmSync(EXPORT_DIR, { recursive: true, force: true });
});

describe('导出产物（双格式 + 标识 + 覆盖范围）', () => {
  it('(a)(b)(c)(d) 文件头三行、[AI] 前缀、disclosure 字段、七类覆盖', async () => {
    const seeded = await seedConversation('exp-abcd');
    // 七类数据的最小在场：消息（1 用户 + 1 角色）、会话、好友、同意 + 历史、
    // 安全事件、使用时长、紧急联系人。
    const { safetyGateway } = await import('@drift/safety');
    const { insertUserMessage, insertCharacterMessage, requireConsent } = await import('@drift/db');
    await ownerDb.insert(friendship).values({ userId: seeded.userId, characterId: seeded.characterId });
    await ownerDb.insert(usageSegment).values({
      userId: seeded.userId,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      accumulatedSeconds: 600,
    });
    await ownerDb.insert(emergencyContact).values({
      userId: seeded.userId,
      kind: 'emergency',
      name: '张三',
      contactRefEncrypted: encryptContact('13800001234'),
    });
    await ownerDb.insert(consentEvent).values({
      userId: seeded.userId,
      scope: 'basic_service',
      action: 'grant',
      policyVersion: 'pv_fixture',
      source: 'registration',
    });
    await ownerDb.insert(safetyEvent).values({
      userId: seeded.userId,
      conversationId: seeded.conversationId,
      previousLevel: 'none',
      level: 'elevated',
      ruleHits: ['crisis_lexicon'],
      classifierStatus: 'ok',
      candidateReplyHash: 'deadbeef',
      candidateReplyLen: 10,
      overrideApplied: false,
    });
    await tx(async (t) => {
      const ticket = await requireConsent(t, seeded.userId, 'sensitive_pi');
      await insertUserMessage(t, {
        conversationId: seeded.conversationId,
        text: '我今天有点难过',
        provenance: { sourceUserId: seeded.userId, sourceConversationId: seeded.conversationId, acquiredVia: 'direct' },
        ticket,
      });
      const gated = await safetyGateway({
        candidateText: '我在听，你慢慢说',
        classification: { classifierStatus: 'ok', level: 'none' },
        readConversationStatus: () => 'active',
        inboundSuggestedLevel: 'none',
        inboundRuleHits: [],
        previousLevel: 'none',
        // fixture 不触发联络（level=none），给一个不会被调用的通道即可。
        contactChannel: async () => ({ status: 'unavailable', contactName: null, maskedContact: null }),
        recordSafetyEvent: async () => 'se-1',
      });
      if (gated.outcome !== 'gated') throw new Error('gateway refused fixture reply');
      await insertCharacterMessage(t, {
        conversationId: seeded.conversationId,
        text: gated.text,
        provenance: { sourceUserId: null, sourceConversationId: seeded.conversationId, acquiredVia: 'direct' },
        ticket,
      });
    });

    const { exportId } = await tx(async (t) => createExportAction(boss, t, seeded.userId));
    const payload = await runExportBuildJob({ executor: purgeDb, exportArtifactsDir: EXPORT_DIR }, exportId);
    expect(payload.status).toBe('complete');
    if (payload.status !== 'complete') return;
    const md = readFileSync(join(EXPORT_DIR, seeded.userId, payload.md), 'utf8');
    const jsonText = readFileSync(join(EXPORT_DIR, seeded.userId, payload.json), 'utf8');
    const parsed = JSON.parse(jsonText) as {
      header: { service: string; disclosure: string; exportedAt: string };
      messages: { senderKind: string; disclosure?: unknown }[];
      conversations: unknown[];
      friendships: unknown[];
      consents: unknown[];
      consentEvents: unknown[];
      safetyEvents: unknown[];
      usageSegments: unknown[];
      emergencyContact: { contactMasked: string } | null;
    };

    // (a) .md 与 .json 都有文件头三行（服务名 / 法定标识句 / 导出时间）。
    const mdHeader = md.split('\n').slice(0, 3);
    expect(mdHeader).toEqual(['Drift', '本文件全部角色消息由 AI 生成', expect.stringContaining('导出时间：')]);
    expect(parsed.header.service).toBe('Drift');
    expect(parsed.header.disclosure).toBe('本文件全部角色消息由 AI 生成');
    expect(typeof parsed.header.exportedAt).toBe('string');

    // (b) .md 里 sender_kind=character 的行带 [AI] 前缀；用户行不带。
    const characterLine = md.split('\n').find((line) => line.includes(': 角色回你的话')) ?? md.split('\n').find((line) => line.startsWith('[AI] '));
    expect(characterLine).toBeTruthy();
    expect(characterLine?.startsWith('[AI] ')).toBe(true);
    const userLine = md.split('\n').find((line) => line.includes('我今天有点难过'));
    expect(userLine?.startsWith('[AI] ')).toBe(false);

    // (c) .json 里每条角色消息对象有 disclosure 字段；用户消息没有。
    const characterMessages = parsed.messages.filter((m) => m.senderKind === 'character');
    expect(characterMessages.length).toBeGreaterThanOrEqual(1);
    for (const item of characterMessages) expect(item.disclosure).toBeTruthy();
    for (const item of parsed.messages.filter((m) => m.senderKind === 'user')) {
      expect(item.disclosure === null || item.disclosure === undefined).toBe(true);
    }

    // (d) 覆盖范围包含七类内容。
    expect(parsed.messages.length).toBeGreaterThanOrEqual(2);
    expect(parsed.conversations.length).toBe(1);
    expect(parsed.friendships.length).toBe(1);
    expect(parsed.consents.length).toBe(5);
    expect(parsed.consentEvents.length).toBeGreaterThanOrEqual(1);
    expect(parsed.safetyEvents.length).toBe(1);
    expect(parsed.usageSegments.length).toBe(1);
    // 紧急联系人遮蔽（138****1234，明文不进导出）。
    expect(parsed.emergencyContact?.contactMasked).toBe('138****1234');
    expect(jsonText.includes('13800001234')).toBe(false);
    // 安全事件脱敏到「发生过一次二级干预」级别：不含正文、不含 hash。
    expect(jsonText.includes('deadbeef')).toBe(false);
  });

  it('(e) 产物 mtime 拨到 8 天前后跑 gc，文件被清理（7 天 TTL，D-17）', async () => {
    const seeded = await seedConversation('exp-e');
    const { exportId } = await tx(async (t) => createExportAction(boss, t, seeded.userId));
    const payload = await runExportBuildJob({ executor: purgeDb, exportArtifactsDir: EXPORT_DIR }, exportId);
    if (payload.status !== 'complete') throw new Error('export 未完成');
    const userDir = join(EXPORT_DIR, seeded.userId);
    for (const file of [payload.md, payload.json]) {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      utimesSync(join(userDir, file), eightDaysAgo, eightDaysAgo);
    }
    const removed = await runExportArtifactGc(EXPORT_DIR, new Date());
    expect(removed).toBe(2);
    expect(existsSync(join(userDir, payload.md))).toBe(false);
    expect(existsSync(join(userDir, payload.json))).toBe(false);
  });

  it('(f) 把 message 的 created_at 拨到 25 个月前后跑 retention-cleanup，该行被清理（24 个月硬上限）', async () => {
    const seeded = await seedConversation('exp-f');
    const { insertUserMessage, requireConsent } = await import('@drift/db');
    const inserted = await tx(async (t) => {
      const ticket = await requireConsent(t, seeded.userId, 'sensitive_pi');
      return insertUserMessage(t, {
        conversationId: seeded.conversationId,
        text: '25 个月前的消息',
        provenance: { sourceUserId: seeded.userId, sourceConversationId: seeded.conversationId, acquiredVia: 'direct' },
        ticket,
      });
    });
    await sql.unsafe('update message set created_at = $1 where id = $2', [
      new Date(Date.now() - 25 * 30 * 24 * 60 * 60 * 1000),
      inserted.id,
    ]);

    const results = await runRetentionCleanup(
      purgeDb,
      buildRetentionRules(DATA_INVENTORY),
      new Date(),
    );
    // message 行被清掉（时间旅行形态：账号仍存续，硬上限先行）。
    const remaining = await sql.unsafe('select count(*)::int as n from message where id = $1', [inserted.id]);
    expect((remaining[0] as unknown as { n: number }).n).toBe(0);
    // 规则确实由 DATA_INVENTORY 派生（源码无第二份期限清单 —— 见 retention-cleanup.ts 头）。
    const tables = results.map((item) => item.table);
    expect(tables).toContain('message');
    expect(tables).toContain('consent_event');
  });

  it('(g) export-artifact-gc 与 retention-cleanup 都已被 boss.schedule 注册', async () => {
    const schedules = await boss.getSchedules();
    const names = new Set(schedules.map((schedule) => schedule.name));
    expect(names.has(EXPORT_ARTIFACT_GC_QUEUE)).toBe(true);
    expect(names.has(RETENTION_CLEANUP_QUEUE)).toBe(true);
  });

  it('(h) 删除后再次导出返回空集（七类全部为空，文件不产生）', async () => {
    const seeded = await seedConversation('exp-h');
    // 先做一次有数据的导出（文件在场），然后删除，再导出。
    const first = await tx(async (t) => createExportAction(boss, t, seeded.userId));
    const firstPayload = await runExportBuildJob({ executor: purgeDb, exportArtifactsDir: EXPORT_DIR }, first.exportId);
    expect(firstPayload.status).toBe('complete');

    const { executeAccountDeletion } = await import('../../apps/api/src/worker/jobs/account-deletion.ts');
    await executeAccountDeletion({ executor: purgeDb, exportArtifactsDir: EXPORT_DIR }, seeded.userId);

    // 目录无该用户文件（删除级联清掉导出产物）。
    expect(existsSync(join(EXPORT_DIR, seeded.userId))).toBe(false);
    // 数据层空集：collectExportBundle 对已删用户七类全空。
    const bundle = await collectExportBundle(db, seeded.userId);
    expect(bundle.conversations).toEqual([]);
    expect(bundle.messages).toEqual([]);
    expect(bundle.friendships).toEqual([]);
    expect(bundle.consents).toEqual([]);
    expect(bundle.consentEvents).toEqual([]); // 去标识化后不再按 user_id 可见。
    expect(bundle.safetyEvents).toEqual([]);
    expect(bundle.usageSegments).toEqual([]);
    expect(bundle.emergencyContact).toBeNull();
  });
});

// gatedFromStoredCharacterMessage 的受控通道：disclosure 不合法时拒绝恢复（非空真）。
describe('gatedFromStoredCharacterMessage（COMPLY-02 的接缝守卫）', () => {
  it('合法 disclosure 恢复为可渲染文本；不合法形态抛错', async () => {
    const good = gatedFromStoredCharacterMessage('text', {
      kind: 'ai_generated',
      labeledAt: '2026-09-27T00:00:00.000Z',
      labelerVersion: 'disclosure-v1',
    });
    expect(String(good)).toBe('text');
    expect(() =>
      gatedFromStoredCharacterMessage('text', {
        kind: 'human' as 'ai_generated',
        labeledAt: '2026-09-27T00:00:00.000Z',
        labelerVersion: 'disclosure-v1',
      }),
    ).toThrow(/ai_generated/);
  });
});
