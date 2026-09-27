---
phase: 01-compliance-safety-chat-skeleton
plan: 11
subsystem: privacy
tags: [deletion, export, storage-locations, purge, retention, gatedtext, priv-05, priv-04, comply-02]

# Dependency graph
requires:
  - phase: 01-04
    provides: 22 张表的 drizzle schema、purgeDb（purge_role 连接）、append-only 审计表族的权限面
  - phase: 01-10
    provides: DATA_INVENTORY 单一真相源（retention 字段与豁免清单）、隐私中心四分区骨架
  - phase: 01-09
    provides: 撤回必选项的删除入口签名（enqueueAccountDeletion 桩）、better-auth session 表
provides:
  - packages/db/src/storage-locations.ts —— STORAGE_LOCATIONS（24 项，含三处最易漏的非表存储）+ KNOWN_EXTERNAL_SCHEMAS + A 腿纯函数
  - packages/db/src/deidentify.ts —— deidentifyAuditRows（Q1：七张审计表去标识化，幂等，purge_role 专属）
  - 0004 迁移 —— 审计表可回链列 DROP NOT NULL + purge_role 列级 UPDATE（去标识化的 schema 前提）
  - account-deletion worker —— 逐项 try/catch、回执（clearedCount 不含去标识化项）、M/N partial 分支、幂等短路
  - POST /me/delete + GET /me/privacy-actions/:id + GET /privacy-receipts/:id?token=（删除后回执的可达路径）
  - export-build worker —— .md/.json 双格式、文件头三行 + [AI] 前缀由管道注入、七类覆盖、紧急联系人遮蔽
  - export-artifact-gc（0 5 * * *，7 天 TTL）+ retention-cleanup（45 18 * * *，规则由 DATA_INVENTORY 派生）
  - packages/safety/src/stored-gated.ts —— gatedFromStoredCharacterMessage（历史角色消息的受控恢复通道）
  - tools/ci/pino-no-pii.test.ts —— 完整 turn 的 pino 输出无 PII 的运行时证明
affects: [01-12 网关 conversationStatus 内移, 01-14 遥测, 阶段验证 UAT]

actuals:
  tokens: 46000
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "显式注册表 + 两条腿对账：回执数量来自 STORAGE_LOCATIONS（A 腿保证不漏表、B 腿保证不漏库对象），不来自运行时枚举"
    - "作业 data 不带 userId，只带 actionId：队列载荷是被登记的存储位置，「要删谁」不写进删除自身管不到的地方"
    - "受控重出口：历史文本经 disclosure 留证恢复为 GatedText（恢复不产生），全仓第二处 as GatedText 由修订后的 egress 断言钉住"
    - "清理规则由 DATA_INVENTORY 派生（buildRetentionRules 纯函数）：源码无第二份期限清单"

key-files:
  created:
    - packages/db/src/storage-locations.ts
    - packages/db/src/deidentify.ts
    - packages/db/drizzle/0004_audit_deidentify.sql
    - apps/api/src/modules/privacy/delete-routes.ts
    - apps/api/src/modules/privacy/export-routes.ts
    - apps/api/src/modules/privacy/export-boss.ts
    - apps/api/src/modules/safety/masked-contact.ts
    - apps/api/src/worker/jobs/export-build.ts
    - apps/api/src/worker/jobs/export-artifact-gc.ts
    - apps/api/src/worker/jobs/retention-cleanup.ts
    - packages/safety/src/stored-gated.ts
    - apps/web/src/features/privacy/delete-dialog.tsx
    - apps/web/src/features/privacy/receipt.tsx
    - apps/web/src/features/privacy/export-panel.tsx
    - 'apps/web/src/app/(app)/privacy/receipt/[actionId]/page.tsx'
    - 'apps/web/src/app/(app)/privacy/receipt/[actionId]/receipt-client.tsx'
    - apps/web/src/components/ui/progress.tsx
    - tests/integration/deletion.test.ts
    - tests/integration/export.test.ts
    - tests/integration/pino-turn-child.ts
    - tools/ci/storage-registry.test.ts
    - tools/ci/storage-registry-db.test.ts
    - tools/ci/pino-no-pii.test.ts
    - apps/web/src/features/privacy/delete-dialog.test.tsx
    - apps/web/src/features/privacy/receipt.test.tsx
    - apps/web/src/features/privacy/export-panel.test.tsx
  modified:
    - packages/db/src/schema/audit.ts（四张表 user_id 可空）
    - packages/db/src/schema/safety.ts（safety_event 可回链列可空）
    - packages/db/src/index.ts
    - packages/db/drizzle/meta/_journal.json
    - apps/api/src/worker/jobs/account-deletion.ts（桩 → 真实现）
    - apps/api/src/worker/index.ts（注册五个作业）
    - apps/api/src/modules/export/render.ts（renderExportHeader + renderExportUserLine）
    - apps/api/src/config/env.ts（EXPORT_ARTIFACTS_DIR）
    - apps/api/src/http/app.ts
    - packages/safety/src/index.ts
    - tools/ci/egress-registry.test.ts（as GatedText 恰好两处）
    - tests/integration/consent-ticket.test.ts（(d) 改真实入队）
    - apps/web/src/app/(app)/privacy/page.tsx（删除/导出分区接真组件）
    - apps/web/src/features/privacy/copy.ts
    - apps/web/src/app/globals.css（progress keyframes）
    - vitest.config.ts（两个新文件归 integration 层）
    - docker-compose.yml（EXPORT_ARTIFACTS_DIR）
    - SKIPPED_CHECKS.md
    - apps/api/src/modules/safety/contact-status-event.ts（可空类型处理）

key-decisions:
  - "0004 迁移是 Q1 的 schema 前提：审计表 user_id / conversation_id 必须**可空**（NOT NULL 的列无法「移除」只能换哨兵值），purge_role 拿到的是**列级** UPDATE（只能清空可回链列，改不了 rule_hits / level / created_at）"
  - "部分失败形态：逐项独立执行 + try/catch（RESEARCH §7.3 的「单事务 + 逐项 catch」在 PG 里结构性不可表达）；consent 失败会级联导致 user 项 FK 失败 —— M/N 分支如实呈现两个失败项，重试时 consent 成功后 user 就能删"
  - "pg-boss 12.34 三处实测纠正：无 archive 表（防御性保留注册表项 + to_regclass 守卫）、insert 落在 pgboss.job_common（授权对 schema 全部表）、两个 role 都需要 USAGE ON SCHEMA pgboss"
  - "删除后回执经一次性 token 读取（GET /privacy-receipts/:actionId?token=）—— session 已随账号消失，122 位随机凭证 + 404 不披露存在性"
  - "egress 断言修订为「恰好两处 as GatedText」：gateway.ts（产出）+ stored-gated.ts（恢复）—— 强度不变，任何第三处仍然红"
  - "export worker 用 purgeDb：回执写回是 UPDATE privacy_action.payload，审计表族对 app_role 是 REVOKE UPDATE"

patterns-established:
  - "回执数量 = 成功执行且 countsAsCleared 不为 false 的项数（含 0 行成功项）—— 口径先于实现"
  - "幂等短路前置于完整性守卫：重复投递读回的是去标识化后的回执形态，先守卫会误判"
  - "受控重出口（恢复不产生）作为 branded type 与历史数据之间的接缝，留证字段是合法性来源"
  - "破坏验证写成测试内注入或对合成坏输出的扫描，不留给执行者的一次性手工验证"

requirements-completed: [PRIV-04, PRIV-05, PRIV-08, COMPLY-02, COMPLY-11]

coverage:
  - id: D1
    description: "STORAGE_LOCATIONS 注册表（24 项，含三处最易漏的非表存储）+ 两条腿 CI 对账（A 腿纯 TS 抓 schema 漏登记，B 腿连测试库抓裸 SQL 表与未知 schema），各有注入式负向证明"
    requirement: "PRIV-05"
    verification:
      - kind: unit
        ref: "tools/ci/storage-registry.test.ts（14 tests：五条不变式 + 假 schema 负向 + 漏登记负向 + 豁免清单清空负向）"
        status: pass
      - kind: integration
        ref: "tools/ci/storage-registry-db.test.ts（3 tests：真实库对账 + 裸 SQL 建表负向 + 未知 schema 负向）"
        status: pass
    human_judgment: false
  - id: D2
    description: "审计去标识化（Q1）：七张 append-only 表移除 user_id 与可回链列、保留事件形状；回执如实单列且不计入 N；幂等；app_role 执行抛 42501 而 purgeDb 可执行（权限面断言）"
    requirement: "PRIV-05"
    verification:
      - kind: integration
        ref: "tests/integration/deletion.test.ts（(g) 行存在 user_id NULL + payload userId 键移除；(h) clearedCount 排除 + countCleared 注入式翻转证明；app_role 42501；幂等 (f)）"
        status: pass
    human_judgment: false
  - id: D3
    description: "删除 worker 与回执页：N 口径诚实（含 0 行成功项）、部分失败走 M/N 且禁止「已删除完成」、独立回执路由、AlertDialog 初始焦点在取消、执行完成后才跳转、旧 session 401"
    requirement: "PRIV-05"
    verification:
      - kind: integration
        ref: "tests/integration/deletion.test.ts（(a)(b)(i)：HTTP 全链路 + 202 未完成态 + token 回执 + 401；九条断言全部落地）"
        status: pass
      - kind: automated_ui
        ref: "apps/web/src/features/privacy/delete-dialog.test.tsx（5 tests：焦点/短语闸门/不提前跳转/401 切换/失败态）+ receipt.test.tsx（7 tests：首读元素/sticky 摘要/去标识化单列/三出路/未清除标注）"
        status: pass
    human_judgment: false
  - id: D4
    description: "一键导出（PRIV-04）：.md/.json 双格式都带标识（文件头三行 + [AI] 前缀由导出管道注入，前端零拼装）、覆盖七类、紧急联系人遮蔽、导出面板三态（10s 追加行/失败/删除后空态带时间戳）"
    requirement: "PRIV-04"
    verification:
      - kind: integration
        ref: "tests/integration/export.test.ts（(a)–(d)：双格式头三行逐行相等、[AI] 前缀、disclosure 字段、七类覆盖、138****1234 且明文不进文件）"
        status: pass
      - kind: automated_ui
        ref: "apps/web/src/features/privacy/export-panel.test.tsx（4 tests：loading+10s 追加行、error 逐字、empty 带时间戳、双格式下载链接）"
        status: pass
      - kind: other
        ref: "grep -rn 'AI]' apps/web/src 无匹配（前缀不经前端拼装）；pnpm --filter @drift/web 在容器内 docker build EXIT=0"
        status: pass
    human_judgment: false
  - id: D5
    description: "保存期与 TTL（PRIV-08 / D-17）：导出产物 7 天 TTL 由 export-artifact-gc 执行（cron 0 5 * * * UTC）；retention-cleanup（cron 45 18 * * * UTC）的规则由 DATA_INVENTORY 派生，源码无第二份期限清单；时间旅行验证 8 天产物与 25 个月消息被清理；两作业的 schedule 注册被 getSchedules 断言"
    requirement: "PRIV-08"
    verification:
      - kind: integration
        ref: "tests/integration/export.test.ts（(e) mtime 时间旅行、(f) created_at 时间旅行 + 规则来源断言、(g) schedule 注册）"
        status: pass
    human_judgment: false
  - id: D6
    description: "pino 日志从设计上不含个人信息（STORAGE_LOCATIONS 登记为 containsPersonalInfo: false 的运行时证明）：完整 turn 的 pino 输出无正文任何 ≥6 字子串、无 11 位手机号；扫描函数对合成坏输出非空真"
    requirement: "PRIV-05"
    verification:
      - kind: integration
        ref: "tools/ci/pino-no-pii.test.ts（3 tests：子进程跑真 turn 抓 stdout、非空真、常量一致）+ 手动破坏验证（正文塞进 count 字段 → 断言红并逐个点名 10 个 6-gram —— 还原后复绿）"
        status: pass
    human_judgment: false
  - id: D7
    description: "删除/导出面板与回执页的实际观感（布局手感、滚动清单的可读性、M/N 分支的呈现是否一目了然）"
    verification: []
    human_judgment: true
    rationale: "RTL 断言证明结构契约（sticky、单列、三出路在场），不证明「这个界面看起来对」—— 需要人在容器里走一遍删除与导出全流程。"
  - id: D8
    description: "COMPLY-11 留存义务的兑现：COMPLY-02 的标识随文件存活使「无显式标识内容的留存对象日志」维持显式空集；egress_hash 因出口集合未变而未更新（stored-gated 不接受 GatedText 参数，不进 AST 集合）"
    requirement: "COMPLY-11"
    verification:
      - kind: unit
        ref: "tools/ci/egress-registry.test.ts（20 tests 全绿：集合相等 + hash 绑定 + as GatedText 恰好两处修订）"
        status: pass
    human_judgment: false

# Metrics
duration: 2h 40m
completed: 2026-09-28
status: complete
---

# Phase 01 Plan 11: 一键导出与一键删除 Summary

**STORAGE_LOCATIONS 注册表（24 项，含三处最易漏的非表存储）+ 两条腿 CI 对账让「新增存储位置不登记」在构建期失败；Q1 裁决的审计去标识化由 0004 迁移撑起 schema 前提，回执的 N 只数真正清掉的项；双格式导出的 [AI] 标识全部由管道注入，7 天 TTL 与按 DATA_INVENTORY 派生的保存期清理由两个 boss.schedule 日作业兑现并被时间旅行测试验证。**

## Performance

- **Duration:** 2h 40m
- **Started:** 2026-09-27T22:00:00Z
- **Completed:** 2026-09-28T00:45:00Z
- **Tasks:** 3
- **Files created/modified:** 45（4 次提交合计）

## Accomplishments

- **注册表与两条腿对账。** packages/db/src/storage-locations.ts 以 24 项覆盖 Phase 1 全部存储位置：七张 append-only 审计表的去标识化项（countsAsCleared: false）、十一张业务表 DELETE、invite_code 置空（码是运营资产）、pgboss.job / pgboss.archive（后者为防御性保留，pg-boss 12.34 实测无此表）、导出文件目录、pino 日志（containsPersonalInfo: false + 理由 + 运行时断言）、user 行最后删。A 腿（纯 TS，contract 层，进 ci:fast）抓 schema 漏登记，B 腿（连测试库）抓裸 SQL 表与未知 schema —— 它第一次真跑就抓到了 drizzle 迁移记账 schema 这个 A 腿结构性看不见的对象。
- **Q1 的去标识化。** deidentifyAuditRows 对七张审计表移除 user_id 与全部可回链列（conversation_id / message_id / payload 的 userId 键），保留事件形状 6 个月。0004 迁移为此 DROP 了五张表的 user_id NOT NULL（与两张表的 conversation_id），并给 purge_role **列级** UPDATE —— 它改不了 rule_hits / level / created_at，去标识化的写入口由权限面限定。回执把去标识化项单列并明确「不计入上面的 N」。
- **删除 worker 与诚实口径的回执。** 回执的 N = purge 成功执行且 countsAsCleared 不为 false 的项数 —— 含 0 行的成功项（口径是「成功执行的项数」不是「非空项数」，空账号不谎报 0 处）。部分失败走 M/N：consent 失败会级联导致 user 项 FK 失败，两个失败项如实分列，UI 禁止渲染「已删除完成」并给出重试 / 导出留副本 / 提交申诉三个出路。幂等三重：条件删除（第二次 0 行）、短策略 singletonKey、回执终态短路（且短路前置于完整性守卫 —— 否则重跑读回的无 userId 回执形态会被误判为行不完整）。
- **删除后回执的可达性。** user 与 session 行都没了之后 /me/* 全部 401 —— 回执页经一次性 token 凭证读取（GET /privacy-receipts/:actionId?token=，122 位随机，错 token 404 不披露存在性）；执行期间的轮询走 /me/privacy-actions/:id（202 = 未完成态）。
- **双格式导出与标识由管道注入。** .md 与 .json 的文件头三行（Drift / 本文件全部角色消息由 AI 生成 / 导出时间）与角色行 [AI] 前缀全部由 render.ts 注入，前端零拼装（grep 证明）。历史角色消息经 gatedFromStoredCharacterMessage 恢复为 GatedText —— 全仓第二处受控 as GatedText，egress 断言修订为「恰好两处」，任何第三处仍然红。紧急联系人只出遮蔽形态（明文不进导出文件）。覆盖个保法第四十五条的七类。
- **保存期清理的派生规则。** retention-cleanup 的规则由 buildRetentionRules(DATA_INVENTORY) 派生 —— 源码没有第二份期限清单；时间旅行测试证明 25 个月的消息被清理、规则表里真的有 message 与 consent_event。export-artifact-gc（0 5 * * * UTC）清 7 天 TTL 的产物；两作业的 schedule 注册被 getSchedules 断言钉住。
- **pino 无 PII 的运行时证明。** 子进程（--experimental-transform-types）跑一个真实 turn，抓 pino 写到 fd 1 的全部输出：无正文任何 ≥6 字子串、无 11 位手机号。手动破坏验证顺带证明了 redact 第二道防线（正文塞 text 字段被 [redacted] 兜住，塞 count 字段则断言变红并逐个点名 10 个 6-gram）。

## Task Commits

1. **Task 1: STORAGE_LOCATIONS 注册表 + 审计去标识化 + A/B 腿对账 + pino 断言** — ee5469d (feat)
2. **Task 2: 删除 worker + 独立回执页** — 195fff8 (feat)
3. **Task 3: 导出 worker + 7 天 TTL gc + 保存期清理 cron** — ac2b361 (feat)
4. **修复：deletion (g) 断言改按用户增量 + 需求标记** — b32e4bb (fix)

**Plan metadata:** 见本次 docs 提交。

## Files Created/Modified

见 frontmatter 的 key-files（26 created / 19 modified）。值得点名的三个：
- packages/db/src/storage-locations.ts —— 注册表本体 + A 腿纯函数（assertStorageRegistryInvariants 五条不变式）。
- apps/api/src/worker/jobs/account-deletion.ts —— 从 Plan 09 的 not-implemented 桩替换为真实现：入队（事务内，经 pg-boss 的 ConnectionOptions.db 适配器落在撤回事务里）+ 执行体 + 回执 + ensurePgbossGrants。
- tests/integration/deletion.test.ts —— 九条断言 (a)–(i) 全部落地；(c) 的「删除后再次导出返回空集」以「用户全部数据表为空 + 审计行 user_id NULL」形态在本文件落地，导出层的空集断言在 export.test.ts (h)。

## Decisions Made

见 frontmatter key-decisions（6 条，均已写入 STATE.md 的 Accumulated Context）。三条架构级：
1. **0004 迁移**（PLAN 未列，Rule 2/3 落位）：Q1 的「移除 user_id」在 NOT NULL 列上结构性不可表达 —— DROP NOT NULL + 列级 GRANT 是裁决过的口径的唯一可行实现，schema 与迁移同步修改且 db:check 无漂移。
2. **回执的删除后可达路径**（PLAN 未设计）：token 凭证路由是对「/me/* 在账号删除后必然 401」与「回执必须可达」这对张力的解法，与导出下载的「绑定用户 + 不可枚举」同型。
3. **egress 断言修订**（Rule 4 性质，但属 PLAN 的 GatedText 签名要求的必然结果）：从「唯一产出点」到「两处受控点（产出 + 恢复）」，防线强度不变。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 审计表族需要 0004 迁移（PLAN 未列迁移文件）**
- **Found during:** Task 1
- **Issue:** Q1 裁决要求去标识化「移除 user_id」，但 consent_event / privacy_action / exit_intent / dependency_signal / safety_event 的 user_id 是 NOT NULL；safety_event / exit_intent 的 conversation_id 同样。不 DROP NOT NULL 则去标识化无法执行（或只能换哨兵值 —— 一个可比对的假用户）。
- **Fix:** 0004_audit_deidentify.sql（7 条 DROP NOT NULL + purge_role 列级 UPDATE GRANT + 存在性断言），schema 文件同步去 notNull，drizzle-kit migrate 应用后 db:check 无漂移。
- **Verification:** pnpm --filter @drift/db run db:check 无漂移；deletion.test.ts (g)。
- **Committed in:** ee5469d

**2. [Rule 1 - Bug] pg-boss 12.34 与 RESEARCH §7.1 的三处不符（实测纠正，Q5 精神）**
- **Found during:** Task 2
- **Issue:** ① 没有 pgboss.archive 表（v10 及更早的概念，v12 完成作业留在 job 表）—— 注册表该项的 purge 会因表不存在而恒失败；② send 的 INSERT 实际落进 pgboss.job_common（job 是分区路由表）—— 只给 pgboss.job 授权仍然 42501；③ app_role / purge_role 都缺 USAGE ON SCHEMA pgboss（0001 只给了 public）。
- **Fix:** archive 项改为 to_regclass 守卫的防御形态（未来版本重新引入时清理已就位）；ensurePgbossGrants 对 schema 全部表授权（表布局不是稳定契约）+ USAGE；DEFAULT PRIVILEGES 覆盖未来新表。
- **Verification:** deletion.test.ts (c)(e)（pgboss 载荷清理）+ consent-ticket (d)（事务内入队）。
- **Committed in:** 195fff8

**3. [Rule 1 - Bug] runAccountDeletionJob 的幂等短路在完整性守卫之后（第二次投递必失败）**
- **Found during:** Task 2 调试
- **Issue:** 第一次执行把回执写回并去标识化后，payload 不再含 userId —— 第二次投递（pg-boss at-least-once 的正常形态）先撞「行不完整」守卫而失败，幂等被自己破坏。
- **Fix:** 幂等短路（status 终态直接返回）前置于守卫。
- **Verification:** deletion.test.ts (a) 的幂等短路断言 + (f)。
- **Committed in:** 195fff8

**4. [Rule 3 - Blocking] B 腿与 pino 断言必须住在 integration 层（vitest 分层调整）**
- **Found during:** Task 1
- **Issue:** B 腿读 information_schema、pino 断言跑完整 turn —— 都需要真实 PostgreSQL，留在 contract 层会让 ci:fast 在无数据库的托管 runner 上跑挂（fast workflow 的第一条约束）。
- **Fix:** vitest.config.ts 把两个文件从 contract 的 exclude 加进 integration 的 include（schema-drift / pgboss-delay-api 的同一处理）。
- **Verification:** ci:fast（contract 层不含两文件）+ 单跑两文件全绿。
- **Committed in:** ee5469d

**5. [Rule 1 - Bug] PLAN 的「约 19 处 / 不少于 19」与「去标识化登记为一个独立项」内部矛盾（18 vs 19）**
- **Found during:** Task 1
- **Issue:** 一项去标识化 + 13 表项 + 4 非表 = 18 项，达不到 acceptance 的「不少于 19」。
- **Fix:** 七张审计表各登记一项（A 腿一一对应、24 项），UI 回执层聚合渲染为单列（UI-SPEC「另有 1 项审计记录」的「1 项」是呈现口径）—— 两个约束同时满足。
- **Committed in:** ee5469d

**6. [Rule 3 - Blocking] 删除后回执的读取路径（PLAN 未设计）**
- **Found during:** Task 2
- **Issue:** PLAN 要求 GET /me/privacy-actions/:actionId 返回回执，但 user 与 session 行删除后该路由必然 401 —— 回执不可达等于告知义务未履行。
- **Fix:** 新增 GET /privacy-receipts/:actionId?token=（一次性回执凭证，POST /me/delete 响应发放）；执行期轮询仍走 /me 路由（202 = 未完成态）。
- **Verification:** deletion.test.ts (a)(i)（token 200 / 错 token 404 / 旧 session 401）+ delete-dialog.test.tsx（401 后切 token 路径）。
- **Committed in:** 195fff8

**7. [Rule 3 - Blocking] export worker 的执行器是 purgeDb 不是 db**
- **Found during:** Task 3
- **Issue:** 回执写回是 UPDATE privacy_action.payload —— 审计表族对 app_role 是 REVOKE UPDATE（append-only），用 db 会在写回处失败。
- **Fix:** registerExportBuild 与测试的执行器改为 purgeDb（与删除 worker 同一权限面）。
- **Committed in:** ac2b361

---

**Total deviations:** 7 auto-fixed（3 Rule 1 实测纠正 / 4 Rule 3 结构落位）
**Impact on plan:** 全部朝「约束更强、口径更诚实」的方向；无范围蔓延。PLAN 的文件清单之外新增了 0004 迁移、export-boss.ts（boss 注册的零 env 边界）、masked-contact.ts（decryptContact 的目录级 lint 边界）与 receipt-client.tsx —— 每一个都是 PLAN 目标在已知仓库约束下的必要落位。

## Issues Encountered

1. **runAccountDeletionJob 幂等短路的顺序 bug**（见偏离 3）—— 定位过程花了四轮 TEMP-DIAG：同一查询一行能查到、一行查不到，最后在生产代码里打印 rows 才发现是**两次调用**（第一次正常执行、第二次的 payload 已是回执形态）。教训：报错信息里带 actionId 但诊断打印不带，就找不到两份数据不属同一次调用。
2. **测试间互扰**：(g) 的 privacy_action 断言最初写成全库绝对值 —— 单文件跑绿、全套跑红（其他文件留下的同形态行）。改按「该用户还有没有」断言。
3. **vitest 的 transform 缓存**：tsc 报找不到新模块而文件明明在 —— packages/*/dist 的陈旧 .d.ts 抢了解析。清 dist + tsbuildinfo 后恢复。
4. **Radix AlertDialog.Action 点击即关对话框** —— Progress 与失败态渲染不出来；preventDefault 保住对话框。
5. **jsdom 不实现导航**：location.href 的断言用 Object.defineProperty 换桩。
6. **Read/Write 工具偶发的 hint 注入**：文件尾部混入 system-reminder 文本导致语法错误 —— 发现后用磁盘直写（node 脚本）绕过，并对全部新文件做了首行内容审计。

## SKIPPED_CHECKS 变更

| 动作 | check id | 说明 |
|---|---|---|
| **新增** | pino-log-not-row-deletable | 日志不能按行删除：以「设计上不含个人信息」登记（白名单 + redact + 运行时断言证明）。解除条件：引入可按用户清除的结构化日志存储 |
| **删除** | account-deletion-not-implemented | 解除条件满足：enqueueAccountDeletion 真实现（事务内入队），consent-ticket (d) 改为断言「撤回成功且删除作业真的入队」（findJobs 直读 pgboss 验证）|

## Authentication Gates

无 —— 本 plan 零外部服务调用、零新增依赖（Progress 自绘、AlertDialog 来自已装的统一包 radix-ui；docker build 验证两端镜像）。

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **PRIV-04 / PRIV-05 / PRIV-08 / COMPLY-02 / COMPLY-11 已标 Complete**，check-contract-amendments 复跑 OK 13/13。
- **Plan 12（网关 conversationStatus 内移）的地基已就位**：STORAGE_LOCATIONS 的删除 worker 是 conversationStatus 的四个调用点之一（tests/integration/tracer.test.ts 是另一个）；回执与导出的 privacy_action 载荷形态已稳定。
- **Plan 14（遥测）**：client_error 的去标识化项已在注册表内 —— /telemetry/error 落地时删除级联自动覆盖它。
- **Phase 1 的 15 个 plan 已完成 12 个**：剩 01-12（网关内移）、01-14（遥测）。
- **一处已知的验证缺口**：前端到后端的 Bearer token 传递是全站缺口（隐私中心 fetch 用 credentials: 'include' 但后端 session.ts 只认 Authorization header —— 注册页之后 token 如何进浏览器请求头属后续接线），本 plan 的 RTL 断言用注入 fetch 覆盖组件行为，D7 按人类判断登记。
- **cron 登记**（acceptance 要求记录）：export-artifact-gc = `0 5 * * *`（05:00 UTC），retention-cleanup = `45 18 * * *`（18:45 UTC，错开 consent-reconcile 18:15 与 publicness 18:30）。

## Self-Check: PASSED

| 检查 | 结果 |
|---|---|
| key-files.created 全部在磁盘（26 个逐一存在） | PASS |
| git log --oneline --grep="01-11" ≥ 1 | PASS（4 个提交）|
| Task 1 verify：storage-registry 14/14 + storage-registry-db 3/3 + pino-no-pii 3/3 + grep countsAsCleared/pgboss/export_artifact 均 ≥ 1 | PASS |
| Task 2 verify：deletion 8/8 + next build（容器 docker build EXIT=0）+ grep sonner 无匹配 + grep 已删除完成/partial 在场 | PASS |
| Task 3 verify：export 6/6 + grep 法定标识句 = 1 + grep 'AI]' apps/web 无匹配 + ci:fast 297/297 | PASS |
| 九条删除断言 (a)–(i)、八条导出断言 (a)–(h) 全部落地 | PASS |
| 四次破坏验证：countsAsCleared 翻转（注入式常驻）；logEvent 记正文（redact 兜住 + count 字段变红后还原）；假 schema 加表（A 腿常驻注入）；测试库裸 SQL 建表（B 腿常驻） | PASS |
| requirements.mark-complete 后复跑 check-contract-amendments | OK 13/13（handout #61 清单项）|
| pnpm run test:integration 全量 | 120/120 |
| pnpm run ci:fast | 297/297，退出 0 |

---
*Phase: 01-compliance-safety-chat-skeleton*
*Completed: 2026-09-28*
