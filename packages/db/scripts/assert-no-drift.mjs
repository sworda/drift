// 「drizzle schema 与实际库无漂移」的断言（T-03-05 的负向守卫）。
//
// ⚠️ 为什么不是 `drizzle-kit check`：那条命令**不连数据库**，它只检查
// drizzle/meta/_journal.json 里的迁移记录自身是否自洽。实测在库与 schema 明显不一致
// 时它照样输出 "Everything's fine 🐶🔥" 并退出 0 —— 把它当漂移门禁是一条空真检查。
// 真正会 introspect 活库的是 `drizzle-kit push`。
//
// ⚠️ 副作用（明写在这里而不是藏起来）：push 在发现差异时会**执行**那些语句。所以
// 本脚本只应指向开发库或一次性测试库，绝不指向生产。它的语义是「这个库应该已经
// 和 schema 一致了」——不一致时非零退出并把 drizzle-kit 打印的语句原样带出来，
// 操作者看得到究竟被同步了什么。
//
// 这条断言存在的具体理由：pg-boss 在 pgboss schema 里自建 12 张表并自跑迁移。
// 如果 packages/db/drizzle.config.ts 的 `schemaFilter: ['public']` 被删掉或写错，
// push 就会把那 12 张表当成「库里有、schema 里没有」的漂移并生成 DROP —— 一次迁移
// 就能把任务队列连同待执行的删除任务一起删掉。所以断言分两条：
//   1. 输出必须命中 "No changes detected"
//   2. 输出里**不得**出现 pgboss 字样

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DRIZZLE_KIT = fileURLToPath(new URL('../node_modules/.bin/drizzle-kit', import.meta.url));

if (!process.env.DATABASE_URL) {
  process.stderr.write('assert-no-drift: DATABASE_URL 未设置\n');
  process.exit(1);
}

const run = spawnSync(DRIZZLE_KIT, ['push', '--force'], {
  cwd: PACKAGE_ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
});

const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

// drizzle-kit 会在内部抛错的情况下**依然退出 0**（本 plan 实测：generate 在 schema
// 求值抛异常时打印 stack 却 exit 0）。所以退出码只是三条判据之一，不是唯一判据。
const failures = [];
if (run.status !== 0) failures.push(`drizzle-kit push 退出码 ${String(run.status)}`);
if (!output.includes('No changes detected')) {
  failures.push('drizzle schema 与实际库存在漂移（push 没有输出 "No changes detected"）');
}
if (/pgboss/i.test(output)) {
  failures.push(
    'push 的输出里出现了 pgboss —— drizzle.config.ts 的 schemaFilter 失效，pg-boss 的表正被当成漂移',
  );
}

if (failures.length > 0) {
  process.stderr.write(`assert-no-drift 失败：\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.stderr.write(`--- drizzle-kit push 输出 ---\n${output}\n`);
  process.exit(1);
}

process.stdout.write('assert-no-drift: 无漂移，且 pgboss schema 被正确排除\n');
