import { defineConfig } from 'drizzle-kit';

/**
 * drizzle 迁移配置。
 *
 * `schemaFilter: ['public']` 是本文件存在的主要理由，不是一个可调项：
 * pg-boss 在 **pgboss** schema 里自建表并跑自己的迁移（见 apps/api/src/worker/index.ts）。
 * 没有这条 filter，`drizzle-kit generate` / `push` 会把 pgboss schema 下的表当成
 * 「数据库里有、schema 里没有」的漂移并生成 DROP —— 即一次迁移就能把任务队列
 * 连同待执行的删除任务一起删掉（RESEARCH §2.2 三个已核实兼容性坑之二，T-03-05）。
 *
 * Plan 04 会在 `boss.start()` 之后断言 `drizzle-kit check` 无 diff，那条断言就是
 * 这一行的负向守卫。
 */
export default defineConfig({
  dialect: 'postgresql',
  // Plan 04 建 packages/db/src/schema。
  schema: './src/schema',
  out: './drizzle',
  schemaFilter: ['public'],
  verbose: true,
  strict: true,
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? '',
  },
});
