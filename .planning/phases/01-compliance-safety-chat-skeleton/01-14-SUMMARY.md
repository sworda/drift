---
phase: 01-compliance-safety-chat-skeleton
plan: 14
subsystem: ui
tags: [unread-badge, backfill, websocket, telemetry, disclosure, rtl, playtest, compliance, accessibility, character-review]

requires:
  - phase: 01-04
    provides: "GET /conversations/:id/messages?after_seq 游标补拉与 seq 取号、DISCLOSURE_SURFACES 常量、reviewCharacterConcept 与 3 个种子角色、WS_TOPICS topic 命名空间"
  - phase: 01-12
    provides: "用户级 WS 事件按 active 会话房间路由（usage-reminder / dependency-scan / contact-status）、三个 Dialog 组件、executeHardExit 零出站执行点、RTL 测试栈"
provides:
  - "会话列表：GET /conversations（unread_count / last_message_at / counterpart_kind）+ POST /conversations/:id/read + 72px 固定行高列表（未读徽章 0 不渲染 / 1-99 数字 / 99+，标题 truncate、AI 徽标 shrink-0，首读锚点）"
  - "离线未读与分割线：first_unread_seq 定位 +「以下是你离开后的消息」（本次会话内持续可见、进入时计算一次并固定）"
  - "断连重连细条 + 浏览器会话载体（chat-client.tsx + chat-socket.ts + lib/session.ts）：Plan 12 三个 Dialog 的 WS 事件接线闭环（handoff #75 义务）"
  - "表情选择器（移动 Sheet / 桌面 Popover，v1 仅 Unicode）+ 重试控件（图标 + 13px 可见文字 + 44×44 触控区 + aria-label）"
  - "EmptyOrError 空错区分容器（可判别联合，error 强制 action、empty 强制 heading+body，四处接入）+ 全局 error boundary + POST /telemetry/error（zod 白名单拒绝未知字段 + 4KB 上限 + IP/session 限流 + componentStack 中文句子剥离）"
  - "角色详情页：sticky 名字+徽标行、骨架屏含 AI 徽标位占位（法定标识无闪缺窗口）、唯一 accent 主 CTA"
  - "四处标识覆盖元测试（DISCLOSURE_SURFACES 每项必须有通过的断言）+ 四条 backstop 视觉测试 + COMPLY-08 审核断言 + 01-PLAYTEST.md 人工走查记录（成功标准 1）"
affects: [phase-01-verification, phase-02-realism-ui, phase-04-character-creation]

actuals:
  tokens: 90600
  tasks: 4
  commits: 14

tech-stack:
  added: []
  patterns:
    - "覆盖元测试：注册表（DISCLOSURE_SURFACES）的每一项都要求存在一条针对它的通过断言 —— 防「加了第四处但只测了三处」，加第五项不写断言即变红（负向 fixture 钉住）"
    - "上报载荷白名单三件套：zod 严格 schema（未知字段拒绝而非忽略）+ componentStack 先过中文句子正则剥离 + 写入行不含特征串 6 字子串的集成断言"
    - "空错区分做成类型义务：EmptyOrError 可判别联合 + 负向 type fixture 证明混用/缺 action 是编译错误（tools/ci/type-fixtures/empty-or-error-escape.ts）"
    - "走查即修复轨迹：人工走查发现的问题当 commit 留证、复验后勾选 —— 记录表与 git log 一一对应"

key-files:
  created:
    - apps/api/src/modules/conversations/routes.ts
    - apps/api/src/modules/telemetry/routes.ts
    - apps/web/src/features/conversations/conversation-list.tsx
    - apps/web/src/features/conversations/unread-badge.tsx
    - apps/web/src/features/chat/unread-separator.tsx
    - apps/web/src/features/chat/reconnect-bar.tsx
    - apps/web/src/features/chat/emoji-picker.tsx
    - apps/web/src/features/chat/message-retry.tsx
    - apps/web/src/features/chat/composer.tsx
    - apps/web/src/features/chat/chat-client.tsx
    - apps/web/src/features/characters/character-detail.tsx
    - apps/web/src/components/empty-or-error.tsx
    - apps/web/src/components/error-boundary.tsx
    - apps/web/src/lib/chat-socket.ts
    - apps/web/src/lib/session.ts
    - apps/web/src/app/(app)/characters/[characterId]/page.tsx
    - tests/integration/unread-and-backfill.test.ts
    - tests/integration/telemetry.test.ts
    - tools/ci/disclosure-surfaces.test.ts
    - tools/ci/ui-state-visual.test.ts
    - tools/ci/character-review.test.ts
    - tools/ci/client-auth-fetch.test.ts
    - tools/ci/next-public-build-arg.test.ts
    - tools/ci/strip-only-scan.ts
    - tools/ci/theme-bridge-completeness.test.ts
    - tools/ci/ui-size-scale.test.ts
    - .planning/phases/01-compliance-safety-chat-skeleton/01-PLAYTEST.md
    - .planning/todos/pending/2026-09-29-desktop-sidebar-layout-1024px.md
  modified:
    - apps/api/src/http/app.ts
    - apps/api/src/modules/chat/routes.ts
    - apps/api/src/modules/chat/turn.ts
    - apps/api/src/modules/characters/routes.ts
    - apps/api/src/modules/safety/alert.ts
    - apps/web/src/app/globals.css
    - apps/web/src/app/layout.tsx
    - apps/web/src/features/chat/chat-view.tsx
    - apps/web/src/features/onboarding/steps.tsx
    - apps/web/src/features/onboarding/age-gate.tsx
    - apps/web/src/features/privacy/export-panel.tsx
    - apps/web/Dockerfile
    - docker-compose.yml
    - packages/db/src/seed/characters.ts
    - .planning/phases/01-compliance-safety-chat-skeleton/01-UI-SPEC.md

key-decisions:
  - "断连补拉在 v1 是原子的（补完才渲染），不区分「已补齐区段」与「仍缺失区段」 —— UI-SPEC 标记为 unresolved 的一项按该假设实现；若将来改流式补拉需回 UI-SPEC 补一行（PLAN acceptance criteria 显式要求本 SUMMARY 记录）"
  - "浏览器会话载体（chat-client / chat-socket / lib/session）是 Task 1 的实质新增而非 PLAN 字面文件 —— handoff #75：01-12 交付三个 Dialog 但 apps/web 无 WS 客户端，「事件到达⇒弹窗」的浏览器侧接线是本 plan 的义务；conversationStatus 读法维持 01-12 的端口形态不变"
  - "桌面端（≥1024px）侧栏布局不落本 plan：走查当天以两档断点（md:640 / lg:720）缓解全站 480px 单列，登记 todos/pending/2026-09-29-desktop-sidebar-layout-1024px.md，并在 01-UI-SPEC.md:52 追加「走查修正（列宽）」登记，明文写下侧栏落地后须删掉两档断点 —— SPEC 与代码的这次耦合是 todo 的主要交付物之一，漏掉它列宽会永久停在临时态"
  - "走查以迭代修复形式进行且如实落档：第一轮 6 个缺陷 + 复验期 4 项修复全部有 commit 留证；期间编排器重建 api 容器误覆盖 WEB_ORIGIN 导致一轮 CORS 回归（操作失误，非产品缺陷，已固化 .env）"
  - "走查者诚实性：本轮走查由产品开发者本人执行（同一个人边走边修），不是 ROADMAP 字面要求的「没见过这个产品的人」—— 缺陷发现与修复真实（commit 为证），但「独立完成、无需解释」的字面判据未经无偏样本验证；建议公开上线前（非 Phase 1 出场门）由真正的首次使用者补走一轮（01-PLAYTEST.md 诚实性备注，阶段验证并入 D13 复核）"
  - "NEXT_PUBLIC_API_ORIGIN 改为构建期注入（web Dockerfile ARG）：注册提交曾永久打到 127.0.0.1:3001，运行时 env 对 Next 的客户端 bundle 不可见是根因；隐私中心改走 authedFetch + Blob 下载并补客户端鉴权断言"

patterns-established:
  - "覆盖元测试：注册表驱动断言完备性 —— 每个新增 surface 必须带一条针对它的通过断言，负向 fixture（加第五项不写断言）证明非空真"
  - "上报载荷白名单：不引入 Sentry（D-28 出境路径），自建端点以 zod 严格 schema 为唯一边界，剥离与 6 字子串断言双保险"
  - "空错区分的类型义务：可判别联合 + 负向 type fixture，让「静默渲染成空列表」成为编译错误而非 code review 责任"
  - "backstop 视觉测试：30 字角色名 / 2000 字消息 / 超长危机清单 / 超长联系人姓名四条极端输入的 DOM 级断言（RTL，jsdom 不做像素断言）"

requirements-completed: [CHAT-01, CHAT-04, CHAT-05, CHAT-06, CHAT-07, COMPLY-01, COMPLY-02, COMPLY-08, IFC-08]

coverage:
  - id: D1
    description: "会话列表与未读徽章（72px 行高三情形、0 不渲染 / 1-99 数字 / 99+、首读锚点、标题 truncate + 徽标 shrink-0、跨用户 404）"
    requirement: CHAT-05
    verification:
      - kind: integration
        ref: "tests/integration/unread-and-backfill.test.ts#(a)(d)(f)"
        status: pass
      - kind: unit
        ref: "apps/web/src/features/conversations/conversation-list.test.tsx#72px 三情形 / 0-99-99+ / truncate+shrink-0 / ≥44px 可点区域"
        status: pass
    human_judgment: false
  - id: D2
    description: "离线未读与 after_seq 游标补拉（恰好 M 条、seq 连续无空洞无重复、补拉期间新消息 seq 更大）+ 未读分割线（read 后仍在 DOM）"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "tests/integration/unread-and-backfill.test.ts#(b)(c)"
        status: pass
      - kind: unit
        ref: "apps/web/src/features/chat/chat-client.test.tsx#未读分割线出现在首条未读之前且 POST read 后仍在 DOM"
        status: pass
    human_judgment: false
  - id: D3
    description: "断连重连细条（DOM 位于 AI 常驻条之后、补拉完成后消失、补拉期间输入框可用）"
    requirement: CHAT-07
    verification:
      - kind: unit
        ref: "apps/web/src/features/chat/chat-client.test.tsx#重连细条在 DOM 顺序上位于 AI 常驻条之后（compareDocumentPosition）"
        status: pass
    human_judgment: false
  - id: D4
    description: "表情选择器（Sheet/Popover 双形态、可访问名称「插入表情」）与重试控件（图标+13px 可见文字+44×44+aria-label，去色后仍可识别）"
    requirement: CHAT-04
    verification:
      - kind: unit
        ref: "apps/web/src/features/chat/composer.test.tsx#六个用例；apps/web/src/features/chat/message-retry.test.tsx#三个用例"
        status: pass
    human_judgment: false
  - id: D5
    description: "POST /telemetry/error（zod 白名单拒绝未知字段、4KB 上限、IP/session 限流 429、写入行不含特征串 6 字子串、未认证可上报但更严限流）+ 全局 error boundary + unhandledrejection 上报"
    requirement: COMPLY-01
    verification:
      - kind: integration
        ref: "tests/integration/telemetry.test.ts#(a)-(e) 五条断言"
        status: pass
    human_judgment: false
  - id: D6
    description: "四处 AI 标识覆盖元测试（conversation_list / chat_banner / character_detail / export_file 各带 testId 且每项有通过的断言；常量单一定义 as const 冻结；渲染条件只依赖 counterpart_kind；无「关闭 AI 提示」类控制文案）"
    requirement: COMPLY-01
    verification:
      - kind: contract
        ref: "tools/ci/disclosure-surfaces.test.ts#(a)-(h) 八条断言 + 加第五项不写断言即变红的负向 fixture"
        status: pass
    human_judgment: false
  - id: D7
    description: "四条 backstop 视觉测试（30 字角色名 / 2000 字单条消息无横向滚动 / 超长危机清单 sticky 置顶 / 超长联系人姓名不挤出联络状态行）"
    requirement: COMPLY-01
    verification:
      - kind: automated_ui
        ref: "tools/ci/ui-state-visual.test.ts + apps/web/src/ui-state-visual.test.tsx#四条 backstop（去掉 truncate 即变红的负向验证已做并还原）"
        status: pass
    human_judgment: false
  - id: D8
    description: "COMPLY-08 审核纯函数（3 条拒绝样本：像我妈 / 模仿我前女友 / 真人姓名；3 条通过；3 个种子角色 core 与 blurb 全过；hardBoundaries 含「不否认自己是 AI」）"
    requirement: COMPLY-08
    verification:
      - kind: unit
        ref: "tools/ci/character-review.test.ts#9 条断言"
        status: pass
    human_judgment: false
  - id: D9
    description: "角色详情页（骨架屏含徽标位占位、sticky 名字+徽标行、恰好 1 个 accent CTA 与 1 个 20px 元素、简介首行「这是一个 AI 角色。」、dossier markdown 渲染）"
    requirement: CHAT-01
    verification:
      - kind: unit
        ref: "apps/web/src/features/characters/character-detail.test.tsx#loading E6 与详情四条"
        status: pass
    human_judgment: false
  - id: D10
    description: "人工走查（ROADMAP Phase 1 成功标准 1）：七个环节从邀请码到导出全程走查，第一轮发现 6 个真实缺陷当天修复，复验由用户确认「没什么问题了」"
    verification:
      - kind: manual_procedural
        ref: ".planning/phases/01-compliance-safety-chat-skeleton/01-PLAYTEST.md#七环节勾选表 + 修复轨迹 commit 36feb2d..757266b"
        status: pass
    human_judgment: true
    rationale: "走查者是产品开发者本人（同一个人边走边修），不是 ROADMAP 字面要求的「没见过这个产品的人」；缺陷发现与修复真实（commit 留证），但「独立完成、无需解释」的字面判据未经无偏样本验证 —— 阶段验证时并入 D13 复核，建议公开上线前由真正的首次使用者补走一轮"
  - id: D11
    description: "事件 topic 命名空间与 WS 下行事件共用同一定义（IFC-08 第三项）：WS_TOPICS 由 WsDownstream union 派生（01-04 建），本 plan 的浏览器载体 chat-socket 消费同一 union"
    requirement: IFC-08
    verification:
      - kind: other
        ref: "packages/contract/src/topics.ts#WS_TOPICS 编译期从 WsDownstream 派生（单一来源无第二份清单）；ci:fast 的 tsc --build 通过"
        status: pass
    human_judgment: false

duration: 40h
completed: 2026-09-29
status: complete
---

# Phase 01 Plan 14: 会话骨架用户可见面补全 + 标识覆盖元测试 + 人工走查 Summary

**会话骨架剩余用户可见面（未读/分割线/重连细条/表情/重试/空错区分/角色详情页）+ /telemetry/error 白名单端点 + 四处 AI 标识覆盖元测试 + 四条 backstop 视觉测试 + COMPLY-08 审核纯函数，经两轮人工走查（6+4 个真实缺陷修复留证）后用户确认通过。**

## Performance

- **Duration:** ~41 小时（2026-09-28 上午至 09-29 晚，含人工走查等待与两轮修复）
- **Started:** 2026-09-28T02:30:00+08:00
- **Completed:** 2026-09-29T19:13:07+08:00
- **Tasks:** 4（3 auto + 1 人工走查 checkpoint）
- **Files modified:** 78（新建 41 / 修改 37）

## Accomplishments
- 会话列表（unread_count 接口 + 72px 固定行高 + 0/1-99/99+ 未读徽章 + 首读锚点）与离线未读补拉（after_seq 游标、seq 连续无空洞）全部落地并有集成断言
- 浏览器会话载体（chat-client + chat-socket）补齐 —— Plan 12 三个合规 Dialog 的「事件到达⇒弹窗」接线闭环，Phase 1 的 WS 下行链路至此真正到达浏览器
- POST /telemetry/error 白名单端点 + 全局 error boundary：zod 严格 schema 拒绝未知字段、componentStack 中文句子剥离、写入行不含消息正文 6 字子串的集成断言（D-28 的前端上报面）
- 四处 AI 标识的覆盖元测试（加第五处不写断言即变红）+ 四条 backstop 视觉测试 + COMPLY-08 审核纯函数（作用于 3 个种子角色）
- 成功标准 1 的人工走查完成：第一轮发现 6 个真实缺陷（注册死结、spacing 劫持、行高缺失、构建期 env 注入缺失、authedFetch 缺失、年龄终态误触）全部当天修复，复验由用户确认通过，走查记录与修复轨迹入 repo（01-PLAYTEST.md）

## Task Commits

Each task was committed atomically:

1. **Task 1: 会话列表未读 + 离线补拉分割线 + 重连细条 + 角色详情页 + 浏览器会话载体** - `ae12ed3` (feat)
2. **Task 2: 表情与重试控件 + 空错区分容器 + /telemetry/error 端点与全局 error boundary** - `29925b4` (feat)
3. **Task 3: 四处标识覆盖元测试 + backstop 视觉测试 + COMPLY-08 审核断言 + 走查记录表** - `746c649` (feat)
4. **Task 4 checkpoint: 人工走查（迭代修复轨迹，全部已提交）**：
   - `36feb2d` alert.ts 参数属性 → API 容器启动即崩（strip-only）
   - `64ebf27` 注册流程两处禁用按钮死结
   - `2998456` / `cadf9b2` 裸键尺寸 utility 被 --spacing-* 劫持 / --text-* 行高配对缺失
   - `66c091f` NEXT_PUBLIC_API_ORIGIN 构建期注入（注册提交打到错误地址）
   - `13e8dc4` 隐私中心 authedFetch + Blob 下载 + 客户端鉴权断言
   - `6663c6b` 年龄终态改由明确操作触发（日历误触不再锁死注册页）
   - `ae53171` dossier JSONB → markdown 映射（角色详情页）
   - `757266b` 气泡 80% 上限造成循环百分比 + 单列补两档桌面断点（侧栏的缓解，非终态）
   - `6cbc354` 桌面侧栏布局 todo 登记（todos/pending）
   - `fbb55aa` 走查记录落档（含诚实性备注）

**Plan metadata:** 本 SUMMARY 提交

## Files Created/Modified

见 frontmatter key-files（78 个文件，新建 41）。核心：
- `apps/api/src/modules/conversations/routes.ts` - GET /conversations（unread_count）+ POST /conversations/:id/read
- `apps/api/src/modules/telemetry/routes.ts` - POST /telemetry/error（白名单 + 限流 + 4KB 上限）
- `apps/web/src/features/chat/chat-client.tsx` / `chat-socket.ts` / `../lib/session.ts` - 浏览器会话载体（WS 接线）
- `apps/web/src/features/conversations/conversation-list.tsx` - 72px 行高 + 未读徽章 + 首读锚点
- `apps/web/src/components/empty-or-error.tsx` - 空错区分可判别联合容器（四处接入）
- `tools/ci/disclosure-surfaces.test.ts` - 四处标识覆盖元测试
- `.planning/phases/01-compliance-safety-chat-skeleton/01-PLAYTEST.md` - 成功标准 1 走查记录

## Decisions Made
- 见 frontmatter key-decisions 六条（断连补拉原子性、浏览器会话载体、桌面侧栏 todo、走查迭代形态、走查者诚实性、构建期 env 注入）
- 其余按 PLAN 字面执行

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] 浏览器会话载体超出 PLAN 文件清单**
- **Found during:** Task 1（会话列表与聊天界面接线时）
- **Issue:** PLAN 的 files_modified 没有浏览器侧 WS 客户端，但 handoff #75 明确「事件到达⇒弹窗的浏览器侧接线属本 plan 义务」—— 没有它，Plan 12 的三个 Dialog 永远不会弹
- **Fix:** 新增 chat-client.tsx（页面级载体，接 chat-socket 事件并渲染 Dialog）+ chat-socket.ts（重连/补拉/游标）+ lib/session.ts（API origin 等浏览器会话事实）
- **Files modified:** apps/web/src/features/chat/chat-client.tsx、apps/web/src/lib/chat-socket.ts、apps/web/src/lib/session.ts 等
- **Verification:** chat-client.test.tsx 五条用例（DOM 顺序 / 分割线 / icon-only 名称 / 常驻条 sticky / 空态）
- **Committed in:** ae12ed3

**2. [Rule 3 - Blocking] 走查发现的前序 plan 交付物缺陷（6 项，本 plan 内修掉）**
- **Found during:** Task 4 checkpoint 人工走查第一轮
- **Issue:** 注册按钮两处死结（64ebf27）、尺寸 utility 被 spacing 劫持致每行一字（2998456）、行高配对缺失（cadf9b2）、NEXT_PUBLIC_API_ORIGIN 缺构建期注入（66c091f，01-09 缺陷）、隐私中心 fetch 不带鉴权（13e8dc4，01-10 缺陷）、年龄终态被日历误触锁死（6663c6b，01-09 缺陷）
- **Fix:** 逐项修复并附测试（client-auth-fetch.test.ts、next-public-build-arg.test.ts、ui-size-scale.test.ts、theme-bridge-completeness.test.ts、strip-only-scan.ts 均为本次新增的守卫）
- **Verification:** 走查复验通过；ci:fast 414 绿
- **Committed in:** 见 Task Commits 第 4 条

**3. [Rule 3 - Blocking] 桌面端（≥1024px）侧栏布局推迟，以两档断点缓解**
- **Found during:** Task 4 checkpoint 人工走查（1440 视口两侧各空 960px）
- **Issue:** UI-SPEC 桌面终态（单列 480px + 侧栏会话列表）在本 plan 范围外，但走查确认现状在 PC 上不可接受
- **Fix:** 全站 10 处 max-w-[480px] 追加 md:640 / lg:720 两档断点作缓解；登记 todos/pending/2026-09-29-desktop-sidebar-layout-1024px.md（含「侧栏落地后删两档断点」的 SPEC 回写耦合）；01-UI-SPEC.md:52 追加走查修正登记
- **Verification:** 走查复验通过；todo 文件入仓
- **Committed in:** 757266b / 6cbc354

---

**Total deviations:** 3 auto-fixed（1 missing critical + 2 blocking）
**Impact on plan:** 均为走查闭环或 handoff 义务所必需，无范围蔓延；桌面侧栏是显式登记的推迟而非静默遗漏。

## Issues Encountered
- 走查期间编排器重建 api 容器时误覆盖 WEB_ORIGIN 导致一轮 CORS 回归 —— 操作失误而非产品缺陷，已固化 .env 并在 01-PLAYTEST.md 记录
- alert.ts 的参数属性（constructor parameter properties）在 strip-only 运行态不被支持，API 容器启动即崩（36feb2d）—— 已加 tools/ci/strip-only-scan.ts + strip-only-syntax.test.ts 守卫，防同类问题再犯
- jsdom 不支持 ResizeObserver 的约束沿用了既有 stub（handoff #58），本 plan 未新增布局类断言依赖

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 1 全部 15 个 plan 至此完成（01-15 已先行交付）；本 plan 是最后一个执行中的 plan
- 成功标准 1（人工走查）已留证，含诚实性备注（走查者为开发者本人，阶段验证时 D13 复核）
- 成功标准 2/3/5 的机器断言已在各 plan 内钉住（探针集真实分类的 ZHIPU_API_KEY 缺口仍登记在 SKIPPED_CHECKS.md，属阶段验证的已知 human_judgment 项）
- 桌面侧栏布局在 todos/pending 登记，属 Phase 2 UI 工作面

## Self-Check: PASSED

- ci:fast：30 files / **414 tests passed**，退出码 0（2026-09-29 19:23）
- test:integration：17 files / **147 tests passed**，退出码 0（DATABASE_URL 内联 127.0.0.1:55432，2026-09-29 19:23）
- 关键文件存在性：10 个 artifacts 全部在盘（conversation-list / unread-separator / reconnect-bar / message-retry / empty-or-error / telemetry routes / 三个 tools/ci 测试 / PLAYTEST）
- grep 散点验收：conversation-list.tsx shrink-0×3、message-retry.tsx 重试×3、telemetry/routes.ts 无 passthrough()/catchall()、PLAYTEST 表 9 行（表头+分隔+七环节）
- AI_BADGE_TEXT 与 AI_BANNER_TEXT 全仓各恰 1 处定义
- git log 含 ≥1 条 01-14 提交（14 条：ae12ed3..fbb55aa）
- 补拉原子性假设已在本 SUMMARY 显式记录（key-decisions 第一条，含「若改流式补拉需回 UI-SPEC 补一行」）

---
*Phase: 01-compliance-safety-chat-skeleton*
*Completed: 2026-09-29*
