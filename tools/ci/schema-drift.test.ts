// DB 层的六条断言 —— 这一层回答的问题是「那些约束真的在库里吗」，而不是
// 「schema 文件里写了吗」。两者的差别就是 Task 2 被标成 [BLOCKING] 的理由：
// 构建与类型检查在**没有 push** 的情况下也会全绿（TypeScript 的类型来自 schema
// 文件而不是活库），那是一个假阳性的验证状态。
//
// ⚠️ 本文件跑在 **integration** 层（L5）而不是 contract 层（L4）：它需要真实
// PostgreSQL。vitest.config.ts 因此把它从 contract 的 include 里排除、加进
// integration 的 include —— 否则 `ci:fast` 会在没有数据库的 GitHub 托管 runner 上
// 跑它，而 fast workflow 的第一条约束就是不依赖任何境内资源或数据库。
//
// 四条断言是**负向 fixture**（V.0 #1）：(c)(d)(e) 都在证明某件事会失败。一个只断言
// 「正常写入成功」的测试文件对「约束被删掉」这件事完全不敏感。

import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ASSERT_NO_DRIFT = fileURLToPath(
  new URL('../../packages/db/scripts/assert-no-drift.mjs', import.meta.url),
);
const DB_PACKAGE = fileURLToPath(new URL('../../packages/db/', import.meta.url));

function testDatabaseUrl(): string {
  const url = process.env['DRIFT_TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error('DRIFT_TEST_DATABASE_URL / DATABASE_URL 未设置（tests/integration/setup.ts 应已设好）');
  }
  return url;
}

let sql: postgres.Sql;

/** 拿 PostgreSQL 的 SQLSTATE。断言错误码而不是错误文案 —— 文案随版本变，码不变。 */
function sqlState(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return `<非 pg 错误: ${String(error)}>`;
}

beforeAll(async () => {
  sql = postgres(testDatabaseUrl(), { max: 2, onnotice: () => undefined });
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe('(a) COMPLY-09 的 DB CHECK 约束真的在库里', () => {
  it('message_disclosure_required 存在且是 CHECK', async () => {
    const rows = await sql<{ readonly n: number }[]>`
      select count(*)::int as n from information_schema.table_constraints
      where constraint_name = 'message_disclosure_required'
        and constraint_type = 'CHECK'
        and table_name = 'message'
    `;
    expect(rows[0]?.n).toBe(1);
  });

  it('message_audience_allowed 与 (conversation_id, seq) 唯一索引也在（IFC-08 / CHAT-07）', async () => {
    const checks = await sql<{ readonly n: number }[]>`
      select count(*)::int as n from information_schema.table_constraints
      where constraint_name = 'message_audience_allowed' and constraint_type = 'CHECK'
    `;
    expect(checks[0]?.n).toBe(1);
    const indexes = await sql<{ readonly n: number }[]>`
      select count(*)::int as n from pg_indexes
      where schemaname = 'public' and indexname = 'message_conversation_seq_unique'
    `;
    expect(indexes[0]?.n).toBe(1);
  });
});

describe('(b) pg-boss 在自己的 schema 里建了表', () => {
  it('pgboss schema 的表数 > 0', async () => {
    // 集成层的 setup 只 `create schema pgboss`，表由 boss.start() 建。这里现场起一次
    // boss —— 断言的正是「boss 建过表之后 drizzle 仍然认为无漂移」这个组合状态，
    // 而不是两件独立的事。
    const before = await sql<{ readonly n: number }[]>`
      select count(*)::int as n from information_schema.tables where table_schema = 'pgboss'
    `;
    if ((before[0]?.n ?? 0) === 0) {
      const { PgBoss } = await import('pg-boss');
      const boss = new PgBoss({ connectionString: testDatabaseUrl(), schema: 'pgboss', max: 2 });
      boss.on('error', () => undefined);
      await boss.start();
      await boss.stop({ graceful: true, timeout: 10_000 });
    }
    const after = await sql<{ readonly n: number }[]>`
      select count(*)::int as n from information_schema.tables where table_schema = 'pgboss'
    `;
    expect(after[0]?.n ?? 0).toBeGreaterThan(0);
  });
});

describe('(c) 审计表族对 app_role 是 append-only（D-06 / T-04-04）', () => {
  it.each(['safety_event', 'consent_event', 'privacy_action', 'llm_call', 'client_error', 'exit_intent', 'dependency_signal'])(
    'app_role 对 %s 执行 UPDATE 抛权限错误',
    async (table) => {
      // SET LOCAL ROLE 让权限检查按 app_role 走；事务结束即恢复。
      // 断言的是「抛错」而不是「改了 0 行」—— 权限检查在计划阶段就发生，与有无数据无关。
      await expect(
        sql.begin(async (t) => {
          await t.unsafe('set local role app_role');
          await t.unsafe(`update ${table} set created_at = now()`);
        }),
      ).rejects.toSatisfy(
        (error: unknown) => sqlState(error) === '42501',
        `${table} 的 UPDATE 没有抛 42501 insufficient_privilege —— append-only 只剩代码约定`,
      );
    },
  );

  it.each(['safety_event', 'llm_call'])('app_role 对 %s 执行 DELETE 也抛权限错误', async (table) => {
    await expect(
      sql.begin(async (t) => {
        await t.unsafe('set local role app_role');
        await t.unsafe(`delete from ${table}`);
      }),
    ).rejects.toSatisfy((error: unknown) => sqlState(error) === '42501');
  });

  it('contact_attempt 反向断言：它**不**属审计表族，UPDATE 必须被允许', async () => {
    // 这条是上面那组的对照。缺了它，「把 contact_attempt 一起 REVOKE 掉」会让四态
    // 状态机静默退化成两态，而上面每一条断言都还是绿的。
    await sql.begin(async (t) => {
      await t.unsafe('set local role app_role');
      await t.unsafe("update contact_attempt set status = 'failed' where false");
    });
  });
});

describe('(d) COMPLY-09 的负向 fixture：绕过标识注入的写入必须失败', () => {
  let conversationId: string;

  beforeAll(async () => {
    conversationId = await sql.begin(async (t) => {
      const code = `fixture-${Date.now().toString(36)}`;
      await t`insert into invite_code (code, created_by) values (${code}, 'fixture')`;
      const [u] = await t<{ readonly id: string }[]>`
        insert into "user" (id, name, email, birth_date, invite_code_id)
        values (${`fx-user-${code}`}, 'fixture', ${`${code}@example.invalid`}, '1990-01-01', ${code})
        returning id
      `;
      const [c] = await t<{ readonly id: string }[]>`select id from "character" limit 1`;
      if (u === undefined || c === undefined) throw new Error('fixture 前置数据缺失');
      const [conv] = await t<{ readonly id: string }[]>`
        insert into conversation (id, user_id, character_id)
        values (${`fx-conv-${code}`}, ${u.id}, ${c.id})
        returning id
      `;
      if (conv === undefined) throw new Error('conversation fixture 未创建');
      return conv.id;
    });
  });

  it('sender_kind=character 且 disclosure 为 NULL → 23514 check_violation', async () => {
    await expect(
      sql`
        insert into message (id, conversation_id, seq, sender_kind, text, disclosure, provenance)
        values ('fx-msg-nodisclosure', ${conversationId}, 9001, 'character', 'bypass attempt', null,
                '{"sourceUserId":null,"sourceConversationId":null,"acquiredVia":"direct"}'::jsonb)
      `,
    ).rejects.toSatisfy(
      (error: unknown) => sqlState(error) === '23514',
      '没有抛 23514 check_violation —— message_disclosure_required 约束不在库里，标识注入只剩应用层中间件',
    );
  });

  it('同一条消息带上 disclosure 就能写入（证明上一条失败的原因是那个约束，不是别的）', async () => {
    await sql`
      insert into message (id, conversation_id, seq, sender_kind, text, disclosure, provenance)
      values ('fx-msg-withdisclosure', ${conversationId}, 9002, 'character', 'labeled',
              '{"kind":"ai_generated","labeledAt":"2026-01-01T00:00:00.000Z","labelerVersion":"fixture"}'::jsonb,
              '{"sourceUserId":null,"sourceConversationId":null,"acquiredVia":"direct"}'::jsonb)
    `;
    const rows = await sql<{ readonly n: number }[]>`
      select count(*)::int as n from message where id = 'fx-msg-withdisclosure'
    `;
    expect(rows[0]?.n).toBe(1);
  });

  it('用户消息不带 disclosure 是允许的（约束只约束角色消息）', async () => {
    await sql`
      insert into message (id, conversation_id, seq, sender_kind, text, provenance)
      values ('fx-msg-user', ${conversationId}, 9003, 'user', 'hello',
              '{"sourceUserId":null,"sourceConversationId":null,"acquiredVia":"direct"}'::jsonb)
    `;
    const rows = await sql<{ readonly n: number }[]>`
      select count(*)::int as n from message where id = 'fx-msg-user'
    `;
    expect(rows[0]?.n).toBe(1);
  });
});

describe('(e) persona_version 的 core 不变触发器（D-25 / PERS-10）', () => {
  it('parent_id 非空且 core 被改过 → 触发器 RAISE EXCEPTION', async () => {
    const [parent] = await sql<
      { readonly id: string; readonly characterId: string }[]
    >`select id, character_id as "characterId" from persona_version limit 1`;
    expect(parent, '种子角色的 persona_version 不存在').toBeDefined();
    if (parent === undefined) return;

    await expect(
      sql`
        insert into persona_version
          (id, character_id, parent_id, core, traits, dossier, prompt_version, model_snapshot)
        values ('fx-pv-mutated', ${parent.characterId}, ${parent.id},
                '{"values":["被改过的内核"],"hardBoundaries":[],"styleInvariants":[]}'::jsonb,
                '{}'::jsonb, '{}'::jsonb, 'sha256:fixture', 'doubao-seed-character-251128')
      `,
    ).rejects.toSatisfy(
      (error: unknown) => sqlState(error) === 'P0001',
      '没有抛 P0001 raise_exception —— core 不变触发器不在库里，L1 内核可被演化改写',
    );
  });

  it('core 与 parent 一致的新版本可以写入（证明触发器不是一律拒绝）', async () => {
    const [parent] = await sql<
      { readonly id: string; readonly characterId: string; readonly core: unknown }[]
    >`select id, character_id as "characterId", core from persona_version where parent_id is null limit 1`;
    if (parent === undefined) throw new Error('种子 persona_version 缺失');
    await sql`
      insert into persona_version
        (id, character_id, parent_id, core, traits, dossier, prompt_version, model_snapshot)
      values ('fx-pv-same-core', ${parent.characterId}, ${parent.id},
              ${sql.json(parent.core as never)}, '{}'::jsonb, '{}'::jsonb,
              'sha256:fixture', 'doubao-seed-character-251128')
    `;
    const rows = await sql<{ readonly n: number }[]>`
      select count(*)::int as n from persona_version where id = 'fx-pv-same-core'
    `;
    expect(rows[0]?.n).toBe(1);
  });
});

describe('(f) drizzle schema 与实际库无漂移，且 pgboss 被 schemaFilter 排除（T-03-05）', () => {
  it('assert-no-drift 通过', () => {
    // 与 `pnpm --filter @drift/db run db:check` 跑的是**同一个脚本**，不是第二份实现。
    const run = spawnSync(process.execPath, [ASSERT_NO_DRIFT], {
      cwd: DB_PACKAGE,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    expect(run.status, output).toBe(0);
    expect(output).toContain('无漂移');
  });
});
