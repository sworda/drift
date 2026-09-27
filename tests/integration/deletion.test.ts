// 一键删除的九条集成断言 (a)–(i)（PRIV-05 / D-19 / Q1）。
//
// 本文件属 L5：真实 PostgreSQL（一次性 drift_test 库）+ 真实 pg-boss + purge_role
// 权限面。worker 的执行体（executeAccountDeletion / runAccountDeletionJob）由测试
// **手动驱动**而不是等 boss 的 poll 轮询 —— 轮询时机不可控，断言要的是确定性。
// POST /me/delete → 入队 → 回执读取的 HTTP 链路用真实 hono 实例（tracer 先例）。
//
// 口径提醒（本文件最重要的断言是 (h)）：回执的 N = purge 成功执行且 countsAsCleared
// 不为 false 的项数。把 countsAsCleared 临时改成 true 后 (h) 变红 —— 这里以注入式
// 非空真（countCleared 喂翻转输入）常驻证明同一件事，不留一次性手工验证。

process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'deletion-test-operator-token-0123456789abcd';
process.env['BETTER_AUTH_SECRET'] ??= 'deletion-test-better-auth-secret-0123456789a';
process.env['CONTACT_ENCRYPTION_KEY'] ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { PgBoss } from 'pg-boss';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { executeAccountDeletion, runAccountDeletionJob, countCleared } = await import(
  '../../apps/api/src/worker/jobs/account-deletion.ts'
);
const { setAccountDeletionScheduler, ensurePgbossGrants, ACCOUNT_DELETION_QUEUE } = await import(
  '../../apps/api/src/worker/jobs/account-deletion.ts'
);
const { createApp } = await import('../../apps/api/src/http/app.ts');
const {
  closeDb,
  consentEvent,
  ownerDb,
  ownerSql,
  purgeDb,
  session,
} = await import('@drift/db');
const { seedConversation } = await import('./fixtures.ts');

/** 临时导出目录（export_artifact purge 的作用域）。 */
const EXPORT_DIR = mkdtempSync(join(tmpdir(), 'drift-deletion-test-'));

/** 一次性测试库的直连（B 腿同款：检查 pgboss 载荷、跨角色权限）。 */
function testUrl(): string {
  const url = process.env['DRIFT_TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (url === undefined) throw new Error('测试库 URL 未设置');
  return url;
};

let boss: PgBoss;
let baseUrl: string;
let stopServer: () => Promise<void>;
let sql: postgres.Sql;

/** 全成功时的 N：24 项 - 7 去标识化 - 1 pino（无 purge）= 16。 */
const EXPECTED_CLEARED = 16;

/** 失败注入用的 deps 形态。 */
const deps = {
  executor: purgeDb,
  exportArtifactsDir: EXPORT_DIR,
};

beforeAll(async () => {
  // 真实 HTTP 实例（POST /me/delete 与回执读取走它）。
  const app = createApp();
  const listener = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  const address = await new Promise<AddressInfo>((resolve) => {
    const bound = listener.address() as AddressInfo | null;
    if (bound !== null) resolve(bound);
    else listener.once('listening', () => resolve(listener.address() as AddressInfo));
  });
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
  stopServer = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      listener.close(() => resolve());
    });
  };

  // boss：只建队列 + 注册进程级调度器（POST 链路的入队要经过它）—— 不注册 worker，
  // 作业由测试手动驱动。
  boss = new PgBoss({ connectionString: testUrl(), schema: 'pgboss', max: 2 });
  boss.on('error', () => undefined);
  await boss.start();
  await boss.createQueue(ACCOUNT_DELETION_QUEUE, { policy: 'short' });
  await ensurePgbossGrants(ownerSql);
  setAccountDeletionScheduler(boss);

  sql = postgres(testUrl(), { max: 2, onnotice: () => undefined });
}, 120_000);

afterAll(async () => {
  setAccountDeletionScheduler(null);
  await boss.stop({ graceful: false, timeout: 5_000 });
  await sql.end({ timeout: 5 });
  await stopServer();
  await closeDb();
  await ownerSql.end({ timeout: 5 });
  rmSync(EXPORT_DIR, { recursive: true, force: true });
});

/** 给 fixture 用户造一个 better-auth session 行，拿可用的 Bearer token。 */
async function mintSession(userId: string): Promise<string> {
  const token = randomUUID();
  await ownerDb.insert(session).values({
    id: randomUUID(),
    token,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return token;
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

describe('POST /me/delete → 执行 → 回执（HTTP 全链路）', () => {
  it('(a)(i) 短语闸门、202 未完成态、旧 session 401、token 回执、N 的口径', async () => {
    const seeded = await seedConversation('del-http');
    const token = await mintSession(seeded.userId);

    // 错短语：409，什么都没发生。
    const wrong = await fetch(`${baseUrl}/me/delete`, {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ confirmationPhrase: '删掉' }),
    });
    expect(wrong.status).toBe(409);

    // 正短语：202 + actionId + receiptToken。
    const requested = await fetch(`${baseUrl}/me/delete`, {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ confirmationPhrase: '删除我的全部数据' }),
    });
    expect(requested.status).toBe(202);
    const credentials = (await requested.json()) as { actionId: string; receiptToken: string };
    expect(credentials.actionId).toBeTruthy();
    expect(credentials.receiptToken).toBeTruthy();

    // 作业未完成时请求回执返回 202（等价的未完成态）。
    const pending = await fetch(`${baseUrl}/me/privacy-actions/${credentials.actionId}`, {
      headers: bearer(token),
    });
    expect(pending.status).toBe(202);

    // 手动执行作业体（测试驱动，不等 boss 轮询）。
    const payload = await runAccountDeletionJob(deps, credentials.actionId);
    expect(payload.status).toBe('complete');

    // (i) 旧 session 失效：user 与 session 行都没了 ⇒ 401。
    const afterDeletion = await fetch(`${baseUrl}/me/privacy-actions/${credentials.actionId}`, {
      headers: bearer(token),
    });
    expect(afterDeletion.status).toBe(401);

    // token 回执路径：正确 token 200；错误 token 404（越权不披露存在性）。
    const receipt = await fetch(
      `${baseUrl}/privacy-receipts/${credentials.actionId}?token=${encodeURIComponent(credentials.receiptToken)}`,
    );
    expect(receipt.status).toBe(200);
    const receiptBody = (await receipt.json()) as {
      clearedCount: number;
      items: { id: string; ok: boolean; rows: number; deidentified: boolean }[];
    };
    const wrongToken = await fetch(`${baseUrl}/privacy-receipts/${credentials.actionId}?token=not-the-token`);
    expect(wrongToken.status).toBe(404);

    // (a) N 的口径 = 成功执行且非去标识化的项数。verification 表本来就空 —— 影响
    // 0 行但成功执行，仍计入 N（口径是「成功执行的项数」，不是「非空项数」）。
    const verification = receiptBody.items.find((item) => item.id === 'verification');
    expect(verification?.ok).toBe(true);
    expect(verification?.rows).toBe(0);
    expect(receiptBody.clearedCount).toBe(EXPECTED_CLEARED);

    // (h) clearedCount 不包含审计去标识化那七项。
    const deidentified = receiptBody.items.filter((item) => item.deidentified);
    expect(deidentified.length).toBe(7);
    expect(receiptBody.clearedCount).toBe(
      receiptBody.items.filter((item) => item.ok && !item.deidentified).length,
    );

    // 作业幂等短路：第二次执行直接返回已存回执（user 已删，不能也不需要重跑）。
    const again = await runAccountDeletionJob(deps, credentials.actionId);
    expect(again.clearedCount).toBe(receiptBody.clearedCount);
    expect(again.status).toBe('complete');
  });

  it('(h) 非空真：把去标识化项当已清除计数时，countCleared 会给出不同的（错误的）数', async () => {
    // 注入式证明（handout #28）：不改源码，喂翻转输入 —— 证明计数真的在读
    // deidentified 标志，而不是恒等于 items.length - 失败数之类的巧合。
    const realItems = await executeAccountDeletion(
      { ...deps, failLocationIds: ['consent'] },
      (await seedConversation('del-h')).userId,
    ).then((receipt) => receipt.items);
    // consent 注入失败 ⇒ user 项因 consent 行的 FK 残留级联失败（部分失败的真实级联形态）。
    expect(countCleared(realItems)).toBe(EXPECTED_CLEARED - 2);

    const flipped = realItems.map((item) =>
      item.id === 'audit.safety_event' ? { ...item, deidentified: false } : item,
    );
    expect(countCleared(flipped)).toBe(EXPECTED_CLEARED - 1); // 翻转后多计一项 —— (h) 靠的就是它会变。
    expect(countCleared(flipped)).not.toBe(countCleared(realItems));
  });
});

describe('executeAccountDeletion 的执行细节', () => {
  it('(b) 某一项 purge 抛错 ⇒ partial，failedCount 如实分列', async () => {
    const seeded = await seedConversation('del-b');
    const receipt = await executeAccountDeletion(
      { ...deps, failLocationIds: ['consent'] },
      seeded.userId,
    );
    expect(receipt.status).toBe('partial');
    // 2 = consent（注入失败）+ user（consent 行的 FK 残留让它删不掉 —— 级联失败是
    // 部分失败的真实形态，M/N 分支存在的理由正是它：重试时 consent 成功后 user 就能删）。
    expect(receipt.failedCount).toBe(2);
    expect(receipt.clearedCount).toBe(EXPECTED_CLEARED - 2);
    const failed = receipt.items.find((item) => item.id === 'consent');
    expect(failed?.ok).toBe(false);
    // 失败不回滚别的项（M/N 的诚实呈现要求已成功项保持成功）。
    expect(receipt.items.find((item) => item.id === 'message')?.ok).toBe(true);
  });

  it('(c)(d)(e) 删除后：各表无该用户行、导出目录无该用户文件、pgboss 无该 userId 载荷', async () => {
    const seeded = await seedConversation('del-cde');
    // (d) 先放一份「历史导出产物」：目录里有两个文件（md + json）。
    const userDir = join(EXPORT_DIR, seeded.userId);
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'old-export.md'), '# old');
    writeFileSync(join(userDir, 'old-export.json'), '{}');
    // (e) 再放一个携带 userId 的队列载荷（其他队列的旧形态 —— 注册表的 purge 按
    // data->>'userId' 清，不依赖队列名）。
    await boss.createQueue('leak-probe');
    await boss.send('leak-probe', { userId: seeded.userId, note: 'stale payload' });

    const receipt = await executeAccountDeletion(deps, seeded.userId);
    expect(receipt.status).toBe('complete');
    // export_artifact 项的行数 = 删掉的文件数（2）。
    expect(receipt.items.find((item) => item.id === 'export_artifact')?.rows).toBe(2);

    // (c) 各表再无该用户的数据（user 行都没了 —— 按行数断言）。
    for (const [column, table] of [
      ['user_id', 'conversation'],
      ['user_id', 'friendship'],
      ['user_id', 'emergency_contact'],
      ['user_id', 'usage_segment'],
      ['user_id', 'consent'],
      ['user_id', 'account'],
      ['user_id', 'session'],
    ] as const) {
      const rows = await sql.unsafe(
        `select count(*)::int as n from ${table} where ${column} = $1`,
        [seeded.userId],
      );
      expect((rows[0] as unknown as { n: number }).n, `${table} 残留`).toBe(0);
    }
    const messages = await sql.unsafe(
      'select count(*)::int as n from message where conversation_id in (select id from conversation where user_id = $1)',
      [seeded.userId],
    );
    expect((messages[0] as unknown as { n: number }).n).toBe(0);
    const users = await sql.unsafe('select count(*)::int as n from "user" where id = $1', [seeded.userId]);
    expect((users[0] as unknown as { n: number }).n).toBe(0);
    // 邀请码被置空而不是删行（D-19：码是运营资产）：行还在、used_by 为 NULL。
    const inviteRows = await sql.unsafe(
      `select count(*)::int as kept, count(*) filter (where used_by is not null)::int as still_used
       from invite_code where created_by = 'del-cde'`,
    );
    const inviteCounts = inviteRows[0] as unknown as { kept: number; still_used: number };
    expect(inviteCounts.kept, '码本身不能被删掉').toBe(1);
    expect(inviteCounts.still_used).toBe(0);

    // (d) 导出目录无该用户的文件。
    expect(existsSync(userDir)).toBe(false);

    // (e) pgboss.job 与 pgboss.archive 中无该 userId 的 jsonb 载荷。
    // pgboss.archive 在 pg-boss 12.34 实测不存在（storage-locations.ts 的注释）——
    // 断言按 to_regclass 条件化：表不存在时「无该 userId 载荷」对任意集合恒真，因此
    // 这一支在 12.34 上由 purge 的 0 行成功承担，查询断言只对真实存在的表生效。
    for (const table of ['pgboss.job', 'pgboss.archive']) {
      const present = await sql.unsafe(
        'select to_regclass($1) is not null as present',
        [table],
      );
      if (((present[0] as unknown as { present: boolean }).present) !== true) continue;
      const rows = await sql.unsafe(
        `select count(*)::int as n from ${table} where data->>'userId' = $1`,
        [seeded.userId],
      );
      expect((rows[0] as unknown as { n: number }).n, `${table} 残留 userId 载荷`).toBe(0);
    }
  });

  it('(f) 重复执行：第二次全部 purge 返回 0 行且不报错（幂等）', async () => {
    const seeded = await seedConversation('del-f');
    const first = await executeAccountDeletion(deps, seeded.userId);
    expect(first.status).toBe('complete');

    const second = await executeAccountDeletion(deps, seeded.userId);
    expect(second.status, '第二次不报错且仍判成功').toBe('complete');
    expect(second.clearedCount).toBe(EXPECTED_CLEARED);
    // 口径保持「成功执行的项数」—— 幂等重跑的影响 0 行不改 N。
    for (const item of second.items) {
      expect(item.rows, `${item.id} 第二次应为 0 行`).toBe(0);
    }
  });

  it('(g) 审计表行仍存在但 user_id 为 NULL（Q1：去标识化，不删行）', async () => {
    const seeded = await seedConversation('del-g');
    // 造审计行：撤回一次同意（consent_event + privacy_action 各一行）。
    const { revokeConsent } = await import('../../apps/api/src/modules/consent/service.ts');
    await revokeConsent(seeded.userId, 'research_l0', {
      enqueueAccountDeletion: async () => 'job-not-needed',
    });
    // 删除前先拿到审计行的 id —— 删除后它们不再指向任何用户，只能按 id 找回。
    const beforeEvents = await ownerDb
      .select({ id: consentEvent.id })
      .from(consentEvent)
      .where(eq(consentEvent.userId, seeded.userId));
    expect(beforeEvents.length).toBe(1);
    const eventId = beforeEvents[0]?.id as string;

    await executeAccountDeletion(deps, seeded.userId);

    // 行还在，user_id 已 NULL。
    const after = await ownerDb
      .select({ userId: consentEvent.userId, scope: consentEvent.scope })
      .from(consentEvent)
      .where(eq(consentEvent.id, eventId));
    expect(after.length, '审计行被删掉了 —— Q1 的口径是去标识化，不是删行').toBe(1);
    expect(after[0]?.userId).toBeNull();
    expect(after[0]?.scope).toBe('research_l0'); // 事件形状保留。
    // 去标识化把 privacy_action.payload 里的 userId 键也移走了。
    const actions = await sql.unsafe(
      `select count(*)::int as n from privacy_action where kind = 'revoke' and payload->>'userId' is null`,
    );
    expect((actions[0] as unknown as { n: number }).n).toBe(1);
  });

  it('app_role 对审计表的 UPDATE 抛 42501 —— deidentifyAuditRows 只能用 purgeDb 的证明', async () => {
    // 与 schema-drift (c) 同款手法：SET LOCAL ROLE app_role 后 UPDATE 必须在权限层
    // 失败。这证明 0004 给 purge_role 的列级 UPDATE 没有意外放宽到 app_role。
    await expect(
      sql.begin(async (t) => {
        await t.unsafe('set local role app_role');
        await t.unsafe('update safety_event set user_id = null');
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        typeof error === 'object' && error !== null && (error as { code?: string }).code === '42501',
    );
  });

  it('purgeDb（purge_role）可以 UPDATE 审计表的可回链列 —— 权限面确实存在', async () => {
    const seeded = await seedConversation('del-perm');
    const { revokeConsent } = await import('../../apps/api/src/modules/consent/service.ts');
    await revokeConsent(seeded.userId, 'research_l0', {
      enqueueAccountDeletion: async () => 'job-not-needed',
    });
    // 去标识化以 purgeDb 跑通本身就是权限存在的证明 —— 抛错会让 (g) 红。
    const receipt = await executeAccountDeletion(deps, seeded.userId);
    expect(receipt.status).toBe('complete');
  });
});
