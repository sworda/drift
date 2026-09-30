---
phase: 01-compliance-safety-chat-skeleton
plan: 03
subsystem: infra
tags: [hono, ws, pg-boss, pino, pgvector, drizzle, next, tailwind, shadcn, docker-compose, caddy, github-actions]

requires:
  - phase: 01-compliance-safety-chat-skeleton (Plan 01)
    provides: 三处契约修订与 tools/ci/check-contract-amendments.mjs 的 13 条机械断言；01-UI-SPEC.md ## Color 表（本 plan 的法定语义色真相源）
  - phase: 01-compliance-safety-chat-skeleton (Plan 02)
    provides: 单 pnpm workspace、tsconfig.base 严格基线、type-aware ESLint flat config 与具名导出的 REQUIRED_RESTRICTED_SYNTAX、vitest 四层 projects、ci:fast 入口
provides:
  - apps/api 单进程三入口（hono HTTP + ws 升级 + pg-boss worker），SIGTERM 下按 worker → ws → http 优雅关闭
  - 白名单式结构化日志（LOG_ALLOWED_FIELDS + logEvent/logError + pino redact 两道防线），不导出裸 logger
  - GET /healthz —— 真查 select 1 / pg_extension.extversion / pgboss schema 表数，任一失败 503
  - packages/db/drizzle.config.ts，schemaFilter ['public'] 把 pg-boss 与 drizzle 迁移彻底分家
  - apps/web（Next 16.3.6 + Tailwind 4.3.3 + shadcn radix），三条真实路由与 32px sticky AI 常驻条
  - apps/web/src/styles/tokens.css —— 法定语义色为独立字面值 token，带以 UI-SPEC 为真相源的机械断言
  - 单机 Docker Compose 全栈（pgvector/pgvector:pg18 + api + web + caddy），实测 up -d --wait 全绿
  - fast / integration / nightly 三条 workflow，integration 无任何放行构造
  - tools/ci/ci-workflow-guard.test.ts 与 tools/ci/design-tokens.test.ts 两个新守卫进入 ci:fast
affects: [01-04 tracer, 01-05 Model Router, 01-06 出站安全网关, 01-07 危机状态机, 01-08 危机探针集, 01-11 导出与日志 PII 断言, 01-13 公开性对账, 01-14 前端异常上报]

actuals:
  tokens: 24700
  tasks: 3
  commits: 3

tech-stack:
  added:
    - hono 4.13.9 + @hono/node-server 2.1.1（Node 适配器，ws 升级需要一个真实的 http.Server）
    - ws 8.21.3 + @types/ws 8.18.1
    - pg-boss 12.34.0（独立 pgboss schema）
    - postgres 3.4.9 + drizzle-orm 0.45.3 + drizzle-kit 0.31.11
    - pino 10.3.1
    - next 16.3.6 / react 19.3.0 / react-dom 19.3.0 / @ai-sdk/react 4.0.117
    - tailwindcss 4.3.3 + @tailwindcss/postcss 4.3.3
    - shadcn CLI 4.21.0（base radix、preset nova）+ radix-ui 1.6.7 + lucide-react 1.48.0 + cn 0.4.0 + class-variance-authority 0.7.1 + tw-animate-css 1.4.0
    - pgvector/pgvector:pg18（PostgreSQL 18.6 + pgvector 0.8.6）
    - caddy 2.10-alpine
    - node:24.21.0-bookworm-slim（基础镜像固定到 engines.node 下限本身）
  patterns:
    - 白名单式日志：字段类型只接受白名单键（编译期）+ pino redact（运行时），业务模块拿不到裸 logger
    - 环境变量在启动时一次性 zod 校验并 exit 1；全仓唯一读取点由 eslint 禁令 + 使用点 disable 注释锁定
    - 包边界用 eslint no-restricted-imports 的 regex 形式表达（group 会误伤相对路径）
    - 法定语义色是独立字面值 token，断言以权威文档表格行为真相源而非测试内常量
    - 被 references 引用的项目不得 noEmit（TS6310）→ 需要 allowImportingTsExtensions 时用 emitDeclarationOnly
    - 「缺失即失败」而非「缺失即跳过」：nightly 对尚未落地的脚本用 [ -f ] + exit 1

key-files:
  created:
    - apps/api/package.json
    - apps/api/tsconfig.json
    - apps/api/Dockerfile
    - apps/api/src/index.ts
    - apps/api/src/config/env.ts
    - apps/api/src/obs/logger.ts
    - apps/api/src/db/client.ts
    - apps/api/src/http/app.ts
    - apps/api/src/http/health.ts
    - apps/api/src/ws/server.ts
    - apps/api/src/worker/index.ts
    - packages/db/drizzle.config.ts
    - apps/web/package.json
    - apps/web/tsconfig.json
    - apps/web/tsconfig.typecheck.json
    - apps/web/next.config.ts
    - apps/web/postcss.config.mjs
    - apps/web/components.json
    - apps/web/Dockerfile
    - apps/web/src/app/layout.tsx
    - apps/web/src/app/globals.css
    - apps/web/src/styles/tokens.css
    - apps/web/src/app/(app)/characters/page.tsx
    - apps/web/src/app/(app)/conversations/page.tsx
    - apps/web/src/app/(app)/chat/[conversationId]/page.tsx
    - docker-compose.yml
    - Caddyfile
    - .dockerignore
    - docker/postgres/init/01-extensions.sql
    - .env.example
    - .github/workflows/fast.yml
    - .github/workflows/integration.yml
    - .github/workflows/nightly.yml
    - tools/ci/design-tokens.test.ts
    - tools/ci/ci-workflow-guard.test.ts
  modified:
    - eslint.config.js
    - tsconfig.json
    - packages/db/package.json
    - packages/db/tsconfig.json
    - pnpm-workspace.yaml
    - .gitignore
    - SKIPPED_CHECKS.md

key-decisions:
  - "apps/api 用 .ts import specifier + emitDeclarationOnly：Node 24 不会把 './x.js' 改写成 './x.ts'（实测 ERR_MODULE_NOT_FOUND），而被 references 引用的项目不得 noEmit（TS6310）。两条约束交集下只有这一个可行形态"
  - "logEvent 的白名单里有 userId 但没有 errorMessage：pg 的报错串里可能带 SQL 参数，而参数就是消息正文。需要更多线索时加枚举型 errorCode，不把原始串放进日志"
  - "apps/web 的 references 指向 tsconfig.typecheck.json 而不是 tsconfig.json：Next 强制把 noEmit: true 与 jsx: react-jsx 写进它自己的配置，与 TS6310 不可能在同一个文件里同时成立"
  - "shadcn preset 取 nova（lucide + neutral）并移除它注入的 next/font Geist：UI-SPEC 的两步命令写于 CLI 要求 preset 之前，而所有 preset 都带网络字体，与「零网络字体开销」冲突"
  - "PG 18+ 镜像的数据卷挂载点是 /var/lib/postgresql 而不是 .../data（docker-library/postgres#1259）"
  - "Caddy 全局 email 指令已移除而不是给假邮箱默认值：空值让配置解析直接失败，而假邮箱意味着证书到期通知永远没人看到"
  - "把 T-03-03（唯一一条 critical）的 grep 断言搬进 ci:fast：只在写代码那天跑过一次的 grep，与一条不存在的检查没有区别"

patterns-established:
  - "机械断言的真相源必须是权威文档本身：design-tokens.test.ts 按 UI-SPEC 的表格行解析色值，改 UI-SPEC 时断言会变红"
  - "字面扫描类断言的范围要收到元素/开标签一级，不能是整文件子串扫描 —— 否则文件里描述该约束的散文会让断言误报，而一条会误报的断言迟早被放宽成永不报"
  - "解释禁止构造的注释不得原样引用被禁的关键字（当断言是字面 grep 时）"

requirements-completed: [PLAT-01, PLAT-02, PLAT-08]

coverage:
  - id: D1
    description: "apps/api 是单进程三入口：hono HTTP、ws 升级、pg-boss worker 在同一个 node 进程内启动，且 ws 的 import 只出现在 apps/api/src/ws/ 目录下"
    requirement: PLAT-01
    verification:
      - kind: other
        ref: "grep -rn \"from 'ws'\" apps/api/src --include=*.ts -> 恰好 1 行（apps/api/src/ws/server.ts:13）"
        status: pass
      - kind: other
        ref: "index.ts 同时引用 healthRoutes / attachWebSocket / startWorker；容器实跑日志依次出现 startup.begin(phase=worker) -> worker.started -> startup.health_probe -> http.routes_mounted -> startup.listening"
        status: pass
    human_judgment: false
  - id: D2
    description: "ws 包只能被 apps/api/src/ws/** 导入这条包边界由 eslint 强制，而不只是靠一次 grep"
    requirement: PLAT-01
    verification:
      - kind: manual_procedural
        ref: "破坏验证：在 apps/api/src/http/ 放一个 import { WebSocketServer } from 'ws' 的探针 -> no-restricted-imports 报错，exit 1；探针已删除"
        status: pass
    human_judgment: false
  - id: D3
    description: "环境变量启动时一次性校验、失败 exit 1；apps/api 里 process.env 只在 src/config/env.ts 出现，且该禁令由 eslint 强制"
    verification:
      - kind: other
        ref: "grep -rl 'process.env' apps/api/src --include=*.ts -> 仅 apps/api/src/config/env.ts"
        status: pass
      - kind: manual_procedural
        ref: "实跑 env -u DATABASE_URL -u WEB_ORIGIN -u WECOM_WEBHOOK_URL node src/index.ts -> 打印三条缺失项，exit 1"
        status: pass
      - kind: manual_procedural
        ref: "破坏验证：探针文件里的 process.env['FOO'] 命中新增的 MemberExpression 禁令；探针已删除"
        status: pass
    human_judgment: false
  - id: D4
    description: "pino 日志白名单式：logEvent 的 fields 类型只接受 LOG_ALLOWED_FIELDS 的键，配 redact 第二道，且不导出裸 logger"
    verification:
      - kind: other
        ref: "logger.ts 同时含 LOG_ALLOWED_FIELDS / logEvent / redact；grep -c 'export const logger' -> 0"
        status: pass
      - kind: other
        ref: "容器实跑日志逐条检查：五条 startup 事件的字段全部在白名单内，无任何文本载荷字段"
        status: pass
    human_judgment: true
    rationale: "「日志不含个人信息」的完整证据需要跑一个真实 turn 再对输出做子串断言（RESEARCH §7.1），而本 plan 还没有消息链路。Plan 11 的 pino-no-pii.test.ts 是那一半；当前只证明了白名单在编译期成立且启动期输出干净"
  - id: D5
    description: "单 PostgreSQL 18.6 同时承载 OLTP + pgvector 0.8.6 + pg-boss，且 pg-boss 在独立 schema；/healthz 真查这三者"
    requirement: PLAT-02
    verification:
      - kind: integration
        ref: "curl -fsS http://localhost:3001/healthz -> 200，body 为 status=ok / db=ok / pgvector=0.8.6 / pgboss=ok"
        status: pass
      - kind: integration
        ref: "容器内 psql -Atc select extversion from pg_extension where extname='vector' -> 0.8.6（>= 0.8.2，CVE-2026-3172）；show server_version -> 18.6"
        status: pass
      - kind: integration
        ref: "select count(*) from information_schema.tables where table_schema='pgboss' -> 12（boss.start() 跑完了自己的迁移）"
        status: pass
      - kind: other
        ref: "grep -n 'schemaFilter' packages/db/drizzle.config.ts -> schemaFilter: ['public']"
        status: pass
    human_judgment: false
  - id: D6
    description: "drizzle 迁移不会把 pg-boss 的表当成漂移删掉（T-03-05）"
    requirement: PLAT-02
    verification: []
    human_judgment: true
    rationale: "本 plan 交付的是 schemaFilter 配置本身；它的负向守卫是「boss.start() 之后 drizzle-kit check 无 diff」，而 packages/db/src/schema 由 Plan 04 建立，此刻没有可比对的 schema。Plan 04 必须补上该断言"
  - id: D7
    description: "apps/web 由 UI-SPEC 的两步预设建成：next/react/react-dom/tailwindcss 为精确版本，components.json 存在且无 template 键"
    requirement: PLAT-01
    verification:
      - kind: other
        ref: "apps/web/package.json -> next 16.3.6 / react 19.3.0 / react-dom 19.3.0 / tailwindcss 4.3.3（均无 ^ 或 ~）；components.json 存在，template 键计数 0，style = radix-nova"
        status: pass
    human_judgment: false
  - id: D8
    description: "AI-label 与 care 六个法定语义色是独立字面值 token，值与 UI-SPEC ## Color 表逐个相等，且不是对 Border/Neutral 的引用"
    verification:
      - kind: unit
        ref: "tools/ci/design-tokens.test.ts#AI-label / Care 的三个值与 UI-SPEC ## Color 表逐个相等（真相源是 UI-SPEC 的表格行，不是测试内常量）"
        status: pass
      - kind: unit
        ref: "tools/ci/design-tokens.test.ts#三个值是字面色值不是引用 / AI-label 的面色与描边都不等于通用 Border 的值"
        status: pass
      - kind: manual_procedural
        ref: "三次破坏验证：面色改成 Border 的 #E2E8F0 -> 2 failed；care 面色改成 var(--secondary-surface) -> 2 failed；--size-ai-bar 改 24px -> 1 failed。还原后 8 passed"
        status: pass
    human_judgment: false
  - id: D9
    description: "三条真实路由存在且可构建；聊天页有一个 32px sticky top-0 的 AI 常驻条，且没有任何 dismiss / 折叠 / 关闭交互"
    verification:
      - kind: integration
        ref: "容器内 next build 的路由清单：/ 、/_not-found 、/characters 、/chat/[conversationId] 、/conversations"
        status: pass
      - kind: unit
        ref: "tools/ci/design-tokens.test.ts#AI 常驻条高度固定为 32px + #常驻条是 sticky top-0 且不带任何可关闭交互（按开标签范围断言 onClick/onDismiss/onClose/aria-expanded/aria-hidden/hidden/tabIndex/role=button 均不存在）"
        status: pass
      - kind: automated_ui
        ref: "docker compose 起栈后 curl -fsSk https://localhost/conversations 经 caddy 反代返回 200"
        status: pass
    human_judgment: true
    rationale: "「常驻条在真实浏览器里确实可见、对比度确实可感知、且滚动时不消失」是 UI-SPEC〔法定〕的可感知性要求，需要人眼在 375–430px 视口上确认。机械断言只覆盖了尺寸、粘性与不可关闭性三项结构事实"
  - id: D10
    description: "apps/web 不加载任何网络字体，字体栈是 UI-SPEC 的系统字体栈"
    verification:
      - kind: unit
        ref: "tools/ci/design-tokens.test.ts#layout.tsx 不加载任何网络字体（剥掉注释后断言不含 next/font，并断言 tokens.css 的 --font-sans 以 -apple-system 开头）"
        status: pass
    human_judgment: false
  - id: D11
    description: "docker compose up -d --wait 起得来：postgres / api / web / caddy 四个服务全部 healthy；明确不引入 redis / clickhouse / minio / langfuse"
    verification:
      - kind: integration
        ref: "docker compose config -q exit 0（四个服务）；docker compose up -d --wait exit 0；docker compose ps -> 四者均 healthy"
        status: pass
      - kind: other
        ref: "docker-compose.yml 中 redis|clickhouse|minio|langfuse 服务名计数 0；postgres 镜像串精确为 pgvector/pgvector:pg18"
        status: pass
      - kind: integration
        ref: "caddy 反代双向可用：https://localhost/healthz -> api 的 JSON；https://localhost/conversations -> 200"
        status: pass
    human_judgment: false
  - id: D12
    description: "fast workflow 只跑 ci:fast 且不依赖任何境内资源；integration workflow 是 self-hosted 且不存在放行分支；nightly 对未落地脚本缺失即失败"
    verification:
      - kind: unit
        ref: "tools/ci/ci-workflow-guard.test.ts 6 条全绿：integration self-hosted / 无放行构造 / 真跑 L5+L6 / fast 在 ubuntu-latest 且不引用 WECOM_|LLM_ secret / 三条 workflow 都设 COREPACK_ENABLE_DOWNLOAD_PROMPT / nightly 两个脚本缺失即 exit 1"
        status: pass
      - kind: other
        ref: "integration.yml 的 continue-on-error 与 if-always 计数 -> 0"
        status: pass
      - kind: manual_procedural
        ref: "破坏验证：给 integration 的 L6 步骤加 continue-on-error -> 守卫 1 failed；已还原"
        status: pass
    human_judgment: true
    rationale: "阻断规则的另一半不在本仓库的文件里：integration 必须在 GitHub 仓库设置里被标记为 required check，runner 掉线时 PR 才会因缺少 required check 而无法合并。本仓库当前无 git remote，三条 workflow 从未真实执行过（已登记 SKIPPED_CHECKS.md 的 ci-workflows-never-executed）"
  - id: D13
    description: "提示词真相源在 git 内、不存在从数据库或远端读取提示词的代码路径（PLAT-08 的本 plan 部分）"
    requirement: PLAT-08
    verification:
      - kind: other
        ref: "docker-compose.yml 不含 langfuse 服务（D-05 明确否决 Langfuse Cloud 与 Phase 1 自托管）；apps/api 与 apps/web 全量源码无任何提示词读取路径"
        status: pass
    human_judgment: true
    rationale: "PLAT-08 的实质（提示词文本 + 内容哈希派生的 prompt_version）由 Plan 05 填入。本 plan 只证明了否定半边：部署拓扑里没有任何可以托管提示词的外部服务"
  - id: D14
    description: "pnpm install --frozen-lockfile 在镜像构建与 CI 中都成立，lockfile 与 workspace 不被安装过程改动"
    verification:
      - kind: other
        ref: "连续两次 pnpm install --frozen-lockfile 后 pnpm-lock.yaml 字节一致；两个 Dockerfile 的 install 步骤均用 --frozen-lockfile 且构建成功"
        status: pass
      - kind: other
        ref: "fast.yml 末步 git diff --exit-code pnpm-lock.yaml pnpm-workspace.yaml"
        status: pass
    human_judgment: false

duration: 1h 22m
completed: 2026-09-26
status: complete
---

# Phase 01 Plan 03: 两个部署单元、单机全栈与 CI 拓扑 Summary

**apps/api 的 hono + ws + pg-boss 单进程三入口与白名单式 pino 日志、apps/web 的 Next 16 两步预设与带 UI-SPEC 为真相源的法定语义色 token、以及 pgvector/pgvector:pg18 的四服务 Compose 全栈 —— `up -d --wait` 实测全绿且 `/healthz` 查到真实的 pgvector 0.8.6；integration workflow 的「无放行构造」从一次性 grep 升级为 ci:fast 里的常驻断言**

## Performance

- **Duration:** 1h 22m
- **Started:** 2026-09-26T17:43:38+08:00
- **Completed:** 2026-09-26T19:05:14+08:00
- **Tasks:** 3 个 auto 任务
- **Files modified:** 45（含 lockfile）

## Accomplishments

- **单机全栈真的起来了，而且 `/healthz` 不是一个常量。** `docker compose up -d --wait` 退出 0、四服务 healthy，`/healthz` 返回 `status=ok / db=ok / pgvector=0.8.6 / pgboss=ok` —— 三个字段分别来自一次 `select 1`、一次 `pg_extension.extversion` 查询、一次 `information_schema.tables` 计数（pgboss schema 里 12 张表，即 `boss.start()` 跑完了自己的迁移）。PostgreSQL 18.6 + pgvector 0.8.6 与版本锁逐字一致。
- **三个只有真跑才会暴露的部署坑被踩到并写下了原因**（细节见 Deviations）：PG 18+ 镜像换了数据目录约定、pnpm 12 的 0600 lockfile 经 `COPY` 带进镜像后非 root 用户读不到、Caddy 的空 `email` 让整份配置解析失败。第二个尤其值得记：它**在 CI 的全新 clone 上复现不了**（git 只存可执行位），只在「构建上下文来自 pnpm 跑过的工作树」时出现。
- **两组法定约束各自有了一个被证明会失败的检查器。** 法定语义色的真相源是 `01-UI-SPEC.md` 的 `## Color` 表格行本身而不是测试里的常量（改 UI-SPEC 时断言会变红）；三次破坏验证实跑：面色改成 Border 的值 → 2 failed、care 面色改成 `var()` → 2 failed、常驻条高度压到 24px → 1 failed。
- **把 T-03-03 从「写代码那天 grep 过一次」变成了每个 PR 都成立。** 它是本 plan 威胁表里唯一一条 critical（integration 被 skip 后 PR 仍合入），原缓解措施只是一次执行期 grep。现在 `tools/ci/ci-workflow-guard.test.ts` 在 `ci:fast` 里断言六条 CI 拓扑性质，破坏验证（给 L6 步骤加放行开关）让它 1 failed。
- **两条新的包边界进了 eslint 而不是只进了验收清单**：`ws` 只能被 `apps/api/src/ws/**` 导入、`process.env` 只能被 `apps/api/src/config/env.ts` 读。两条都做了破坏验证。

## Task Commits

1. **Task 1: apps/api 单进程三入口 + pino 白名单日志 + drizzle 排除 pgboss** — `867ddf3` (feat)
2. **Task 2: apps/web 两步预设 + 法定语义色独立 token + 三条路由** — `cc3f9e3` (feat)
3. **Task 3: Docker Compose 单机全栈 + fast/integration/nightly 三条 workflow** — `722b217` (feat)

**Plan metadata:** 本次提交 (docs: complete plan)

## Files Created/Modified

**apps/api（单进程三入口）**
- `src/index.ts` — 唯一启动点。启动顺序 worker → 健康自检 → HTTP → 挂 ws；SIGTERM 下 worker → ws → http 优雅关闭
- `src/config/env.ts` — zod 启动时一次性校验，失败 exit 1。全仓唯一 `process.env` 读取点
- `src/obs/logger.ts` — `LOG_ALLOWED_FIELDS` + `logEvent`/`logError` + pino `redact`；不导出裸 logger
- `src/http/health.ts` — `healthRoutes` / `HEALTH_PATH` / `probeHealth`，三项真实探测，任一失败 503
- `src/http/app.ts` — hono 实例、CORS 取 `WEB_ORIGIN`、`/telemetry/error` 骨架（501 + 载荷白名单常量 + bodyLimit）
- `src/ws/server.ts` — 全仓唯一导入 `ws` 的文件；连接建立、30s 心跳（半开连接 terminate）、按 `conversationId` 房间登记
- `src/worker/index.ts` — pg-boss 住 `pgboss` schema；文件头记录了四条从 `.d.ts` 实读的 API 事实
- `src/db/client.ts` — 单一 postgres.js 连接池；注明 `debug` 永不打开（它会打印含消息正文的 SQL 参数）
- `Dockerfile` / `tsconfig.json` / `package.json`

**apps/web**
- `src/styles/tokens.css` — 法定语义色 6 个独立字面值 + 通用调色板 + 4 档字号 + 2 个字重 + 8 档间距 + 44/72/32
- `src/app/globals.css` — import 顺序与 `:root` 去重（说明见 Deviations #6）；法定 token 桥接进 Tailwind theme 命名空间
- `src/app/layout.tsx` — 系统字体栈，无网络字体
- `src/app/(app)/{characters,conversations,chat/[conversationId]}/page.tsx` — 三条路由；聊天页含 32px sticky AI 常驻条
- `tsconfig.json`（Next 拥有）+ `tsconfig.typecheck.json`（根 references 指向它）
- `Dockerfile` / `next.config.ts` / `postcss.config.mjs` / `components.json`

**部署与 CI**
- `docker-compose.yml` / `Caddyfile` / `.dockerignore` / `docker/postgres/init/01-extensions.sql` / `.env.example`
- `.github/workflows/{fast,integration,nightly}.yml`
- `tools/ci/design-tokens.test.ts`（8 条）/ `tools/ci/ci-workflow-guard.test.ts`（6 条）

**修改**
- `eslint.config.js` — `restrictedImports()` 组合器 + `ws` 边界 + `apps/api` 的 `process.env` 禁令
- `tsconfig.json` — references 追加 `apps/api` 与 `apps/web/tsconfig.typecheck.json`
- `packages/db/{package.json,tsconfig.json}` + `drizzle.config.ts`
- `.gitignore` — `!.env.example`（`.env*` 本来把它一起排除了）
- `pnpm-workspace.yaml` — `allowBuilds: esbuild: true`
- `SKIPPED_CHECKS.md` — 新增三行

## Decisions Made

1. **apps/api 用 `.ts` import specifier + `emitDeclarationOnly`。** 两条实测约束的交集只剩这一个形态：Node 24 不会把 `./x.js` 改写成 `./x.ts`（直接 `ERR_MODULE_NOT_FOUND`），所以源码直连要求写 `.ts`；而 `allowImportingTsExtensions` 要求 `noEmit` 或 `emitDeclarationOnly`，被 `references` 引用的项目又**不得** `noEmit`（TS6310）。顺带一条反直觉事实：`composite: true` + `noEmit: true` 在 `tsc --build` 下单独是合法的，不合法的只是「被别人引用」。
2. **`apps/web` 的 references 指向 `tsconfig.typecheck.json`。** Next 16 会把 `noEmit: true` 与 `jsx: react-jsx` 强制写进它自己的 `tsconfig.json`（构建日志里明确列为 mandatory change），与 TS6310 不可能在同一个文件里同时成立。让 Next 完全拥有 `tsconfig.json`，另起一份只改 emit 的 composite 配置，是唯一不用和 Next 抢文件的写法。
3. **日志白名单里不放 `errorMessage`。** `logError` 只取 `error.name`。理由：postgres 的报错串里可能带 SQL 参数，而参数就是消息正文 —— 那正是这两道防线要堵的东西。需要更多线索时加枚举型 `errorCode`。
4. **`ws` 的导入边界用 `regex` 而不是 `group`。** `group: ['ws', 'ws/*']` 会把相对路径 `'./ws/server.ts'` 也算命中（实测），于是「唯一导入者」这条边界会退化成「谁都不能引用 ws 目录」——`apps/api/src/index.ts` 当场被自己的规则拦下。
5. **`process.env` 的豁免写成使用点上的 `eslint-disable` 注释，而不是配置块的 `ignores`。** 两者效果等价，但前者让「谁绕过了这条禁令」在 code review 的 diff 里看得见，且新增文件默认被管住。
6. **Caddy 的全局 `email` 指令移除，而不是给一个默认值。** 空值让整份配置解析失败；假邮箱更糟 —— 那会拿一个收不到信的地址去注册 ACME 账户，证书到期通知永远没人看到。
7. **把 CI 阻断规则的 grep 搬进 `ci:fast`。** T-03-03 是本 plan 唯一一条 critical，而它原本的缓解措施是「执行时 grep 断言为 0」。一条只在写代码那天跑过的 grep，与一条不存在的检查没有区别。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - 阻塞] typecheck 命令改用 `tsc --build`，并补 `apps/api` 的 `emitDeclarationOnly`**
- **Found during:** Task 1
- **Issue:** PLAN 的 verify 写的是 `tsc --noEmit -p tsconfig.json`，而 01-02-SUMMARY 已实测该命令在 `references` 存在时是空真检查。另外把 `apps/api` 加入 references 后，`noEmit: true` 触发 TS6310「Referenced project may not disable emit」。
- **Fix:** 验证统一走 `pnpm run typecheck`（`tsc --build`）；`apps/api/tsconfig.json` 改为 `emitDeclarationOnly: true` + `outDir: dist`（`dist/` 已被 gitignore）。两条命令都实跑记录（均 exit 0）。
- **Verification:** `pnpm run typecheck` exit 0；`pnpm run typecheck:tools` exit 0
- **Committed in:** `867ddf3`

**2. [Rule 3 - 阻塞] 新增三类 PLAN 未列出的文件**
- **Found during:** Task 1 / Task 3
- **Issue:** (a) `healthRoutes` 与 worker 都需要一个 postgres 连接池，PLAN 的文件清单里没有它的位置；(b) hono 跑在裸 Node 上需要适配器才能拿到 `http.Server`，而 `ws` 的升级只能挂在它上面；(c) compose 的 `api`/`web` 服务需要镜像。
- **Fix:** 新增 `apps/api/src/db/client.ts`、依赖 `@hono/node-server@2.1.1`（honojs 官方适配器）、新增 `apps/api/Dockerfile` 与 `apps/web/Dockerfile` 及 `.dockerignore`、`docker/postgres/init/01-extensions.sql`。
- **Verification:** 两个镜像均构建成功并在 compose 里 healthy
- **Committed in:** `867ddf3` / `722b217`

**3. [Rule 1 - Bug] `.gitignore` 的 `.env*` 把 `.env.example` 一起排除了**
- **Found during:** Task 1 提交前
- **Issue:** PLAN 要求交付 `.env.example`，而 Plan 02 留下的 `.env*` 模式会让它永远进不了仓库 —— 一个「文件明明写了却不存在」的静默失败。
- **Fix:** `.gitignore` 加 `!.env.example`。
- **Verification:** `git check-ignore -v .env.example` 命中否定规则，文件已入仓
- **Committed in:** `867ddf3`

**4. [Rule 3 - 阻塞] `pnpm-workspace.yaml` 的 `allowBuilds` 占位串让 `--frozen-lockfile` 静默退出 1**
- **Found during:** Task 1（装 drizzle-kit 之后）
- **Issue:** pnpm 12 检测到带 postinstall 的包（esbuild，drizzle-kit 的 config 加载器）时，会自行往 `pnpm-workspace.yaml` 写入 `allowBuilds: esbuild: set this to true or false`。留着这个占位串，`pnpm install --frozen-lockfile` **退出 1 且 stdout/stderr 完全没有任何错误信息**（分离流捕获确认）。fast workflow 的第一步就是这条命令。
- **Fix:** 显式 `allowBuilds: esbuild: true` 并在文件里写明理由。
- **Verification:** `pnpm install --frozen-lockfile` exit 0，三个 esbuild postinstall 正常完成；连续两次安装后 lockfile 字节一致
- **Committed in:** `867ddf3`

**5. [Rule 4 → 已按 UI-SPEC 的显式授权自行裁决] `shadcn init` 现在强制要求 `--preset`，且 `@shadcn/theme-slate` 已不在 registry 中**
- **Found during:** Task 2
- **Issue:** UI-SPEC `## Design System` 给的两步命令写于 CLI 要求 preset 之前：不带 `--preset` 时 `init` 停在交互式选择器上（`-y` 默认为 true 也不跳过）。而第二步 `shadcn add @shadcn/theme-slate` 直接失败 —— registry 现在只有 214 项且**零个 theme 条目**（UI-SPEC 记录的是 471 项 / 5 个 theme），theme 已被 preset 机制取代。
- **为什么没有升级为 Rule 4 停下来问:** UI-SPEC 的 `preset_field_note` 已经预先授权了这类处置（它明确区分「设计预设的描述」与 CLI 的 `--preset` 取值域，并要求不得把前者原样传给后者）；而两步预设的**实质**是「基座取冷灰中性族 + 覆写 `--primary`」，这一条由 `tokens.css` 按 UI-SPEC `## Color` 表逐值落地后完全成立 —— 表里的 `#F6F7F9`/`#E2E8F0`/`#0F172A`/`#556070` 本身就是 slate 族。禁令「不得用 `--template next` / 不得让 shadcn 生成 monorepo」全部遵守。
- **Fix:** 从 CLI 内置的 preset 注册表里读出可用取值（`nova/vega/maia/lyra/mira/luma/sera/rhea`），选 `nova`（`iconLibrary: lucide` 与 `baseColor: neutral` 两项与 UI-SPEC 一致，且它是 `--defaults` 自己用的那个）；`theme-slate` 一步跳过，调色板改由 `tokens.css` 承担。
- **Verification:** `components.json` 存在、无 `template` 键、`style: radix-nova`、`iconLibrary: lucide`；四个锁定版本仍为精确值
- **Committed in:** `cc3f9e3`

**6. [Rule 1 - Bug] `shadcn init` 注入网络字体，且 `@import` 顺序不足以让 token 生效**
- **Found during:** Task 2
- **Issue:** 两件事。(a) `init` 往 `layout.tsx` 注入了 `next/font/google` 的 Geist，违反 UI-SPEC 的「系统字体栈 / 零网络字体开销」。(b) `init` 把自己的 `@import` 追加到我的 `tokens.css` 之后，并在 `globals.css` 里内联了一整块 `:root` —— 而 CSS 层叠里 `@import` 进来的规则**永远早于**本文件的内联规则，同优先级下后者胜出。也就是说「把 tokens.css 放最后」并不能让法定 token 赢；同名键必须只在一处定义。
- **Fix:** (a) 重写 `layout.tsx` 为系统字体栈，并补一条断言 —— 这个注入每次 `init` 都会回来，没有断言它会安静地复发（本 plan 内它确实复发过一次：第一次改写没落盘，直到 grep 才发现）。(b) 以 `tokens.css` 的键集为准，程序化地把 `globals.css` 内联 `:root` 里的同名键全部删除，`.dark` 块清空为插槽（UI-SPEC：v1 不做深色模式）。
- **Verification:** `design-tokens.test.ts` 的字体断言通过；`apps/web/src` 下 `next/font` 仅剩一处 CSS 注释；容器内 `next build` 成功
- **Committed in:** `cc3f9e3`

**7. [Rule 1 - Bug] PG 18+ 镜像的数据卷挂载点变了**
- **Found during:** Task 3（第一次 `up -d --wait`）
- **Issue:** 沿用 18 之前到处可见的 `pgdata:/var/lib/postgresql/data` 写法，容器**直接拒绝启动**：`there appears to be PostgreSQL data in /var/lib/postgresql/data (unused mount/volume)`。PG 18+ 官方镜像改成按主版本号命名子目录（docker-library/postgres#1259），这样 `pg_upgrade --link` 不会跨挂载点边界。
- **Fix:** 挂载点改为 `pgdata:/var/lib/postgresql`，并在 compose 里写下原因。
- **Verification:** postgres healthy，`show server_version` → 18.6，初始化脚本执行（pgvector 扩展 + pgboss schema + 版本下限断言）
- **Committed in:** `722b217`

**8. [Rule 1 - Bug] pnpm 12 的 0600 lockfile 经 `COPY` 带进镜像后非 root 用户读不到**
- **Found during:** Task 3（`web` 容器反复重启）
- **Issue:** `drift-web` 起来就报 `Failed to read pnpm-workspace.yaml at /app/pnpm-workspace.yaml: Permission denied (os error 13)`。根因：pnpm 12 把 `pnpm-lock.yaml` 与 `pnpm-workspace.yaml` 写成 **0600**，`COPY` 原样保留文件模式，`USER node` 于是读不到。`api` 没暴露是因为它运行时不读 workspace 配置。
- **为什么值得单独记:** 这个坑**在 CI 的全新 clone 上复现不了** —— git 只存可执行位，clone 出来是 0644。它只在「构建上下文来自 pnpm 跑过的工作树」时出现，也就是本地构建和任何带缓存的 runner 上。
- **Fix:** 两个 Dockerfile 在 `USER node` 之前 `RUN chmod -R a+rX /app`（不依赖宿主模式；目录补 x）。
- **Verification:** `web` healthy，经 caddy 反代 `/conversations` 返回 200
- **Committed in:** `722b217`

**9. [Rule 1 - Bug] Caddy 的空 `email` 让整份配置解析失败**
- **Found during:** Task 3
- **Issue:** `ACME_EMAIL` 未设置时 `{$ACME_EMAIL}` 展开为空串，Caddy 报 `parsing caddyfile tokens for 'email': wrong argument count` 并反复重启。
- **Fix:** 移除全局 `email` 指令（Caddy 不需要它也能签发证书），并在 Caddyfile 里写明为什么不给一个假邮箱默认值；compose 里同步删掉悬空的 `ACME_EMAIL`。
- **Verification:** caddy healthy，admin API 探针通过，https 双向反代可用
- **Committed in:** `722b217`

**10. [Rule 2 - 缺失关键项] 两条断言的范围过宽会误报，以及 T-03-03 的 grep 只活在 PLAN 里**
- **Found during:** Task 2 / Task 3
- **Issue:** 三件同源的事。(a)「聊天页无 dismiss 交互」若做整文件子串扫描，会被**描述该约束本身的注释**触发（实跑红过一次）。(b) PLAN 要求 integration.yml 的放行构造计数为 0，而我在该文件里解释禁令时原样引用了那两个关键字 —— 实测计数 2。(c) T-03-03 是本 plan 唯一一条 critical，缓解措施却只是一次执行期 grep。
- **Fix:** (a) 断言范围收到常驻条的**开标签**一级，改断 `onClick`/`onDismiss`/`onClose`/`aria-expanded`/`aria-hidden`/`hidden`/`tabIndex`/`role="button"` 均不出现。(b) 改写 integration.yml 的注释：完整保留理由，但不原样引用被禁的关键字，并说明「断言是一次字面扫描，连注释里的引用也会让它变红」。(c) 新增 `tools/ci/ci-workflow-guard.test.ts`（6 条），进 `ci:fast`。
- **Verification:** 计数 0；守卫 6 条全绿；破坏验证（给 L6 加放行开关）→ 1 failed，已还原
- **Committed in:** `cc3f9e3` / `722b217`

**11. [Rule 2 - 缺失关键项] 两条包边界只在 PLAN 的验收清单里，没有在 CI 里**
- **Found during:** Task 1
- **Issue:** 「`ws` 的唯一导入者是 `apps/api/src/ws/**`」是 RESEARCH §2.1 四条不可协商包边界之一，而 PLAN 只给了一条 `grep`。一次性的 grep 挡不住下一个 `new WebSocketServer`。
- **Fix:** `eslint.config.js` 里把 provider 与 ws 两条导入边界改成可组合的 `restrictedImports({ providers, ws })`（两者作用域不同，而 flat config 对同一规则是替换而非合并，必须从一处组装）；并追加 `apps/api/src/**` 的 `process.env` 禁令，spread `REQUIRED_RESTRICTED_SYNTAX`。
- **Verification:** 探针文件同时命中两条新禁令（exit 1），探针已删除；`eslint-config-meta.test.ts` 自动把 `apps/api` 的代表文件纳入断言并全绿（19 条）
- **Committed in:** `867ddf3`

---

**Total deviations:** 11 自行处置（5 条 Rule 1、3 条 Rule 2、3 条 Rule 3；其中 #5 形式上属 Rule 4 但 UI-SPEC 已显式授权，理由见该条）
**Impact on plan:** 无范围扩张。5 条 Rule 1 里有 4 条是「照抄通行写法就会静默失败」的真实坑（PG18 数据目录、0600 lockfile、Caddy 空 email、`.env*` 吞掉 example），第 5 条是 shadcn 注入的网络字体违反 UI-SPEC 法定项。3 条 Rule 2 全部指向同一件事 —— 把只在执行当天成立的断言变成常驻断言。

## Q5（PLAN 要求记录的 pg-boss 延迟投递签名原文）

从 `node_modules/.pnpm/pg-boss@12.34.0/node_modules/pg-boss/dist/{index,types}.d.ts` 实读。四条里有三条与流传最广的文档写法不同：

```ts
// index.d.ts —— 注意整个文件里 export default 零命中
export declare class PgBoss extends EventEmitter<types.PgBossEventMap> {
    constructor(connectionString: string);
    constructor(options: types.ConstructorOptions);
    start(): Promise<this>;
    stop(options?: types.StopOptions): Promise<void>;
    send(request: types.Request): Promise<string | null>;
    send(name: string, data?: object | null, options?: types.SendOptions): Promise<string | null>;
    sendAfter(name: string, data: object | null, options: types.SendOptions | null, date: Date): Promise<string | null>;
    sendAfter(name: string, data: object | null, options: types.SendOptions | null, dateString: string): Promise<string | null>;
    sendAfter(name: string, data: object | null, options: types.SendOptions | null, seconds: number): Promise<string | null>;
    sendThrottled(name: string, data: object | null, options: types.SendOptions | null, seconds: number, key?: string): Promise<string | null>;
    sendDebounced(name: string, data: object | null, options: types.SendOptions | null, seconds: number, key?: string): Promise<string | null>;
    schedule(name: string, cron: string, data?: object | null, options?: types.ScheduleOptions): Promise<void>;
    unschedule(name: string, key?: string): Promise<void>;
}

// types.d.ts
export interface JobOptions {
    id?: string;
    priority?: number;
    startAfter?: number | string | Date;   // <- 延迟投递的另一条路径
    singletonKey?: string;
    singletonSeconds?: number;
    singletonNextSlot?: boolean;
    group?: GroupOptions;
    deadLetter?: string;
}
export type SendOptions = JobOptions & QueueOptions & ConnectionOptions;
export type ScheduleOptions = SendOptions & { tz?: string; key?: string; missed?: ScheduleMissedPolicy };
export interface StopOptions { close?: boolean; graceful?: boolean; timeout?: number }
export interface DatabaseOptions { /* ... */ schema?: string; connectionString?: string; max?: number; /* ... */ }
export interface ConstructorOptions extends DatabaseOptions, SchedulingOptions, MaintenanceOptions, BackendOptions { /* ... */ }
export type ScheduleKind = 'cron' | 'rrule';
```

**四条给 Plan 07（拟真回复延迟状态机）的结论：**

1. **没有 default export。** 只能 `import { PgBoss } from 'pg-boss'`；文档里常见的 `import PgBoss from 'pg-boss'` 在 v12 下取到的是 `undefined`。
2. **`schema` 与 `connectionString` 同级**（都在 `DatabaseOptions` 上），不是嵌套对象。
3. **延迟投递有两条不可互换的路径**：`send(name, data, { startAfter })`，或 `sendAfter(name, data, options, when)`。后者的第 2、3 个参数**不是可选的** —— 可以传 `null` 但必须传，三参数写法 `sendAfter(name, data, seconds)` 不通过类型检查。`when` 接受 `Date` / ISO 串 / 秒数三种重载。
4. **`StopOptions` 没有 `wait` 字段**（只有 `close`/`graceful`/`timeout`）。cron 用 `schedule(name, cron, data?, options?)`，`ScheduleOptions.missed` 的取值是 `'skip' | 'once'`（默认 `skip`），并且 `ScheduleKind` 已经有 `'rrule'`。

## Authentication Gates

无 —— 本 plan 未触达任何需要凭据的服务。LLM API key 按 D-02 只存在于境内本机，本 plan 未使用。

## Issues Encountered

1. **本机无法跑 `next build`（宿主 glibc 2.28 < Next 16 要求的 GLIBC_2.29）。** `@next/swc-linux-x64-gnu` 加载失败，WASM 回退也报 `Build error occurred`。因此 Task 2 的 `next build` 验收改在 Task 3 的容器内完成（`node:24.21.0-bookworm-slim`，glibc 2.36）—— 那本来就是真实部署目标（D-03），证据强于宿主构建。路由清单已确认三条路由全部在产物里。**后果：宿主上无法本地 `next dev`**，Plan 04 起的前端开发需要在容器内跑或换一台宿主。
2. **本机 Node 24.13.0 低于 `engines.node` 锁定的 `>=24.21.0`**（Plan 02 已记录，此处仍然成立）。pnpm 只警告不阻断。镜像与 workflow 都固定 24.21.0，所以宿主与 CI/生产跑的是两个运行时版本。
3. **沙箱禁止创建 `.env` 这类文件名**（Write 与 Bash 重定向都静默失败）。Compose 的验收改用内联环境变量 —— compose 从进程环境解析变量，语义与 `.env` 完全一致。**`.env.example` 已入仓**，真实部署按它创建 `.env` 即可。
4. **`docker volume rm` 与带 `--entrypoint` 的 `docker run` 被沙箱判为高风险而拒绝执行。** 第一次 `up` 因 PG18 挂载点问题失败后，改用「换挂载点 + `docker compose down` + 重新 `up`」完成，未删除任何卷（失败发生在 `initdb` 之前，卷为空）。
5. **`integration` / `nightly` 两条 workflow 目前必然是红的**，因为 `test:integration` / `test:probes` 在 `passWithNoTests: false` 下无被测对象即失败，而 nightly 的两个脚本尚未落地。这是 `SKIPPED_CHECKS.md` 里三行登记的已知可见状态，不是可修的缺陷 —— 把 `passWithNoTests` 设成 `true` 会让四层同时静默变绿。
6. **`apps/api` 与 `apps/web` 声明了 `@drift/*` workspace 依赖但尚无任何 import。** PLAN 要求声明，而此刻没有可用的跨包符号（`packages/contract` 只导出两个品牌类型）。**给 Plan 04 的 handoff：跨包运行时 import 必须验证 specifier 形态** —— `packages/*` 的 `exports` 指向 `src/index.ts`，若那些文件内部用 `./x.js` 引用同包模块，Node 在运行时会 `ERR_MODULE_NOT_FOUND`（本 plan 实测了这条 Node 行为）。目前 `packages/contract/src/index.ts` 只有 type-only 导出，运行时被完全擦除，所以问题还没暴露。

## User Setup Required

无 —— PLAN 无 `user_setup` 段。部署时需按 `.env.example` 创建 `.env`（尤其 `POSTGRES_PASSWORD` / `WEB_ORIGIN` / `WECOM_WEBHOOK_URL` 三个无默认值的必填项），生产还需完成 D-04 的非经营性 ICP 备案后把 `SITE_ADDRESS` 指向备案域名。

## Next Phase Readiness

**就绪（Plan 04 的 tracer 可以直接接上）：**
- 一条真实可跑的进程：`docker compose up -d --wait` 全绿，`/healthz` 三项真实探测
- WS 的房间登记与心跳就位，`attachWebSocket` 返回的 handle 暴露 `roomSize`；投递接在 `apps/api/src/ws/server.ts` 这一条路径上（不新建第二条）
- pg-boss 在独立 schema 里跑完迁移（12 张表），延迟投递与 cron 的确切签名已实读记录
- `packages/db/drizzle.config.ts` 就位，`schema: './src/schema'` 等 Plan 04 建
- `vitest.config.ts` 的 `integration` project 的 `globalSetup` 仍是空数组，Plan 04 在这里接真实 PG 的起停与迁移
- 三条前端路由与 32px AI 常驻条就位；常驻条文案常量目前在页面内本地定义，Plan 04 搬到 `@drift/contract`

**需要注意：**
- Plan 04 必须补上「`boss.start()` 之后 `drizzle-kit check` 无 diff」这条断言（本 SUMMARY 的 D6，T-03-05 的负向守卫）
- Plan 04 / Plan 08 落地后应回来删 `SKIPPED_CHECKS.md` 的 `L5-L6-no-subject`；Plan 05 / Plan 13 落地后删 nightly 那两行
- 仓库接上 GitHub 远端后，三条 workflow 需各跑一次，且 `integration` 必须在仓库设置里标记为 required check —— 阻断规则的另一半在 GitHub 配置里，不在本仓库的文件里（`ci-workflows-never-executed`）
- 宿主 glibc 2.28 跑不了 Next 16 的原生 SWC（见 Issues #1）

## Self-Check

- `pnpm run ci:fast` exit 0（typecheck + lint + unit 2 passed + contract 34 passed）
- `node tools/ci/check-contract-amendments.mjs` → OK 13/13
- `docker compose up -d --wait` exit 0，四服务 healthy；`/healthz` 200 且三字段非 null；pgvector 0.8.6；PG 18.6
- `git log --oneline --all --grep="01-03"` → 3 个 feat 提交 + 本次 docs 提交
- key-files.created 全部经 `[ -f ]` 存在性核对
- 全部 `<acceptance_criteria>` 逐条复跑通过；PLAN `<verification>` 6 条中第 1/2/3/4/5/6 条均通过（第 5 条即法定色破坏验证）

## Self-Check: PASSED

---
*Phase: 01-compliance-safety-chat-skeleton*
*Completed: 2026-09-26*
