# Walking Skeleton — Drift

**Phase:** 1
**Generated:** 2026-09-26
**Mode:** mvp · TRACER_MODE · WALKING_SKELETON
**Source of truth for this document:** `01-RESEARCH.md` §2（工程地基）与 §2.4（Tracer slice）、`01-CONTEXT.md` D-01..D-28

---

## Capability Proven End-to-End

> 一个持邀请码的新用户能完成注册（同一事务写入 5 条同意）、在角色库里挑一个预设角色加为好友、发出一条消息，并在带「AI」徽标与 32px 常驻条的类微信界面里收到一条**经过出站安全网关、先落库取 seq 再经 WebSocket 投递**的角色回复 —— 全栈跑在一条 `docker compose up` 起得来的单机编排上。

这一刀故意**不**覆盖：危机干预、导出/删除、两个计时器、三条 tripwire、法务文本。它们在 Plan 04–12 里逐层加厚，但**都必须接在这条链路上**，不得新建第二条投递路径（`01-RESEARCH.md` §2.4）。

---

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Monorepo | 单 pnpm workspace（pnpm 12.6.0，`packageManager` 字段锁定） | PLAT-01 明确只有两个部署单元；ARCHITECTURE §9 的 `services/*` 是模块边界不是部署单元 |
| 部署单元 | `apps/api`（hono 4.13.9 + ws 8.21.3 + pg-boss 12.34.0，单进程三入口）与 `apps/web`（next 16.3.6，仅 UI） | PLAT-01 |
| 语言与编译 | TypeScript 7.0.2，`tsc --noEmit` 作为 L1 验证层 | `GatedText` / `SyntheticText` / `CallMode` 的不可表达性全部由编译期承担（RESEARCH §3.1/§5.1/§5.5） |
| 数据层 | PostgreSQL 18.6（镜像 `pgvector/pgvector:pg18`）+ pgvector 0.8.6 + pg-boss 12.34 同库；drizzle-orm 0.45.3 + postgres 3.4.9 | PLAT-02；pg-boss 自建表与自跑迁移，drizzle 配置必须排除 `pgboss` schema（RESEARCH §2.2） |
| 迁移 | drizzle-kit 生成 SQL 迁移进 git；`drizzle-kit push` 只在开发库使用且是 `[BLOCKING]` 任务 | 类型来自配置而非活库，不 push 会造成假阳性验证 |
| 认证 | better-auth 1.7.6 邮箱密码 + **邀请码前置**；同意项**不**放进 `user.additionalFields`，另建 `consent` / `consent_event` 表 | D-22 / D-23；RESEARCH §6.1（`databaseHooks.user.create.after` 未必同事务，会产出「账号在、同意缺」的残缺账号） |
| LLM 访问 | 全部经 `packages/llm` 的 Model Router；`mock` 是路由表里的一个 provider，也必须写 `llm_call` 行 | PLAT-03 / D-27；RESEARCH §5.3 —— 「mock 也必须经 Router」本身就是对 PLAT-03 的一次验证 |
| 回复形态 | **整段生成** → 出站安全网关 → 落库取 seq → WS 投递；等待期前端显示 typing | D-24；typing 时长天然等于生成时长，REAL-03 在 Phase 1 自动满足，Phase 2 只叠加延迟与分条、不重写链路 |
| 出站边界 | branded type `GatedText`，`packages/safety` 是全仓唯一产出点，三个出口签名只接受它；第四个出口（IM 告警）登记为 `carriesUserText:false` | D-15 + RESEARCH §3.1/§3.4 |
| 传输 | 单条 WebSocket + 自定义 JSON envelope（zod 4.6.5 定义在 `packages/contract`）；DB 是真相源，重连按 `after_seq` 补拉 | STACK §4；CHAT-07；明确不用 socket.io |
| 目录布局 | `apps/{api,web}` + `packages/{contract,db,llm,safety,prompts}` + `compliance/` + `db/publication/` + `tools/ci/` | RESEARCH §2.1；四条包边界见下 |
| 部署目标 | 一台境内云主机跑 Docker Compose 单机全栈（postgres / api / web / caddy），非经营性 ICP 备案 | D-03 / D-04 |
| CI | GitHub 私有仓 + Actions，runner 自建在境内云主机；两条 workflow：`fast`（托管 runner 亦可）/ `integration`（self-hosted） | D-01 / D-02；RESEARCH §2.5 |
| 可观测性 | pino 结构化日志（**设计上不含个人信息**）+ `llm_call` 落库表 + `/telemetry/error` 自建上报端点 | D-05 / D-28；明确否决 Langfuse Cloud 与 Sentry（均为隐蔽出境路径） |

### 四条不可协商的包边界（RESEARCH §2.1，对应 ARCHITECTURE §14 Internal Boundaries）

1. `packages/llm` 是 `@ai-sdk/*` / `openai` / `@anthropic-ai/sdk` 的**唯一**导入者（静态 import 与动态 `import()` 都禁）
2. `packages/safety` 是 `GatedText` 的**唯一**产出者
3. `apps/api/src/transport` 是 `ws` 的**唯一**导入者 —— 否则一个新的 `new WebSocketServer` 就能绕过「WS 下发只接受 GatedText」
4. `packages/db` 是 `DATA_INVENTORY` / `STORAGE_LOCATIONS` 的**唯一**定义处

---

## Stack Touched in Phase 1

- [ ] Project scaffold —— pnpm workspace / TypeScript 7.0.2 / ESLint flat config（type-aware）/ vitest / drizzle-kit（Plan 02）
- [ ] Routing —— `apps/api` 的 hono REST 路由 + `/ws` 升级入口；`apps/web` 的 Next App Router 三条真实路由（角色库 / 会话列表 / 聊天页）（Plan 02 + 03）
- [ ] Database —— 真实写（`message` 落库取 `seq`、`consent` ×5、`llm_call`）与真实读（角色库列表、`after_seq` 补拉）（Plan 03）
- [ ] UI —— 聊天页输入框发送一条消息、收到回复并渲染带「AI」徽标的角色气泡（Plan 03）
- [ ] Deployment —— `docker compose up -d` 在单机把 postgres + api + web 起起来，`/healthz` 返回 200（Plan 02）

---

## Out of Scope (Deferred to Later Slices)

> 明确列出，防止后续阶段重新讨论 Phase 1 的最小性。

- 流式增量下发（与 CHAT-07 和出站网关结构上不相容，D-24 已否决；Phase 2 也不改链路，只叠加延迟与分条）
- 拟真包装：语义分条、重尾延迟、错字自更正、已读不回、作息差异 —— 全部 Phase 2（REAL-01..07）
- 记忆与遗忘（Phase 3）、人格演化管道（Phase 4–5）—— Phase 1 只建 `persona_version` 表并填一版，不建管道
- Langfuse / Redis / ClickHouse / MinIO 等有状态组件（D-05 推到 Phase 2）
- 会话内人工接管后台（D-09 已裁决**不做**，降级为会话外联系）
- 境内短信 / 语音外呼自动联络通道（D-10，Phase 10）
- L2 人工阅读授权同意项（Phase 7）、`info_item` / `disclosure_capability` / `character_relationship` / `memory.source_kind`（各自阶段）
- CHAT-08 自建角色（Phase 4）—— Phase 1 只把 COMPLY-08 的审核规则写成纯函数并作用于 3 个种子角色
- 深色模式、平板断点、虚拟滚动（UI-SPEC 明文 v1 不做）

---

## Subsequent Slice Plan

每个后续阶段在此骨架之上加一条垂直切片，**不改动**上表的架构决定：

- **Phase 2** 拟真对话基线 —— 在 `chat.reply` 与 WS 投递之间叠加延迟函数与语义分条；接 Langfuse 自托管；建盲测基线与双臂探针
- **Phase 3** 记忆与遗忘 —— 在 `packages/db` 新增 `memory_embeddings_v1`（pgvector 列此时才真正使用）；检索链路接在 `chat.reply` 之前
- **Phase 4** 人格内核与静态画像 —— 填满 `persona_version` 三元组的解析纯函数与画像 UI；接 CHAT-08 自建角色（复用 Phase 1 的 COMPLY-08 审核纯函数）
- **Phase 5** 演化引擎 + 五层护栏 + 疏远机制 —— 夜间反思作业接 `packages/safety` 的**同一个**出站网关；重跑 Phase 1 的 `tests/probes/crisis/*.yaml`（SAFE-15）
