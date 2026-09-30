---
phase: 01-compliance-safety-chat-skeleton
plan: 02
subsystem: infra
tags: [pnpm-workspace, typescript, eslint, vitest, branded-types, ci]

requires:
  - phase: 01-compliance-safety-chat-skeleton (Plan 01)
    provides: 三处契约修订与 tools/ci/check-contract-amendments.mjs 的 13 条机械断言
provides:
  - 单 pnpm workspace（packages/* 与 apps/* 两组 glob），packageManager 锁定 pnpm@12.6.0
  - tsconfig.base.json 严格编译基线 + 五个包的包边界骨架（contract/db/llm/safety/prompts）
  - GatedText 与 SyntheticText 的 TS1335 安全形态（declare const unique symbol + 计算属性键）
  - type-aware ESLint flat config，具名导出 REQUIRED_RESTRICTED_SYNTAX（6 条必需禁令）
  - 三个已被证明非空真的负向 fixture（V.0 #1 #4 #5）与 flat-config 元测试
  - vitest 四层 projects（unit/contract/integration/probes）与 ci:fast 入口脚本
affects: [01-03 会话骨架, 01-04 tracer, 01-05 Model Router, 01-06 出站安全网关, 01-13 RES-03 静态检查]

actuals:
  tokens: 48000
  tasks: 3
  commits: 3

tech-stack:
  added:
    - pnpm 12.6.0（packageManager 字段锁定，corepack 自动拉取）
    - typescript 7.0.2（原生端口，经 npm alias @typescript/native 提供 tsc）
    - "@typescript/typescript6 6.0.2（npm alias 成 typescript，供 typescript-eslint 用 TS 6.0 API）"
    - eslint 10.11.0 + @typescript-eslint/{parser,eslint-plugin} 8.70.1
    - vitest 5.0.2
    - "@types/node 24.19.0"
  patterns:
    - 品牌类型只在 packages/contract 声明、只在各自唯一产出点提升；brand.ts 不导出任何值
    - 负向 fixture 目录（tools/ci/fixtures、tools/ci/type-fixtures）排除出常规 lint/typecheck，只由专门断言驱动
    - flat config 子目录块若重设 no-restricted-syntax 必须 spread REQUIRED_RESTRICTED_SYNTAX
    - 源码直连（package exports 指向 src/index.ts，不预构建）
    - vitest project 名即验证层名，CI 按层筛选

key-files:
  created:
    - package.json
    - pnpm-workspace.yaml
    - .npmrc
    - .gitignore
    - tsconfig.base.json
    - tsconfig.json
    - eslint.config.js
    - vitest.config.ts
    - SKIPPED_CHECKS.md
    - packages/contract/src/brand.ts
    - packages/contract/src/brand.test.ts
    - packages/contract/src/index.ts
    - packages/db/src/index.ts
    - packages/llm/src/index.ts
    - packages/safety/src/index.ts
    - packages/prompts/src/index.ts
    - tools/ci/eslint-config-meta.test.ts
    - tools/ci/type-fixture-negative.test.ts
    - tools/ci/fixtures/bad-model-literal.ts
    - tools/ci/fixtures/dynamic-provider-import.ts
    - tools/ci/type-fixtures/gated-text-escape.ts
    - tools/ci/type-fixtures/tsconfig.json
  modified: []

key-decisions:
  - "工具链按 TS 7.0 公告的 Running Side-by-Side 方案装两份 TypeScript：tsc 由 @typescript/native（typescript@7.0.2）提供，bare typescript 别名指向 @typescript/typescript6@6.0.2 供 typescript-eslint 使用 —— TS 7 原生端口不再提供 JS 编译器 API，否则 type-aware 的四条 any 防线整层不可用"
  - "typecheck 入口是 tsc --build tsconfig.json，而不是 plan 字面的 tsc --noEmit -p tsconfig.json —— 后者在 references 存在时会整体跳过被引用项目的源文件，是空真检查（已用故意放入的类型错误实测：退出码仍为 0）"
  - "passWithNoTests 保持根级 false（vitest 不支持 per-project），L3 层由 brand 运行时不可构造测试打底，从而 integration/probes 两层在无被测对象时必须失败而不是静默变绿"
  - "负向 fixture 目录同时排除出 eslint ignores 与根 tsconfig exclude；元测试用 new ESLint({ ignore: false }) 显式绕过 ignore 来 lint 它们"

patterns-established:
  - "空真防线的两端：编译期（tools/ci/type-fixtures + tsc 退出码非 0）与运行时（packages/contract/src/brand.test.ts 断言零值导出）"
  - "配置类护栏必须有元测试：有效配置是被计算出来的，不是写下来的（ESLint#calculateConfigForFile）"

requirements-completed: [PLAT-01, PLAT-06, PLAT-08]

coverage:
  - id: D0
    description: "本阶段全部待装包的合法性人工核验（RESEARCH 无 Package Legitimacy Audit 表，全部按 ASSUMED 处理）"
    verification:
      - kind: other
        ref: "npm registry 元数据批量核验（发布者 / 周下载量 / 仓库链接 / 最新版本日期 / 精确版本存在性），25/25 命中"
        status: pass
    human_judgment: true
    rationale: "gate=\"blocking-human\" checkpoint，任何模式都不得自动放行；用户已明确回复「已核验，放行」并确认 @ai-sdk/openai@4.0.75 与 @ai-sdk/react@4.0.117 存在"
  - id: D1
    description: "单 pnpm workspace 成立，两组 glob 恰好是 packages/* 与 apps/*，packageManager 锁定 pnpm@12.6.0（PLAT-01）"
    requirement: PLAT-01
    verification:
      - kind: other
        ref: "pnpm install（exit 0，6 个 workspace project）+ grep -n 'pnpm@12.6.0' package.json"
        status: pass
    human_judgment: false
  - id: D2
    description: "TypeScript 7.0.2 在全 workspace 严格编译通过，且 tsc --version 输出 Version 7.0.2"
    verification:
      - kind: other
        ref: "pnpm -w exec tsc --version -> Version 7.0.2；pnpm run typecheck（tsc --build tsconfig.json）exit 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "GatedText 与 SyntheticText 的 TS1335 安全形态：declare const unique symbol + 计算属性键，且运行时不可构造"
    verification:
      - kind: unit
        ref: "packages/contract/src/brand.test.ts#@drift/contract 的品牌类型在运行时不可构造"
        status: pass
      - kind: other
        ref: "grep -n 'declare const' packages/contract/src/brand.ts；grep -c 'export function' -> 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "负向 type fixture 让编译期检查真的失败（V.0 #1）—— GatedText 退化为 string 别名时该断言立刻变红"
    verification:
      - kind: integration
        ref: "tools/ci/type-fixture-negative.test.ts#对 tools/ci/type-fixtures 跑 tsc 必须失败，且至少 3 条 error TS（实测 exit 1，4 条 error TS）"
        status: pass
      - kind: manual_procedural
        ref: "破坏验证：brand.ts 的 GatedText 改成 string 别名 -> 该测试 1 failed；已还原"
        status: pass
    human_judgment: false
  - id: D5
    description: "type-aware ESLint 生效，no-unsafe-argument / no-unsafe-assignment / no-unsafe-return / no-explicit-any 四条在每个包的有效配置中均为 error（V.0 #2 的载体）"
    verification:
      - kind: unit
        ref: "tools/ci/eslint-config-meta.test.ts#... 的四条 type-aware any 防线 severity 均为 2（6 个代表文件）"
        status: pass
      - kind: other
        ref: "实跑中 type-aware 层真实拦下一处 no-unsafe-assignment（元测试自身的 Array.isArray 收窄产生的 any），修正后 eslint . --max-warnings=0 --no-cache exit 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "model 字符串字面量禁令活着（PLAT-06 / V.0 #4），message 含 AI Gateway 字样"
    requirement: PLAT-06
    verification:
      - kind: unit
        ref: "tools/ci/eslint-config-meta.test.ts#bad-model-literal.ts 报出 no-restricted-syntax 且 message 含 AI Gateway"
        status: pass
      - kind: manual_procedural
        ref: "破坏验证：从 REQUIRED_RESTRICTED_SYNTAX 删掉 model 字面量条目 -> 该断言 1 failed；已还原"
        status: pass
    human_judgment: false
  - id: D7
    description: "动态 import() provider SDK 的边界禁令活着（V.0 #5），ImportExpression 选择器命中"
    verification:
      - kind: unit
        ref: "tools/ci/eslint-config-meta.test.ts#dynamic-provider-import.ts 报出 no-restricted-syntax 的 ImportExpression 条目"
        status: pass
    human_judgment: false
  - id: D8
    description: "flat config 替换语义陷阱可被抓到：子目录块重设 no-restricted-syntax 而不 spread 时元测试变红"
    verification:
      - kind: unit
        ref: "tools/ci/eslint-config-meta.test.ts#... 的有效配置含全部必需的 no-restricted-syntax 条目（calculateConfigForFile，6 个代表文件）"
        status: pass
      - kind: manual_procedural
        ref: "破坏验证：给 packages/db/** 加一个不 spread 的 no-restricted-syntax 块 -> 元测试 1 failed；已还原"
        status: pass
    human_judgment: false
  - id: D9
    description: "ci:fast 一条命令覆盖 L1/L2/L3/L4，在无 Docker、无数据库、无 LLM API key 的环境下退出 0"
    verification:
      - kind: other
        ref: "pnpm run ci:fast exit 0（输出中 'No test files found' 与 '0 passed' 计数为 0）；16 个 contract 测试 + 2 个 unit 测试全绿"
        status: pass
    human_judgment: false
  - id: D10
    description: "SKIPPED_CHECKS.md 建立，四列表头（check id / 为什么 skip / 解除条件 / 登记日期），并已登记两行真实 skip 状态"
    verification:
      - kind: other
        ref: "grep -n '解除条件' SKIPPED_CHECKS.md；两行登记：L5-L6-no-subject、L2-type-aware-on-ts6"
        status: pass
    human_judgment: false
  - id: D11
    description: "Plan 01 的契约断言未被工具链改动破坏"
    verification:
      - kind: other
        ref: "node tools/ci/check-contract-amendments.mjs -> OK 13/13 contract amendments"
        status: pass
    human_judgment: false
  - id: D12
    description: "提示词真相源在 git 中、不托管于可观测性平台的载体包 packages/prompts 就位（PLAT-08 的骨架部分）"
    requirement: PLAT-08
    verification: []
    human_judgment: true
    rationale: "本 plan 只交付 packages/prompts 的包边界骨架；PLAT-08 的实质（提示词文本 + 内容哈希版本）由 Plan 05 填入，需求状态因此仍为 Pending（见下）"

duration: 1h 1m
completed: 2026-09-26
status: complete
---

# Phase 01 Plan 02: 工程地基与三条非空真检查 Summary

**单 pnpm workspace + TS 7.0.2 严格编译 + type-aware ESLint flat config + vitest 四层，五个包边界与 GatedText/SyntheticText 的 TS1335 安全形态就位，V.0 的 #1 #4 #5 三条负向 fixture 与 flat-config 元测试全部被证明能让检查失败**

## Performance

- **Duration:** 1h 1m
- **Started:** 2026-09-26T08:35:00Z
- **Completed:** 2026-09-26T09:36:00Z
- **Tasks:** 3 个 auto 任务 + 1 个 blocking-human checkpoint
- **Files modified:** 33

## Accomplishments

- **三条本来会空真通过的断言，现在各自有了一个被证明会失败的检查器。** 负向 type fixture 让 `tsc` 退出码为 1 并报出 4 条 `error TS`；两个 lint fixture 各自命中 `no-restricted-syntax`；flat-config 元测试用 `calculateConfigForFile` 读回六个代表文件的有效配置逐条比对。三处「破坏再还原」实跑均让对应测试变红。
- **GatedText / SyntheticText 落在 TS1335 安全形态上，并且两端都有守卫。** 编译期一端是 `tools/ci/type-fixtures`，运行时一端是 `packages/contract/src/brand.test.ts`（断言 `@drift/contract` 零值导出、`brand.ts` 零函数导出）—— 后者直接对应「`packages/safety` 是 GatedText 唯一产出者」这条包边界。
- **type-aware 的四条 any 防线不是写在配置里而已，它在本 plan 内就真实拦下了一次违规**（元测试自身 `Array.isArray` 收窄产生的 `any`）。
- **发现并绕过了两个会让检查静默失效的真实陷阱**：TS 7 原生端口没有 JS 编译器 API（否则 type-aware 整层不可用）；`tsc --noEmit -p` 在 project references 下会整体跳过被引用项目的源文件（否则 typecheck 是空真的）。两者都是实测确认，不是推测。
- **ci:fast 一条命令覆盖 L1→L4 且不接触境内资源**，为 self-hosted runner 掉线时仍有防线奠定前提。

## Task Commits

1. **Task 1: pnpm workspace 与版本锁定 + 五个包边界骨架 + brand 类型** — `cf49003` (feat)
2. **Task 2: type-aware ESLint flat config + 三个负向 fixture + config 元测试** — `8f20870` (feat)
3. **Task 3: vitest 分层配置 + lint/typecheck/test 的 CI 入口脚本** — `635654d` (feat)

**Plan metadata:** 本次提交 (docs: complete plan)

## Files Created/Modified

- `package.json` — private/type=module、packageManager 锁 pnpm@12.6.0、engines.node `>=24.21.0 <25`、十条 scripts（含 ci:fast）
- `pnpm-workspace.yaml` — packages/* 与 apps/* 两条 glob（pnpm 12 自动追加的 `minimumReleaseAgeExclude` 为其供应链保护，保留）
- `.npmrc` — save-exact=true、strict-peer-dependencies=false
- `tsconfig.base.json` — strict / noUncheckedIndexedAccess / exactOptionalPropertyTypes / nodenext / verbatimModuleSyntax / isolatedModules / declaration / composite
- `tsconfig.json` — 根解决方案配置，references 五个包，include 覆盖 packages/*/src、tools/ci、eslint.config.js、vitest.config.ts，exclude 两个 fixture 目录
- `eslint.config.js` — 具名导出 `REQUIRED_RESTRICTED_SYNTAX`（6 条）；type-aware 块 + packages/llm 豁免块（显式 spread）+ fixtures 非 type-aware 块
- `vitest.config.ts` — 四个 project：unit / contract / integration / probes；watch=false、passWithNoTests=false
- `packages/contract/src/brand.ts` — 品牌类型唯一声明处，不导出任何值
- `packages/contract/src/brand.test.ts` — L3 第一条测试：品牌类型运行时不可构造
- `packages/{db,llm,safety,prompts}/src/index.ts` — 包边界占位（各写明本包不可协商的边界，实现由 Plan 03/05/06 填入）
- `tools/ci/eslint-config-meta.test.ts` — 有效配置元测试 + 两个 lint fixture 断言（15 个测试）
- `tools/ci/type-fixture-negative.test.ts` — spawn tsc 跑负向 type fixture 并断言退出码非 0
- `tools/ci/fixtures/bad-model-literal.ts` / `dynamic-provider-import.ts` — V.0 #4 / #5
- `tools/ci/type-fixtures/gated-text-escape.ts` + `tsconfig.json` — V.0 #1（4 处真实违反 + 2 行注明 tsc 不会报错、只有 lint 能挡的断言形式）
- `SKIPPED_CHECKS.md` — 四列表头 + 两行登记

## Decisions Made

1. **两份 TypeScript，走 TS 官方 side-by-side。** `@typescript/native`→`typescript@7.0.2` 提供 `tsc`；bare `typescript`→`@typescript/typescript6@6.0.2` 提供 TS 6.0 API 给 typescript-eslint。理由与替代方案见下方 Deviations。
2. **typecheck 入口用 `tsc --build`。** `tsc --noEmit -p tsconfig.json` 在 references 存在时对被引用项目的源文件是空真的（实测）。`--noEmit -p` 保留为 `typecheck:tools`（覆盖 tools/ci 层）。
3. **`passWithNoTests` 只能是根级设置**（vitest 不接受 per-project 的该键，已实测）。保持 `false` 以堵住 T-02-06，代价是 L3 层必须至少有一条真实测试 —— 于是补上了品牌类型运行时不可构造的那条，它本身就是包边界的运行时守卫。
4. **fixture 目录双重排除 + 元测试显式绕过 ignore。** `new ESLint({ ignore: false })` 让元测试能 lint 被常规运行忽略的 fixture，从而「fixture 不进常规范围」与「fixture 必须被断言」同时成立。

## Deviations from Plan

### Auto-fixed / 已获批准的偏离

**1. [Rule 4 - 架构变更，已获用户批准] 引入第二份 TypeScript（官方 side-by-side 方案）**
- **Found during:** Task 2（配置 type-aware ESLint）
- **Issue:** `typescript@7.0.2` 是原生端口，`exports` 只有 `./lib/version.cjs`，不再提供 JS 编译器 API；`@typescript-eslint` 8.70.1（最新，无更高版本）peer 范围为 `>=4.8.4 <6.1.0`，实跑直接抛错 `typescript-eslint does not support TS 7.0`。plan 的 must_have「tsc 必须是 7.0.2」与 prohibition #1「四条 type-aware 规则不得关闭」在单一 TS 版本下不可同时成立。
- **排除过的替代方案（均已实测）:** pnpm `packageExtensions` 注入、pnpm `overrides` 路径选择器 —— peer 解析优先，TS 6 根本不会被安装。
- **Fix:** 按 TS 7.0 公告 “Running Side-by-Side with TypeScript 6.0” 的官方写法改为两个 npm alias：`"@typescript/native": "npm:typescript@7.0.2"`（提供 `tsc`）+ `"typescript": "npm:@typescript/typescript6@6.0.2"`（提供 `tsc6` 与 TS 6.0 API）。
- **包合法性:** `@typescript/typescript6@6.0.2` 维护者与 `typescript` 同一批（microsoft1es / typescript-bot / jakebailey 等）、同一 repo `microsoft/TypeScript`、Apache-2.0、周下载 576 万。
- **Verification:** `pnpm -w exec tsc --version` → `Version 7.0.2`；`require('typescript').versionMajorMinor` → `6.0` 且 `createProgram` 可用；type-aware lint 生效并真实报错一次。
- **登记:** `SKIPPED_CHECKS.md` 的 `L2-type-aware-on-ts6` 一行，解除条件为 typescript-eslint 支持 TS >=7.1。
- **Committed in:** `8f20870`

**2. [Rule 1 - Bug] typecheck 入口从 `tsc --noEmit -p` 改为 `tsc --build`**
- **Found during:** Task 1（验证 typecheck）
- **Issue:** `tsc --noEmit -p tsconfig.json` 在根 tsconfig 带 `references` 时，会把被引用项目拥有的源文件整体从 program 里剔除（`--listFiles` 中 `packages/` 下一个文件都没有）。故意放入 `const x: number = "nope"` 后退出码仍为 0 —— 即 plan 字面给出的 typecheck 命令是一个空真检查，正是本 plan 要消灭的那类断言。
- **Fix:** `typecheck` 改为 `tsc --build tsconfig.json`（实测能抓到每个包内的错误，退出码 2）；`tsc --noEmit -p tsconfig.json` 保留为 `typecheck:tools`。references 数组按验收要求保留五个包路径。
- **Verification:** 探针文件实测（`--build` 报错、`--noEmit -p` 不报错），清理后两者均 exit 0。
- **Committed in:** `cf49003`

**3. [Rule 2 - 缺失关键项] 新增 `packages/contract/src/brand.test.ts`**
- **Found during:** Task 3（配置 vitest 分层）
- **Issue:** `passWithNoTests` 是 vitest 根级选项，无法只对 unit 层放宽。保持 `false` 且 L3 无任何测试文件时 `ci:fast` 必然以 `No test files found` 失败；设为 `true` 则四层同时退化为静默绿（T-02-06）。
- **Fix:** 补一条真实的 L3 测试，断言 `@drift/contract` 运行时零值导出、`brand.ts` 零函数导出 —— 它是「`packages/safety` 是 GatedText 唯一产出者」这条包边界的运行时一端，不是占位。
- **Verification:** `pnpm run test:unit` 2 passed；`pnpm run ci:fast` exit 0 且输出无 `No test files found` / `0 passed`。
- **Committed in:** `635654d`

**4. [Rule 3 - 阻塞] 根 tsconfig 增加 `allowJs`/`checkJs:false` 与四个包的 `tsconfig.json`**
- **Found during:** Task 1 / Task 2
- **Issue:** (a) `references` 要求每个被引用项目都有 `tsconfig.json`，而 plan 的 `files_modified` 只列了 `packages/contract/tsconfig.json`；(b) 元测试需要 `import { REQUIRED_RESTRICTED_SYNTAX } from '../../eslint.config.js'`，在 `allowJs:false` 下报 TS7016。
- **Fix:** 为五个包各建 `tsconfig.json`（extends `../../tsconfig.base.json`）；根 tsconfig 加 `allowJs:true` + `checkJs:false` 并把 `eslint.config.js`、`vitest.config.ts` 纳入 include（后者同时让它们进入 type-aware lint 的项目范围）。
- **Committed in:** `cf49003` / `8f20870` / `635654d`

---

**Total deviations:** 4（1 条 Rule 4 已获用户批准、1 条 Rule 1、1 条 Rule 2、1 条 Rule 3）
**Impact on plan:** 全部围绕「让检查真的会失败」这一目标，无范围扩张。两条 Rule 1/Rule 2 偏离分别消灭了一个空真 typecheck 与一个会让四层同时静默变绿的配置；Rule 4 偏离是保住 prohibition #1 的唯一可行路径。

## Authentication Gates

无 —— 本 plan 未触达任何需要凭据的服务。

## Issues Encountered

1. **本机 Node 为 24.13.0，低于 `engines.node` 锁定的 `>=24.21.0 <25`。** 未放宽 engines（版本锁是 RESEARCH §2.2 的契约），pnpm 在 `engine-strict=false` 默认下只警告不阻断，安装与全部检查均通过。**CI 与部署环境必须用 24.21.0 LTS**；本机后续应升级，否则 `ci:fast` 在本机与 CI 上跑的是不同运行时。
2. **corepack 首次会交互式询问是否下载 pnpm 12.6.0。** 非交互环境需 `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`，CI 配置时须带上，否则 job 会挂在提示符上。
3. **pnpm 12 会自行向 `pnpm-workspace.yaml` 追加 `minimumReleaseAgeExclude`**（本例为 `@types/node@24.19.0`），并在 install 时跑 “supply-chain policies” 校验。这是 pnpm 的供应链保护，与 T-02-SC 同向，已保留；但它会在 lockfile/workspace 文件上产生自动改动，CI 若用 `--frozen-lockfile` 需注意。
4. **删掉 `REQUIRED_RESTRICTED_SYNTAX` 中某一条时，变红的是负向 fixture 断言而不是 selector 比对断言** —— 因为后者以该常量自身为真相源。这正是 V.0「空真断言必须带负向 fixture」的直接例证：元测试守的是「配置被替换」，fixture 守的是「条目被删除」，两者不可互相替代。

## User Setup Required

无 —— PLAN.md 无 `user_setup` 段，本 plan 不需要外部服务配置。

## Next Phase Readiness

**就绪：**
- `pnpm install` / `pnpm run typecheck` / `pnpm run lint` / `pnpm run ci:fast` 全部可用且退出 0
- 五个包边界与 `GatedText`/`SyntheticText` 就位，Plan 05（Model Router）与 Plan 06（出站网关）可以直接接上各自的唯一产出点
- Plan 03 追加 `apps/api` 与 `apps/web` 时：`pnpm-workspace.yaml` 的 `apps/*` glob 已在、根 tsconfig 需追加两条 references、元测试会自动把 `apps/*` 的代表文件纳入断言（无需改测试）
- `tests/integration/` 的 `globalSetup` 预留位已在 `vitest.config.ts` 中留空数组，Plan 03 接真实 PG 时填入

**需要注意：**
- 三条需求 PLAT-01 / PLAT-06 / PLAT-08 均被 Plan 03/05/06/13 等同阶段兄弟 plan 同时声明，按 shared-ID 门禁（`requirements.ready-ids` 返回 0/3）本次**不**标记 Complete，待最后一个声明它们的 plan 完成后自动标记
- `SKIPPED_CHECKS.md` 两行登记均有可判定的解除条件，Plan 04 与 Plan 08 落地时应回来删行
- 本机 Node 版本低于锁定下限（见 Issues #1）

---
*Phase: 01-compliance-safety-chat-skeleton*
*Completed: 2026-09-26*
