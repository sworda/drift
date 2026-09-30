// 单一 postgres.js 连接池。PLAT-02：一个 PostgreSQL 同时承载 OLTP + pgvector + pg-boss。
//
// ⚠️ `debug` 永远不要打开：postgres.js 的 debug 钩子会打印完整 SQL **连同参数**，
// 而参数里就是消息正文 —— 那正是 obs/logger.ts 花两道防线堵住的东西，从这里
// 一个开关就能全部绕过。

import postgres from 'postgres';

import { env } from '../config/env.ts';

export const sql = postgres(env.DATABASE_URL, {
  max: 8,
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: true,
  onnotice: () => {
    // 丢弃 NOTICE：pg-boss 的建表 NOTICE 会在每次启动刷屏，且无信息量。
  },
});

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
