---
phase: 01-compliance-safety-chat-skeleton
plan: 06
subsystem: safety
tags: [branded-types, eslint, typescript-compiler-api, egress-registry, compliance, wecom-webhook]

requires:
  - phase: 01-04
    provides: "safetyGateway 的前身（三条 fail-closed 行为里的两条）、GatedText 的两个出口签名、message/safety_event 表"
  - phase: 01-05
    provides: "Model Router 与 safety.classify 的输出契约（confidence 字段），mock provider 恒返回 level none + confidence 0.99"
provides:
  - "EGRESS_POINTS 出口注册表（4 项）+ 集合相等断言 —— 堵住 branded type 方案唯一的结构性缺口"
  - "三个负向 fixture 证明三层出口防线各自非空真（未登记出口 / any 穿透 / GatedText 逃逸）"
  - "COMPLY-11 的显式空集登记 + egress_hash 绑定（出口集合变化机械地要求一次人工复核）"
  - "网关第四条不可协商行为：挽留话术运行时拦截 + safety_event 留证"
  - "parseClassification 覆盖 SAFE-05 的第三类失败（置信度低于阈值）"
  - "AcuteAlert（5 字段，编译期字段清单断言）+ notifyOperator，第四个出口不含对话文本"
  - "renderExportLine —— 第三个出口的签名与最小实现（Plan 11 填内容）"
affects: [01-07, 01-08, 01-10, 01-11, 01-12, 01-13]

actuals:
  tokens: 62000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "注册表 + AST 集合相等：类型系统管不到的「本该是 X 却写成了 Y」，用注册表与扫描结果的集合相等来管"
    - "破坏验证写成测试内注入（handoff #28）：diffEgress / checkEgressHash 都接受注入参数，于是「改坏会红」每个 PR 都跑"
    - "必填 sink：packages/safety 不连库，留证动作由调用方在事务里做，但 sink 是必填字段而非可选项"
    - "零依赖叶子模块：alert.ts 不 import env/logger，否则 L4 断言无法在不带凭据的 ci:fast 里跑"

key-files:
  created:
    - packages/safety/src/egress.ts
    - packages/safety/src/retention-words.ts
    - packages/safety/src/retention-words.test.ts
    - packages/safety/src/gateway.test.ts
    - apps/api/src/modules/safety/alert.ts
    - apps/api/src/modules/export/render.ts
    - compliance/no-unlabeled-output.md
    - tools/ci/egress-registry.test.ts
    - tools/ci/egress-hash.mjs
    - tools/ci/fixtures/unregistered-egress.ts
    - tools/ci/fixtures/any-into-egress.ts
    - tools/ci/fixtures/tsconfig.json
  modified:
    - packages/safety/src/gateway.ts
    - packages/safety/src/index.ts
    - packages/safety/tsconfig.json
    - apps/api/src/modules/chat/turn.ts
    - tests/integration/tracer.test.ts
    - tools/ci/type-fixtures/gated-text-escape.ts
    - tools/ci/type-fixture-negative.test.ts
    - eslint.config.js
    - .github/workflows/fast.yml

key-decisions:
  - "网关的拒绝态沿用 Plan 04 已发布的 outcome 判别式（gated / escalated / refused + reason），不改成 PLAN 写的 ok:false —— 两个判别式会互相矛盾"
  - "判定顺序固定为 会话状态 → 风险等级 → 挽留词表：一次真实 crisis 不得被一条文案问题掩盖"
  - "挽留匹配的归一化去掉标点与零宽字符，接受极少数过拦截（角色该轮不说话）以换取触发率恒为 0"
  - "SAFETY_CONFIDENCE_FLOOR = 0.5，且缺失/越界的 confidence 一并算 failed"
  - "recordSafetyEvent 是 GatewayInput 的必填字段（可选 sink 等于把留证变成调用方的选择题）"
  - "alert.ts 零依赖：不 import config/env.ts 与 obs/logger.ts，投递结果与日志都交给调用方"
  - "egress 哈希比对只有一份实现（egress-hash.mjs）：fast.yml 跑它的 CLI，vitest 用 spawn 驱动同一个 CLI"
  - "escalated 分支的 safety_event 留给 Plan 07（它还要写 session_risk_state 与 contact_attempt），本 plan 只在挽留拦截时写"

patterns-established:
  - "注册表层：类型系统的结构性缺口用「注册表 + AST 集合相等 + 未登记负向 fixture」三件套堵"
  - "合规登记与代码的机械绑定：front-matter 哈希 + 不许自动更新 + 失败信息里直接写复核指引"
  - "失配信息必须分类：一句「集合不相等」分不清该登记新出口还是该修出口签名，而两者修法相反"

requirements-completed: [COMPLY-09, COMPLY-11, SAFE-01, PLAT-06]

coverage:
  - id: D1
    description: "EGRESS_POINTS 注册表（4 项）与 AST 扫描结果的集合相等断言，失配分两类列出"
    requirement: "SAFE-01"
    verification:
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#生产源码扫描结果与注册表集合相等"
        status: pass
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#扫描器真的看得见 GatedText —— 三个出口都被扫到（防止恒返回空集的空真通过）"
        status: pass
    human_judgment: false
  - id: D2
    description: "负向 fixture：未登记的 GatedText 出口让集合相等变红，错误信息点名 sendSomewhereElse（V.0 #3）"
    requirement: "SAFE-01"
    verification:
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#把未登记的负向 fixture 纳入扫描后，集合相等失败且错误信息点名 sendSomewhereElse"
        status: pass
    human_judgment: false
  - id: D3
    description: "负向 fixture：any 穿过接受 GatedText 的出口被 no-unsafe-argument 抓到（V.0 #2）"
    requirement: "PLAT-06"
    verification:
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#对 any-into-egress.ts 跑 eslint 必须报出 no-unsafe-argument"
        status: pass
    human_judgment: false
  - id: D4
    description: "出口签名从 GatedText 改回 string 时失配信息归类到「注册表中已不存在的项」（注入式 + 一次真实改文件破坏验证）"
    requirement: "SAFE-01"
    verification:
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#某个出口的参数从 GatedText 改回 string 时，失配信息把它归到「注册表中已不存在的项」"
        status: pass
      - kind: manual_procedural
        ref: "临时把 apps/api/src/ws/server.ts 的 deliver 参数改成 string，测试报「注册表中已不存在的项: ws.deliver (apps/api/src/ws/server.ts::deliver)」，随后还原（git diff 干净）"
        status: pass
    human_judgment: false
  - id: D5
    description: "COMPLY-11 显式空集登记，front-matter 的 egress_hash 与 EGRESS_POINTS 绑定，脚本不得自动改写登记"
    requirement: "COMPLY-11"
    verification:
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#--check 与登记文件一致（出口集合没变 ⇒ 不要求重新复核）"
        status: pass
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#给注册表加一项而不改 egress_hash ⇒ 变红，且错误信息含「未重新复核」"
        status: pass
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#哈希脚本不得自动改写登记文件（自动更新会绕过人工复核动作）"
        status: pass
    human_judgment: false
  - id: D6
    description: "登记文件正文逐条核实四条对外提供路径（三条「带标识」+ acute 告警「不构成对外提供生成内容」），含空集结论与《标识办法》第九条引注"
    requirement: "COMPLY-11"
    verification:
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#登记文件的 front-matter 三个键齐全，正文含空集结论与第九条引注"
        status: pass
    human_judgment: true
    rationale: "结构可断言（四个出口 id 逐一出现、含「空集」与「第九条」），但「这条判据在法律上是否成立」是法务判断，机器只能证明它被写下来且与当前出口集合同步"
  - id: D7
    description: "网关 fail-closed：classifierStatus failed ⇒ level 恒为 elevated（三类失败输入各一条），会话 ended ⇒ 不产出 GatedText"
    requirement: "SAFE-01"
    verification:
      - kind: unit
        ref: "packages/safety/src/gateway.test.ts#SAFE-05：classifierStatus 为 failed 时 level 恒为 elevated"
        status: pass
      - kind: unit
        ref: "packages/safety/src/gateway.test.ts#COMPLY-05：会话 ended ⇒ 拒绝产出 GatedText（fail-closed）"
        status: pass
      - kind: integration
        ref: "tests/integration/tracer.test.ts（9 用例，含 GatedText 唯一产出点的使用证明）"
        status: pass
    human_judgment: false
  - id: D8
    description: "挽留话术运行时拦截：七个词各一条阳性 + 三条阴性，命中即不产出 GatedText 并写一条只含哈希与长度的 safety_event"
    requirement: "SAFE-01"
    verification:
      - kind: unit
        ref: "packages/safety/src/gateway.test.ts#COMPLY-05 / R1.33：挽留话术出站触发率恒为 0"
        status: pass
      - kind: unit
        ref: "packages/safety/src/retention-words.test.ts#hitsRetentionPhrase"
        status: pass
      - kind: unit
        ref: "packages/safety/src/retention-words.test.ts#全仓库只有一处定义（复制成第二份之后两处会分叉，而分叉那天不会有检查变红）"
        status: pass
    human_judgment: false
  - id: D9
    description: "acute 告警载荷不含对话文本：特征串走完 acute 流程，webhook 载荷无任何 6 字以上子串泄漏；AcuteAlert 恰好 5 字段且类型体无文本字段"
    requirement: "COMPLY-09"
    verification:
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#走完 acute 流程到 notifyOperator 的载荷构造点，载荷不含触发消息的任何 6 字以上子串"
        status: pass
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#子串检查器自身有效 —— 一个故意泄漏的载荷必须被抓到（防止空真通过）"
        status: pass
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#AcuteAlert 恰好五个字段，类型体里不存在任何对话文本字段"
        status: pass
    human_judgment: false
  - id: D10
    description: "出站标识由消息管道统一注入且有 DB CHECK 兜底；renderExportLine 注入 [AI] 前缀（COMPLY-09 / COMPLY-02 的第四处落点）"
    requirement: "COMPLY-09"
    verification:
      - kind: integration
        ref: "tools/ci/schema-drift.test.ts#assert-no-drift 通过（disclosure 的 CHECK 约束在库里且与 schema 一致）"
        status: pass
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#每一项的 module 都在磁盘上，且该文件里出现了这个 fn 名"
        status: pass
    human_judgment: true
    rationale: "导出管道的文件头三行元数据与 .json 形态在 Plan 11 才落地，本 plan 只交付 renderExportLine 的签名与最小实现 —— 「标识随导出文件存活」这条最终要人看一份真实导出文件"
  - id: D11
    description: "三层出口防线之一：全仓 as GatedText 只出现在 packages/safety/src/gateway.ts，且无任何调用点用非空断言跳过网关返回值的收窄"
    requirement: "SAFE-01"
    verification:
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#全仓 as GatedText 只命中 packages/safety/src/gateway.ts"
        status: pass
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts#没有任何调用点用非空断言跳过网关返回值的收窄"
        status: pass
      - kind: unit
        ref: "tools/ci/type-fixture-negative.test.ts#对 tools/ci/type-fixtures 跑 tsc 必须失败，且至少 4 条 error TS"
        status: pass
    human_judgment: false

duration: 51 min
completed: 2026-09-27
status: complete
---

# Phase 01 Plan 06: 出站出口的三层执行拓扑 Summary

**EGRESS_POINTS 注册表 + TypeScript compiler API 的集合相等断言堵住了 branded type 方案唯一的结构性缺口（新增出口接受 string 不报错），三个负向 fixture 证明编译期/lint/注册表三层各自非空真，COMPLY-11 以显式空集登记并由 egress_hash 绑定到出口集合，网关补上挽留话术运行时拦截与置信度 fail-closed，acute 告警作为第四个出口被证明载荷里没有任何对话片段。**

## Performance

- **Duration:** 51 min
- **Started:** 2026-09-27T04:00:40Z
- **Completed:** 2026-09-27T04:52:00Z
- **Tasks:** 3
- **Files modified:** 21（12 新建 / 9 修改，+1710 −13）

## Accomplishments

- **注册表层堵住了唯一的结构性缺口。** `tools/ci/egress-registry.test.ts` 用 typescript compiler API 扫全仓（含 `apps/web`）取出所有「参数类型解析后含 `GatedText`」的导出函数，与 `EGRESS_POINTS` 中 `carriesUserText !== false` 的项做集合相等。检测靠的是 TS 给 unique symbol 成员生成的 `__@GATED` 属性前缀而不是别名叫什么 —— 换个名字重新导出照样被抓到。
- **三层防线各自有负向 fixture，且每一条的失败方向都被真的跑过一次。** 「多一项会红」由 `unregistered-egress.ts` 证明；「少一项会红」由注入式 `diffEgress` 用例证明，并额外做了一次真实改文件的破坏验证（把 `deliver` 的参数改成 `string`，测试报出「注册表中已不存在的项: ws.deliver」后还原）；「`any` 穿不过」由 `any-into-egress.ts` + 为它单开的 type-aware eslint 块证明。
- **COMPLY-11 从一句结论变成一次会失败的检查。** `compliance/no-unlabeled-output.md` 逐条核实四条对外提供路径，front-matter 的 `egress_hash` 与 `EGRESS_POINTS` 的规范化 sha256 绑定；`egress-hash.mjs` 不含任何 fs 写入 API，失败信息里直接写着复核指引与更新命令。
- **挽留话术触发率恒为 0 有了运行时执行点。** 七个词一份定义（`RETENTION_PHRASES`），归一化去掉空白、零宽字符与标点，命中即不产出 `GatedText` 并写一条只含哈希与长度的 `safety_event`。七个阳性 + 三个阴性 + 三种变形体（空格/逗号/零宽）全部有用例。
- **acute 告警被证明不携带对话文本。** `AcuteAlert` 五个字段配一条编译期字段清单断言（加字段不改清单即 tsc 报错），运行时再用一段特征串走完 acute 流程，断言 webhook 载荷不含任何 6 字以上子串 —— 并先证明那个子串检查器本身抓得到一个故意泄漏的载荷。
- **SAFE-05 的第三类失败被补上。** `parseClassification` 原先完全忽略 `confidence`，而分类器输出契约里它是必填。现在缺失、越界、低于 `SAFETY_CONFIDENCE_FLOOR`（0.5）一律算 `failed` ⇒ fail-closed 到 `elevated`。

## Task Commits

1. **Task 1: EGRESS_POINTS 注册表 + 集合相等断言 + 两个负向 fixture** — `d187ec4` (feat)
2. **Task 2: COMPLY-11 显式空集登记 + egress_hash 绑定** — `1de59ce` (feat)
3. **Task 3: 网关 fail-closed + 挽留拦截 + acute 告警载荷无对话文本** — `297cbd8` (feat)

## Files Created/Modified

- `packages/safety/src/egress.ts` — `EGRESS_POINTS`（4 项）+ `TEXT_CARRYING_EGRESS_POINTS`。刻意零 import，让 `egress-hash.mjs` 能靠 Node 的类型擦除直接加载它。
- `packages/safety/src/retention-words.ts` — 七个挽留词的唯一定义处 + `normalizeForRetentionMatch` / `hitsRetentionPhrase`。
- `packages/safety/src/gateway.ts` — `safetyGateway` 改 async；新增必填 `recordSafetyEvent`、`retention_phrase` 拒绝态、`SafetyEventDraft`；`parseClassification` 覆盖置信度失败。
- `apps/api/src/modules/safety/alert.ts` — `AcuteAlert`（5 字段）、`notifyOperator`、`renderAlertContent`、`buildWecomPayload`。零依赖（不 import env/logger）。
- `apps/api/src/modules/export/render.ts` — `renderExportLine(text: GatedText, meta)` + `EXPORT_AI_PREFIX`，第三个出口的签名先定。
- `compliance/no-unlabeled-output.md` — COMPLY-11 的显式空集登记，含复核触发条件与三步人工更新流程。
- `tools/ci/egress-hash.mjs` — 规范化 sha256，`--print` / `--check [expected]`，全仓唯一一份哈希实现。
- `tools/ci/egress-registry.test.ts` — 20 个用例，三条绑定断言 + 三层防线的负向证明。
- `tools/ci/fixtures/{unregistered-egress,any-into-egress}.ts` + `tools/ci/fixtures/tsconfig.json` — 两个负向 fixture 与为 any fixture 单配的 program。
- `eslint.config.js` — 为 `any-into-egress.ts` 单开 type-aware 块（同目录其他 fixture 关着 type-aware，沿用那份配置会让这个 fixture 永远绿）。
- `.github/workflows/fast.yml` — `node tools/ci/egress-hash.mjs --check` 独立一步。
- `apps/api/src/modules/chat/turn.ts` / `tests/integration/tracer.test.ts` — 跟上 `await` + `recordSafetyEvent`。
- `tools/ci/type-fixtures/gated-text-escape.ts` / `type-fixture-negative.test.ts` — 追加两处 `satisfies` 违反，负向阈值 3 → 4。
- `packages/safety/tsconfig.json` — 补 `types: [node]`（网关要 `node:crypto`）。

## Decisions Made

见 front-matter 的 `key-decisions`。其中三条值得单独说明：

1. **拒绝态的判别式沿用 `outcome` 而不是 PLAN 写的 `ok: false`。** Plan 04 已经发布了 `outcome: 'gated' | 'escalated' | 'refused'` 这个判别式并有调用点依赖它。再加一个 `ok` 布尔等于让同一个值有两个判别式，它们可以互相矛盾（`ok: true` + `outcome: 'refused'`），而「不可表达」正是这套类型方案的全部价值。PLAN 的 `<output>` 段与 Plan 04 的既有形状本身就是冲突的，这里取既有形状。
2. **`fast.yml` 里只有一处 egress 哈希比对，而它与 `ci:fast` 里那条断言共用同一个 CLI。** PLAN 要求「二者取其一，不要两处实现」。这里的解法是一份实现两个调用点：`egress-hash.mjs` 是唯一算法，`fast.yml` 跑它的 `--check`，`egress-registry.test.ts` 用 `spawnSync` 驱动同一个 CLI（而不是在测试里重写一遍比对）。之所以两个调用点都要：`ci-workflows-never-executed` 这条 skip 仍然在册（本仓库还没接远端），把唯一的检查只放进 workflow 等于它从未运行过。
3. **escalated 分支不在本 plan 写 `safety_event`。** 那次写入要与 `session_risk_state` / `contact_attempt` 同一事务（Plan 07），在这里先写一半会让 Plan 07 面对「有的行已经写了、有的没写」。本 plan 只在挽留拦截时写 —— 那是本 plan 自己引入的判定。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `parseClassification` 完全忽略 `confidence`，SAFE-05 的第三类失败不存在**
- **Found during:** Task 3（写 fail-closed 的三条失败输入用例时）
- **Issue:** RESEARCH §4.3 要求三类分类器失败全部映射到 `elevated`，第三类是「置信度低于阈值」。`SafetyClassifyOutput` 契约里 `confidence` 是必填，但 `parseClassification` 只校验 `level` —— 于是一个 `confidence: 0.1` 的判定与一个 `confidence: 0.99` 的判定被同等对待，而缺失 `confidence` 被当成「满信心」。那是 fail-open。
- **Fix:** 新增 `SAFETY_CONFIDENCE_FLOOR = 0.5`；`confidence` 缺失、非数、越界（<0 或 >1）、低于下限一律返回 `{ classifierStatus: 'failed' }`。阈值取 0.5 的理由写在常量的 doc 上，并注明调整它需要 Plan 08 的探针实测分布作为依据。
- **Files modified:** `packages/safety/src/gateway.ts`、`packages/safety/src/gateway.test.ts`
- **Verification:** 6 条 `parseClassification` 用例（含阈值边界：恰好等于下限算通过）+ 三类失败各一条 gateway 用例
- **Committed in:** `297cbd8`

**2. [Rule 3 - Blocking] `alert.ts` 若 import `obs/logger.ts`，第三条绑定断言在 ci:fast 里根本跑不起来**
- **Found during:** Task 3
- **Issue:** PLAN 的 `<read_first>` 指向 `apps/api/src/obs/logger.ts`（白名单式 `logEvent`），而 logger 静态 import `config/env.ts`，后者在**模块加载时**校验环境变量并 `process.exit(1)`。第三条绑定断言住在 L4 契约层，而 fast workflow 的第一条约束就是不引用任何 `WECOM_` / `LLM_` 前缀的 secret —— 一旦 `alert.ts` 拖进 env，那条断言要么跑不起来，要么被迫挪出 ci:fast。
- **Fix:** `alert.ts` 做成零依赖叶子模块：webhook URL 与 `fetch` 实现都从 `AlertTransport` 参数进来，投递结果如实返回给调用方（Plan 07 的状态机本来就要这个返回值），日志由调用方按白名单字段记。
- **Files modified:** `apps/api/src/modules/safety/alert.ts`
- **Verification:** `tools/ci/egress-registry.test.ts` 的第三条绑定断言在 `ci:fast` 里通过，全程不出网、不读 env
- **Committed in:** `297cbd8`

**3. [Rule 3 - Blocking] `eslint.config.js` 的 fixtures 块把 type-aware 规则关掉了，`any` 负向 fixture 会永远是绿的**
- **Found during:** Task 1
- **Issue:** PLAN 的 `<files>` 不含 `eslint.config.js`。但 Plan 02 为 `tools/ci/fixtures/**/*.ts` 设了 `projectService: false` 并把四条 `no-unsafe-*` 设成 `off`（那些 fixture 不属于任何 tsconfig）。`no-unsafe-argument` **只有 type-aware 才会被求值**，沿用那份配置意味着 V.0 #2 这个 fixture 无论写成什么样都不会报错 —— 一个恒绿的负向 fixture 比没有 fixture 更糟，因为它看起来像一条防线。
- **Fix:** 新增 `tools/ci/fixtures/tsconfig.json`（只 include `any-into-egress.ts`）与一个位于 fixtures 块**之后**的 eslint 块，在其中重新打开四条规则并 spread `REQUIRED_RESTRICTED_SYNTAX`（不 spread 会静默删掉仓库级禁令）。
- **Files modified:** `eslint.config.js`、`tools/ci/fixtures/tsconfig.json`
- **Verification:** `eslint tools/ci/fixtures/any-into-egress.ts --no-ignore` 报出 `no-unsafe-assignment` + `no-unsafe-argument` 并非零退出；`eslint-config-meta.test.ts` 的 19 条元测试仍全绿（新块只作用于那一个文件）
- **Committed in:** `d187ec4`

**4. [Rule 3 - Blocking] `packages/safety/tsconfig.json` 缺 `types: [node]`，网关用不了 `node:crypto`**
- **Found during:** Task 3
- **Issue:** 候选回复哈希要 `createHash`，而该包的 tsconfig 没有 `types` 字段，`tsc --build` 报 TS2591。
- **Fix:** 加 `"types": ["node"]`。
- **Files modified:** `packages/safety/tsconfig.json`
- **Verification:** `pnpm run typecheck`（`tsc --build`）退出 0
- **Committed in:** `297cbd8`

**5. [Rule 1 - Bug] `turn.ts` 与 `tracer.test.ts` 的网关调用点在网关改 async 后全部失配**
- **Found during:** Task 3
- **Issue:** `safetyGateway` 变成 async 且新增必填 `recordSafetyEvent`，两个调用点共 15 条 tsc 报错（`Property 'outcome' does not exist on type 'Promise<GatedResult>'` 一类）。`turn.ts` 不在 PLAN 的 `files_modified` 里。
- **Fix:** `turn.ts` 补 `await` 与一个在自己短事务里写 `safety_event` 的 sink（事务边界与 `llm_call` 同理：崩溃只可能留下「有审计行、没有消息」）；`TurnResult` 的 refused 分支扩宽到 `'conversation_ended' | 'retention_phrase'`；`tracer.test.ts` 传一个「被调用即抛错」的 sink（比传空函数更诚实 —— 那条候选文本本来就不该触发留证）。
- **Files modified:** `apps/api/src/modules/chat/turn.ts`、`tests/integration/tracer.test.ts`
- **Verification:** `pnpm run typecheck` 退出 0；L5 集成层 28 个用例全绿（tracer 9 + schema-drift 19）
- **Committed in:** `297cbd8`

**6. [Rule 2 - Missing Critical] `type-fixture-negative.test.ts` 的报错数阈值停在 3，与本 plan 的验收标准（>= 4）不一致**
- **Found during:** Task 1
- **Issue:** 该文件不在 PLAN 的 `files_modified` 里。但本 plan 给 `gated-text-escape.ts` 追加了两处 `satisfies` 违反（共 6 条报错），而守着它的测试仍然只要求 >= 3 —— 于是「少掉一半报错源」是一条不会变红的路。
- **Fix:** 阈值 3 → 4，并在注释里写明为什么抬。
- **Files modified:** `tools/ci/type-fixture-negative.test.ts`
- **Verification:** 该用例通过；实测 `gated-text-escape.ts` 报 6 条、整个 fixture 目录 9 条
- **Committed in:** `d187ec4`

### 与 PLAN 文字的两处有意不一致（非 bug，已在 Decisions 说明）

- **拒绝态判别式用 `outcome`/`reason` 而不是 `ok: false`**（见 Decisions 1）。PLAN 的 `<output>` 段写的是 `{ ok: true; text: GatedText }`，与 Plan 04 已发布的形状冲突；这里取既有形状，可判别联合与「没有原样透传形态」两个实质要求都成立。
- **`as unknown as GatedText` 无法作为 tsc 负向违反。** PLAN 的 Task 1 要求给 type fixture「追加一处 `as unknown as GatedText` 与一处 `satisfies GatedText` 的违反」。前者在 TS 里**不报错**（`GatedText` 是 `string` 的子类型，双重断言合法），该行本来就已存在并在文件里注明了这一点 —— 它是 eslint 两条 `as GatedText` 选择器存在的理由，不是 tsc 的报错源。实际追加的是两处 `satisfies`（`string` 与 `SyntheticText` 各一条），都是真报错。

**Total deviations:** 6 auto-fixed（1 bug、2 missing critical、3 blocking）+ 2 处与 PLAN 文字的有意不一致
**Impact on plan:** 全部为必要修正，无范围扩张。3 条 blocking 修的都是「这条检查根本跑不起来 / 永远是绿的」，2 条 missing critical 补的都是 fail-open 方向的缺口。

## Issues Encountered

- **PLAN 的 eslint 验收命令按字面跑不通。** `pnpm -w exec eslint tools/ci/fixtures/any-into-egress.ts --no-cache --format json` 会因为 `tools/ci/fixtures/**` 在全局 `ignores` 里而报「File ignored」并**退出 0**。全局 ignore 是 Plan 02 刻意设的不变量（否则 `pnpm run lint` 会因为这些故意违规的 fixture 整体失败），所以正确的等价命令是加 `--no-ignore`，或走测试里的 ESLint API（`ignore: false`，与 `eslint-config-meta.test.ts` 同一手法）。两者都已验证：报出 `no-unsafe-assignment` + `no-unsafe-argument`，退出码 1。
- **`grep -rn '别走' packages apps --include=*.ts` 会命中 3 行而不是 1 行。** 其中两行在 `retention-words.test.ts` 里：一行是「逐字等于契约里的七个词」那条断言（它**必须**是字面量，否则那条契约检查就自我循环了），一行是该文件里那条 grep 断言自己的参数。唯一的**定义**仍然只有 `retention-words.ts:23`。已把其余测试用例改成从 `RETENTION_PHRASES` 取词，并把「只有一处定义」写成一条常驻断言（排除 `*.test.ts`），而不是依赖一次人工 grep。

## User Setup Required

None — 本 plan 不引入新的外部服务配置。`WECOM_WEBHOOK_URL` 已在 Plan 03 的 `env.ts` 与 `.env.example` 中声明；`notifyOperator` 不自己读它，由调用方（Plan 07）传入。

## Next Phase Readiness

**给后续 plan 的交接事实：**

1. **新增任何接受 `GatedText` 的导出函数，必须同时登记进 `EGRESS_POINTS`**，否则 `ci:fast` 变红。把出口从注册表里删掉不是修法 —— 失配信息里直接写着这句话。
2. **改动 `EGRESS_POINTS` 必须同时复核 `compliance/no-unlabeled-output.md` 并用 `node tools/ci/egress-hash.mjs --print` 更新 `egress_hash`**（与出口改动同一个 commit）。不要把它做成自动更新。
3. **`safetyGateway` 现在是 async，且 `recordSafetyEvent` 是必填字段。** 新调用点必须提供一个真写库的 sink；`escalated` 分支的 `safety_event` 仍未写（留给 Plan 07 与 `session_risk_state` / `contact_attempt` 同一事务）。
4. **`notifyOperator(alert, transport)` 需要调用方传 `{ webhookUrl }`**（来自 `env.WECOM_WEBHOOK_URL`）与可选的 `mentionedList` / `fetchImpl`。它**不记日志**，投递结果的日志与 `contact_attempt` 的状态推进都在 Plan 07：`delivered: true` ⇒ `pending`；`delivered: false` ⇒ 直接 `unavailable`，不经 `pending`（SAFE-16）。
5. **Plan 10 的禁用词扫描（规则 2）直接 `import { RETENTION_PHRASES } from '@drift/safety'`**，不要复制词表。`retention-words.test.ts` 有一条断言把「全仓只有一处定义」钉住了（它排除 `*.test.ts`）。
6. **Plan 11 填导出管道时**：`renderExportLine` 只渲染角色消息行，用户消息的渲染要另写一个函数，而且那个函数**不应该**要求 `GatedText`（用户原文从不过网关，把它伪装成 GatedText 才是真正的绕过）。文件头三行元数据落地后须重新复核 COMPLY-11 登记的第 3 条。
7. **Plan 12 把 `conversationStatus` 的读挪进网关内部时**，注意 `GatewayInput` 目前有 `conversationStatus` 与 `recordSafetyEvent` 两个必填字段；挪走前者会改所有调用点的形状，而 `tests/integration/tracer.test.ts` 也是调用点之一。
8. **`SAFETY_CONFIDENCE_FLOOR` 当前是 0.5，一个有依据但未实测的值。** Plan 08 的探针集跑完后应当用真实置信度分布回头校准它 —— 抬高它换来更多误升级（用户看到关怀卡片而不是回复），压低它换来更多低置信判定被当成有效判定。

**已知盲区（不阻塞）：**

- AST 扫描只认「导出函数的参数类型」。一个把 `GatedText` 藏在类方法、或藏在运行时构造的回调里的出口扫不到。Phase 1 没有这类形态（四个出口都是顶层导出函数），但它是这条断言的边界，写在这里以免被当成已覆盖。
- 挽留词表是**词表**而非语义模型。「你真的要走了吗」这类同义表达不在七个词里，靠 L6 探针（Plan 08）与 Plan 10 的文案层扫描补。这与 PLAN 的定位一致：本 plan 交付的是运行时执行点，覆盖面由探针集扩。
- `SKIPPED_CHECKS.md` 本 plan**未解除也未新增**任何行（5 行原样）。`ci-workflows-never-executed` 仍在册，因此 `fast.yml` 里那一步 `egress-hash --check` 至今没有被任何一次真实 CI 运行验证过 —— 这也是为什么同一个 CLI 在 `ci:fast` 里另有一个调用点。

## Self-Check: PASSED

| 检查 | 命令 | 结果 |
|---|---|---|
| 计划级验证 1 | `pnpm run ci:fast` | 退出 0，105 个用例全绿（7 个 contract 文件）|
| 计划级验证 2 | `pnpm -w exec vitest run tools/ci/egress-registry.test.ts` | 20 passed，三条绑定断言全绿 |
| 计划级验证 3 | `eslint tools/ci/fixtures/any-into-egress.ts --no-ignore --format json` | 退出 1，报出 `no-unsafe-argument` |
| 计划级验证 4 | `tsc --noEmit -p tools/ci/type-fixtures/tsconfig.json` | 退出 1，9 条 `error TS`（`gated-text-escape.ts` 占 6 条，>= 4）|
| 计划级验证 5a | 加未登记的 `GatedText` 出口 | 集合相等变红，信息点名 `sendSomewhereElse`（常驻用例）|
| 计划级验证 5b | 把 `deliver` 参数改成 `string` | 变红，信息为「注册表中已不存在的项: ws.deliver (apps/api/src/ws/server.ts::deliver)」，已还原（`git diff` 干净）|
| 计划级验证 5c | 给 `EGRESS_POINTS` 加一项而不改 `egress_hash` | 哈希断言变红，信息含「未重新复核」（常驻注入用例 + CLI 错期望值用例）|
| 计划级验证 6 | `node tools/ci/egress-hash.mjs --print` | 单行 `sha256:44d59022…` |
| 额外：L5 未被破坏 | `pnpm run test:integration` | 28 passed（tracer 9 + schema-drift 19）|
| 额外：lint 全仓 | `pnpm run lint`（`--max-warnings=0 --no-cache`）| 退出 0 |
| 额外：磁盘存在性 | `key-files.created` 12 个文件 | 全部存在 |
| 额外：commit 可查 | `git log --grep="01-06"` | 3 个 task commit + 本条 docs commit |

**成功标准逐条：**

- ✅ **出站标识由消息管道统一注入且有 DB CHECK 兜底（COMPLY-09）** —— `insertCharacterMessage` 不接受 `disclosure` 形参，DB CHECK 在库里且 `assert-no-drift` 通过；第四个出口的载荷被证明不含对话文本。
- ✅ **COMPLY-11 以显式空集登记成立，出口集合变化机械地触发人工复核** —— 登记文件逐条覆盖四个出口，`egress_hash` 绑定，脚本不得自动改写。
- ✅ **网关不存在「原样透传」形态（SAFE-01）** —— 返回值是可判别联合，只有 `gated` 那一支带 `text`；全仓无 `as GatedText` 越界、无非空断言绕过收窄，两条都有常驻断言。
- ✅ **三层出口防线各自带负向 fixture，三条都被证明非空真** —— 编译期（`gated-text-escape.ts`，6 条报错）、lint（`any-into-egress.ts`，type-aware 单开）、注册表（`unregistered-egress.ts` + 两条注入式破坏用例）。

---
*Phase: 01-compliance-safety-chat-skeleton*
*Completed: 2026-09-27*
