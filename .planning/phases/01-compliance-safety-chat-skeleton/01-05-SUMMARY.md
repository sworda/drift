---
phase: 01-compliance-safety-chat-skeleton
plan: 05
subsystem: infra
tags: [model-router, llm, pinnability, prompt-versioning, data-residency, zod]

requires:
  - phase: 01-04
    provides: "最小 Router（ROUTES 5 条 + resolveProvider 抛错占位）、llm_call 的 requested/resolved/price_tier 列、mock provider、tracer 集成测试"
  - phase: 01-02
    provides: "PLAT-06 的 ESLint 规则本体（model 字面量禁令 + ImportExpression 选择器）、negative type fixture 目录与元测试"
  - phase: 01-03
    provides: "nightly workflow 的两个占位步骤、SKIPPED_CHECKS 登记机制"
provides:
  - "ROUTES：6 个语义角色各自独立且字段齐全的配置（PLAT-05），未启用的用 enabled:false 而不是缺条目"
  - "PINNABLE：手写的可 pin 性显式表 + pinnabilityOf()，未登记返回 undefined 而不是默认 snapshot"
  - "assertRouterInvariants()：完备性 / 模型分离 / 可 pin 性 / host 白名单四组断言，apps/api 启动第一步调用"
  - "ALLOWED_LLM_HOSTS（境内）与 SYNTHETIC_ONLY_HOSTS（境外，仅 frontier）两张互斥白名单 + DENIED_LLM_HOSTS 网关黑名单"
  - "callFrontier(readonly SyntheticText[])：境外通道的唯一入口；chat.reply.frontier 已从 CallMode 中移除"
  - "ark / zhipu 两个真实 provider 实例（fetch + git 写死的 baseURL，无运行时覆盖）"
  - "llm.model_alias_resolved warn 事件 + packages/llm 的窄 sink（由 apps/api 的 logger 注册）"
  - "price_tier：按 priceTierBoundaries 与实际 prompt_tokens 推出，恒非空"
  - "tools/ci/model-snapshot-diff.mjs + compliance/model-snapshot-baseline.json：resolved_model 日 diff 告警（含 --self-test 负向 fixture）"
  - "promptVersion() = pv_<16 hex>（归一化后内容哈希）+ PROMPTS 注册表（真相源在 git）"
  - "SafetyClassifyOutput zod 契约 + 不含任何人格指令的分类器系统提示词"
affects: [01-06-egress-registry, 01-07-crisis-intervention, 01-08-crisis-probes, 01-12-safety-gateway-internalization, phase-02-persona-drift]

actuals:
  tokens: 31000
  tasks: 3
  commits: 3

tech-stack:
  added: ["zod（packages/prompts，与 apps/api 同版本 4.6.5，非新依赖）"]
  patterns:
    - "启动期断言接受一个被注入的配置副本（assertRouterInvariants(routes?)），使「断言在被违反时真的会失败」可以被测试证明，而不是只能靠人工临时改坏文件"
    - "两张互斥的 host 白名单（境内 / 仅合成）+ 一张网关黑名单，替代单张白名单 —— PLAT-06 与 PLAT-07 对同一个字段的要求方向相反"
    - "provider 实例的 baseURL 只从 git 里的 routes.ts 读，工厂不接受运行时覆盖"
    - "packages/llm 用窄 sink 上报告警，由 apps/api 的 logger 在模块加载时注册（logger 是所有入口都会加载的模块，注册在它里面则没有入口会漏掉）"
    - "prompt_version 取**系统提示词**的哈希而非拼装后整段文本的哈希；人格由 persona_version_id、逐轮输入由 input_hash 各自负责"
    - "CI 脚本的负向 fixture 做成一个 CLI 开关（--self-test），并把它接进 ci:fast，于是告警的非空真性质每个 PR 都被验证一次"

key-files:
  created:
    - packages/llm/src/routes.ts
    - packages/llm/src/pinnability.ts
    - packages/llm/src/hosts.ts
    - packages/llm/src/startup-assertions.ts
    - packages/llm/src/events.ts
    - packages/llm/src/providers/openai-compatible.ts
    - packages/llm/src/providers/ark.ts
    - packages/llm/src/providers/zhipu.ts
    - packages/llm/src/providers/index.ts
    - packages/prompts/src/registry.ts
    - packages/prompts/src/safety-classify.ts
    - tools/ci/model-snapshot-diff.mjs
    - tools/ci/llm-router-contract.test.ts
    - tools/ci/prompt-version.test.ts
    - tools/ci/type-fixtures/probe-routed.ts
    - compliance/model-snapshot-baseline.json
  modified:
    - packages/llm/src/types.ts
    - packages/llm/src/router.ts
    - packages/llm/src/providers/mock.ts
    - packages/prompts/src/version.ts
    - packages/prompts/src/chat-reply.ts
    - apps/api/src/index.ts
    - apps/api/src/obs/logger.ts
    - .github/workflows/nightly.yml
    - tools/ci/ci-workflow-guard.test.ts
    - tests/integration/tracer.test.ts
    - SKIPPED_CHECKS.md

key-decisions:
  - "provider 实例用 fetch 直连 git 写死的 baseURL，而不是引入 ai / @ai-sdk/*：仓库里没有任何 provider SDK，安装它在本项目是一次阻断式人工包合法性确认，而 Phase 1 的 LLM_PROVIDER_MODE 默认 mock —— 现在引入这条供应链依赖买不到任何东西。方向上它也更强：直连一个写死的 baseURL 在结构上没有「被默认路由到 AI Gateway」这个形态。"
  - "host 白名单拆成两张互斥的表。PLAN 写的是「白名单只含境内 host + mock 哨兵，且遍历每条 baseURL 必须在其中」，但 PLAT-07 同时要求存在一个境外的 chat.reply.frontier 条目 —— 两条要求在单张表上不可同时成立。境外 host 因此放进 SYNTHETIC_ONLY_HOSTS，并断言只有 frontier 角色可以用它、两张表不相交、且都不含已知网关 host。"
  - "chat.reply.frontier 从 CallMode 中整个移除（RESEARCH §5.1 只移除了 persona.probe）。于是境外通道的唯一入口是 callFrontier(readonly SyntheticText[])，「把真实用户原文发去境外」在编译期不可表达而不是运行时被拒。"
  - "alias-only 模型在 routed 模式下放行，但必须在 routes.ts 写下一条 aliasOnlyWaiver 理由（空 waiver ⇒ 拒绝启动）；pinned 模式一律拒绝。这让 Q4 的裁决（智谱 flash 标 alias-only 并用日 diff 补偿）成为一条有形的、可被下一个人读到的记录，而不是一个默认放行。"
  - "prompt_version 取系统提示词的哈希，不取拼装后整段文本的哈希。后者每一行 llm_call 都不重复，于是「当时生效的是哪一版提示词」反而答不出来 —— 而那正是 PLAT-08 要回答的问题。"
  - "promptVersion 归一化（统一行尾 + 去首尾空白），inputHash 刻意不归一化。两者判据不同：前者问「是不是同一版提示词」，后者问「是不是逐字节同一段输入」。前缀也因此不同（pv_ / sha256:），避免在日志里被混读。"
  - "llm.model_alias_resolved 的 sink 注册在 apps/api/src/obs/logger.ts 的模块尾部，而不是 index.ts：logger 是 apps/api 里唯一被所有入口（HTTP / WS / worker / 集成测试直接 import app.ts）加载的模块。注册在 index.ts 只覆盖生产进程，集成测试里这条告警会被静默丢掉。"

patterns-established:
  - "可证伪的启动期断言：断言函数接受被注入的配置，测试喂它改坏的副本以证明它会失败。通过一个正确的配置不能证明任何事。"
  - "CI 告警自带负向开关：--self-test 同时检查正反两个方向（人造新值必须报警、既有值必须不报警），并接进 ci:fast。"
  - "跨包告警上报用窄 sink + 在必经模块注册，而不是让 packages 反向依赖 apps。"

requirements-completed: [PLAT-03, PLAT-05, PLAT-06, PLAT-07, PLAT-08, SAFE-02]

coverage:
  - id: D1
    description: "ROUTES 为 6 个语义角色各自提供独立且字段齐全的配置；删掉任一键即启动失败"
    requirement: "PLAT-05"
    verification:
      - kind: unit
        ref: "tools/ci/llm-router-contract.test.ts#ROUTES 的键恰好是 6 个 SemanticRole"
        status: pass
      - kind: unit
        ref: "tools/ci/llm-router-contract.test.ts#删掉任一角色后启动期断言必须抛错"
        status: pass
    human_judgment: false
  - id: D2
    description: "三条启动期断言（模型分离 / alias-only 禁降级 / host 白名单）在 apps/api 启动第一步执行，且每条都有被改坏的配置副本证明它会失败"
    requirement: "SAFE-02"
    verification:
      - kind: unit
        ref: "tools/ci/llm-router-contract.test.ts#SAFE-02：危机判定由与扮演角色不同的模型、不同厂商执行"
        status: pass
      - kind: unit
        ref: "tools/ci/llm-router-contract.test.ts#PLAT-06 第三层：baseURL host 白名单"
        status: pass
      - kind: other
        ref: "grep -n assertRouterInvariants apps/api/src/index.ts -> 32 行，早于 startWorker(37) 与 serve/listen(48)"
        status: pass
    human_judgment: false
  - id: D3
    description: "PINNABLE 是手写显式表；智谱 flash 标 alias-only（Q4），文件内不出现任何模式匹配 API"
    requirement: "PLAT-03"
    verification:
      - kind: unit
        ref: "tools/ci/llm-router-contract.test.ts#PLAT-03：可 pin 性是显式表，不是推断"
        status: pass
      - kind: manual_procedural
        ref: "把该行临时改成 snapshot -> 契约测试 3 条变红；反向 Edit 还原后 32 条全绿，git diff 干净"
        status: pass
    human_judgment: false
  - id: D4
    description: "persona.probe 不可为 routed、真实用户原文不可传入 callFrontier —— 两条都在编译期不可表达"
    requirement: "PLAT-07"
    verification:
      - kind: unit
        ref: "tools/ci/llm-router-contract.test.ts#tools/ci/type-fixtures/probe-routed.ts 必须让 tsc 报出至少 2 条 error TS"
        status: pass
      - kind: unit
        ref: "tools/ci/type-fixture-negative.test.ts#对 tools/ci/type-fixtures 跑 tsc 必须失败"
        status: pass
    human_judgment: false
  - id: D5
    description: "llm_call 分列记录 requested_model / model_snapshot / resolved_model，并落非空 price_tier"
    verification:
      - kind: integration
        ref: "tests/integration/tracer.test.ts#(5)(6)(7)(8) 发一条消息"
        status: pass
      - kind: unit
        ref: "tools/ci/llm-router-contract.test.ts#计价档位：分段计费的边界两侧各一次"
        status: pass
    human_judgment: false
  - id: D6
    description: "resolved_model 与 requested_model 不一致时发一条 warn 事件，且事件不含任何对话内容"
    verification:
      - kind: unit
        ref: "tools/ci/llm-router-contract.test.ts#用 mock provider 构造一次不一致的回传 ⇒ 一条 warn 事件，字段只有三个"
        status: pass
    human_judgment: false
  - id: D7
    description: "resolved_model 日 diff 告警（脚本 + 人工确认基线 + nightly 直接调用）"
    verification:
      - kind: unit
        ref: "tools/ci/llm-router-contract.test.ts#resolved_model 日 diff：告警本身不是空真的"
        status: pass
      - kind: manual_procedural
        ref: "DATABASE_URL=<dev> node tools/ci/model-snapshot-diff.mjs -> 查到 llm_call 表、0 行、退出 0"
        status: pass
    human_judgment: true
    rationale: "DRIFT 分支只在 --self-test 的人造输入上被证明过；「真实库里真的出现了一个新 resolved_model」这一次的端到端表现（nightly job 变红 + IM 告警投递）无法在本地验证 —— 仓库尚无 remote，三条 workflow 从未真实执行（SKIPPED_CHECKS 的 ci-workflows-never-executed）。"
  - id: D8
    description: "prompt_version 是归一化后的内容哈希，提示词真相源只在 git，注册表含两个 id"
    requirement: "PLAT-08"
    verification:
      - kind: unit
        ref: "tools/ci/prompt-version.test.ts#promptVersion 是内容哈希，不是手工递增的版本号"
        status: pass
      - kind: unit
        ref: "tools/ci/prompt-version.test.ts#真相源在 git：packages/prompts/src 不得从远端或数据库读提示词"
        status: pass
      - kind: integration
        ref: "tests/integration/tracer.test.ts# 落库的 prompt_version 与注册表值逐字相等"
        status: pass
    human_judgment: false
  - id: D9
    description: "safety.classify 的系统提示词不含任何角色名、人格描述或语体指令；输出契约由 zod 声明"
    verification:
      - kind: unit
        ref: "tools/ci/prompt-version.test.ts#SAFE-02：safety.classify 的提示词不含任何人格指令"
        status: pass
    human_judgment: true
    rationale: "「不含人格指令」这一条是关键词缺失断言，可自动判定；但这段提示词作为分类器**是否真的够敏感**只能由 Plan 08 的危机探针集（L6）回答，Phase 1 的 mock 分类器恒返回 none，所以判定质量此刻完全未被测量。"
  - id: D10
    description: "ark / zhipu 两个真实 provider 实例（境内 baseURL 写死在 git，不接受运行时覆盖）"
    requirement: "PLAT-06"
    verification:
      - kind: unit
        ref: "tools/ci/llm-router-contract.test.ts#每条 baseURL 的 host 都在白名单里"
        status: pass
    human_judgment: true
    rationale: "从未对真实 endpoint 发过一次请求：本机没有 ARK_API_KEY / ZHIPU_API_KEY，且 LLM_PROVIDER_MODE 默认 mock。回包解析（choices[0].message.content、usage、model 字段）与两家的实际回包形状是否一致，要到第一次 live 调用才会被验证。"

duration: 30 min
completed: 2026-09-27
status: complete
---

# Phase 01 Plan 05: Model Router 完备形态 Summary

**6 个语义角色的独立配置 + 手写 PINNABLE 表 + 四组启动期断言（完备性/模型分离/可 pin 性/host 白名单）+ requested/resolved 双列与 resolved_model 日 diff 告警 + 只接受 SyntheticText 的境外通道 + pv_ 内容哈希的提示词注册表**

## Performance

- **Duration:** 30 min
- **Started:** 2026-09-27T03:07:00Z
- **Completed:** 2026-09-27T03:37:00Z
- **Tasks:** 3
- **Files modified:** 35（含 pnpm-lock.yaml）

## Accomplishments

- **PLAT-05 不再有空洞。** ROUTES 从 5 条（缺 persona.probe）变成 6 条齐全配置，字段扩到 provider / requestedModel / modelSnapshot / baseURL / temperature / maxOutputTokens / thinkingMode / priceTierBoundaries / aliasOnlyWaiver / enabled。Phase 1 只启用 chat.reply 与 safety.classify，其余四条 `enabled: false` —— 调用未启用的角色会抛错，而不是静默换一个启用的角色。
- **SAFE-02 从「代码审查题」变成「进程起不来」。** `assertRouterInvariants()` 是 apps/api `main()` 的第一条语句（第 32 行，早于 startWorker 的 37 行与 serve 的 48 行），断言 safety.classify 与两个扮演角色既不同模型也不同厂商。
- **可 pin 性成为一张手写表，并如实记录了一次降级。** 01-04 的 `glm-4.7-flash: 'snapshot'` 是未核实的值；按 Q4 裁决改成 `alias-only`。随之而来的是三层处理：pinned 模式拒绝启动、routed 模式要求书面 waiver、nightly 日 diff 连续采样。SKIPPED_CHECKS.md 新增一行登记这条**强度降级**（不是存在性 skip），解除条件是智谱提供带日期的快照 ID。
- **PLAT-06 的第三层补位落地。** ESLint 规则挡不住「provider 实例本身指向网关」；现在有两张互斥的 host 表（境内 / 仅合成）加一张已知网关黑名单，启动期与 ci:fast 各遍历一次。
- **PLAT-07 提到了编译期。** `chat.reply.frontier` 从 CallMode 中移除，境外通道唯一入口是 `callFrontier(readonly SyntheticText[])`。负向 fixture `probe-routed.ts` 报出 3 条 error TS（探针走 routed 一条、string 传给 callFrontier 两条）。
- **厂商静默换模型有了连续采样。** requested / resolved 分列无条件落库（一致时也落，否则日 diff 在「还没换模型」的日子里无基线可建），不一致时发一条只含三个字段的 warn 事件；`model-snapshot-diff.mjs` 比对最近 24 小时的 distinct resolved_model 与人工基线，`--self-test` 是它自己的负向 fixture 且已接进 ci:fast。
- **PLAT-08 的归因链闭合。** `promptVersion` 改为 `pv_` + 16 位 hex（归一化后哈希），`PROMPTS` 注册表把两段系统提示词的 text 与 version 绑在一起，落库值与注册表值在集成测试里逐字比对。

## Task Commits

1. **Task 1: 6 个语义角色配置 + PINNABLE 显式表 + 三条启动期断言** — `dd894ba` (feat)
2. **Task 2: requested_model / resolved_model 双列 + 日 diff 告警脚本** — `24c0d7f` (feat)
3. **Task 3: prompt_version 内容哈希 + 提示词注册表** — `f7ebd6a` (feat)

## Files Created/Modified

- `packages/llm/src/routes.ts` — 6 个角色的路由表 + classifyHost + priceTierFor + boundariesForModel
- `packages/llm/src/pinnability.ts` — 手写可 pin 性表 + pinnabilityOf（未登记返回 undefined）
- `packages/llm/src/hosts.ts` — 境内白名单 / 仅合成白名单 / 网关黑名单 / hostOf
- `packages/llm/src/startup-assertions.ts` — assertRouterInvariants(routes?)，四组断言
- `packages/llm/src/events.ts` — llm.model_alias_resolved + 窄 sink
- `packages/llm/src/providers/{openai-compatible,ark,zhipu,index}.ts` — fetch 直连 + 懒构造 + 模式解析
- `packages/llm/src/router.ts` — dispatch 统一路径、price_tier 推导、别名告警、callFrontier
- `packages/llm/src/types.ts` — CallableRole（去掉 probe 与 frontier）、FrontierMessages、MODELS 只留 provider 归属
- `packages/prompts/src/{version,registry,safety-classify,chat-reply}.ts` — pv_ 哈希、注册表、zod 输出契约、系统提示词常量
- `apps/api/src/index.ts` — 启动第一步调用 assertRouterInvariants
- `apps/api/src/obs/logger.ts` — 白名单新增 purpose/requestedModel/resolvedModel + sink 注册
- `tools/ci/model-snapshot-diff.mjs` — 日 diff（--dry-run / --self-test）
- `tools/ci/{llm-router-contract,prompt-version}.test.ts` — 44 条契约断言
- `tools/ci/type-fixtures/probe-routed.ts` — 两条类型层约束的负向 fixture
- `compliance/model-snapshot-baseline.json` — 人工确认基线
- `.github/workflows/nightly.yml` — 占位改成直接调用 + job summary
- `SKIPPED_CHECKS.md` — 解除 nightly-model-snapshot-diff，新增 model-pinnability-glm-flash

## Decisions Made

见 frontmatter 的 `key-decisions`（7 条）。其中三条改变了 PLAN 的字面要求，理由都写在对应 commit message 与源码注释里：provider 用 fetch 而非 AI SDK、host 白名单拆成两张互斥表、prompt_version 取系统提示词哈希而非整段文本哈希。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] provider 实例用 fetch 直连，而不是 AI SDK 工厂**
- **Found during:** Task 1（providers/ark.ts / zhipu.ts）
- **Issue:** PLAN 要求「用 AI SDK 的 provider 实例工厂」，但仓库里没有安装 `ai` / `@ai-sdk/*` 任何一个包。安装 provider SDK 在本项目是一次**阻断式的人工包合法性确认**（Plan 02 的 checkpoint 协议），而 Phase 1 的 `LLM_PROVIDER_MODE` 默认 mock、不实际调用真实 provider。
- **Fix:** 新增 `providers/openai-compatible.ts`，用 `fetch` 对 routes.ts 里写死的 baseURL 发 OpenAI 兼容的 chat/completions 请求；ark.ts / zhipu.ts 各自懒构造一个实例。实例构造时即检查 host 白名单。
- **Files modified:** packages/llm/src/providers/{openai-compatible,ark,zhipu}.ts
- **Verification:** typecheck + lint 通过；host 检查由契约测试遍历；PLAT-06 的 model 字面量禁令不受影响（传的是变量）
- **Committed in:** dd894ba
- **备注:** 方向上这比传 provider 实例更强 —— 直连一个 git 写死的 baseURL 在结构上没有「被默认路由到 AI Gateway」这个形态。真正接 live 时（Plan 07/08 需要 generateObject 的结构化输出修复重试）再走一次包合法性 checkpoint，届时本文件是唯一需要替换的实现。

**2. [Rule 1 - Bug] host 白名单在 PLAN 的写法下自相矛盾，拆成两张互斥表**
- **Found during:** Task 1（hosts.ts / startup-assertions.ts）
- **Issue:** PLAN 要求「ALLOWED_LLM_HOSTS 只含火山方舟与智谱的境内 host 及 mock 哨兵」并「遍历 ROUTES 的每条 baseURL，host 必须在白名单内」。但 PLAT-07 同时要求存在一个境外的 `chat.reply.frontier` 条目，且 PLAT-05 不允许它留空洞 —— 两条要求在单张表上不可同时成立。照字面实现只有两种结果：把境外 host 放进境内白名单（等于把 T-05-01 降级成一次代码评审），或给 frontier 填一个假 baseURL（配置与它声明的模型不自洽）。
- **Fix:** 境外 host 放进独立的 `SYNTHETIC_ONLY_HOSTS`，断言改为「按角色分类」：只有 frontier 可以用仅合成 host，其余角色必须是境内 host，frontier 反过来不得指向境内 host；两张表必须不相交；两张表都不得与 `DENIED_LLM_HOSTS`（已知 AI 网关 host）相交。另加 `dashscope.aliyuncs.com`（persona.reflect 声明用 qwen，STACK §15.9）。
- **Files modified:** packages/llm/src/hosts.ts, packages/llm/src/startup-assertions.ts, packages/llm/src/routes.ts
- **Verification:** tools/ci/llm-router-contract.test.ts 的「PLAT-06 第三层」6 条断言，含三条改坏副本（非白名单 host、非 frontier 指向境外、frontier 指向境内）
- **Committed in:** dd894ba

**3. [Rule 1 - Bug] prompt_version 取系统提示词哈希，而非拼装后整段文本的哈希**
- **Found during:** Task 3（chat-reply.ts / safety-classify.ts）
- **Issue:** 01-04 的 `buildChatReplyPrompt` 把**拼装后整段文本**（含人格小传与本轮用户消息）的哈希作为 version。那样每一行 llm_call 的 prompt_version 都不相同，于是「当时生效的是哪一版提示词」这个问题答不出来 —— 而那正是 PLAT-08 存在的理由。
- **Fix:** 抽出 `CHAT_REPLY_SYSTEM_PROMPT` / `SAFETY_CLASSIFY_SYSTEM_PROMPT` 两个常量并各自导出一个模块级 version 常量，注册表复用同一个值（不重算，避免第二个计算点）。人格侧的版本由 `llm_call.persona_version_id` 负责，逐轮输入的同一性由 `input_hash` 负责，三者分工不重叠。
- **Files modified:** packages/prompts/src/{chat-reply,safety-classify,registry}.ts
- **Verification:** tools/ci/prompt-version.test.ts（12 条）+ tracer 集成断言「落库值 == 注册表值」
- **Committed in:** f7ebd6a

**4. [Rule 3 - Blocking] tools/ci/ci-workflow-guard.test.ts 的占位断言必须同时改**
- **Found during:** Task 2（nightly.yml）
- **Issue:** 该测试断言 nightly.yml 含 `[ -f tools/ci/model-snapshot-diff.mjs ]`。PLAN 要求把这个占位改成真实调用，两者直接冲突 —— 不改测试的话 Task 2 完成即让 ci:fast 变红。
- **Fix:** 把那条断言换成三条反向断言：占位分支**必须消失**（留着等于保留一条「将来文件被弄丢也照样绿」的路径）、脚本必须在磁盘上、nightly.yml 全文不得含任何容错开关；另加一条断言「脚本不含 writeFile/appendFile」与「基线文件在仓库里」。Plan 13 的 publicness-reconcile 占位断言原样保留。
- **Files modified:** tools/ci/ci-workflow-guard.test.ts
- **Verification:** ci:fast 全绿（8 条 workflow guard 断言）
- **Committed in:** 24c0d7f

**5. [Rule 3 - Blocking] tools/ci/type-fixtures/tsconfig.json 缺 allowImportingTsExtensions**
- **Found during:** Task 1（probe-routed.ts）
- **Issue:** 该项目未开这个开关，于是程序里每一条 `.ts` 后缀的 import 都报 TS5097。原先只有 4 条噪声（来自 @drift/contract）被 ≥3 条的阈值掩盖掉了；引入 `@drift/llm` 后噪声会淹没真正的违反，让「报错是否来自正确的原因」无法判定。
- **Fix:** 开启该开关（`noEmit: true` 已设，因此合法）。现在该项目恰好报 7 条错误，全部来自两个 fixture 文件的真实违反。
- **Files modified:** tools/ci/type-fixtures/tsconfig.json
- **Verification:** `tsc --noEmit -p tools/ci/type-fixtures/tsconfig.json` 输出 7 条 error TS，其中 probe-routed.ts 3 条；无任何 TS5097
- **Committed in:** dd894ba

**6. [Rule 2 - Missing Critical] apps/api 的日志白名单缺三个字段，且 sink 需要一个必经的注册点**
- **Found during:** Task 2（llm.model_alias_resolved）
- **Issue:** `LOG_ALLOWED_FIELDS` 没有 purpose / requestedModel / resolvedModel，告警事件在编译期就过不去。另外 packages/llm 不能反向依赖 apps/api 的 logger。
- **Fix:** 三个字段加进白名单（都是模型标识与角色枚举，不可反推自然人）；packages/llm 暴露一个窄 sink，由 `apps/api/src/obs/logger.ts` 在模块加载时注册 —— 它是 apps/api 里唯一被所有入口加载的模块，注册在 index.ts 只覆盖生产进程、集成测试里会静默丢掉这条告警。
- **Files modified:** apps/api/src/obs/logger.ts, packages/llm/src/events.ts
- **Verification:** 契约测试断言事件字段恰好三个且序列化后不含正文任何 6 字子串
- **Committed in:** dd894ba（白名单与 sink）/ 24c0d7f（告警语义）

**7. [Rule 3 - Blocking] 依赖接线：root devDependencies 与 packages 的 workspace 链接**
- **Found during:** Task 1 / Task 3
- **Issue:** `tools/ci` 与 type fixture 需要 import `@drift/llm`，但 root node_modules 没有它的链接（root devDependencies 只列了 contract/db/safety）；packages/llm 需要 `@drift/contract`（SyntheticText）；packages/prompts 需要 zod（输出契约）。
- **Fix:** root devDependencies 加 @drift/llm 与 @drift/prompts；packages/llm 加 @drift/contract 依赖与 tsconfig reference；packages/prompts 加 zod 4.6.5（与 apps/api 同版本，非新依赖，pnpm store 已有）。
- **Files modified:** package.json, packages/llm/package.json, packages/llm/tsconfig.json, packages/prompts/package.json, pnpm-lock.yaml
- **Verification:** `pnpm install --prefer-offline` 无网络下载（reused 441, downloaded 0）；typecheck 通过
- **Committed in:** dd894ba（三处 package.json 与 lockfile 同一 commit —— 拆开会让中间那个 commit 的 lockfile 与 package.json 不一致，`--frozen-lockfile` 在那一点上会失败）

**8. [Rule 1 - Bug] 验证命令从 `tsc --noEmit -p` 改为 `tsc --build`**
- **Found during:** 全程
- **Issue:** PLAN 的 `<verify>` 写的是 `pnpm -w exec tsc --noEmit -p tsconfig.json`。01-02 已实测该命令在带 project references 的根配置下是空真检查（被引用项目拥有的源文件整体被剔出 program，故意注入类型错误仍退出 0）。
- **Fix:** 改用 `pnpm run typecheck`（= `tsc --build tsconfig.json`）。
- **Verification:** 执行过程中真实捕获到 4 个编译错误（providers 的相对路径写错 3 条、懒实例收窄 1 条），证明它不是空真的。
- **Committed in:** 不涉及文件改动（编排器 handoff #1 已记此事）

---

**Total deviations:** 8 auto-fixed（3 条 Rule 1 修正 / 1 条 Rule 2 补缺 / 4 条 Rule 3 阻断解除）
**Impact on plan:** 没有范围扩张。三条 Rule 1 都是 PLAN 内部或前序产物里的实际错误（单张 host 白名单不可同时满足 PLAT-06 与 PLAT-07；prompt_version 取整段哈希使 PLAT-08 失效；`--noEmit -p` 是空真门禁），修正方向一律是加强而非放宽。唯一的强度**降级**是 `glm-4.7-flash` 从（未核实的）snapshot 改成 alias-only —— 那不是新引入的弱点，而是把一个一直存在的弱点如实登记了下来，并配上了三层补偿。

## Issues Encountered

- **`instance ??= factory(); return instance;` 在模块级 `let` 上不收窄。** TS 认为闭包可能改动它，于是返回类型仍是 `Provider | undefined`。改成显式的 `const existing = instance; if (existing !== undefined) return existing;`。
- **本机没有 psql，也没有为日 diff 引入新依赖的余地。** 脚本改为**动态** import 仓库既有的 postgres.js（packages/db 用的同一个包），于是 `--dry-run` 与 `--self-test` 两条路径完全不依赖任何 npm 包与数据库，只有真实比对那一条路径才加载驱动。已对开发库真实跑过一次（查到 llm_call 表、0 行、退出 0）。
- **日 diff 的 DRIFT 分支没有在真实库上被触发过。** 制造它需要往开发库的 append-only 审计表里插入再删除一行；`--self-test` 用的是同一个 `diff()` 函数，所以比较器本身已被证明，但端到端（nightly 变红 + IM 投递）仍未验证。已记入 coverage 的 D7（human_judgment: true）。

## User Setup Required

None —— 本 plan 未引入任何需要人工配置的外部服务。`ARK_API_KEY` / `ZHIPU_API_KEY` 只在 `LLM_PROVIDER_MODE=live` 时才需要，Phase 1 默认 mock；缺失时 provider 显式抛错而不是回落。

## Next Phase Readiness

**已就绪供后续 plan 消费：**
- Plan 06（egress 注册表）：`ALLOWED_LLM_HOSTS` / `SYNTHETIC_ONLY_HOSTS` / `DENIED_LLM_HOSTS` 三张表与 `hostOf` / `classifyHost` 可直接作为出口注册表的 host 维度，**不要另起一份**。
- Plan 07（危机干预）：SAFE-02 的 SQL 断言所需四列（turn_id / purpose / model_snapshot / resolved_model）已全部落库且非空；`SafetyClassifyOutput` zod 契约与 `SAFETY_HIT_CATEGORIES` 已定，解析失败即 `classifierStatus: 'failed'` 的 fail-closed 语义在 packages/safety 侧已就位。
- Plan 08（危机探针集）：`persona.probe` 只能经 `{ mode: 'pinned', modelSnapshot }`，且启动期已断言它声明的模型是 snapshot。探针的固定温度 0 与 maxOutputTokens 取自 `ROUTES['persona.probe']`。
- Plan 12（网关内化）：`conversationStatus` 仍由调用方传入（handoff #18 未解除，本 plan 未触及）。

**留给后续的三件事（都不是阻塞项）：**
1. `packages/llm/src/providers/openai-compatible.ts` 的回包解析从未对真实 endpoint 验证过。第一次 live 调用前应先用一次最小请求核对 `choices[0].message.content` / `usage.prompt_tokens_details.cached_tokens` / `model` 三个字段在两家的实际形状。
2. 四个 `enabled: false` 的角色（frontier / reflect / probe / memory.extract）的 `priceTierBoundaries` 是空数组 —— 刻意不猜边界（猜错比没有更糟，因为成本表会看起来是对的）。启用前需要填入各家的实际分段。
3. `compliance/model-snapshot-baseline.json` 目前只有两个启用角色的期望值。nightly 第一次真实跑起来（需要 remote + self-hosted runner）之前，这条告警的投递链路仍未被验证。

---
*Phase: 01-compliance-safety-chat-skeleton*
*Completed: 2026-09-27*
