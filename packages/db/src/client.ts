// postgres.js 连接 + drizzle 实例 + 事务辅助。
//
// ── 三个连接，三个身份，一条理由 ─────────────────────────────────────────────
//
//   ownerSql —— 连接串里的那个用户（迁移/种子/测试的身份，表的 owner）
//   db       —— **app_role** 身份。业务代码只能用它。
//   purgeDb  —— **purge_role** 身份。删除 worker（PRIV-05）只能用它。
//
// 身份不是靠三份凭证切换的，而是靠 PostgreSQL 的启动参数 `-c role=<role>`：连接一
// 建立就 SET ROLE，之后这条连接上的每一条语句（事务内外都一样）都按那个角色做权限
// 检查。这一点很关键 —— 如果改成「在事务开头 SET LOCAL ROLE」，任何一条走非事务
// 路径的语句就会以 owner 身份执行，而 owner 会**绕过** 0001 迁移里对审计表族的
// REVOKE UPDATE, DELETE。那种绕过不会报错，只会让 append-only 悄悄不成立。
//
// 代价是 app_role / purge_role 必须先存在（0001 迁移建）。它们是 NOLOGIN 的组角色，
// 不需要各自的密码，因此部署时不多一份密钥。

import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase, type PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.ts';

/** 业务连接的角色名。0001 迁移建它并 REVOKE 掉审计表族的 UPDATE/DELETE。 */
export const APP_ROLE = 'app_role';
/** 删除 worker 的角色名。审计表族对它 GRANT DELETE。 */
export const PURGE_ROLE = 'purge_role';

function requireDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    // 起不来是可见的，半年后才发现不是 —— 与 apps/api/src/config/env.ts 同一条理由。
    throw new Error('DATABASE_URL 未设置：packages/db 无法建立连接');
  }
  return url;
}

const DATABASE_URL = requireDatabaseUrl();

/** postgres.js 的公共选项。⚠️ `debug` 永远不要打开：它会打印 SQL 连同参数，而参数就是消息正文。 */
const BASE_OPTIONS = {
  max: 8,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {
    // 丢弃 NOTICE：迁移与 pg-boss 建表的 NOTICE 无信息量且会刷屏。
  },
} as const;

function poolAs(role: string | null): postgres.Sql {
  return postgres(DATABASE_URL, {
    ...BASE_OPTIONS,
    ...(role === null ? {} : { connection: { options: `-c role=${role}` } }),
  });
}

/**
 * owner 身份的裸 postgres.js 句柄。
 * **只给迁移、种子与测试用** —— 业务代码用 db / purgeDb。
 */
export const ownerSql: postgres.Sql = poolAs(null);

const appSql: postgres.Sql = poolAs(APP_ROLE);
const purgeSql: postgres.Sql = poolAs(PURGE_ROLE);

export type Schema = typeof schema;
export type Db = PostgresJsDatabase<Schema>;
export type Tx = PostgresJsTransaction<Schema, ExtractTablesWithRelations<Schema>>;
/** 事务与非事务都能接的执行器。message.ts 的三个函数都按它取参。 */
export type Executor = Db | Tx;

/** 业务连接（app_role）。 */
export const db: Db = drizzle(appSql, { schema });
/** 删除 worker 连接（purge_role）。 */
export const purgeDb: Db = drizzle(purgeSql, { schema });
/** owner 连接的 drizzle 实例。迁移/种子/测试用。 */
export const ownerDb: Db = drizzle(ownerSql, { schema });

/**
 * 在 app_role 身份的单个事务里执行 fn。
 *
 * ⚠️ seq 取号（conversation.next_seq 的 UPDATE ... RETURNING）与消息落库**必须**在
 * 同一个事务里，否则两条并发消息可能拿到同一个 seq —— 而唯一索引会把它变成一次
 * 写入失败，不是一次静默错号。用这个辅助而不是各处手写 db.transaction，是为了让
 * 「哪些写入共享一个事务」在调用点上看得见。
 */
export async function tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/** owner 身份的事务。种子与测试 fixture 用。 */
export async function ownerTx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  return ownerDb.transaction(fn);
}

export async function closeDb(): Promise<void> {
  await Promise.all([
    appSql.end({ timeout: 5 }),
    purgeSql.end({ timeout: 5 }),
    ownerSql.end({ timeout: 5 }),
  ]);
}
