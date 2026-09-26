import { defineConfig } from 'vitest/config';

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
        test: {
          // L3 单元：纯函数，不连数据库、不连 LLM。
          name: 'unit',
          environment: 'node',
          include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
          testTimeout: 10_000,
        },
      },
      {
        test: {
          // L4 契约/注册表：大部分无需 DB，负向 fixture 的断言都在这一层。
          name: 'contract',
          environment: 'node',
          include: ['tools/ci/**/*.test.ts'],
          testTimeout: 10_000,
        },
      },
      {
        test: {
          // L5 集成：真实 PG 18.6 + mock provider。
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 120_000,
          // globalSetup 预留位：Plan 03 在这里接真实 Postgres 的起停与迁移，
          // Plan 04 起填入被测内容。留空数组而不是删掉这个键 —— 让「还没接」
          // 是一个看得见的事实。
          globalSetup: [],
        },
      },
      {
        test: {
          // L6 危机探针：真实 safety.classify，Plan 08 填入探针集。
          name: 'probes',
          environment: 'node',
          include: ['tests/probes/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
