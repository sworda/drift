# SKIPPED_CHECKS

任何被 skip 的检查必须在此登记，否则它会在后续阶段无人察觉地继续 skip —— 一个
静默 skip 掉的检查与一条不存在的防线没有区别，而 CI 会一直是绿的。

**登记规则**：新增一行；解除条件必须写成一个可判定的事实（某个 plan 的某个任务
落地、某个依赖升到某版本），不得写成「以后再说」。解除后删除该行并在对应 plan 的
SUMMARY 里说明。

| check id | 为什么 skip | 解除条件 | 登记日期 |
|---|---|---|---|
| L5-L6-no-subject | vitest 的 integration（L5）与 probes（L6）两层在本 plan 之后没有任何被测对象：`tests/integration/` 与 `tests/probes/` 目录尚不存在，`pnpm run test:integration` / `test:probes` 会因 `passWithNoTests: false` 直接失败。这两条脚本因此**不进** `ci:fast`，只在 self-hosted 的 integration job 里跑 | Plan 04 Task 3 的 tracer 落地（第一条端到端切片进 `tests/integration/`）；probes 的解除条件是 Plan 08 的危机探针集落地 | 2026-09-26 |
| L2-type-aware-on-ts6 | type-aware lint 的类型判定跑在 TS 6.0 API 上而非生产编译器 TS 7.0.2。typescript@7 是原生端口、不再提供 JS 编译器 API，@typescript-eslint 8.70.1 的 peer 范围是 `>=4.8.4 <6.1.0` 且实跑直接抛错。按 TS 7.0 公告的 Running Side-by-Side 方案，`typescript` 别名指向 `@typescript/typescript6`，`tsc` 由 `@typescript/native` 提供。四条 no-unsafe-* 规则全部保留为 error，未 skip，但两个编译器的类型判定可能有细微差异 | typescript-eslint 支持 TS >=7.1（[typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)）后，删除 package.json 里的两个 npm alias，回到单一 `typescript` 依赖 | 2026-09-26 |
