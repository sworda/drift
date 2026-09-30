// L5 集成层的 globalSetup —— 每次运行都重建一个一次性测试库。
//
// 为什么是「每次重建」而不是复用开发库：集成断言里有若干条**负向 fixture**（往
// message 表插一条缺标识的角色消息、往 persona_version 插一条 core 被改过的记录）。
// 它们会留下失败的事务与部分写入的 fixture 行；跑在开发库上会让「上一次测试的残留」
// 变成下一次测试的隐性前提 —— 那是一类只在本机复现、在 CI 上看不见的绿。
//
// 顺序（不可调换）：建库 → 装扩展 → drizzle-kit migrate（0000 + 0001）→ seed。
// 0001 里有角色与权限，seed 之前必须已经应用，否则种子写入会以 owner 身份绕过
// 那套权限，而那正是 schema-drift 断言 (c) 要证明的东西。

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const DB_PACKAGE = fileURLToPath(new URL('../../packages/db/', import.meta.url));
const DRIZZLE_KIT = fileURLToPath(
  new URL('../../packages/db/node_modules/.bin/drizzle-kit', import.meta.url),
);

/** 一次性测试库的名字。固定名字 + 每次 drop/create，而不是随机名 —— 随机名会在
 *  测试进程被 kill 时留下一堆孤儿库。 */
const TEST_DB_NAME = 'drift_test';

function requireDevDatabaseUrl(): URL {
  const raw = process.env['DATABASE_URL'];
  if (raw === undefined || raw.length === 0) {
    throw new Error(
      [
        'DATABASE_URL 未设置，集成层无法建测试库。',
        '本地：先 `docker compose up -d --wait postgres`，再',
        "  DATABASE_URL='postgres://drift:<POSTGRES_PASSWORD>@127.0.0.1:5432/drift' pnpm run test:integration",
        '（这里不给默认值：猜一份数据库凭证比报错更糟 —— 它可能连上另一个库并把它 drop 掉。）',
      ].join('\n'),
    );
  }
  return new URL(raw);
}

function withDatabase(base: URL, database: string): string {
  const next = new URL(base.toString());
  next.pathname = `/${database}`;
  return next.toString();
}

function runDrizzleKit(args: readonly string[], databaseUrl: string): void {
  const run = spawnSync(DRIZZLE_KIT, [...args], {
    cwd: DB_PACKAGE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  // ⚠️ drizzle-kit 在内部抛错时**依然退出 0**（本 plan 实测）。所以除了退出码，
  // 还要看输出里有没有 stack 的痕迹，否则一个没建任何表的「成功」会一路跑到断言里，
  // 变成一堆看不出原因的 relation does not exist。
  const failed = run.status !== 0 || /\bError\b|at async |ENOENT/.test(output);
  if (failed) {
    throw new Error(`drizzle-kit ${args.join(' ')} 失败：\n${output}`);
  }
}

function runNode(script: string, databaseUrl: string): void {
  const run = spawnSync(process.execPath, [script], {
    cwd: DB_PACKAGE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  if (run.status !== 0) {
    throw new Error(`node ${script} 失败：\n${run.stdout ?? ''}${run.stderr ?? ''}`);
  }
}

export async function setup(): Promise<void> {
  const devUrl = requireDevDatabaseUrl();
  const adminUrl = withDatabase(devUrl, 'postgres');
  const testUrl = withDatabase(devUrl, TEST_DB_NAME);

  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  try {
    // 先断掉可能残留的连接，否则 DROP DATABASE 会因为「其他会话正在使用」失败。
    await admin.unsafe(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${TEST_DB_NAME}' and pid <> pg_backend_pid()`,
    );
    await admin.unsafe(`drop database if exists "${TEST_DB_NAME}"`);
    await admin.unsafe(`create database "${TEST_DB_NAME}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  const testDb = postgres(testUrl, { max: 1, onnotice: () => undefined });
  try {
    await testDb.unsafe('create extension if not exists vector');
    await testDb.unsafe('create schema if not exists pgboss');
  } finally {
    await testDb.end({ timeout: 5 });
  }

  runDrizzleKit(['migrate'], testUrl);
  runNode('src/seed/run.ts', testUrl);

  // 让测试进程连测试库而不是开发库。globalSetup 在 worker fork 之前执行，
  // 所以 worker 继承到的是这里改过的值。
  process.env['DATABASE_URL'] = testUrl;
  process.env['DRIFT_TEST_DATABASE_URL'] = testUrl;
  process.env['DRIFT_ADMIN_DATABASE_URL'] = adminUrl;
}

export async function teardown(): Promise<void> {
  const adminUrl = process.env['DRIFT_ADMIN_DATABASE_URL'];
  if (adminUrl === undefined) return;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${TEST_DB_NAME}' and pid <> pg_backend_pid()`,
    );
    await admin.unsafe(`drop database if exists "${TEST_DB_NAME}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
}
