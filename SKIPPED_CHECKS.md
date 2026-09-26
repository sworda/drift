# SKIPPED_CHECKS

任何被 skip 的检查必须在此登记，否则它会在后续阶段无人察觉地继续 skip —— 一个
静默 skip 掉的检查与一条不存在的防线没有区别，而 CI 会一直是绿的。

**登记规则**：新增一行；解除条件必须写成一个可判定的事实（某个 plan 的某个任务
落地、某个依赖升到某版本），不得写成「以后再说」。解除后删除该行并在对应 plan 的
SUMMARY 里说明。

| check id | 为什么 skip | 解除条件 | 登记日期 |
|---|---|---|---|
| L6-no-subject | vitest 的 probes（L6）层没有任何被测对象：`tests/probes/` 目录尚不存在，`pnpm run test:probes` 会因 `passWithNoTests: false` 直接失败。该脚本因此**不进** `ci:fast`，只在 self-hosted 的 integration job 里跑。**L5 已于 Plan 04 解除**（`tests/integration/` 与 `tools/ci/schema-drift.test.ts` 落地，`test:integration` 有被测对象且全绿） | Plan 08 的危机探针集落地（`tests/probes/crisis/*.yaml` 与驱动它的测试） | 2026-09-26 |
| L2-type-aware-on-ts6 | type-aware lint 的类型判定跑在 TS 6.0 API 上而非生产编译器 TS 7.0.2。typescript@7 是原生端口、不再提供 JS 编译器 API，@typescript-eslint 8.70.1 的 peer 范围是 `>=4.8.4 <6.1.0` 且实跑直接抛错。按 TS 7.0 公告的 Running Side-by-Side 方案，`typescript` 别名指向 `@typescript/typescript6`，`tsc` 由 `@typescript/native` 提供。四条 no-unsafe-* 规则全部保留为 error，未 skip，但两个编译器的类型判定可能有细微差异 | typescript-eslint 支持 TS >=7.1（[typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)）后，删除 package.json 里的两个 npm alias，回到单一 `typescript` 依赖 | 2026-09-26 |
| nightly-model-snapshot-diff | nightly workflow 的「resolved_model 日 diff」步骤调用 `tools/ci/model-snapshot-diff.mjs`，该脚本尚不存在。步骤用 `[ -f ]` 判断并在缺失时 **exit 1**（不是跳过）—— 所以 nightly 会红，这是一个看得见的已知状态，而不是一条静默通过的检查 | Plan 05（Model Router）落地 `tools/ci/model-snapshot-diff.mjs`：对比 `llm_call.model_snapshot` 的日快照，变化时输出 diff 并非零退出 | 2026-09-26 |
| nightly-publicness-reconcile | nightly workflow 的「registered_users 日对账」步骤调用 `tools/ci/publicness-reconcile.mjs`，该脚本尚不存在。同样是缺失即 exit 1 | Plan 13 落地 `tools/ci/publicness-reconcile.mjs`：把 `compliance/publicness.json` 声明的 registered_users 与数据库实际计数对账（D-23，COMPLY-10 四条抗辩里「≤10 用户」那一条） | 2026-09-26 |
| ci-workflows-never-executed | `.github/workflows/{fast,integration,nightly}.yml` 三条 workflow 从未真实执行过：本仓库当前**没有配置 git remote**，也就没有 GitHub Actions 运行过它们。语法与步骤逻辑是静态写成的，`actions/checkout@v7` / `actions/setup-node@v7` 的可用性、self-hosted runner 的标签匹配、以及 integration 作为 required check 的分支保护配置都尚未被任何一次真实运行验证 | 仓库接上 GitHub 私有仓远端（D-01）并产生第一个 PR，三条 workflow 各至少运行一次；integration 在仓库设置里被标记为 required check（阻断规则的另一半在 GitHub 配置里，不在本仓库的文件里） | 2026-09-26 |
