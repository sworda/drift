import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * apps/web 的 `@/*` 路径别名。
 *
 * 它定义在 apps/web/tsconfig.json 的 paths 里，而 Vite **不读** tsconfig paths ——
 * 不在这里映一次，apps/web 的组件在 vitest 下会以 `Cannot find package '@/components/…'`
 * 失败，而 vitest 把这类失败报成「0 test」，看不出原因。
 */
const WEB_SRC = fileURLToPath(new URL('./apps/web/src/', import.meta.url));

/**
 * 验证层级切分（01-RESEARCH.md § Validation Architecture V.1）。
 * project 名**就是层名**，CI 按层筛选：ci:fast 只跑 unit + contract（L3/L4），
 * integration（L5）与 probes（L6）由 self-hosted runner 的 integration job 跑。
 *
 * ⚠️ CI 不得用 watch 模式 —— 全局 watch 关闭，且 package.json 的任何脚本都不带 watch 标记。
 *
 * ⚠️ passWithNoTests 是**根级**选项（vitest 不接受 per-project 的该键，实测写在
 * project.test 里不生效）。这里显式设为 false：任何一层在没有测试文件时都必须
 * 失败，而不是静默变绿（T-02-06）。integration / probes 两层在 Plan 04 之前
 * 必然因此报错 —— 该状态登记在 SKIPPED_CHECKS.md，是一个看得见的已知状态。
 */
export default defineConfig({
  test: {
    watch: false,
    passWithNoTests: false,
    projects: [
      {
        resolve: { alias: [{ find: /^@\//u, replacement: WEB_SRC }] },
        test: {
          // L3 单元：纯函数，不连数据库、不连 LLM。
          name: 'unit',
          environment: 'node',
          // ⚠️ 含 .tsx：apps/web 的静态渲染断言（react-dom/server）住在组件旁边，
          // 因为 react 只装在 apps/web/node_modules 里 —— 从 tools/ci 解析不到它。
          include: [
            'packages/**/src/**/*.test.ts',
            'apps/**/src/**/*.test.ts',
            'apps/**/src/**/*.test.tsx',
          ],
          // jsdom 缺失的浏览器 API（ResizeObserver 等）。带守卫，只在缺失时补，
          // 因此对 node 环境的单元测试是无害的（见该文件的说明）。
          setupFiles: ['./tools/ci/vitest-jsdom-setup.ts'],
          testTimeout: 10_000,
        },
      },
      {
        test: {
          // L4 契约/注册表：**不连 DB、不连 LLM**，负向 fixture 的断言都在这一层。
          name: 'contract',
          environment: 'node',
          include: ['tools/ci/**/*.test.ts'],
          // ⚠️ schema-drift.test.ts 住在 tools/ci/ 但需要真实 PostgreSQL，所以它属
          // integration（下面）而不是这一层。留在 contract 里会让 ci:fast 在 GitHub
          // 托管 runner 上尝试连数据库 —— 而 fast workflow 的第一条约束就是不依赖
          // 任何数据库或境内资源（掉线时它是仅存的防线）。
          // pgboss-delay-api.test.ts 同理：Q5 的锁定测试要真排一个作业再读回来，
          // 所以它需要真实 PostgreSQL，属 integration。
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            'tools/ci/schema-drift.test.ts',
            'tools/ci/pgboss-delay-api.test.ts',
            'tools/ci/storage-registry-db.test.ts',
            'tools/ci/pino-no-pii.test.ts',
          ],
          testTimeout: 10_000,
        },
      },
      {
        test: {
          // L5 集成：真实 PG 18.6 + mock provider。
          name: 'integration',
          environment: 'node',
          include: [
            'tests/integration/**/*.test.ts',
            'tools/ci/schema-drift.test.ts',
            'tools/ci/pgboss-delay-api.test.ts',
            'tools/ci/storage-registry-db.test.ts',
            'tools/ci/pino-no-pii.test.ts',
          ],
          testTimeout: 120_000,
          // 每次运行重建一个一次性 drift_test 库并跑 migrate + seed，teardown 时 drop。
          // 负向 fixture 会留下部分写入的行，跑在开发库上会让「上一次的残留」变成
          // 下一次的隐性前提 —— 一类只在本机复现、在 CI 上看不见的绿。
          globalSetup: ['./tests/integration/setup.ts'],
        },
      },
      {
        test: {
          // L6 危机探针：真实 safety.classify（需 ZHIPU_API_KEY）+ 离线结构守卫与
          // 非空真证明（桩分类器打真库）。与集成层共用一次性测试库的 globalSetup。
          name: 'probes',
          environment: 'node',
          include: ['tests/probes/**/*.test.ts'],
          testTimeout: 120_000,
          globalSetup: ['./tests/integration/setup.ts'],
        },
      },
    ],
  },
});
