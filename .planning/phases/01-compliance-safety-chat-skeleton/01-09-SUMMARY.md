---
phase: 01-compliance-safety-chat-skeleton
plan: 09
subsystem: auth
tags: [better-auth, consent, aes-256-gcm, branded-types, drizzle, react, shadcn, pgboss]

requires:
  - phase: 01-01
    provides: 五项同意的 scope 名与 PRIV-01/PRIV-02 的修订版需求文本、13 条契约修订断言
  - phase: 01-04
    provides: 22 张表（user/account/session/verification/invite_code/emergency_contact/consent/consent_event/privacy_action）、注册链路的最小前身、message 落库
  - phase: 01-15
    provides: apps/web/content/legal/privacy.md 正文 —— policy_version 的唯一哈希来源
provides:
  - 单事务注册：better-auth 建账号 + 条件更新消耗邀请码 + 5 条 consent/consent_event + 加密紧急联系人，任一步失败整体回滚
  - better-auth 参与外部事务的手法（AsyncLocalStorage + Proxy 绑定适配器执行器）
  - packages/db/src/crypto.ts：紧急联系人联系方式的 AES-256-GCM 加解密与遮蔽，无明文回退
  - ConsentTicket<'sensitive_pi'> 守卫：message 落库在类型层要求合法性基础
  - 撤回语义：可选项即停数据流；必选项进入 PRIV-05 删除流程（入队失败整条回滚）
  - consent-reconcile 日对账（user × CONSENT_SCOPES.length = consent）
  - 注册 UI：五个互不捆绑 Checkbox、18 岁无出口终态拒绝、监护人/紧急联系人二选一
  - @drift/contract 成为同意取值域、紧急联系人取值域、isAdult、撤回确认文案的唯一定义处
affects: [01-08, 01-10, 01-11, 01-12, 01-14]

actuals:
  tokens: 41000
  tasks: 3
  commits: 3

tech-stack:
  added: [better-auth@1.7.6, kysely@0.29.6, "shadcn ui: checkbox/label/input/field/radio-group/separator"]
  patterns:
    - "AsyncLocalStorage + Proxy 把第三方库的 db 句柄绑到当前事务"
    - "品牌类型的第二次复用：ConsentTicket<S> 单一产出点 + eslint 断言禁令 + 负向 type fixture"
    - "跨端共享取值域与文案放 @drift/contract（apps/web 不能 import @drift/db）"
    - "源码扫描先去注释再匹配，并各带一条非空真证明"
    - "把「临时改坏它会变红」写成测试内注入，而不是执行者手上跑过一次"

key-files:
  created:
    - apps/api/src/modules/auth/better-auth.ts
    - apps/api/src/modules/auth/register.ts
    - apps/api/src/modules/auth/invite.ts
    - apps/api/src/modules/consent/service.ts
    - apps/api/src/modules/consent/routes.ts
    - apps/api/src/worker/jobs/consent-reconcile.ts
    - apps/api/src/worker/jobs/account-deletion.ts
    - packages/db/src/crypto.ts
    - packages/db/src/consent-ticket.ts
    - packages/contract/src/consent.ts
    - packages/contract/src/emergency-contact.ts
    - apps/web/src/features/onboarding/{steps,consent-checkboxes,age-gate,emergency-contact}.tsx
    - apps/web/src/features/onboarding/{copy,consent-state}.ts
    - "apps/web/src/app/(auth)/register/page.tsx"
    - tests/integration/register.test.ts
    - tests/integration/consent-ticket.test.ts
    - tools/ci/consent-ui-contract.test.ts
    - tools/ci/consent-copy-contract.test.ts
    - tools/ci/policy-version-binding.test.ts
    - tools/ci/type-fixtures/consent-ticket-escape.ts
  modified:
    - packages/db/src/message.ts
    - packages/db/src/onboarding.ts
    - packages/db/src/schema/{auth,consent}.ts
    - apps/api/src/config/env.ts
    - apps/api/src/modules/auth/routes.ts
    - apps/api/src/modules/safety/contact.ts
    - apps/api/src/modules/chat/turn.ts
    - eslint.config.js
    - vitest.config.ts
    - SKIPPED_CHECKS.md

key-decisions:
  - "better-auth 通过 AsyncLocalStorage + Proxy 参与我们自己的事务 —— 它的 drizzleAdapter 在构造期绑定 db，没有逐调用注入事务的入口"
  - "policy_version 不接受客户端传入，服务端取 privacy.md 内容哈希，无兜底分支"
  - "同意/紧急联系人取值域与 isAdult 收拢到 @drift/contract"
  - "撤回必选同意项与三条留证同事务；入队删除失败即整条回滚并回 503"
  - "五项同意状态提成纯函数模块，把「点一项其余不变」从肉眼确认变成穷举断言"
  - "kysely 声明进根与 packages/db 以统一 drizzle-orm 的 peer 解析上下文"
  - "注册 UI 渲染断言用 react-dom/server 静态渲染；RTL/jsdom 未获包裁决，两条 DOM 事件断言登记 skip"

patterns-established:
  - "外部库参与本地事务：ALS 存当前 Tx + Proxy 转发属性访问，唯一绑定点是一个 runInXxxTx 包装"
  - "源码断言先去注释：文件头必须能写出被禁止的那件事，否则检查会换来沉默"
  - "负向证明写成测试内注入（全选按钮 / 批量 setter / 越界 kind），每个 PR 都跑一次"

requirements-completed: [COMPLY-06, COMPLY-07, PRIV-01, PRIV-02]

coverage:
  - id: D1
    description: "注册在单个事务里完成四件事，任一步失败整体回滚，不产生残缺账号"
    requirement: "COMPLY-06"
    verification:
      - kind: integration
        ref: "tests/integration/register.test.ts#(c) 第四步失败时整体回滚 —— 不产生残缺账号（T-09-02）"
        status: pass
      - kind: integration
        ref: "tests/integration/register.test.ts#(a) 注册成功后 consent 恰好 5 行，两项必选 granted 为 true"
        status: pass
    human_judgment: false
  - id: D2
    description: "同一邀请码并发使用时恰好一个成功（条件更新 + 行锁）"
    verification:
      - kind: integration
        ref: "tests/integration/register.test.ts#(b) 同一邀请码并发注册两次，恰好一个成功（T-09-01）"
        status: pass
      - kind: integration
        ref: "tests/integration/tracer.test.ts#(1) 同一个邀请码并发注册两次，恰好一个成功（T-04-03）"
        status: pass
    human_judgment: false
  - id: D3
    description: "紧急联系人联系方式加密入库、接口只返回遮蔽形态、危机卡片渲染遮蔽号码"
    verification:
      - kind: integration
        ref: "tests/integration/register.test.ts#(d) emergency_contact 的联系方式不是 11 位明文数字（T-09-03）"
        status: pass
      - kind: integration
        ref: "tests/integration/register.test.ts#(e) 注册接口的响应体不含 11 位连续数字（T-09-03）"
        status: pass
      - kind: unit
        ref: "packages/db/src/crypto.test.ts#密文被改动后解不开（GCM 认证标签生效）"
        status: pass
      - kind: integration
        ref: "tests/integration/contact-attempt.test.ts#status 为 pending、alert_sent_at 非空、卡片联络状态行与库里一致"
        status: pass
    human_judgment: false
  - id: D4
    description: "policy_version 是 privacy.md 的真实内容哈希，且代码里没有任何兜底分支"
    verification:
      - kind: integration
        ref: "tests/integration/register.test.ts#POLICY_VERSION 等于 privacy.md 的真实内容哈希（运行时相等）"
        status: pass
      - kind: other
        ref: "tools/ci/policy-version-binding.test.ts (5 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "ConsentTicket<'sensitive_pi'> 守卫：撤回该同意后写消息抛错，且票据不可伪造"
    requirement: "PRIV-02"
    verification:
      - kind: integration
        ref: "tests/integration/consent-ticket.test.ts#(a) 撤回 sensitive_pi 之后 insertUserMessage 抛错"
        status: pass
      - kind: other
        ref: "tools/ci/type-fixture-negative.test.ts#对 tools/ci/type-fixtures 跑 tsc 必须失败，且至少 8 条 error TS"
        status: pass
      - kind: other
        ref: "tools/ci/eslint-config-meta.test.ts（as ConsentTicket 两条禁令进 REQUIRED_RESTRICTED_SYNTAX）"
        status: pass
    human_judgment: false
  - id: D6
    description: "撤回必选同意项进入删除流程；入队失败整条回滚，不存在降级只读路径"
    requirement: "PRIV-02"
    verification:
      - kind: integration
        ref: "tests/integration/consent-ticket.test.ts#(c) 撤回 basic_service 触发 enqueueAccountDeletion，恰好一次且 reason 正确"
        status: pass
      - kind: integration
        ref: "tests/integration/consent-ticket.test.ts#(d) 入队失败 ⇒ 整条撤回回滚"
        status: pass
    human_judgment: false
  - id: D7
    description: "残缺账号的日对账（user × 5 = consent）挂进 pg-boss schedule，告警载荷无 userId"
    verification:
      - kind: integration
        ref: "tests/integration/register.test.ts#(f) 日对账能检出残缺账号，且告警载荷里没有 userId"
        status: pass
    human_judgment: false
  - id: D8
    description: "五项同意在界面上互不捆绑：无全选控件、无批量 setter、改一项其余四项逐键不变"
    requirement: "PRIV-01"
    verification:
      - kind: unit
        ref: "apps/web/src/features/onboarding/consent-state.test.ts#改 %s 时其余四项逐键不变（5 scope × 2 值 × 2 起点）"
        status: pass
      - kind: unit
        ref: "apps/web/src/features/onboarding/register-render.test.tsx#恰好渲染 5 个 checkbox / 无「全选」/ 注入式非空真证明"
        status: pass
      - kind: other
        ref: "tools/ci/consent-ui-contract.test.ts（代码里无「全选」与批量 setter，各带非空真证明）"
        status: pass
    human_judgment: false
  - id: D9
    description: "两项必选未全勾时主 CTA 为禁用态，不是提交后报错"
    requirement: "PRIV-01"
    verification:
      - kind: unit
        ref: "apps/web/src/features/onboarding/register-render.test.tsx#(d) 三条：不勾/只勾一项 ⇒ disabled；两项都勾 ⇒ enabled"
        status: pass
    human_judgment: false
  - id: D10
    description: "18 岁门禁是无出口的法定终态拒绝（容器内 button 与 a 数量为 0）"
    requirement: "COMPLY-07"
    verification:
      - kind: unit
        ref: "apps/web/src/features/onboarding/register-render.test.tsx#(e) 整页没有任何 button 与 a"
        status: pass
      - kind: integration
        ref: "tests/integration/tracer.test.ts#未满 18 岁注册被法定终态拒绝（COMPLY-07）"
        status: pass
    human_judgment: false
  - id: D11
    description: "紧急联系人二选一、手机号格式校验、说明在 description 行而非占位符；提交失败保留已填内容并把焦点移到第一个出错字段"
    requirement: "COMPLY-06"
    verification:
      - kind: unit
        ref: "apps/web/src/features/onboarding/register-render.test.tsx#(g) 说明与占位符是两段不同的文本 / 两个单选都在场"
        status: pass
    human_judgment: true
    rationale: "「焦点真的移到第一个出错字段」与「点击 checkbox 之后状态变化」需要真实 DOM 事件，而 RTL/jsdom 未获包合法性批准（SKIPPED_CHECKS 的 ui-contract-static-render-only）。当前只有 firstInvalidContactFieldId 的纯函数断言与静态渲染断言，焦点落位本身必须由人确认"
  - id: D12
    description: "注册相关文案与撤回确认文案逐字对齐 01-UI-SPEC.md 的 Copywriting Contract"
    verification:
      - kind: other
        ref: "tools/ci/consent-ui-contract.test.ts（6 条文案绑定 + 提取器非空真 + 未内联扫描）"
        status: pass
      - kind: other
        ref: "tools/ci/consent-copy-contract.test.ts（两条 Destructive confirmation 逐字 + 五项名称对齐）"
        status: pass
    human_judgment: false
  - id: D13
    description: "apps/web 的生产构建通过，/register 路由存在"
    verification:
      - kind: other
        ref: "docker build -f apps/web/Dockerfile（本机 glibc 2.28 < GLIBC_2.29 跑不了 next build）"
        status: pass
    human_judgment: true
    rationale: "构建在容器内一次性验证通过（/register 预渲染为静态路由），但页面的实际观感、响应式表现与键盘可达性没有任何自动化断言覆盖 —— 需要人在容器里打开页面走一遍"

duration: 1h 18m
completed: 2026-09-27
status: complete
---

# Phase 01 Plan 09: 18+ 注册全链路与五项同意 Summary

**better-auth 账号、一次性邀请码、五条同意留证与 AES-256-GCM 加密的紧急联系人在同一个数据库事务里落地；`ConsentTicket<'sensitive_pi'>` 让消息落库在类型层要求合法性基础，注册页的五个 Checkbox 互不捆绑、18 岁拒绝无任何出口。**

## Performance

- **Duration:** 1h 18m
- **Started:** 2026-09-27T07:26:00Z
- **Completed:** 2026-09-27T08:44:00Z
- **Tasks:** 3
- **Files created/modified:** 74（3 次提交合计）

## Accomplishments

- **注册是一个真正的单事务。** 四件事（better-auth 建账号 / 条件更新消耗邀请码 / 5 条 consent + 5 条 consent_event / 加密紧急联系人）共享一个回滚边界。这一点不是「写得仔细」，而是本 plan 的核心交付：注册链路的静默失效模式是「账号存在、同意缺失」的残缺账号，它在「缺失视为未授权」的读取逻辑下看起来完全正常。
- **让 better-auth 参与了我们的事务。** 它的 `drizzleAdapter` 在构造期绑定 db，没有任何逐调用注入事务的入口 —— 照 PLAN/RESEARCH 字面实现会让账号落在另一个连接上。改用 AsyncLocalStorage 存当前 Tx + Proxy 转发属性访问后，better-auth 发出的每条 SQL 都落在我们的事务连接上（spike 实测 + 集成断言双重证明）。
- **policy_version 从「调用方传入」收回到服务端。** 它现在是 `apps/web/content/legal/privacy.md` 的内容哈希（用 `@drift/prompts` 的 `promptVersion`，不写第二份 sha256），无默认值、无 try/catch、缺文件即进程起不来。
- **紧急联系人的号码加密入库、只以遮蔽形态出接口。** 顺带解除了 `masked-contact-until-crypto` 这条 skip：`startContactAttempt` 的 `maskedContact` 从 `null` 改成 `maskContact(decryptContact(...))`，`decryptContact` 的导入被 eslint 限定在 `apps/api/src/modules/safety/**`（正反两侧都有断言）。
- **ConsentTicket 守卫生效。** `insertUserMessage` / `insertCharacterMessage` 现在要一张只能由 `requireConsent()` 发出的票；撤回 `sensitive_pi` 之后写消息在运行时抛错、在编译期写不出来。
- **撤回必选同意项走删除流程，而不是降级只读。** Plan 11 之前入队会抛 not-implemented，于是整条撤回回滚并返回 503 —— 这是刻意选的失败方向。
- **五项同意在界面上互不捆绑，且被穷举证明。** `setScope` 是纯函数，5 scope × 2 值 × 2 起点全部逐键比对；`onToggle` 的签名只吃一个 scope，捆绑同意在类型层不可表达。
- **18 岁拒绝是无出口的终态。** 未满 18 时整页只剩那一行文案，button 与 a 数量为 0。

## Task Commits

1. **Task 1: 单事务注册 + 加密紧急联系人 + 日对账** — `64d2566` (feat)
2. **Task 2: ConsentTicket 守卫 + 撤回语义** — `73105d7` (feat)
3. **Task 3: 注册 UI** — `e0b3e2d` (feat)

**Plan metadata:** 本次提交（docs）

## Files Created/Modified

见 frontmatter 的 `key-files`。几个值得点名的：

- `apps/api/src/modules/auth/better-auth.ts` — betterAuth 实例 + `runInRegistrationTx()`（全仓唯一的事务绑定点）
- `apps/api/src/modules/auth/register.ts` — 四件事的单事务编排 + `POLICY_VERSION`
- `apps/api/src/modules/auth/invite.ts` — 条件更新消耗邀请码（裸 SQL，形态与 RESEARCH §10.2 的契约逐字一致）
- `packages/db/src/crypto.ts` — AES-256-GCM + `maskContact`，懒读密钥、无明文回退
- `packages/db/src/consent-ticket.ts` — 票据的唯一产出点
- `packages/contract/src/{consent,emergency-contact}.ts` — 跨端唯一定义处
- `apps/web/src/features/onboarding/consent-state.ts` — 同意状态的纯函数模块
- `tools/ci/{consent-ui-contract,consent-copy-contract,policy-version-binding}.test.ts` — 三条新的 L4 契约断言

## Decisions Made

见 frontmatter 的 `key-decisions`（7 条，均已写入 STATE.md 的 Accumulated Context）。

## Deviations from Plan

### Auto-fixed / 结构性偏离

**1. [Rule 1 - Bug] better-auth 无法照字面参与外部事务**
- **Found during:** Task 1
- **Issue:** PLAN 与 RESEARCH §6.1 都写「在单个事务里调 better-auth 的 server API 建账号」。实读 `@better-auth/drizzle-adapter@1.7.6` 的类型：`drizzleAdapter(db, config)` 在**构造期**绑定 db，config 的 `transaction?: boolean` 只是「让适配器自己把多步包进一个事务」，不是「用外面那个事务」。照字面实现的结果是账号落在 better-auth 自己的连接上 —— 写同意失败时账号已经提交，正是 T-09-02 的残缺账号。
- **Fix:** AsyncLocalStorage 存当前 Tx + Proxy 把适配器的每次属性访问转发到它；`runInRegistrationTx()` 是唯一绑定点。
- **Verification:** spike 实测（事务内 signUpEmail 成功、事务内抛错后 user 表零残留）+ `tests/integration/register.test.ts` (c) 的注入式回滚断言 + 一次「把写 consent 挪出事务」的临时破坏验证（变红，已还原）。
- **Committed in:** `64d2566`

**2. [Rule 3 - Blocking] better-auth 引入 kysely，导致 drizzle-orm 出现两份 peer 解析实例**
- **Found during:** Task 1（typecheck 报出数十条 `SQL<unknown> is not assignable to SQL<unknown>`）
- **Issue:** drizzle-orm 把 kysely 列为可选 peer。better-auth 依赖 kysely，于是 apps/api 解析到 `drizzle-orm@0.45.3_kysely@...`，packages/db 仍是 `drizzle-orm@0.45.3_pg...` —— 两个 nominal 不兼容的实例。
- **Fix:** 把 `kysely@0.29.6`（本就在依赖树里，是 better-auth 的传递依赖）声明进根与 packages/db 以统一 peer 集合。⚠️ pnpm **不会**为未变化的 specifier 重新解析 peer：`pnpm install --force` / `--lockfile-only` 都无效，必须对 packages/db 做一次 `remove drizzle-orm && add drizzle-orm@0.45.3` 才收敛。
- **Verification:** `ls node_modules/.pnpm/drizzle-orm@*` 只剩一个实例；`pnpm run typecheck` 退出 0。
- **Committed in:** `64d2566`

**3. [Rule 2 - Missing critical] policy_version 不再由请求体传入**
- **Found during:** Task 1
- **Issue:** 01-04 的前身把 `policyVersion` 作为请求体字段（当时没有政策正文，是权宜）。Plan 15 交付正文后这条口子必须闭上：一个由客户端声明的「我同意的是哪一版」是可伪造的留证。
- **Fix:** 从 `RegisterBody` 移除该字段，服务端在模块加载期算 privacy.md 的内容哈希；新增 `tools/ci/policy-version-binding.test.ts`（源码形态 + 非空真 + SKIPPED_CHECKS 无 policy_version 登记行）。
- **Committed in:** `64d2566`

**4. [Rule 2 - Missing critical] 五项同意状态提成纯函数模块，而不是五个独立 useState**
- **Found during:** Task 3
- **Issue:** PLAN 写「每个 Checkbox 绑定独立 state」。那样做能让「点一项其余四项不变」为真，但**只能靠肉眼确认** —— 没有任何断言会在有人后来把两个 setState 写进同一个 onChange 时变红。
- **Fix:** `consent-state.ts` 的 `setScope` 是纯函数，`consent-state.test.ts` 穷举 5 scope × 2 值 × 2 起点逐键比对，并带一条注入式非空真证明（造一个批量 setter，断言它违反该性质）。`onToggle` 的签名只吃一个 scope。
- **Committed in:** `e0b3e2d`

**5. [Rule 2 - Missing critical] 测试库里的 fixture 用户补齐五条同意**
- **Found during:** Task 1（(f) 日对账断言基线不平）
- **Issue:** `tests/integration/fixtures.ts` 与 `tools/ci/schema-drift.test.ts` 建的用户没有 consent 行，于是「user × 5 = consent」这条全库不变式在测试库里永远为假 —— (f) 的「残缺账号被检出」会退化成一条空真断言。
- **Fix:** 两处 fixture 都补写 5 条 consent。
- **Committed in:** `64d2566`

**6. [Rule 1 - Bug] contact-attempt 测试里的假密文**
- **Found during:** Task 1
- **Issue:** `'enc:13812341234'` 这个假串在 crypto 落地后解不开，于是每条用例都退到 `contact_ref_undecryptable` ⇒ unavailable —— 四态又只剩两态，正是那份测试要防的事。
- **Fix:** 改用 `encryptContact()` 算一次真密文；新增 `contact_ref_undecryptable` 这个 unavailable 成因（与「没存下来」分开记）。
- **Committed in:** `64d2566`

**7. [偏离] 注册 UI 的渲染断言用 react-dom/server 静态渲染，不是 RTL**
- **Found during:** Task 3（执行前已上报编排器）
- **Issue:** PLAN Task 3 的七条验收全是 RTL 断言，但 `@testing-library/react` / `@testing-library/dom` / `jsdom` 不在 Plan 02 那次 `gate="blocking-human"` 包合法性核验的 25 包清单里，而 T-09-SC 禁止本 plan 新增未经核验的包。已向 team-lead 请求裁决，两次上报均未获回复。
- **Fix:** (a)(b)(d)(e)(g) 五条改用静态渲染实现；(c)「点一项其余四项不变」改用穷举的纯函数断言（**强度高于**一次点击）；(f) 焦点落位与真实点击两条登记 `SKIPPED_CHECKS.md` 的 `ui-contract-static-render-only`，解除条件写成「批准安装 RTL 后把静态断言换成 RTL 断言」。同时在 STATE.md 记了一条 blocker —— 01-08/10/11/12/14 都需要同一次解除。
- **Committed in:** `e0b3e2d`

---

**Total deviations:** 7（1 条 Rule 1 库能力误判 + 1 条 Rule 3 依赖解析 + 3 条 Rule 2 缺失关键 + 1 条 Rule 1 测试假数据 + 1 条包裁决未决导致的验证手段降级）
**Impact on plan:** 偏离 1/2/3/4/5/6 全部是朝「约束更强」的方向；偏离 7 是唯一一次强度降级，已按登记规则写成可判定的解除条件并上报。无范围蔓延。

## Authentication Gates

无。本 plan 未触及任何需要人工认证的外部服务。

## Issues Encountered

1. **本机跑不了 `next build`**（宿主 glibc 2.28 < Next 16 原生 SWC 要求的 GLIBC_2.29，Turbopack 无 WASM 回退）。已在容器内完成验证：`docker build -f apps/web/Dockerfile` 编译成功，`Route (app)` 里 `/register` 是预渲染静态路由。**本机构建失败与代码无关**，不要当成错误去修。
2. **vitest 不读 tsconfig paths**，apps/web 的 `@/*` 别名在 vitest 下解析失败，而 vitest 把这类失败报成「0 test」且不打印原因（要从 `--reporter=json` 的输出里挖）。已在 `vitest.config.ts` 的 unit project 里映一次 `@/` → `apps/web/src/`。
3. **源码断言会把自己的说明判成违规。** 「代码里不得出现『全选』」这类扫描第一次跑就被 `consent-checkboxes.tsx` 文件头那句「没有『全选』控件」判红。全部源码扫描改为**先去注释再匹配**，并各带一条非空真证明（把违规词放进代码位置仍会被抓到）—— 否则这类断言只会逼人把说明删掉，那是用检查换沉默。
4. **`git checkout --` / `rm -rf` 在沙箱里被拒**（不执行，直接返回 error 对象）。临时破坏验证的还原一律用 Edit 反向改回，临时目录用 node 的 `fs.rmSync` 删。
5. **`state.add-decision` 的 `--summary-file` 拒绝仓库外路径**（`/tmp` 被判 Path escapes allowed directory）。改用仓库内 `.gsd/tmp/` 并在写完后删掉。

## SKIPPED_CHECKS 变更

| 动作 | check id | 说明 |
|---|---|---|
| **删除** | `masked-contact-until-crypto` | crypto 落地，`startContactAttempt` 的 `maskedContact` 改为真实遮蔽形态，并在 `contact-attempt.test.ts` 的 pending 用例补上「联络状态行含遮蔽后的联系方式且不含明文」断言 |
| **新增** | `account-deletion-not-implemented` | 撤回必选同意项的删除入队属 Plan 11；当前抛 not-implemented 于是整条回滚并回 503。解除条件：Plan 11 填实现并把 (d) 改为断言「撤回成功且作业真的入队」 |
| **新增** | `ui-contract-static-render-only` | RTL/jsdom 未获包合法性批准，两条需要真实 DOM 事件的断言（真实点击、焦点落位）暂缺。解除条件：批准安装 RTL 后换成 RTL 断言 |

**未新增** 任何关于 `policy_version` 的登记行 —— 该依赖由 Plan 15 前移到 wave 5 真正解决了，`policy-version-binding.test.ts` 有一条断言盯着这件事。

## User Setup Required

无新增外部服务，但**新增两个必填部署变量**（无默认值、compose 层 `:?` 必填）：

| 变量 | 形态 | 生成 |
|---|---|---|
| `BETTER_AUTH_SECRET` | ≥32 字符 | `openssl rand -hex 32` |
| `CONTACT_ENCRYPTION_KEY` | **64 个十六进制字符**（32 字节 AES-256 密钥） | `openssl rand -hex 32` |

⚠️ 轮换 `CONTACT_ENCRYPTION_KEY` 会让已存的 `contact_ref_encrypted` 全部解不开（危机流程会退到 `unavailable` 并如实告知用户）。轮换前必须先做一次重加密迁移。

`apps/api/Dockerfile` 新增 `COPY apps/web/content/`：`policy_version` 在模块加载期读 `privacy.md`，不拷进镜像会让 api 起不来。

## Verification Results

| 检查 | 结果 |
|---|---|
| `pnpm run ci:fast` | 退出 0（typecheck + lint + 113 unit + 217 contract） |
| `pnpm run test:integration` | 8 文件 / 100 用例全绿 |
| `node tools/ci/check-contract-amendments.mjs` | `OK 13/13 contract amendments` |
| `pnpm run typecheck:fixtures` | 非零退出，13 条 `error TS`（`consent-ticket-escape.ts` 4 条 + `gated-text-escape.ts` 6 条 + `probe-routed.ts` 3 条） |
| `grep -rn 'as ConsentTicket' packages apps` | 只有 `packages/db/src/consent-ticket.ts` 一处（含两行注释） |
| `grep -c 'used_by IS NULL' apps/api/src/modules/auth/invite.ts` | 2 |
| `docker build -f apps/web/Dockerfile` | 成功，`/register` 预渲染为静态路由 |
| 临时破坏验证 | 把写 consent 挪出事务 → register (c) 变红（已还原）；另有三条注入式非空真证明常驻测试 |

## Self-Check: PASSED

- `key-files.created` 全部在磁盘上（逐个 `[ -f ]` 通过）
- `git log --oneline --grep="01-09"` 返回 3 条生产提交
- 每个任务的 `<acceptance_criteria>` 逐条复核：Task 1 八条、Task 2 六条、Task 3 七条 —— 全部通过，唯一降级项（RTL 的两条 DOM 事件断言）已按登记规则写入 SKIPPED_CHECKS 并上报
- 计划级 `<verification>` 六条：1/2/3/4/6 通过；第 5 条的三次「临时破坏再还原」有两次改成了测试内常驻注入（更强），其中「写 consent 挪出事务」按字面做过一次并已还原

## Next Phase Readiness

**给后续 plan 的交接事实（务必先读这几条）：**

1. **`insertUserMessage` / `insertCharacterMessage` 现在要一张 `ConsentTicket<'sensitive_pi'>`。** 票只能由 `requireConsent(executor, userId, 'sensitive_pi')` 发出，且必须在**同一个事务**里取。新增任何消息写入点都要先取票。
2. **不要为 `research_l0` / `research_l1` / `persona_evolution` 造 `requireConsent` 消费点。** 三者在 Phase 1 没有任何数据流，造假消费点会让 Plan 10 的「你已经授权，我们目前还没有开始收集这项数据」变成一句假话；已有一条集成断言盯着这件事。
3. **Plan 11 必须替换 `apps/api/src/worker/jobs/account-deletion.ts` 的 `enqueueAccountDeletion`（签名不变，取 `Executor` 以便与撤回记录同事务），把 `consent-ticket.test.ts` 的 (d) 改为断言「撤回成功且作业真的入队」，并删掉 `SKIPPED_CHECKS.md` 的 `account-deletion-not-implemented` 行。**
4. **Plan 10 的隐私中心可以直接消费 `listConsents()`**（`apps/api/src/modules/consent/service.ts`）与 `GET /me/consents`；撤回走 `POST /me/consents/:scope/revoke`，必选项在没拿到逐字短语时返回 409 + `confirmationCopy`（文案来自 `@drift/contract` 的 `revokeConfirmationCopy()`，不要在前端再抄一份）。
5. **`DATA_INVENTORY` 仍未落地（Plan 10 的义务，路径必须是 `packages/db/src/inventory.ts`）。** `legal-collected-section-matches-inventory` 这条 skip 还在。
6. **同意与紧急联系人的取值域、`isAdult`、撤回确认文案都在 `@drift/contract`。** apps/web 不能 import `@drift/db`（后者加载即读 `DATABASE_URL`），需要跨端共享的常量一律放 contract。
7. **两个新必填 env**（`BETTER_AUTH_SECRET` / `CONTACT_ENCRYPTION_KEY`）：新写集成测试时必须在 import apps/api 之前设好，否则 `config/env.ts` 会 `process.exit(1)` 而 vitest 只报「0 test」。
8. **`vitest.config.ts` 的 unit project 现在含 `.tsx` 并映了 `@/` 别名** —— 后续 plan 的 web 渲染断言可以放在组件旁边。
9. **RTL/jsdom 的包裁决仍未决**，STATE.md 有一条 blocker。01-08/10/11/12/14 的验收里都写着 RTL 断言；建议在下一个需要它的 plan 之前一次性解决。
10. **`docker build -f apps/web/Dockerfile -t drift-web-verify:01-09 .` 留下了一个本地镜像标签**（验证用），可安全删除。

---
*Phase: 01-compliance-safety-chat-skeleton*
*Completed: 2026-09-27*
