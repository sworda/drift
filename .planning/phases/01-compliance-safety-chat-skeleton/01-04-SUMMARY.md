---
phase: 01-compliance-safety-chat-skeleton
plan: 04
subsystem: infra
tags: [drizzle, postgres, zod, websocket, model-router, branded-types, pg-boss, shadcn, hono]

requires:
  - phase: 01-01
    provides: 修订后的 PRIV-01 五项同意 scope 名、01-UI-SPEC 的 A-01/A-03 修订与 AI 标识呈现契约
  - phase: 01-03
    provides: apps/api 单进程三入口、drizzle.config.ts 的 schemaFilter、docker compose 全栈、fast/integration/nightly 三条 workflow
provides:
  - Phase 1 完整 drizzle schema（22 张表，9 个域文件）+ 两条迁移
  - COMPLY-09 的 DB CHECK（message_disclosure_required）与 IFC-08 的两项列级预留
  - 审计表族 append-only 的 PG 权限实现（app_role / purge_role）
  - persona_version 的 core 不变触发器
  - 3 个种子角色与 COMPLY-08 的审核纯函数 reviewCharacterConcept
  - Model Router 的唯一入口 call() 与路由表里的 mock provider（均落 llm_call）
  - safetyGateway()：全仓唯一的 GatedText 产出点
  - packages/db 的三个消息函数（seq 取号 / disclosure 注入 / after_seq 补拉）
  - apps/api 的角色库 / 加好友 / 发消息 / 补拉四组路由与 runTurn 编排
  - WS 的两个出口 deliver(GatedText) 与 publish(不含正文)
  - AI 标识文案的跨端唯一真相源与 AiBadge / AiBanner 两个组件
  - 一条端到端绿色 tracer 集成测试 + 19 条 DB 层断言 + 真实零漂移门禁
affects: [01-05, 01-06, 01-07, 01-08, 01-09, 01-10, 01-11, 01-12, 01-13, 01-14, 01-15]

actuals:
  tokens: 128000
  tasks: 3
  commits: 3

tech-stack:
  added:
    - "@drift/contract 增加 zod 4.6.5 依赖（WS envelope 与事件 topic）"
    - "postgres 3.4.9 / pg-boss 12.34.0 / @hono/node-server 2.1.1 / drizzle-orm 0.45.3 提升为根 devDependency（tests 与 tools/ci 需要）"
    - "shadcn bubble / message / button 三个原语（无新增外部依赖）"
  patterns:
    - "包内与跨包 import 一律写 .ts specifier；被 references 引用的包用 emitDeclarationOnly + allowImportingTsExtensions"
    - "值域的单一真相源：TS as const 数组同时生成联合类型与 DB CHECK 约束（packages/db/src/sql-helpers.ts 的 inValues）"
    - "身份靠 PostgreSQL 启动参数 -c role=<role> 切换，而不是 SET LOCAL ROLE 或多份凭证"
    - "出站文本的类型闸门：唯一产出点 + 出口签名只接受品牌类型 + publish 的类型排除带正文事件"
    - "审计留证只存哈希与长度，不存正文"

key-files:
  created:
    - packages/db/src/schema/{auth,invite,consent,character,conversation,message,safety,audit,usage,index}.ts
    - packages/db/src/{client,message,onboarding,sql-helpers}.ts
    - packages/db/src/seed/{characters,characters.test,run}.ts
    - packages/db/drizzle/{0000_init.sql,0001_constraints_and_grants.sql}
    - packages/db/scripts/assert-no-drift.mjs
    - packages/contract/src/{disclosure,ws,topics}.ts
    - packages/llm/src/{types,router}.ts 与 packages/llm/src/providers/mock.ts
    - packages/safety/src/gateway.ts
    - packages/prompts/src/{version,chat-reply}.ts
    - apps/api/src/modules/{auth/session,auth/routes,characters/routes,friendship/routes,chat/routes,chat/turn}.ts
    - apps/web/src/components/{ai-badge,ai-banner}.tsx
    - apps/web/src/components/ui/{bubble,message,button}.tsx
    - apps/web/src/features/characters/character-list.tsx
    - apps/web/src/features/chat/chat-view.tsx
    - tests/integration/{setup,tracer.test}.ts
    - tools/ci/schema-drift.test.ts
  modified:
    - apps/api/src/ws/server.ts（新增 deliver / publish 两个出口）
    - apps/api/src/http/app.ts（挂载四组路由）
    - apps/web/src/app/globals.css（补 --spacing-* 桥接）
    - apps/web/src/app/(app)/characters/page.tsx 与 chat/[conversationId]/page.tsx
    - tools/ci/design-tokens.test.ts（断言跟随组件搬家 + 新增 5 条）
    - packages/contract/src/brand.test.ts（改为函数允许清单）
    - vitest.config.ts、tsconfig.json、SKIPPED_CHECKS.md、.github/workflows/integration.yml

key-decisions:
  - "CHECK 约束定义在 drizzle schema（0000 生成）而不是裸 SQL：drizzle-kit 0.31 会 introspect check 约束，只存在于库里的 CHECK 会被下一次 push 当成漂移并生成 DROP —— 等于用一次迁移把 COMPLY-09 的兜底删掉。0001 改为对它做 fail-loud 存在性断言。"
  - "drizzle-kit check 不连数据库，不能当漂移门禁；真正的门禁是 packages/db/scripts/assert-no-drift.mjs。"
  - "为了让零漂移可达，去掉表达式 id 默认值（改客户端 newId()）与命名复合主键（consent / friendship 改代理主键 + 唯一索引）。"
  - "app_role / purge_role 是 NOLOGIN 组角色，身份靠连接启动参数 -c role= 切换 —— 部署不多带两份密钥，且非事务语句也受权限约束。"
  - "llm_call 按每次 provider 调用各自短事务落库，不横跨 provider 网络调用。"
  - "insertCharacterMessage 不接受 disclosure 形参（与 PLAN 的 artifact 签名相反）：可传入的 disclosure 等于把「谁负责标识」重新变成调用方的选择题。"
  - "不引入 @shadcn/react；放弃 message-scroller 原语。"
  - "注册链路的 tracer 版本落在 packages/db/src/onboarding.ts，形态与 Plan 09 对齐、由它替换建账号那一步。"

patterns-established:
  - "值域单一真相源：as const 数组 → TS 联合类型 + DB CHECK（inValues）"
  - "负向 fixture 与正向对照成对出现：每条「必须失败」的断言旁边都有一条「换掉那一个条件就应该成功」"
  - "出站类型闸门三件套：唯一产出点 + 出口签名 + publish 的类型排除"
  - "审计表族 append-only 由 PG 权限而非代码习惯保证，并配一条反向断言（contact_attempt 的 UPDATE 必须被允许）"
  - "drizzle-kit 的静默失效：内部抛错仍 exit 0 —— 任何包装脚本都要另外检查输出"

requirements-completed: [PLAT-02, PLAT-03, CHAT-01, CHAT-02, CHAT-03, CHAT-07, COMPLY-01, COMPLY-09, IFC-08]

coverage:
  - id: D1
    description: "Phase 1 完整 drizzle schema：22 张表按 9 个域文件拆分，两条迁移落到开发库与一次性测试库"
    requirement: "PLAT-02"
    verification:
      - kind: integration
        ref: "tools/ci/schema-drift.test.ts#(a) COMPLY-09 的 DB CHECK 约束真的在库里"
        status: pass
      - kind: other
        ref: "pnpm --filter @drift/db run db:check"
        status: pass
    human_judgment: false
  - id: D2
    description: "COMPLY-09 的 DB 兜底：插入角色消息而未注入标识的路径在数据库层失败（负向 fixture，已用摘约束/装约束两次实跑证明非空真）"
    requirement: "COMPLY-09"
    verification:
      - kind: integration
        ref: "tools/ci/schema-drift.test.ts#sender_kind=character 且 disclosure 为 NULL 抛 23514"
        status: pass
      - kind: integration
        ref: "tests/integration/tracer.test.ts#(5)(6)(7)(8) 发一条消息"
        status: pass
    human_judgment: false
  - id: D3
    description: "IFC-08 的三项预留：message.provenance / message.audience 两个 NOT NULL 列，以及由 WS 下行 union 派生的事件 topic 命名空间"
    requirement: "IFC-08"
    verification:
      - kind: other
        ref: "grep -n from-ws.ts packages/contract/src/topics.ts"
        status: pass
      - kind: integration
        ref: "tools/ci/schema-drift.test.ts#message_audience_allowed 与 (conversation_id, seq) 唯一索引也在"
        status: pass
    human_judgment: false
  - id: D4
    description: "审计表族 append-only：七张表对 app_role REVOKE UPDATE, DELETE，且 contact_attempt 反向可 UPDATE"
    verification:
      - kind: integration
        ref: "tools/ci/schema-drift.test.ts#(c) 审计表族对 app_role 是 append-only（10 条）"
        status: pass
    human_judgment: false
  - id: D5
    description: "persona_version 的 core 不变触发器：parent 非空且 core 被改过即 P0001"
    verification:
      - kind: integration
        ref: "tools/ci/schema-drift.test.ts#(e) persona_version 的 core 不变触发器"
        status: pass
    human_judgment: false
  - id: D6
    description: "3 个种子角色 + COMPLY-08 的审核纯函数（5 条应拒绝 / 4 条应通过 / 3 个角色的 blurb 与 dossier 过审）"
    verification:
      - kind: unit
        ref: "packages/db/src/seed/characters.test.ts（14 条）"
        status: pass
      - kind: other
        ref: "psql: character 与 persona_version 各 3 行，model_snapshot 均非别名"
        status: pass
    human_judgment: false
  - id: D7
    description: "Model Router 唯一入口 call()：mock provider 也经它落 llm_call，同 turn_id 恰好两行且 purpose 成对、provider 均为 mock、model_snapshot 不同（SAFE-02）"
    requirement: "PLAT-03"
    verification:
      - kind: integration
        ref: "tests/integration/tracer.test.ts#(7) llm_call 成对"
        status: pass
      - kind: integration
        ref: "RESEARCH 4.1 的顺序断言 SQL（safety.classify 早于 chat.reply 必须 0 行）"
        status: pass
    human_judgment: false
  - id: D8
    description: "safetyGateway() 是全仓唯一 GatedText 产出点；三个出口签名只接受它；elevated/crisis 与已结束会话不产出可投递文本"
    verification:
      - kind: other
        ref: "grep -rn 'as GatedText' 全仓仅命中 packages/safety/src/gateway.ts"
        status: pass
      - kind: other
        ref: "pnpm run typecheck:fixtures 退出码非 0（负向 type fixture）"
        status: pass
    human_judgment: false
  - id: D9
    description: "per-conversation seq 单调、先落库再投递、断连后按 after_seq 补拉不丢不重无空洞"
    requirement: "CHAT-07"
    verification:
      - kind: integration
        ref: "tests/integration/tracer.test.ts#断连补拉：再写 2 条后用 after_seq=3 恰好取回 seq 4、5"
        status: pass
    human_judgment: false
  - id: D10
    description: "端到端一刀：邀请码并发注册恰好一个成功，5 条 consent，角色库真实 DB 读，加好友，发 1 条消息，mock provider，网关，落库注入 disclosure，WS 投递"
    requirement: "CHAT-03"
    verification:
      - kind: integration
        ref: "tests/integration/tracer.test.ts（9 条）"
        status: pass
    human_judgment: false
  - id: D11
    description: "越权防线：跨用户读写他人会话返回 404；未登录访问角色库 401；未满 18 岁注册 403 且邀请码不被消耗"
    verification:
      - kind: integration
        ref: "tests/integration/tracer.test.ts#跨用户访问他人会话返回 404（T-04-01）"
        status: pass
    human_judgment: false
  - id: D12
    description: "AI 明示标识：文案全仓各一处定义、AiBadge props 无 text/children、常驻条 32px sticky 且无任何可关闭交互、全仓无流式下发路径"
    requirement: "COMPLY-01"
    verification:
      - kind: unit
        ref: "tools/ci/design-tokens.test.ts（13 条，含新增 5 条）"
        status: pass
    human_judgment: false
  - id: D13
    description: "角色库与聊天页的真实渲染：48px 头像 + 20px 名 + 13px 简介的列表、BubbleContent 覆写 text-base、用户/角色气泡变体、时间戳在气泡外"
    requirement: "CHAT-01"
    verification:
      - kind: other
        ref: "docker compose build web（next build 通过，两条路由为动态渲染）"
        status: pass
    human_judgment: true
    rationale: "版式是否符合 UI-SPEC 的视觉约定（字号层级、48px 头像、气泡留白、时间戳位置、徽标不被挤出）只有人眼能判。宿主 glibc 2.28 跑不了 next dev，浏览器走查须在容器内完成，已留给 end-of-phase UAT。"
  - id: D14
    description: "加好友后 counterpart_kind=ai_character、relationship=stranger，且重复加好友幂等"
    requirement: "CHAT-02"
    verification:
      - kind: integration
        ref: "tests/integration/tracer.test.ts#(4) 加好友后 counterpart_kind 与 relationship"
        status: pass
    human_judgment: false
  - id: D15
    description: "docker compose 单机全栈起得来：postgres + api + web 三个容器 healthy，/healthz 四项全 ok"
    verification:
      - kind: other
        ref: "docker compose up -d --wait postgres api web 三容器 Healthy，/healthz status=ok db=ok pgvector=0.8.6 pgboss=ok"
        status: pass
    human_judgment: false

duration: 21 min
completed: 2026-09-26
status: complete
---

# Phase 1 Plan 04: Walking Skeleton Tracer Summary

**Phase 1 全部 22 张表一次性定型（含 COMPLY-09 的 DB CHECK、IFC-08 的两项列级预留、七张审计表族的 PG 权限级 append-only、persona_version 的 core 不变触发器），并用一条端到端集成测试打穿「邀请码 → 5 条 consent → 真实角色库 → 加好友 → 发消息 → mock provider 经 Router 落 llm_call → safetyGateway 产出 GatedText → 落库注入 disclosure → WS 投递」。**

## Performance

- **Duration:** 21 min（19:25 → 21:46 本地时区；含一次 checkpoint 裁决与一次包合法性裁决的等待）
- **Started:** 2026-09-26T11:25:25Z
- **Completed:** 2026-09-26T13:46:34Z
- **Tasks:** 3（外加一个 checkpoint:decision）
- **Files changed:** 77（+10215 / −88）

## Accomplishments

- **Phase 1 完整 schema 定型**：22 张表按 9 个域文件拆分（后续 plan 各改自己的域文件，避免并行写冲突），三类事后补不了的字段全部就位 —— `message.provenance` / `message.audience`（IFC-08）、`persona_version.model_snapshot`（PERS-10）、五项 consent 的收集时机。
- **DB 层三条兜底真的在库里，且都有负向 fixture**：`message_disclosure_required` CHECK（摘掉后那条 INSERT 确实成功、装回后确实失败 —— 实跑验证过）、`persona_version_core_immutable` 触发器、七张审计表对 `app_role` 的 `REVOKE UPDATE, DELETE`。
- **真正的零漂移门禁**：`drizzle-kit check` 被证实不连数据库（库与 schema 明显不一致时它仍输出 "Everything's fine" 并退出 0），改用 `assert-no-drift.mjs`；并消除了两处会让「零漂移」永远达不到的 drizzle-kit 往返噪声。`boss.start()` 建出 12 张 pgboss 表之后仍报 "No changes detected"，`schemaFilter` 得到了它的负向守卫（T-03-05）。
- **一条绿色的端到端 tracer**：9 条断言 + 19 条 DB 层断言全通过，断言的都是结构化事实（seq 序列、llm_call 行数与 purpose 配对、WS 帧的 seq 与库里一致），不是「响应 200」。
- **出站类型闸门闭合**：`safetyGateway()` 是全仓唯一一处把 string 提升为 GatedText 的地方（grep 只命中那一个文件）；`deliver()` 只接受 `GatedText`；`publish()` 的类型排除 `message.created`，所以它不可能成为第二条投递路径。
- **单机全栈起得来**：`docker compose up -d --wait postgres api web` 三容器 Healthy，`/healthz` 四项全绿，`next build` 在容器内通过。

## Task Commits

1. **Task 1: Phase 1 完整 drizzle schema + DB 约束/触发器/权限 + 3 个种子角色** — `7bcc466` (feat)
2. **Task 2 [BLOCKING]: 迁移落到开发库/测试库并断言真实零漂移** — `08eabac` (feat)
3. **Task 3 (tracer): 一条真实消息打穿全链路** — `ef55d6d` (feat)

**Plan metadata:** 本次 docs 提交。

## Checkpoint

Task 0 是 `checkpoint:decision`（三个单向门 + 两个取舍）。用户裁决：三个单向门**全部按 D-26 / D-25 / D-06 已记录的形态放行**；两个取舍**均同意**（`safety_event` 只存 `candidate_reply_hash` + `candidate_reply_len`，不加正文列；`llm_call` 现在就预建 `retrieved_memory_ids` / `recall_scores` 两列）。

执行中追加了一次 `gate="blocking-human"` 性质的包合法性裁决（`shadcn add` 顺带引入 `@shadcn/react`），见下方偏离 6。

## Decisions Made

1. **CHECK 约束定义在 drizzle schema，不在裸 SQL。** PLAN 要求把 `message_disclosure_required` 写进 `0001`。实测 drizzle-kit 0.31 会 introspect check 约束，于是一条只存在于库里、schema 文件里没有的 CHECK 会在下一次 `push` 时被当成漂移并生成 `DROP` —— 那等于用一次迁移把 COMPLY-09 的兜底删掉，而这与 Task 2 自己要求的「无漂移」直接冲突。改为：约束定义在 `packages/db/src/schema/message.ts`（drizzle 管得住的地方），`0001` 对它做 **fail-loud 存在性断言**（缺失即 `RAISE EXCEPTION`，迁移失败）。这比 PLAN 的形态强一档：约束被删时迁移链会红，而不是静默少一条约束。
2. **`drizzle-kit check` 不是漂移门禁。** 它不连数据库，只检查 journal 自洽。真正的门禁是 `packages/db/scripts/assert-no-drift.mjs`（`drizzle-kit push` + 断言输出含 "No changes detected" 且不含 `pgboss`）。`db:check` 两条都跑。
3. **消除两处 drizzle-kit 往返噪声，让零漂移可达。** 表达式 id 默认值（`gen_random_uuid()::text`）改为客户端 `newId()`；`consent` / `friendship` 的命名复合主键改为代理主键 + 唯一索引（约束强度相同，且给 RES-08 的 publication 留了稳定复制身份）。否则每次 `push` 都会产出一批 `ALTER COLUMN SET DEFAULT` 与 `DROP/ADD CONSTRAINT`，而「无漂移」只能靠白名单通过 —— 那与没有这条检查等价。
4. **`app_role` / `purge_role` 是 NOLOGIN 组角色，身份靠连接启动参数 `-c role=<role>` 切换。** 不用 `SET LOCAL ROLE`：那样任何走非事务路径的语句都会以 owner 身份执行，而 owner 绕过 REVOKE —— 一种不报错、只让 append-only 悄悄不成立的绕过。也不用两份登录凭证：部署不该为此多带两份密钥。
5. **`llm_call` 不横跨 provider 网络调用。** 每次调用后各自短事务落库，角色消息另起短事务。崩溃只可能留下「有 llm_call、没有消息」（安全方向），反向由调用顺序排除；而横跨网络调用的事务会把连接池上限（max=8）直接变成并发上限。
6. **不引入 `@shadcn/react`。** `shadcn add message-scroller` 顺带往 `apps/web` 塞了一个 caret 范围的新外部依赖，而它唯一难自行实现的能力是虚拟滚动 —— UI-SPEC 明确 v1 不做。删掉 `message-scroller.tsx`、还原 `package.json`，保留 `bubble` / `message` / `button`（三者只依赖已在册的 cva / cn / radix-ui）。
7. **`insertCharacterMessage` 不接受 `disclosure` 形参**（与 PLAN 的 artifact 签名相反，与 PLAN 的正文一致）。可传入的 disclosure 等于把「谁负责标识」重新变成调用方的选择题，而 DB CHECK 只能保证它非空、保证不了它是对的。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CHECK 约束的归属地改为 drizzle schema，0001 改为存在性断言**
- **Found during:** Task 2（漂移断言）
- **Issue:** PLAN 要求 CHECK 只写在裸 SQL `0001`，但 drizzle-kit 0.31 会 introspect check 约束 → 一条库里有、schema 里没有的 CHECK 会被下一次 `push` 生成 `DROP`。PLAN 内部因此自相矛盾（Task 2 同时要求「无漂移」）。
- **Fix:** 约束定义进 `packages/db/src/schema/*.ts`（由 `0000_init.sql` 生成），`0001` 改为 fail-loud 的存在性断言（含 `message_disclosure_required` / `message_audience_allowed` / `message_conversation_seq_unique` 三条）。
- **Files modified:** packages/db/src/schema/message.ts、packages/db/drizzle/0001_constraints_and_grants.sql
- **Verification:** `db:check` 退出 0 且输出不含 pgboss；`schema-drift.test.ts` 的 (a)(d) 通过；摘掉约束后那条 INSERT 确实成功（非空真已实跑验证）。
- **Committed in:** `7bcc466` / `08eabac`

**2. [Rule 1 - Bug] 消除 drizzle-kit 往返噪声（id 默认值 + 命名复合主键）**
- **Found during:** Task 2
- **Issue:** `push` 每次都产出 18 条 `ALTER COLUMN SET DEFAULT` 与 2 对 `DROP/ADD CONSTRAINT`，零漂移永远达不到。
- **Fix:** 表达式默认值 → 客户端 `newId()`；命名复合主键 → 代理主键 + 唯一索引；重建 `0000_init.sql` 与 snapshot（本地开发库 drop/recreate 后重新 migrate + seed，无部署受影响）。
- **Files modified:** packages/db/src/sql-helpers.ts、packages/db/src/schema/*.ts、packages/db/drizzle/**
- **Verification:** `drizzle-kit push` 输出 "No changes detected"（`boss.start()` 之后同样）。
- **Committed in:** `08eabac`

**3. [Rule 3 - Blocking] 五个 package 的 tsconfig 改为 emitDeclarationOnly + allowImportingTsExtensions，import 一律写 .ts**
- **Found during:** Task 1
- **Issue:** 上一波次的交接事实 6 —— Node 24 不会把 `./x.js` 改写成 `./x.ts`，而 `packages/*` 的 exports 指向 `src/index.ts`。本 plan 引入了第一批运行时跨包 import，撞上它。
- **Fix:** `packages/{contract,db,llm,safety,prompts}` 统一 `emitDeclarationOnly: true` + `allowImportingTsExtensions: true`（TS6310：被 references 引用的项目不得 noEmit）；`apps/web/tsconfig.json` 也需要这个开关 —— 因为 `@drift/contract` 的源文件会被拉进它的 program。
- **Files modified:** packages/*/tsconfig.json、apps/web/tsconfig.json、tsconfig.json
- **Verification:** `pnpm run typecheck` 全绿；运行时 `import('./packages/contract/src/topics.ts')` 成功并打印出 7 个 topic。
- **Committed in:** `7bcc466` / `ef55d6d`

**4. [Rule 2 - Missing critical] 新增 packages/db/src/onboarding.ts 与 apps/api/src/modules/auth/**
- **Found during:** Task 3
- **Issue:** tracer 验收 (1)(2) 要求「同一邀请码并发注册恰好一个成功」与「注册后 consent 恰好 5 行」，但注册链路的完整形态属 **Plan 09**（wave 6），且 `better-auth` 至今不在依赖里（T-04-SC 禁止新增未经核验的包）。没有注册入口就无从断言这两条。
- **Fix:** 交付 tracer 需要的那一刀，形态刻意与 Plan 09 对齐、由它替换其中建账号那一步：表结构就是 better-auth 的期望形状；凭证用 node:crypto 的 scrypt 哈希（不存明文）；会话用 `session` 表里的不透明随机 token，所以路由的身份校验从第一天起就是真的。**不做**紧急联系人加密、ConsentTicket、注册 UI、18 岁终态拒绝页（均属 Plan 09）；COMPLY-07 在服务端先落成一条 403 硬校验。
- **Files modified:** packages/db/src/onboarding.ts、apps/api/src/modules/auth/{session,routes}.ts、apps/api/src/http/app.ts
- **Verification:** tracer (1)(2) 通过；未满 18 岁注册 403 且邀请码未被消耗。
- **Committed in:** `ef55d6d`

**5. [Rule 1 - Bug] llm_call 的事务边界改为每次调用各自短事务**
- **Found during:** Task 3
- **Issue:** PLAN 要求「在同一事务里写 llm_call」，那会让事务横跨 provider 网络调用（真实 provider 下 2-10s），连接池上限直接变成并发上限。
- **Fix:** 每次 provider 调用后立刻以自己的短事务落 llm_call，角色消息另起短事务。失败方向由调用顺序保证：只可能「有 llm_call、没有消息」。
- **Files modified:** apps/api/src/modules/chat/turn.ts、packages/llm/src/router.ts
- **Verification:** tracer (7) 的两行 llm_call 与 RESEARCH 4.1 的顺序断言均通过。
- **Committed in:** `ef55d6d`

**6. [Rule 4 - Architectural，已获裁决] 不引入 @shadcn/react**
- **Found during:** Task 3
- **Issue:** `shadcn add message-scroller` 顺带往 `apps/web/package.json` 写入 `@shadcn/react: ^0.3.1` —— 一个未经核验的新外部依赖，且是 caret 范围（仓库其余依赖全精确锁）。撞上 T-04-SC。
- **Fix:** 提交裁决后删除 `message-scroller.tsx` 并还原 `package.json`；`chat-view.tsx` 用 `bubble` + `message` 两个原语加本地滚动锚定（UI-SPEC v1 明确不做虚拟滚动，该包唯一难自行实现的能力用不到）。保留 `button.tsx`（无新增依赖）。
- **Verification:** `git diff apps/web/package.json` 为空；`docker compose build web` 的 `next build` 通过。
- **Committed in:** `ef55d6d`

**7. [Rule 1 - Bug] 两条既有断言在被测对象搬家后会变成空真，已跟随修正**
- **Found during:** Task 3
- **Issue:** (a) `design-tokens.test.ts` 扫的是聊天页里那个 `h-ai-bar` 的 div，而常驻条按 PLAN 搬进了 `components/ai-banner.tsx` —— 断言会失去被测对象。(b) `brand.test.ts` 断言「contract 包入口不导出任何运行时值」，而 contract 现在**必须**导出 zod envelope 与标识文案常量。
- **Fix:** (a) 断言跟随组件，并补一条「聊天页确实挂载了 AiBanner」，否则上一条测的是一个没人用的组件；另新增 4 条（徽标 props 无 text/children、BubbleContent 覆写 text-base、文案全仓各一处定义、全仓无流式下发路径）。(b) 改为「brand.ts 运行时完全为空」+「包入口导出的函数必须在允许清单里」，新增任何函数即红，强迫作者回答「它会不会产出品牌类型」。
- **Files modified:** tools/ci/design-tokens.test.ts、packages/contract/src/brand.test.ts
- **Verification:** `test:contract` 39 条全绿。
- **Committed in:** `ef55d6d`

**8. [Rule 1 - Bug] globals.css 补 --spacing-* 桥接**
- **Found during:** Task 3
- **Issue:** `--space-*` 档位没有桥接进 Tailwind 的 `--spacing-*` 命名空间，于是 `px-md` / `gap-md-tight` 这类 utility **不报错、只是不生成任何样式**（Tailwind 4 对未知 utility 是静默跳过）。01-03 的页面已经在用它们。
- **Fix:** 逐个桥接 8 个档位。
- **Verification:** `docker compose build web` 的 `next build` 通过。
- **Committed in:** `ef55d6d`

**9. [Rule 3 - Blocking] schema-drift.test.ts 归到 integration 层；integration workflow 补 DATABASE_URL**
- **Found during:** Task 2
- **Issue:** 它住在 `tools/ci/` 但需要真实 PostgreSQL；留在 contract 层会让 `ci:fast` 在 GitHub 托管 runner 上尝试连数据库，而 fast workflow 的第一条约束就是不依赖任何数据库或境内资源。另外 integration job 从未给测试传过 `DATABASE_URL`。
- **Fix:** `vitest.config.ts` 把它从 contract 的 include 排除、加进 integration；`integration.yml` 在 shell 里用 runner 环境里的 `POSTGRES_*` 拼出 `DATABASE_URL`（不给 password 默认值 —— 硬写默认值会让它静默连到另一个库）。
- **Verification:** `ci:fast` 不再跑它；`test:integration` 28 条全绿。
- **Committed in:** `08eabac`

**10. [Rule 1 - Bug] 根依赖与 tsconfig 补齐**
- **Found during:** Task 2 / Task 3
- **Issue:** `tests/**` 与 `tools/ci/**` 需要 `postgres` / `pg-boss` / `drizzle-orm` / `@hono/node-server` / `@drift/db` / `@drift/safety`，而它们只是子包依赖；`tests/**` 也不在任何 tsconfig 的 include 里（lint 直接报 project service 找不到）。
- **Fix:** 六项提升为根 devDependency（全部已在 lockfile 里，无新外部包）；根 tsconfig 加 `tests/**/*.ts` 与 `allowImportingTsExtensions`。
- **Verification:** `ci:fast` 全绿；`pnpm-workspace.yaml` 未被 install 改动。
- **Committed in:** `08eabac` / `ef55d6d`

---

**Total deviations:** 10 auto-fixed（5 条 Rule 1 bug、1 条 Rule 2 缺失关键、3 条 Rule 3 阻塞、1 条 Rule 4 已获裁决）
**Impact on plan:** 全部围绕「让断言不空真」与「让跨包 import 真的能跑」。没有一条扩大了本 plan 的范围；偏离 4（注册那一刀）是唯一新增的功能面，且刻意做成 Plan 09 的可替换前身。

## Issues Encountered

- **drizzle-kit 内部抛错仍然 exit 0。** `generate` 在 schema 求值抛异常时打印完整 stack 却退出 0，`drizzle/` 下什么都没生成。任何包装脚本都不能只看退出码 —— `assert-no-drift.mjs` 与 `tests/integration/setup.ts` 都另外检查输出。这是本 plan 里最值得记下的一条工具坑。
- **Write 对已存在文件会静默失败，除非先 Read。** `0001_constraints_and_grants.sql` 第一次写入没有生效（文件仍是 53 字节的 drizzle 占位符），而两条 grep 验收正是因此才发现的。后续所有覆写都先 Read。
- **开发库的密码与 compose 的 `POSTGRES_PASSWORD` 不一致**（数据卷是更早一次初始化留下的，initdb 不会再跑）。用 `docker exec psql` 重置了 `drift` 的密码。另外宿主 5432 被占用，开发库映射到 55432。
- **`@hono/node-server` 的 `serve()` 是异步开始监听的**，立刻读 `address()` 得到 null。tracer 改为等 `listening` 事件而不是 sleep —— 后者在负载高的 CI 上会变成一条间歇性红。
- **沙箱仍不允许创建 `.env`**（交接事实 10 复现）。所有本地验证用内联环境变量完成；`docker compose` 每次调用都要带齐 `POSTGRES_PASSWORD` / `WEB_ORIGIN` / `WECOM_WEBHOOK_URL`，否则 compose 在插值阶段就失败。

## User Setup Required

None —— 本 plan 未新增任何需要外部服务配置的内容。（`.env` 的键与说明仍见 `.env.example`。）

## Next Phase Readiness

**已就绪，可执行 01-05（Model Router 完整形态）。** 后续 plan 必须接在这条链路上，不得新建第二条投递路径。给下游的交接事实：

1. **`SKIPPED_CHECKS.md` 的 `L5-L6-no-subject` 已收窄为 `L6-no-subject`** —— L5（integration）已解除，`test:integration` 有 28 条被测断言且全绿；probes（L6）仍无被测对象，解除条件是 Plan 08 的危机探针集。
2. **`drizzle-kit check` 不能当漂移门禁**（不连库）。要在 CI 里加漂移检查请用 `pnpm --filter @drift/db run db:check`，它会跑 `scripts/assert-no-drift.mjs`。
3. **不要把 CHECK 约束写进裸 SQL 迁移** —— drizzle-kit 会把它当漂移并生成 DROP。约束定义在 schema 文件里，裸 SQL 只放触发器、角色、权限，以及对约束的存在性断言。
4. **`purge_role` 目前只有 `SELECT, DELETE`（外加 `invite_code(used_by, used_at)` 的 UPDATE）。** PRIV-05 的 Q1 裁决要求一键删除时对审计行做**去标识化**（UPDATE 移除 `user_id`），Plan 11 需要为此给 `purge_role` 补 `UPDATE` 授权 —— 现在没给是刻意守住本 plan 的范围。
5. **注册链路是一刀前身，不是成品。** `packages/db/src/onboarding.ts` + `apps/api/src/modules/auth/` 由 Plan 09 替换建账号那一步（改为 better-auth 的 server API），其余三步（消耗邀请码、5 条 consent + 5 条 consent_event、建会话）形态已对齐。`policy_version` 目前由调用方传入 —— Plan 15 产出隐私政策正文后应改为取其内容哈希（用 `@drift/prompts` 的 `promptVersion`，不要再写第二份 sha256）。
6. **`DISCLOSURE_SURFACES` 四项里目前只有 2 处有渲染点**（`chat_banner`、`character_detail`；`conversation_list` 的会话列表页仍是占位，`export_file` 属 Plan 11）。RESEARCH 8.3 要求的「每个 surface 都有一条通过的断言」那条元测试尚未写 —— 它属 Plan 14 的 UI 断言集。
7. **`session_risk_state` / `safety_event` / `contact_attempt` / `usage_segment` / `exit_intent` / `dependency_signal` 六张表已建但无写入路径**，分别由 Plan 07 / 12 / 13 填入。它们的取值域常量（`RISK_LEVELS`、`CONTACT_ATTEMPT_STATUSES`、`DEPENDENCY_RULE_IDS` 等）已定，直接用，不要另起一份。
8. **`llm_call.retrieved_memory_ids` / `recall_scores` 已预建**（本 plan 的裁决），Phase 3 不需要改表。
9. **网关的 `conversationStatus` 目前由调用方在同一事务里读出来传入。** Plan 12 要把这次读挪进 `packages/safety` 内部，让调用方连「传一个过期状态」都做不到。
10. **`resolveProvider()` 在 `LLM_PROVIDER_MODE != mock` 时显式抛错**，不回落到 mock。Plan 05 接真实 provider 时替换这一处，并补上 `ALLOWED_LLM_HOSTS` 白名单与启动期 host 断言。
11. **egress 注册表（RESEARCH 3.4）尚未建。** 本 plan 交付的是三个出口的类型签名与唯一产出点；`EGRESS_POINTS` 的集合相等断言与 `egress_hash` 绑定属 Plan 06。
12. **宿主 glibc 2.28 仍跑不了 `next dev` / `next build`**（交接事实 9 仍然成立）。前端走查必须在容器内完成：`docker compose up -d --wait postgres api web` 之后访问映射端口。

## Self-Check: PASSED

- `pnpm run ci:fast` 退出 0（typecheck / lint / 17 条 unit / 39 条 contract）
- `pnpm --filter @drift/db run db:check` 退出 0，输出不含 `pgboss`
- `pnpm run test:integration` 退出 0（tracer 9 条 + schema-drift 19 条）
- `pnpm run typecheck:fixtures` 退出码 1（负向 type fixture 仍然失败 —— GatedText 未退化）
- `docker compose up -d --wait postgres api web` 三容器 Healthy；`GET /healthz` 返回 status=ok / db=ok / pgvector=0.8.6 / pgboss=ok；`GET /characters` 未登录返回 401
- character 与 persona_version 各 3 行，三行 `model_snapshot` 均为 `doubao-seed-character-251128`（非别名）
- `grep -rn 'as GatedText'` 全仓仅命中 `packages/safety/src/gateway.ts`
- `AI_BADGE_TEXT =` / `AI_BANNER_TEXT =` 全仓各 1 处
- `grep -rn 'streamText|streamObject' packages apps` 0 行
- key-files.created 的每一项均已在磁盘上核对存在
- `git log --oneline --grep="01-04"` 返回 3 个生产提交

---
*Phase: 01-compliance-safety-chat-skeleton*
*Completed: 2026-09-26*
