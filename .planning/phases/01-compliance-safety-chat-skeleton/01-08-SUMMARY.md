---
phase: 01-compliance-safety-chat-skeleton
plan: 08
subsystem: safety
tags: [crisis-intervention, care-card, alert, rtl, probe-suite, structured-facts, websocket, eslint-ban]

requires:
  - phase: 01-07
    provides: 入站规则层 scanInbound、classifySafety、safetyGateway 的结构化 careCard（一级无 contactStatus）、contact_attempt 四态状态机、TurnResult.reply.escalated、运行营者 ack/failed 端点
  - phase: 01-09
    provides: RTL 测试栈（@testing-library/react 16.3.3 + jsdom 30.1.1，包合法性 checkpoint 已过）、AiBanner 常驻条组件、vitest 的 apps/web 别名
provides:
  - 两级关怀卡片的渲染层：Alert 基座、同色不同版式、二级唯一确认按钮「我看到这些帮助方式了」、一级类型层无联络语义
  - 四态联络状态行（SAFE-04）：文案逐字取自 UI-SPEC；非 delivered 不陈述已联系（claimsContacted 双闸门）；failed/unavailable 热线上移首屏第一行 + 44×44 tel: 直呼
  - WS 下行事件 safety.contact_status（attemptId/status/contactName/contactMasked，协议里不存在未遮蔽手机号字段）
  - crisis 目录的 setTimeout/setInterval eslint 禁令 + 负向 fixture（裸调用与成员形式都覆盖）
  - 78 条危机探针集（版本化 yaml，SAFE-15 Phase 5 重跑同一套）+ 结构化事实断言 runner + 条数守卫（78/15）
  - 探针集自身的非空真证明：永远返回 crisis 的桩让 15 条阴性对照全部失败
affects: [01-12-hard-exit, 01-14-ui-polish, phase-05-shadow]

actuals:
  tokens: 69000
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "「非 delivered 不得声称已联系」做成双闸门：四态文案语义上只有 delivered 含该表述，渲染又要求服务端算好的 claimsContacted 为真 —— 不信任渲染层自己判 status"
    - "断言提取成检查器函数 + 注入式反例：expectNoFalseContactClaim / expectHotlineFirstRow 拿故意矛盾的输入（claimsContacted=false 的 delivered 卡、hotlineFirst=false 的 failed 卡）直接调用并断言会抓红"
    - "探针断言只认结构化事实：runner 没有任何文本子串断言入口，失败输出只含 id、轮次与事实差异 —— 探针日志不是泄漏路径"
    - "真实分类器探针 = 注入端口 + 生产 provider 实例：zhipuClassifyInvoke 用生产 zhipuProvider() 与 ROUTES 的 temperature 0，chat.reply 留在 mock 上保证候选确定"
    - "探针集自身的防退化三件套：总数 78 / 阴性 15 的条数守卫（删用例即红）、永远返回 crisis 的桩（空真即红）、none 用例不命中词表的规则层守卫"

key-files:
  created:
    - apps/web/src/components/ui/alert.tsx
    - apps/web/src/features/crisis/copy.ts
    - apps/web/src/features/crisis/care-card.tsx
    - apps/web/src/features/crisis/contact-status-row.tsx
    - apps/web/src/features/crisis/resource-list.tsx
    - apps/web/src/features/crisis/crisis-ui-contract.test.tsx
    - apps/api/src/modules/safety/contact-status-event.ts
    - tools/ci/crisis-ui-contract.test.ts
    - tools/ci/fixtures/crisis-settimeout.tsx
    - tests/probes/yaml.ts
    - tests/probes/runner.ts
    - tests/probes/crisis.test.ts
    - tests/probes/crisis/level1-extreme-emotion.yaml
    - tests/probes/crisis/level2-self-harm.yaml
    - tests/probes/crisis/level2-financial-loss.yaml
    - tests/probes/crisis/negative-controls.yaml
    - tests/probes/crisis/bypass-attempts.yaml
    - tests/probes/crisis/classifier-failure.yaml
  modified:
    - apps/web/src/features/chat/chat-view.tsx
    - packages/contract/src/ws.ts
    - apps/api/src/modules/safety/routes.ts
    - apps/api/src/worker/index.ts
    - packages/llm/src/index.ts
    - eslint.config.js
    - vitest.config.ts
    - .github/workflows/integration.yml
    - SKIPPED_CHECKS.md
    - apps/web/package.json
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "RTL 断言住在 apps/web/src/features/crisis/crisis-ui-contract.test.tsx 而非 PLAN 写的 tools/ci：react / react-dom 只装在 apps/web（pnpm 严格 node_modules，从 tools/ci 解析不到），01-09 已确立同一先例；tools/ci/crisis-ui-contract.test.ts 承担不需要渲染的那一半（grep 禁令、常量、eslint 负向 fixture）"
  - "探针总数按 78 交付、各类目基线不变（l1 16 / selfharm 20 / fin 8 / 阴性 15 / bypass 16 / 故障 3）：PLAN 的类目数字之和是 58，78 来自 RESEARCH §4.6 含 Plan 12 硬退出 20 条的全表 —— 两处要求冲突时保住「总数 78、阴性恰好 15」这两条被断言钉住的数，余下 20 条按类目加强样本补齐"
  - "真实分类的探针 invoke 用生产 zhipuProvider() 直连（ROUTES 的 temperature 0、git 锁定的 baseURL）而不是 routed call：LLM_PROVIDER_MODE=mock 下后者会让 chat.reply 也走 mock（探针失去被测对象），切 live 则候选回复失去确定性 —— turn.ts 的 classifyInvoke 注入端口正是为这个组合留的"
  - "无 ZHIPU_API_KEY 时探针不静默跳过：真实分类用例 runIf(有 key) 跳过，但另有一条守卫断言 SKIPPED_CHECKS 里存在 probes-real-classify-not-run 登记（登记被删而 key 仍缺会变红）—— 这是编排器裁决的方案 B"
  - "探针 yaml 用 60 行受控子集解析器 + zod 全量校验，不引 js-yaml：新增解析库要走 blocking-human checkpoint（T-08-SC），而探针文件形状是我们自己定的"
  - "超时 worker 的 contact_status 广播是 PLAN 文件清单之外的补全（Rule 2）：没有它，pending→failed（超时）的转态永远到不了正盯着卡片的用户界面，UI-SPEC「该行必须由服务端状态驱动」就只剩运营者触发的两个转态"
  - "二级卡片的确认按钮标签取本地法定常量（LEVEL2_CONFIRM_LABEL）而不是卡片数据的 confirmLabel：按钮文案是 UI 契约，服务端字段与它的相等性由 tools/ci 断言钉住 —— 最高风险的一次点击不信任传输层"

patterns-established:
  - "「非 delivered 不得声称已联系」双闸门（文案语义 + 服务端布尔 claimsContacted）"
  - "检查器函数 + 注入式反例（每个 PR 都证明断言非空真，而不是执行者手里改一次文件）"
  - "探针 = 结构化事实断言，禁止输出文本子串断言入口"
  - "条数守卫（总数 + 阴性数）防「删用例提高通过率」"

requirements-completed: [SAFE-01, SAFE-03, SAFE-04, SAFE-05, SAFE-14, SAFE-16, COMPLY-01]

coverage:
  - id: D1
    description: "两级关怀卡片在组件层排除了「伪装成角色发言」与「法定告知走 toast」两条错误路径（SAFE-01/03/04）"
    requirement: SAFE-01
    verification:
      - kind: unit
        ref: "apps/web/src/features/crisis/crisis-ui-contract.test.tsx#两级卡片：Alert 基座、无移除交互、唯一确认按钮（31 条）"
        status: pass
      - kind: other
        ref: "tools/ci/crisis-ui-contract.test.ts#crisis 目录 grep 不到 Bubble / BubbleContent / sonner（目录级禁令）"
        status: pass
    human_judgment: false
  - id: D2
    description: "四态联络状态行全部有渲染分支；非 delivered 不陈述已联系；failed/unavailable 热线上移首屏第一行；pending→delivered 原地替换不夺焦点（SAFE-04/R1.23）"
    requirement: SAFE-04
    verification:
      - kind: unit
        ref: "apps/web/src/features/crisis/crisis-ui-contract.test.tsx#(a)-(e)：四态文案、(b) 注入式反例、(c) hotlineFirst 检查器 + 反例、(d) DOM 节点与 activeElement 不变、(e) 未知=pending"
        status: pass
    human_judgment: false
  - id: D3
    description: "safety.contact_status 下行事件与四态接线：协议只有遮蔽字段、运营者 ack/failed 与超时 worker 广播、渲染不含 11 位连续数字（T-08-03）"
    requirement: SAFE-04
    verification:
      - kind: contract
        ref: "tools/ci/crisis-ui-contract.test.ts#载荷里不存在未遮蔽的手机号字段 + 取值域三方一致（web/safety/contract）"
        status: pass
      - kind: integration
        ref: "apps/api 集成层 100 条全绿（routes/worker 改动后 ack/failed 端点不回归）"
        status: pass
    human_judgment: false
  - id: D4
    description: "crisis 目录的前端计时器禁令（超时权威在服务端），负向 fixture 证明非空真"
    requirement: SAFE-04
    verification:
      - kind: contract
        ref: "tools/ci/crisis-ui-contract.test.ts#(f) crisis-settimeout.tsx 报出 no-restricted-syntax（三处违规）+ 正向一半（crisis 文件有效配置含禁令）"
        status: pass
    human_judgment: false
  - id: D5
    description: "危机探针集本体：78 条版本化 yaml、结构化事实断言、条数守卫 78/15、阴性对照非空真证明（永远返回 crisis 的桩全红）、故障注入 fail-closed"
    requirement: SAFE-01
    verification:
      - kind: integration
        ref: "tests/probes/crisis.test.ts#形状守卫（含删 3 条变红的注入式反例）+ 桩分类器 15 条全失败 + 故障注入 3 条全过（真实管道）"
        status: pass
    human_judgment: false
  - id: D6
    description: "78 条 × N=3 的真实 safety.classify 全绿（成功标准 2 的「危机探针集 100% 通过」）"
    requirement: SAFE-05
    verification: []
    human_judgment: true
    rationale: "执行环境无 ZHIPU_API_KEY（编排器裁决方案 B）：真实分类判定尚未被任何一次机器验证，登记于 SKIPPED_CHECKS 的 probes-real-classify-not-run（解除条件=带 key 环境跑 pnpm run test:probes 全绿后删行）。已交付的离线证明只覆盖探针集自身的非空真与故障注入路径，不覆盖真实分类器的判定质量。"
  - id: D7
    description: "两级卡片的视觉呈现：同色不同版式、首读锚点、直呼按钮手感、危机态下 AI 常驻条不被遮挡"
    requirement: SAFE-04
    verification: []
    human_judgment: true
    rationale: "RTL 与 grep 断言钉住了结构（组件类型、禁令、token 类名），但「这张卡片看起来像平台的关心而不是角色的发言」「44×44 按钮在真机上好不好按」是人眼判断 —— 容器内 next build 已过（drift-web-verify:01-08），视觉走查属阶段验证器。"

duration: 1h 40m
completed: 2026-09-27
status: complete
---

# Phase 01 Plan 08: 两级关怀卡片 + 四态联络状态行 + 78 条危机探针集 Summary

**Alert 基座的两级关怀卡片（一级类型层无联络语义、二级唯一确认按钮「我看到这些帮助方式了」）+ 四态联络状态行（非 delivered 不陈述已联系、失败两态热线提到首屏第一行）+ 78 条结构化事实断言的危机探针集（阴性对照被桩证明真的在起作用；真实分类判定因无 ZHIPU_API_KEY 显式挂起）。**

## Performance

- **Duration:** 1h 40m（含一次编排器裁断往返）
- **Started:** 2026-09-27T09:30:00Z
- **Completed:** 2026-09-27T11:09:00Z
- **Tasks:** 3
- **Files:** 30（18 新建 / 12 修改，+2765 −43）

## Accomplishments

- **「伪装成角色发言」在组件层不可发生。** 关怀卡片只长在全宽的 Alert 原语上（新建 alert.tsx），crisis 目录 grep 不到气泡组件与 toast 的任何引用（目录级禁令 + CI 断言）；一级视图类型里不存在 contactStatus（与服务端同名的编译期断言互为镜像），「一级不联络」不是渲染时记得别显示，而是拿不到值可显示。
- **「非 delivered 不陈述已联系」是双闸门。** 四态文案语义上只有 delivered 含该表述；渲染又要求服务端算好的 claimsContacted 为真。两条断言 (b)/(c) 各带注入式反例：把矛盾输入（claimsContacted=false 的 delivered 卡、hotlineFirst=false 的 failed 卡）直接喂给检查器并断言会抓红 —— 每个 PR 都证明一次「断言非空真」，而不是执行者手里改一次文件。
- **四态全部有渲染分支且拿到终态原地替换。** pending 是文字行 + 13px 说明（无转圈）、未知状态等同 pending、pending→delivered 保持同一 DOM 节点且 document.activeElement 不变（RTL 逐条断言）；failed/unavailable 把热线行提到署名行之下的首屏第一行并渲染 44×44 的 tel: 直呼按钮。
- **协议里不存在未遮蔽的手机号字段。** safety.contact_status 载荷只有 contactMasked（服务端 maskContact 产物）；四态渲染结果断言不含 11 位连续数字。运营者 ack/failed 端点与超时 worker 在推进成功后广播 —— 超时转态到不了界面是 PLAN 文件清单之外的缺口，已补上（Rule 2）。
- **crisis 目录禁前端计时器，且禁令被证明非空真。** eslint 对 setTimeout/setInterval 的裸调用与 window.* 成员形式都报错（只写 callee.name 会漏掉成员形式）；负向 fixture 三处违规全部被抓，且正向一半证明真实 crisis 文件的有效配置带着禁令（不是一堵墙）。
- **探针集断言的只有结构化事实。** session_risk_state.level、safety_event 行数、contact_attempt 存在性与 status、careCard.level、gated 回复的 disclosure —— runner 没有任何文本子串断言入口（verify 的 grep 钉住），失败输出只含用例 id、轮次与事实差异，探针日志不是泄漏路径。
- **探针集不是空真的，且删不动。** 「永远返回 crisis」的桩让 15 条阴性对照全部失败（离线、真实管道、真库）；总数 78 / 阴性 15 的条数守卫各带注入式反例（删 3 条、抽掉阴性组都会变红）；expect=none 的 19 条用例文本经规则层守卫确认不命中入站词表与挽留词表（考的是分类器，不是词表）。
- **分类器三类故障注入走真实管道全绿。** timeout（真的等 12 秒竞速）/ schema / low-confidence 三条用例 fail-closed 到 elevated、零联络、角色消息零落库 —— 这部分离线可证明且已验证。

## Task Commits

1. **Task 1: 两级关怀卡片（Alert 基座、同色不同版式、不可 dismiss）** — `437d858` (feat)
2. **Task 2: safety.contact_status 下行事件 + 四态接线 + crisis 目录计时器禁令** — `422ca0f` (feat)
3. **Task 3: 危机探针集 78 条 × N=3** — `4eeada5` (test)
4. **（Task 3 收尾）四态渲染不含 11 位连续数字** — `6cdb0cb` (test)

**Plan metadata:** 本次提交（docs: complete crisis-cards-and-probe-suite plan）

## Files Created/Modified

见 frontmatter 的 key-files（18 新建 / 12 修改）。核心链路：`turn.ts 的 classifyInvoke 注入端口 → 探针 runner → 生产 zhipuProvider()（temperature 0）`；渲染链路：`TurnResult.reply.careCard（结构化对象）→ CareCard 分发（level 可判别）→ Alert 版式`。

## Decisions Made

见 frontmatter 的 key-decisions（7 条）。三条改变了 PLAN 的字面要求：RTL 测试的落点（react 不可从 tools/ci 解析）、探针条数的分布（78 vs 类目和 58 的计划内部矛盾）、超时 worker 的广播接线（文件清单外的 Rule 2 补全）。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tools/ci 无法承载 RTL 断言**
- **Found during:** Task 1（crisis-ui-contract 测试落点）
- **Issue:** PLAN 把六条 RTL 断言写在 tools/ci/crisis-ui-contract.test.ts，但 react / react-dom 只装在 apps/web（pnpm 严格 node_modules，从 tools/ci 解析不到），且 contract project 也不 include .tsx。
- **Fix:** 拆两处：apps/web/src/features/crisis/crisis-ui-contract.test.tsx 承担全部渲染断言（01-09 的先例）；tools/ci/crisis-ui-contract.test.ts 承担 grep 禁令、文案常量、eslint 负向 fixture 与协议字段断言。PLAN 的 verify 命令（vitest run tools/ci/crisis-ui-contract.test.ts）照常可用。
- **Files modified:** 两个测试文件
- **Verification:** 两处测试全绿（31 + 12 条）；PLAN verify 命令逐一跑过
- **Committed in:** `437d858` / `422ca0f`

**2. [Rule 1 - Bug] 探针条数的计划内部矛盾（78 vs 类目和 58）**
- **Found during:** Task 3（yaml 构造前计数）
- **Issue:** PLAN 六类条数 12+12+6+15+10+3=58，但总数断言、must_haves、acceptance 三处都写 78 —— 78 来自 RESEARCH §4.6 含 Plan 12 硬退出 20 条的全表（58+20=78），而 PLAN 明说那 20 条不计入。
- **Fix:** 保住两条被断言钉住的数（总数 78、阴性恰好 15），余下 20 条按类目加强：l1 16 / selfharm 20 / fin 8 / bypass 16（基线全部不低于 PLAN 数字）。
- **Files modified:** 六个 yaml 的条数分布
- **Verification:** 条数守卫（78/15）+ 注入式反例全绿
- **Committed in:** `4eeada5`

**3. [Rule 2 - Missing Critical] 超时 worker 不广播 contact_status**
- **Found during:** Task 2（服务端接线）
- **Issue:** PLAN 文件清单只有 routes.ts —— 但 pending→failed 的三个来源里，pg-boss 超时是唯一不经运营者端点的那一个。不接它，用户界面上的「正在联系」要挂到刷新为止，UI-SPEC「该行必须由服务端状态驱动」只剩两个转态成立。
- **Fix:** worker/index.ts 的 onExpired 在 affected>0 时广播（影响 0 行的重复投递不是状态变化）。
- **Files modified:** apps/api/src/worker/index.ts, apps/api/src/modules/safety/contact-status-event.ts（新）
- **Verification:** 集成层 100 条全绿（routes/worker 改动无回归）
- **Committed in:** `422ca0f`

**4. [Rule 3 - Blocking] 探针的依赖缺口（react 侧卡片构造 / yaml 解析 / 根 zod）**
- **Found during:** Task 3
- **Issue:** ① apps/web 的 RTL 测试用真实 buildCareCard 构造卡片，但 @drift/safety 不在 apps/web 依赖里 —— 容器内 next build 因 zod 解析链直接失败；② tests/probes 解析不到 zod（根 devDeps 没有）；③ 探针直连真实分类器需要 zhipuProvider 实例，但包入口只导出 resolveProvider。
- **Fix:** apps/web devDependencies 增 @drift/safety（workspace:*，类型漂移由 RTL 用真实卡片渲染钉住）；根 devDependencies 增 zod@4.6.5（workspace 既有版本，无新包）；@drift/llm 导出 zhipuProvider（注释写明唯一消费者是 L6 探针）。容器内 next build 重新通过（drift-web-verify:01-08）。
- **Files modified:** apps/web/package.json, package.json, pnpm-lock.yaml, packages/llm/src/index.ts
- **Verification:** 容器 `docker compose build web` 成功；test-deps-isolation 断言不变（@drift/safety 与 zod 不在测试包隔离清单的监视范围内）
- **Committed in:** `437d858` / `4eeada5`

**5. [Rule 2 - Missing Critical] integration.yml 的 L6 步骤缺 DATABASE_URL**
- **Found during:** Task 3 收尾
- **Issue:** 探针层现在有 globalSetup（建一次性测试库）+ 打真库的离线证明，但 L6 步骤的命令只有 `pnpm run test:probes` —— DATABASE_URL 只在 L5 步骤的命令行里，L6 会因缺变量直接红。
- **Fix:** 与 L5 同一条构造补上。
- **Files modified:** .github/workflows/integration.yml
- **Verification:** 无 continue-on-error（grep=0）；本地带 DATABASE_URL 的 test:probes 全绿
- **Committed in:** `4eeada5`

**6. [Rule 3 - Blocking] 聊天页已有独立的 AiBanner 组件**
- **Found during:** Task 1（chat-view 集成）
- **Issue:** 我最初把 32px 常驻条写进 ChatView，但聊天页（chat/[conversationId]/page.tsx）已经渲染 components/ai-banner.tsx 的同名组件 —— 重复渲染会出现两条常驻条。
- **Fix:** ChatView 不再自带常驻条；RTL 断言改为按页面真实结构组合渲染（<AiBanner /> + <ChatView />）并断言常驻条在二级危机卡片之前（不被遮挡）。
- **Files modified:** apps/web/src/features/chat/chat-view.tsx, crisis-ui-contract.test.tsx
- **Verification:** RTL 31 条全绿（含「危机态下常驻条在场且在卡片之前」）
- **Committed in:** `437d858`

---

**Total deviations:** 6 auto-fixed（2 Rule 1 / 3 Rule 2 / 3 Rule 3，其中一条跨两个提交）
**Impact on plan:** 全部为正确性与可验证性所必需，无范围蔓延。最重要的一条是 #2 —— 条数分布是 PLAN 算术矛盾的忠实处置，78/15 两条被断言钉住的数都保住了。

## Issues Encountered

1. **执行环境没有 ZHIPU_API_KEY（环境缺口，非代码缺口）。** 探针集的真实分类判定（78 条中除故障注入外的全部）无法在本环境机器验证。处置（编排器裁决方案 B）：默认 invoke = 生产 zhipuProvider()（无 key 响亮抛错不回落）+ 注入端口；离线可证明部分全部做实（条数守卫、桩的非空真证明、故障注入真管道）；「78×3 真实全绿」登记 SKIPPED_CHECKS（probes-real-classify-not-run，解除条件=带 key 环境跑 test:probes 全绿后删行），本 SUMMARY 的 coverage 里对应条目标 human_judgment: true。同时删除已解除的 L6-no-subject 行。
2. **宿主跑不了 next build（已知，glibc 2.28）。** 容器内完成：`docker compose build web` 通过（tag drift-web-verify:01-08）。期间发现并修掉了 deviations #4 的容器构建失败（@drift/safety 不在 apps/web 依赖图里）。
3. **二级卡片重连重建的读接口仍未建（handoff #48 已登记的既有缺口）。** 本 plan 交付的是事件驱动的实时转态；掉线期间错过的转态要等「按 session_risk_state + 最新 contact_attempt 重建」的读接口（属后续 plan）。状态未知时界面等同 pending 渲染，不会先假后翻。

## User Setup Required

None —— 本 plan 未新增外部服务或必填环境变量。探针的真实分类需要 ZHIPU_API_KEY 存在于 self-hosted runner 的进程环境（既有设计），缺口已登记 SKIPPED_CHECKS。

## Next Phase Readiness

- 危机干预的呈现面（两级卡片 + 四态行）与探针集骨架全部就位；Plan 12（硬退出）追加的 20 条退出词表用例进同一目录，条数守卫届时从 78 调到 98（并在 negative-controls 保持 15 或按其计划调整）。
- **挂起项：** 首次在带 ZHIPU_API_KEY 的环境跑 `pnpm run test:probes` 并让「78 条 × N=3 全部通过」全绿，然后删 SKIPPED_CHECKS 的 probes-real-classify-not-run 行 —— 成功标准 2 的机器验证到此才算闭合。
- `SAFETY_CONFIDENCE_FLOOR = 0.5` 仍是有依据但未实测的值：真实探针跑完后应当用实际置信度分布校准（handoff #33，责任随 D6 一起挂起）。

---
*Phase: 01-compliance-safety-chat-skeleton*
*Completed: 2026-09-27*
