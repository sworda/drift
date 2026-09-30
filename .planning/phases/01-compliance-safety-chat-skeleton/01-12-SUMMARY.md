---
phase: 01-compliance-safety-chat-skeleton
plan: 12
subsystem: safety
tags: [usage-timer, dependency-thresholds, hard-exit, pg-boss, websocket, exit-filter, compliance, rtl]

requires:
  - phase: 01-06
    provides: "safetyGateway 的 outcome 判别式与挽留词表运行时拦截、EGRESS_POINTS 注册表"
  - phase: 01-08
    provides: "RTL 测试栈与 crisis 目录计时器禁令先例、探针 yaml 受控子集解析器"
  - phase: 01-04
    provides: "usage_segment / exit_intent / dependency_signal 表与 DEPENDENCY_RULE_IDS 取值域"
provides:
  - "服务端连续使用计时：usage_segment 按 user_id 归集（跨角色合并、跨刷新/重登录有效）、15 分钟分段、7200×(n+1) 重复提醒、pg-boss 到点作业补齐只读不发"
  - "依赖信号三阈值纯函数（daily_usage_over_3h / seven_consecutive_days / late_night_share_over_40pct）+ 04:00 日扫 + 72h 去重 + evidence 只存聚合值"
  - "两档硬退出过滤器（归一化 + 整句锚定 + 长度上限，代码级不走模型）+ 21 条含阴性探针集与常驻子串回归守卫"
  - "零出站多处执行：网关 readConversationStatus 端口（网关内最后一刻读）、usage-reminder/dependency-scan 只发 active 会话、contact-status-event 同查询读 status、turn 落库事务重读、executeHardExit 按 singletonKey 显式取消（必填端口 + 注册表）"
  - "POST /conversations/:id/exit 窗口操作退出入口 + conversation.ended 下行事件"
  - "三个 UI 面：2 小时提醒 Dialog（双按钮、次按钮 ghost）、依赖告知 Dialog（单按钮 + SAFE-14 边界引导次级说明行）、中性系统卡片 + 禁用输入框 + 更多 Sheet 直接执行入口"
affects: [01-14-ui-polish, phase-02-safety-calibration, phase-05-shadow]

actuals:
  tokens: 98000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "计时权威在服务端 + 前端目录级计时器禁令：DB 为真相、pg-boss 推一把、eslint 负向 fixture 钉住非空真"
    - "条件更新幂等（判据进 WHERE）：pg-boss at-least-once 投递下的重复执行影响 0 行"
    - "零出站的多处执行：取消（第一道）+ 每个出站 worker 发送前重读会话状态（竞态兜底），只靠任何一处都不够"
    - "端口化状态读取：readConversationStatus 让「何时读」由网关决定，调用方无法传过期值"
    - "用户级事件按 active 会话房间路由 + ended 会话零投递（COMPLY-05 在 worker 侧的形态）"

key-files:
  created:
    - apps/api/src/modules/usage/segment.ts
    - apps/api/src/modules/usage/thresholds.ts
    - apps/api/src/modules/usage/dependency.ts
    - apps/api/src/modules/chat/exit.ts
    - apps/api/src/worker/jobs/usage-reminder.ts
    - apps/api/src/worker/jobs/dependency-scan.ts
    - packages/safety/src/exit-filter.ts
    - packages/contract/src/exit.ts
    - apps/web/src/components/ui/dialog.tsx
    - apps/web/src/components/ui/sheet.tsx
    - apps/web/src/features/chat/copy.ts
    - apps/web/src/features/chat/usage-reminder-dialog.tsx
    - apps/web/src/features/chat/dependency-notice-dialog.tsx
    - apps/web/src/features/chat/exit-system-card.tsx
    - apps/web/src/features/chat/more-sheet.tsx
    - tests/probes/exit-keywords/tier1.yaml
    - tests/probes/exit-keywords/tier2.yaml
    - tests/probes/exit-keywords/negatives.yaml
    - tests/probes/exit-keywords.test.ts
    - tests/integration/usage-timer.test.ts
    - tests/integration/dependency-scan.test.ts
    - tests/integration/hard-exit.test.ts
    - tools/ci/exit-ui-contract.test.ts
    - tools/ci/chat-timer-ban.test.ts
    - tools/ci/fixtures/chat-settimeout.tsx
  modified:
    - packages/safety/src/gateway.ts
    - packages/safety/src/gateway.test.ts
    - packages/safety/src/index.ts
    - packages/db/src/message.ts
    - packages/contract/src/index.ts
    - apps/api/src/modules/chat/turn.ts
    - apps/api/src/modules/chat/routes.ts
    - apps/api/src/modules/safety/contact-status-event.ts
    - apps/api/src/worker/index.ts
    - apps/api/src/obs/logger.ts
    - apps/web/src/features/chat/dependency-notice-dialog.test.tsx
    - tests/probes/yaml.ts
    - tests/integration/tracer.test.ts
    - tests/integration/export.test.ts
    - tools/ci/egress-registry.test.ts
    - eslint.config.js

key-decisions:
  - "rule_id 用 DB CHECK 的取值域（daily_usage_over_3h 等）而非 PLAN 字面（daily_3h 等）—— 写 PLAN 的值插不进 dependency_signal；一致性由 tools/ci/exit-ui-contract.test.ts 的集合相等断言守着"
  - "网关 conversationStatus 值参数改为 readConversationStatus 端口（handoff #18 的落实）：LLM 调用耗时数秒，值参数会让网关拿到过期状态；端口让读取发生在网关内部、判定之前"
  - "executeHardExit 的「按 singletonKey 取消」做成必填端口 + 会话级队列注册表（Phase 1 为空是事实陈述：contact-attempt-timeout 以 attemptId 为 key 且危机状态机不能被取消，usage-reminder 是用户级义务不能因单会话退出而丢）—— Phase 2 的拟真延迟投递接入时只需注册，不改本函数"
  - "usage-reminder 的 boss 排定器未注册时降级为 warn 而非抛错（与 contact-attempt-timeout 的差异）：消息驱动的提醒照常发生，只缺「只读不发」的补充路径，让消息链路因它失败是把补充义务摆在主义务前面"
  - "insertSystemMessage 落在 packages/db/src/message.ts（PLAN files_modified 之外）：nextSeq 私有且消息插入归 packages/db 所有；不需要 GatedText（平台常量非模型输出）、不需要同意票（行内无用户内容）"
  - "dependency-scan 的时区写死 Asia/Shanghai (+480)：Phase 1 用户全部境内，如实反映而非猜测；Phase 2 校准时挪进用户档案"

patterns-established:
  - "用户级 WS 事件路由：按 user 的 active 会话逐房间 publish —— 同时就是 COMPLY-05 的 worker 侧执行点"
  - "破坏验证双轨：常驻注入式守卫（阴性探针、截断用例集、eslint 负向 fixture）+ 执行者一次性临时改坏再还原"
  - "evidence 只存聚合值：类型层 Record<string, number> + 集成断言序列化后不含消息正文子串（T-12-07 双保险）"

requirements-completed: [COMPLY-03, COMPLY-04, COMPLY-05, SAFE-14]

coverage:
  - id: D1
    description: "服务端连续使用计时与 2 小时重复提醒（跨刷新/重登录有效、4 小时两次、只读不发也被提醒、重复投递只提醒一次）"
    requirement: COMPLY-03
    verification:
      - kind: integration
        ref: "tests/integration/usage-timer.test.ts#(a)-(f) 六条断言"
        status: pass
      - kind: contract
        ref: "tools/ci/chat-timer-ban.test.ts#chat 目录计时器禁令 + 负向 fixture 非空真"
        status: pass
    human_judgment: false
  - id: D2
    description: "依赖信号三阈值纯函数 + 日扫 + 72h 去重（六个边界 + 时区窗口 + 去重边界）"
    requirement: COMPLY-04
    verification:
      - kind: unit
        ref: "apps/api/src/modules/usage/thresholds.test.ts#八条边界断言"
        status: pass
      - kind: integration
        ref: "tests/integration/dependency-scan.test.ts#(a)-(e)：schedule 注册、留证+告知、evidence 无正文、72h 去重、ended 零投递"
        status: pass
    human_judgment: false
  - id: D3
    description: "依赖告知单按钮 Dialog + SAFE-14 情感边界引导次级说明行（不提供第二个选项）"
    requirement: SAFE-14
    verification:
      - kind: unit
        ref: "apps/web/src/features/chat/dependency-notice-dialog.test.tsx#恰好 1 个 button、无「不再提醒」控件、边界文案逐字"
        status: pass
      - kind: contract
        ref: "tools/ci/exit-ui-contract.test.ts#文案与 UI-SPEC 运行时提取逐字比对"
        status: pass
    human_judgment: false
  - id: D4
    description: "两档硬退出过滤器：归一化 + 整句锚定 + 长度上限，21 条含阴性探针集 + 常驻子串回归守卫"
    requirement: COMPLY-05
    verification:
      - kind: unit
        ref: "tests/probes/exit-keywords.test.ts#26 条断言（21 用例 + 条数守卫 + 非空真 + 四条指定阴性）"
        status: pass
      - kind: contract
        ref: "tools/ci/exit-ui-contract.test.ts#无 includes/indexOf、无 LLM 调用、词表逐字等于 D-12"
        status: pass
    human_judgment: false
  - id: D5
    description: "硬退出后当前会话零出站（含定时与推送）：网关 refused + worker 重读 + 落库事务重读 + 显式取消，挽留触发率恒为 0"
    requirement: COMPLY-05
    verification:
      - kind: integration
        ref: "tests/integration/hard-exit.test.ts#(a)-(f) + 幂等 + 注入式端口断言 + 真实 pg-boss 按 key 取消"
        status: pass
      - kind: unit
        ref: "packages/safety/src/gateway.test.ts#COMPLY-05：会话 ended ⇒ 拒绝产出 GatedText"
        status: pass
    human_judgment: false
  - id: D6
    description: "中性系统卡片 + 禁用输入框 + 更多 Sheet 直接执行入口 + 两个提醒 Dialog 的 UI 契约（无二次确认/挽留控件，不吃 care 色）"
    requirement: COMPLY-05
    verification:
      - kind: automated_ui
        ref: "apps/web/src/features/chat/exit-ui-contract.test.tsx#(a)-(e) RTL 断言"
        status: pass
      - kind: contract
        ref: "tools/ci/exit-ui-contract.test.ts#care token 隔离与 UI-SPEC 逐字比对"
        status: pass
    human_judgment: false
  - id: D7
    description: "「收到服务端事件时弹一次 Dialog」的浏览器侧 WS 客户端接线"
    requirement: COMPLY-03
    verification: []
    human_judgment: true
    rationale: "三个 Dialog/卡片组件已交付并被 RTL 契约测试钉住（open 由 props 驱动），但 apps/web 目前没有 WS 客户端（chat 页是服务端渲染，Plan 01-03 起即为如此）—— 「事件到达 ⇒ 弹窗」的端到端链路要等 Plan 14 的 UI 接线，机器此刻证明不了浏览器侧行为"

duration: 55min
completed: 2026-09-27
status: complete
---

# Phase 01 Plan 12: 服务端计时器与两档硬退出 Summary

**usage_segment 服务端计时（按 user_id 归集 + pg-boss 到点作业，4 小时提醒两次）、依赖三阈值纯函数与 72h 去重日扫、两档整句锚定退出过滤器与零出站多处执行（网关 + worker + 落库事务），配三个契约测试过的 UI 面与 21 条含阴性词表探针集。**

## Performance

- **Duration:** 55 min
- **Started:** 2026-09-27T17:04:14Z
- **Completed:** 2026-09-27T17:56:45Z
- **Tasks:** 3
- **Files modified:** 41（新建 25 / 修改 16）

## Accomplishments
- COMPLY-03：计时权威在服务端 —— 状态在 DB 按 user_id 归集（跨角色合并、跨刷新/重登录有效），15 分钟分段（14/16 分钟两侧钉住），7200×(reminded_count+1) 的重复提醒语义（4 小时两次），pg-boss 到点作业让「只读不发」也能被提醒，条件更新保证重复投递只提醒一次
- COMPLY-04/SAFE-14：三条硬阈值是可单测的纯函数（六个边界 + 时区 + 72h 去重窗口），04:00 日扫留证 dependency_signal 并只向 active 会话发 dependency.notice，告知是单按钮 Dialog + 情感边界引导次级说明行
- COMPLY-05：两档退出过滤器用整句锚定 + 长度上限（子串匹配被 9 条阴性样本常驻守卫钉死）；硬退出后零出站在网关（readConversationStatus 端口）、worker（usage-reminder/dependency-scan/contact-status 各自重读）、落库事务（turn 第 7 步）三处独立成立，executeHardExit 同时置状态、按 singletonKey 显式取消（必填端口）、插中性系统卡片

## Task Commits

1. **Task 1: usage_segment 服务端计时 + 2 小时重复提醒** - `bb571af` (feat)
2. **Task 2: 依赖信号三阈值纯函数 + 日扫与 72h 去重 + 单按钮告知 Dialog** - `b9237fa` (feat)
3. **Task 3: 两档硬退出过滤器 + 零出站双处执行 + 中性系统卡片 + 词表测试集** - `0c8cd85` (feat)

**Plan metadata:** 本 commit (docs)

## Files Created/Modified

见 frontmatter 的 key-files（41 个文件）。核心链路：
- `apps/api/src/modules/usage/segment.ts` — touchUsageSegment（与消息落库同事务）+ runUsageReminder（条件更新幂等 + 只发 active 会话）
- `apps/api/src/modules/usage/thresholds.ts` — DEPENDENCY_THRESHOLDS 五常量 + evaluateDependencyRules 纯函数
- `apps/api/src/modules/chat/exit.ts` — executeHardExit（三件事一体）+ 会话级队列注册表 + 按 key 取消
- `packages/safety/src/exit-filter.ts` — normalizeUtterance + matchExitIntent（整句锚定）
- `packages/safety/src/gateway.ts` — conversationStatus → readConversationStatus 端口
- `apps/web/src/features/chat/*` — copy.ts 单一定义 + 三个 UI 面 + sheet/dialog 原语

## Decisions Made

见 frontmatter 的 key-decisions（六条，均含理由）。

## Deviations from Plan

### 与 PLAN 字面不同的实现（Rule 1/3 类，均已验证）

**1. [Rule 3 - Blocking] rule_id 取值域用 DB CHECK 而非 PLAN 字面**
- **Found during:** Task 2
- **Issue:** PLAN 写 daily_3h / consecutive_7d / night_ratio_40，但 dependency_signal 的 DB CHECK（0000 迁移）只认 daily_usage_over_3h / seven_consecutive_days / late_night_share_over_40pct —— 写 PLAN 的值插不进表
- **Fix:** 用 DB 的取值域；thresholds.ts 本地定义（不 import @drift/db 包入口，避免单元层拖进连接池），与 DB 的一致性由 tools/ci/exit-ui-contract.test.ts 的集合相等断言守着
- **Verification:** 集成测试真实插入 dependency_signal 全绿

**2. [Rule 3 - Blocking] hard-exit (a) 的「延迟投递作业」用两个真实形态补位**
- **Found during:** Task 3
- **Issue:** PLAN 假设 Phase 1 有「延迟投递」队列（拟真回复延迟），实际不存在（REAL-04 属 Phase 2）
- **Fix:** (a) 用 ① 会话级探针队列（验证 executeHardExit 的按 singletonKey 取消在真实 pg-boss 上成立）+ ② 真实排定的 usage-reminder 作业（取消不掉的作业也发不出消息 —— worker 事务内重读才是竞态兜底）两个方向合起来覆盖原断言意图
- **Verification:** hard-exit (a) 全绿；cancelConversationJobs 真实取消断言独立存在

**3. [Rule 1 - API 形态] executeHardExit 签名从 (tx, conversationId) 改为 (conversationId, ports, context)**
- **Found during:** Task 3
- **Issue:** 「按 singletonKey 取消」需要 boss 实例，tx 参数装不下；且组合（事务 → 取消 → 事件）无法在 tx 回调内完成
- **Fix:** 必填 ports（注入使组合可测）+ context（userId 与 matchedRule）；幂等（alreadyEnded 不插第二张卡片）与注入式端口断言都有测试
- **Verification:** hard-exit 的「幂等」「取消端口被调用」两条断言

**4. [Rule 2 - Missing Critical] 零出站补了 PLAN 没列的两处执行点**
- **Found during:** Task 3
- **Issue:** PLAN 列了网关与 worker 两处，但 turn.ts 第 7 步的落库事务在网关判定之后还有一个数秒窗口（LLM 调用）；contact-status-event 的广播也是一条出站路径
- **Fix:** 第 7 步事务内重读 status（ended ⇒ 该轮 refused、不落库）；contact-status-event 在同一条查询里读 conversation.status（ended ⇒ 不广播）
- **Verification:** hard-exit (a) 的 WS 帧窗口断言覆盖前者；后者由代码评审 + contact-status-event 的实现保证（状态推进照常落库、只拦广播）

**5. [Rule 1 - 范围边界] 「换 session 重登录」以机制等价形态断言**
- **Found during:** Task 1
- **Issue:** fixtures 不走 HTTP 注册（fixtures.ts 拒绝的理由同样适用于这里）
- **Fix:** (b) 断言「断开重连后累计不变 + 第二个会话（另一角色）继续累计在同一段」—— 状态在 DB 按 user_id 归集是跨刷新/重登录有效的充分条件
- **Verification:** usage-timer (b) 全绿

**6. [Rule 3 - 文件清单外] insertSystemMessage 落在 packages/db/src/message.ts**
- **Found during:** Task 3
- **Issue:** nextSeq 私有；消息插入的出口归 packages/db 所有（架构边界）
- **Fix:** 新增 insertSystemMessage（无 GatedText —— 平台常量非模型输出；无同意票 —— 行内无用户内容；provenance.acquiredVia='system'）
- **Verification:** hard-exit (c) 断言系统卡片行形状

---

**Total deviations:** 6 auto-fixed（Rule 1 × 2、Rule 2 × 1、Rule 3 × 3）
**Impact on plan:** 全部为 PLAN 字面与既有架构事实的对接，无范围扩张；零出站与计时的语义均强于 PLAN 字面。

## Issues Encountered
- 执行过程中三次 Write 误用了会话里的旧字符串变量，导致四个文件被写成前一个文件的内容（typecheck 立刻暴露）—— 全部重写并逐一核对文件头后消除，最终提交内容已验证正确
- pg-boss getSchedules 的时区字段名是 timezone 而非入参的 tz（.d.ts 实读纠正，与 handoff #8 同类）；short 策略下同 singletonKey 的第二个作业会被拒绝 —— usage-timer (e) 因此改为直接插段行避开排队冲突
- 宿主机时区是 UTC+8：dependency-scan 的种子段最初以「现在」为锚，凌晨跑测试会命中夜间规则 —— 固定到「昨天北京白天 10:00–13:00」后与运行时刻无关

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- 15 个 plan 已完成 13 个（01-12 之后余 01-14 UI polish 与 01-15 收尾类）；三个 Dialog/卡片组件等待 Plan 14 的 WS 客户端接线（D7 的 human_judgment 项）
- 依赖阈值与 SAFETY_CONFIDENCE_FLOOR 同属「保守起点」：Phase 2 用真实数据校准（CONTEXT D-13）
- Phase 2 接入拟真延迟投递队列时：调 registerConversationScopedQueue() 注册即可获得硬退出取消，executeHardExit 无需改动

---
*Phase: 01-compliance-safety-chat-skeleton*
*Completed: 2026-09-27*
