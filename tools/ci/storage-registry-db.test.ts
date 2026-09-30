// STORAGE_LOCATIONS 的 B 腿对账（PRIV-05 / RESEARCH §7.2）—— 连真实测试库。
//
// 本文件属 **integration** 层（L5）：B 腿读 information_schema.tables，抓的是 A 腿
// 结构性看不到的对象 —— 裸 SQL 迁移建的表、pg-boss 自己的表、publication DDL 与
// CREATE EXTENSION 带来的东西。vitest.config.ts 因此把它从 contract 的 include 里
// 排除、加进 integration 的 include（schema-drift.test.ts 的同一处理）。
//
// 非空真策略：B 腿的失效模式是「集合比较吞掉未登记表」—— 负向用例在测试库里用
// 裸 SQL 真建一张表，断言对账函数点名它，然后 drop（不留残留 —— 本层的一次性
// 测试库每次重建，但残留仍会污染同一次运行里的后续用例）。

import { PgBoss } from 'pg-boss';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  KNOWN_EXTERNAL_SCHEMAS,
  registeredTables,
  STORAGE_EXEMPT_TABLES,
  STORAGE_LOCATIONS,
} from '../../packages/db/src/storage-locations.ts';

function testDatabaseUrl(): string {
  const url = process.env['DRIFT_TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error('DRIFT_TEST_DATABASE_URL / DATABASE_URL 未设置（tests/integration/setup.ts 应已设好）');
  }
  return url;
}

interface InformationSchemaTable {
  readonly table_schema: string;
  readonly table_name: string;
}

/**
 * B 腿对账：库里的表集合 == 注册表 ∪ 已知外部 schema。
 *
 * 规则：public 里的每张表必须在注册表（否则是漏登记）；非 public 的 schema 必须在
 * KNOWN_EXTERNAL_SCHEMAS 里（否则是未知 schema —— CREATE EXTENSION / 手工建 schema
 * 都要走这里显式登记，而不是静默放行）。
 */
function assertDatabaseMatchesRegistry(
  rows: readonly InformationSchemaTable[],
  exemptTables: readonly string[] = [...STORAGE_EXEMPT_TABLES],
): void {
  const registered = registeredTables(STORAGE_LOCATIONS);
  const systemSchemas = new Set<string>(['pg_catalog', 'information_schema']);
  const unknown: string[] = [];
  const unregistered: string[] = [];
  for (const row of rows) {
    if (systemSchemas.has(row.table_schema)) continue;
    const qualified = `${row.table_schema}.${row.table_name}`;
    if (row.table_schema === 'public') {
      if (!registered.has(row.table_name) && !exemptTables.includes(row.table_name)) {
        unregistered.push(qualified);
      }
      continue;
    }
    if (!KNOWN_EXTERNAL_SCHEMAS.includes(row.table_schema as (typeof KNOWN_EXTERNAL_SCHEMAS)[number])) {
      unknown.push(qualified);
    }
  }
  if (unregistered.length > 0) {
    throw new Error(
      `库里这些 public 表未登记进 STORAGE_LOCATIONS（裸 SQL 建的表也会被删除静默漏掉）：${unregistered.join('、')}`,
    );
  }
  if (unknown.length > 0) {
    throw new Error(
      `库里出现了 KNOWN_EXTERNAL_SCHEMAS 之外的 schema（新 schema 必须显式登记，否则它的表绕过对账）：${unknown.join('、')}`,
    );
  }
}

let sql: postgres.Sql;
let boss: PgBoss;

beforeAll(async () => {
  sql = postgres(testDatabaseUrl(), { max: 2, onnotice: () => undefined });
  // pgboss schema 的表由 boss.start() 建 —— 断言的对象包含「pg-boss 自己的表被
  // KNOWN_EXTERNAL_SCHEMAS 正确覆盖」这一半，不起 boss 就测不到它（schema-drift.test.ts
  // (b) 的同一理由）。
  boss = new PgBoss({ connectionString: testDatabaseUrl(), schema: 'pgboss', max: 2 });
  boss.on('error', () => undefined);
  await boss.start();
}, 120_000);

afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5_000 });
  await sql.end({ timeout: 5 });
});

describe('B 腿：测试库 information_schema ↔ 注册表 ∪ KNOWN_EXTERNAL_SCHEMAS', () => {
  it('迁移后的库与注册表对账通过（pgboss 表被外部 schema 覆盖）', async () => {
    const rows = await sql<InformationSchemaTable[]>`
      select table_schema, table_name from information_schema.tables
      where table_schema not in ('pg_catalog', 'information_schema')
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(() => assertDatabaseMatchesRegistry(rows)).not.toThrow();
    // 方向性复核：pgboss.job 确实在库里（B 腿的「覆盖」不是空真）。
    const pgbossTables = rows.filter((row) => row.table_schema === 'pgboss').map((row) => row.table_name);
    expect(pgbossTables).toContain('job');
  });

  it('负向：裸 SQL 建一张未登记的 public 表 → 对账点名它（随后 drop）', async () => {
    await sql.unsafe('create table public.registry_probe_negative (id text primary key)');
    try {
      const rows = await sql<InformationSchemaTable[]>`
        select table_schema, table_name from information_schema.tables
        where table_schema not in ('pg_catalog', 'information_schema')
      `;
      expect(() => assertDatabaseMatchesRegistry(rows)).toThrow(/public.registry_probe_negative/);
    } finally {
      await sql.unsafe('drop table public.registry_probe_negative');
    }
    // drop 之后恢复干净。
    const after = await sql<InformationSchemaTable[]>`
      select table_schema, table_name from information_schema.tables
      where table_schema not in ('pg_catalog', 'information_schema')
    `;
    expect(() => assertDatabaseMatchesRegistry(after)).not.toThrow();
  });

  it('负向：未知 schema 的表不被放行（非空真证明之二）', async () => {
    await sql.unsafe('create schema if not exists rogue_schema');
    await sql.unsafe('create table rogue_schema.surprise (id text primary key)');
    try {
      const rows = await sql<InformationSchemaTable[]>`
        select table_schema, table_name from information_schema.tables
        where table_schema not in ('pg_catalog', 'information_schema')
      `;
      expect(() => assertDatabaseMatchesRegistry(rows)).toThrow(/rogue_schema.surprise/);
    } finally {
      await sql.unsafe('drop table rogue_schema.surprise');
      await sql.unsafe('drop schema rogue_schema');
    }
  });
});
