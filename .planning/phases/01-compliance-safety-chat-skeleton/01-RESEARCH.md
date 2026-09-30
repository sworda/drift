# Phase 1 Research: 合规安全地基 + 会话骨架

**Researched:** 2026-09-26
**Phase:** 1 of 5 · **Mode:** mvp · **Walking skeleton + Tracer** · **Granularity:** standard
**Requirements:** 44 条（COMPLY-01..11 / SAFE-01..05,14 / PRIV-01..10 / CHAT-01..07 / PLAT-01..03,05..08 / IFC-08 / RES-02,03）
**Repo state:** greenfield —— 仅 `.planning/` `.claude/` `.git`，零业务代码、零 node_modules、无 git remote

---

## 0. 给 planner 的 14 条硬结论（先读这段）

1. **第一个 plan 不是写代码，是执行 CONTEXT 的三处 Required Amendments**（A-01 UI-SPEC 危机文案 / A-02 新增 PRIV-11 / A-03 同意项 4→5）。UI-SPEC 自定规则：改〔法定〕条目必须先改 REQUIREMENTS.md。不先改，后面所有验收断言都会绑到过时的契约上。
2. **本阶段 5 条成功标准里有 3 条是"对尚不存在的东西的防线"**（RES-03 向量列扫描、PLAT-06 字符串 model、PRIV-06 禁用词）。这类断言**默认是空真的**——它在没有被测对象时也通过。**因此本阶段最重要的单条验证原则是：每一条空真断言必须随附一个"负向 fixture"，证明它在被违反时真的会失败。**没有负向 fixture 的 tripwire 等于没有 tripwire，而且比没有更糟（它提供虚假的安全感）。这一条贯穿 §11 与 Validation Architecture。
3. **D-15 的 branded type 写法有一个编译期风险必须先验证**：`type GatedText = string & { readonly __gated: unique symbol }` 中 `unique symbol` 出现在类型字面量成员位置，TypeScript 只允许 `unique symbol` 出现在 `const` 声明与 `readonly static` 属性上（否则 TS1335）。**安全形态见 §3.1**（`declare const` + 计算属性键）。这不是风格问题——写错则整个"不可绕过"退化为普通 string 别名，且**不会有任何报错**。
4. **branded type 的真实漏洞不是 `as` 断言，是 `any`**。接受 `GatedText` 的函数会无声地接受 `any`。必须开 type-aware 的 `@typescript-eslint/no-unsafe-argument`，否则一个 `JSON.parse()` 的返回值就能穿过全部三个出口（§3.3）。
5. **PLAT-06 的 ESLint 规则有一个已在真实项目中被记录的静默失效**：ESLint flat config 对同一规则的 options 是**替换而非合并**——任何为子目录再设一次 `no-restricted-syntax` 的配置块都会**静默丢掉**仓库级的 model 字面量禁令。检查手段是用 `ESLint#calculateConfigForFile()` 写一条元测试（§5.4）。
6. **`no-restricted-imports` 看不见动态 `import()`**（它是 ImportExpression，不是 ImportDeclaration）。"provider SDK 只能在 packages/llm 内导入"这条边界因此有一个默认敞开的后门，必须用 `no-restricted-syntax` 上的 `ImportExpression` 选择器补掉（§5.4）。
7. **"危机判定发生在人格渲染之后、由不同模型执行"可以做成一条 SQL 断言，不需要新的埋点**：两次调用都必经 Model Router 并落 `llm_call`，于是"同一 turn 内 `chat.reply` 行的 `created_at` 早于 `safety.classify` 行"与"两行的 `model_snapshot` 不相等"就是成功标准 2 的机器断言（§4.1/§4.2）。这是本阶段"把架构约束变成可查询事实"的最佳单例。
8. **PRIV-03 的"说明与实际存储字段一致"应该靠一份注册表而不是靠人**：`DATA_INVENTORY`（表 × 列 → 用途 / 同意项 / 保存期 / 是否个人信息 / 研究分层）是**单一真相源**，被三个消费者共用——隐私中心 UI、删除 worker 的 `STORAGE_LOCATIONS`、保存期清理 cron。三份清单各写一遍必然漂移（§6.4/§7.1）。
9. **Phase 1 有一个需求内部的真实冲突需要 planner 裁决**：A-03 收 5 个同意项，但其中 L0 / L1 / 人格演化三项在 Phase 1 **没有任何对应数据流**；而 PRIV-03 要求"我们收集了什么"与实际存储字段一致。结论：**同意清单与"我们收集了什么"清单是两份不同的清单**，PRIV-03 只约束后者；必须给授权渲染出第三态「已授权 · 尚未开始收集」，并用 CI 断言这个态（§6.5）。
10. **删除回执的数字必须来自"成功执行的清除项数"，且注册表必须双向核对**：只用 drizzle schema 对账会漏掉裸 SQL 迁移建的表（pg-boss 自己的表、publication DDL）；只用 `information_schema` 会漏掉导出文件、日志、队列载荷。两条都要（§7.2）。
11. **D-12 的硬退出词表按子串匹配会误杀**：「不想聊」是词表项，而「我不想聊这个话题」包含它——按子串实现会在用户想换话题时硬退出整个会话。必须用**归一化后的整句锚定匹配 + 长度上限**，并配 ≥20 条含阴性样本的测试集（§9.1）。
12. **2 小时计时不要做成 tick，做成"DB 为真相 + pg-boss 定时推一把"**：每条入站消息在同一事务内更新 `usage_segment`（15 分钟静默即分段清零、跨角色合并），同时用 `boss.send(..., { startAfter, singletonKey })` 排一个到点提醒，使"用户只读不发"也能被提醒。跨刷新与重登录由"状态在 DB"天然成立（§9.3）。
13. **acute 事件的 IM 告警是一条新的出站出口，也是一条新的个人信息流向**（这正是 A-02 要新增 PRIV-11 的原因）。它必须进 egress 注册表，且告警载荷的类型里**不能有对话文本字段**，并配一条"告警 JSON 不含触发消息任何子串"的断言（§3.4）。
14. **tracer slice 的推荐切法见 §2.4**：邀请码 → 注册（写 5 条 consent）→ 角色库（1 次真实 DB 读）→ 加好友 → 发 1 条消息 → mock provider 回复 → 出站网关 → 落库取 seq + 注入 disclosure → WS 投递 → 带 AI 徽标渲染 → Docker Compose 起得来。它一次打穿 PLAT-01/02/03、CHAT-01/02/03/07、COMPLY-01/09 与 D-15/D-24，是后续每个 plan 的加厚底座。

---

## 1. 前置修订与需求覆盖

### 1.1 三处 Required Amendments（第一个 plan 的内容）

| ID | 改什么 | 文件 | 为什么必须先改 |
|---|---|---|---|
| A-01 | 二级危机卡片「极端情况下会有真人介入这段对话」→ 语义等价于「我们已经收到通知，会尽快直接联系你」 | `01-UI-SPEC.md` ## 危机干预呈现契约 | D-09 已裁决不做会话内接管。留着原文案不实现＝虚假陈述，与写「匿名」同性质 |
| A-02 | 新增 `PRIV-11`：隐私中心须列明「触发二级危机时系统会将该事件通知运营者（不含对话内容）」 | `REQUIREMENTS.md` + `01-UI-SPEC.md` | 无 REQ-ID 则这条文案无人负责、不进验收；且它是 PRIV-03 要求披露的一条真实数据流 |
| A-03 | PRIV-01 同意项 4 → 5（加「敏感个人信息处理」为必选） | `REQUIREMENTS.md` PRIV-01 正文 + `01-UI-SPEC.md` ## 本阶段覆盖的用户可见面 第 1 行 + ## 交互契约 | 冲突证据在 `PITFALLS-COMPLIANCE.md:174`（清单含「敏感个人信息处理」）vs `REQUIREMENTS.md` PRIV-01（不含）。差的那项是个保法第二十九条的单独同意，且 Phase 1 第一条消息落库时即发生。事后补收＝事后追认，历史数据无法合法化 |

**额外建议（planner 裁决）**：CONTEXT `<requirement_gaps>` 指出 acute 告警链路（D-09/D-10/D-11）无 REQ-ID。建议新增 `SAFE-16`「acute 事件在 N 秒内投递到运营者告警通道，投递结果驱动 `contact_attempt` 状态机，告警载荷不含对话内容」。理由同 A-02：没有 REQ-ID 的能力不会被验收，而这条能力承载 SAFE-04 的「及时联络」。

### 1.2 44 条需求 → 实现载体 → 验证层（planner 用来切 plan 的地图）

| REQ | 实现载体 | 验证层（见 Validation Architecture） |
|---|---|---|
| COMPLY-01 | `conversation.counterpart_kind` + 三处常量徽标/常驻条 | L5 组件断言 × 3 面 + L4 surface 注册表 |
| COMPLY-02 | 导出管道 header 3 行 + 每条角色消息 `[AI]` 前缀（.md/.json 双格式） | L5 导出物解析断言 |
| COMPLY-03 | `usage_segment` 服务端计时 + pg-boss 到点提醒 | L5（跨刷新/重登录/14min vs 16min 间隔） |
| COMPLY-04 | `dependency_signal` 三阈值 + 日扫 cron + 72h 去重 | L3 阈值纯函数 + L5 触发一次 |
| COMPLY-05 | 两档退出过滤器 + `conversation.status='ended'` 在网关 fail-closed | L3 词表 ≥20 + L5 零出站 + L6 挽留率=0 |
| COMPLY-06 | 注册表单年龄 + 监护人/紧急联系人（应用层加密 + 遮蔽） | L5 注册事务断言 |
| COMPLY-07 | 自填生日即信 + 18 岁门禁（终态拒绝文案，无「下一步」） | L3 + L5 |
| COMPLY-08 | 预设角色审核（Phase 1 无自建角色，规则先落但仅作用于种子数据） | L4 种子数据断言 |
| COMPLY-09 | `message.disclosure` 由落库中间件单写 + DB CHECK 约束 | **L4 DB 约束**（最强）+ L5 |
| COMPLY-10 | `compliance/publicness.json` + hash 双写 + CHECKLIST + 日对账 | L4 CI 断言 + L5 对账作业 |
| COMPLY-11 | `compliance/no-unlabeled-output.md` 登记空集 + egress 注册表哈希绑定 | L4 |
| SAFE-01 | 安全覆写在人格渲染之后、确定性执行、不进人格提示词 | **L4 SQL 序断言** + L5 |
| SAFE-02 | `safety.classify` 与 `chat.reply` 路由到不同 model；启动期断言 | L4 启动断言 + L4 SQL 断言 |
| SAFE-03 | 一级卡片：安抚 + 求助渠道，**无任何联络语义** | L5 断言无 `contact_attempt` 行 + L6 探针 |
| SAFE-04 | 二级卡片 + 援助清单 + `contact_attempt` 四态 + IM 告警 | L5 四态全分支 + L6 探针 |
| SAFE-05 | 三档 risk + fail-closed→elevated | L3 映射纯函数 + L5 故障注入 |
| SAFE-14 | 情感边界引导文案 + 依赖提醒 | L5 |
| PRIV-01 | 5 个独立 consent + 无全选控件 | L5 注册断言 + L4「源码中无全选控件」 |
| PRIV-02 | 逐项撤回 → 数据流立即停（consent ticket 守卫） | L5 撤回后写入被拒 |
| PRIV-03 | `DATA_INVENTORY` 单一真相源渲染 | **L4 schema↔注册表集合相等** |
| PRIV-04 | 导出 worker（.md/.json + 7 天 TTL） | L5 |
| PRIV-05 | `STORAGE_LOCATIONS` 遍历 + 回执数量派生 | L4 注册表对账 + L5 删后导出为空 |
| PRIV-06 | 禁用词 grep **+ 正向存在性断言** | L4（含负向 fixture） |
| PRIV-07 | 人格派生物披露文案 | L4 存在性 |
| PRIV-08 | `DATA_INVENTORY.retention` + 清理 cron | L4 每条有期限 + L5 到期清理 |
| PRIV-09 | `compliance/PIA-2026.md` | L4 文件存在 + 章节齐 |
| PRIV-10 | `compliance/dpa/{provider}.md` + 路由表 provider 全覆盖 | **L4 路由表↔文件集合断言** |
| PRIV-11(新) | 隐私中心「危机事件通知运营者」披露 | L4 存在性 + L5 |
| CHAT-01..06 | 角色库 / 加好友 / 类微信聊天 / 表情 / 会话列表未读 / 离线未读 | L5 + L7 人工试玩 |
| CHAT-07 | 先落库取 seq 再投递 + `after_seq` 补拉 | L5 断连补拉不丢不重 |
| PLAT-01 | pnpm workspace + apps/web + apps/api | L1/L4 |
| PLAT-02 | 单 PG 18.6 + pgvector 0.8.6 + pg-boss 同库 | L5 |
| PLAT-03 | Model Router 必经 + pinnability 显式表 + `llm_call` 落库 | L2 import 边界 + L4 字段齐全 |
| PLAT-05 | 5 个语义角色独立配置 | L4 配置断言 |
| PLAT-06 | ESLint 禁字符串 model **+ config 合并元测试** | L2 + L4 元测试 + 负向 fixture |
| PLAT-07 | 境外通道只接受 synthetic（类型层表达） | L1 + L4 |
| PLAT-08 | prompts 在 git + `prompt_version` = 内容哈希 | L4 |
| IFC-08 | `message.provenance` / `message.audience` / 事件 topic 命名空间共用定义 | L4 列存在 + L1 类型 |
| RES-02 | `DATA_INVENTORY.layer` + 「layer=l0 不得有向量列」断言 | L4 + **负向 fixture** |
| RES-03 | publication DDL 静态扫描（列清单必须显式、不得含 vector/halfvec） | L4 + **负向 fixture** |

---

## 2. 工程地基：walking skeleton 的第一刀

### 2.1 目录结构（PLAT-01 + ARCHITECTURE §9 的裁剪）

ARCHITECTURE §9 的 `services/*` 是**与栈无关的模块边界**，不是 Phase 1 就要 11 个部署单元。PLAT-01 明确只有两个部署单元。建议：

    drift/
    ├── apps/
    │   ├── api/                  # hono + ws + pg-boss worker（单进程，三个入口）
    │   │   └── src/{http,ws,worker,modules/*}
    │   └── web/                  # next 16，仅 UI
    ├── packages/
    │   ├── contract/             # zod schema + WS envelope + 事件 topic + brand 类型
    │   ├── db/                   # drizzle schema + 迁移 + DATA_INVENTORY + STORAGE_LOCATIONS
    │   ├── llm/                  # ★ Model Router；唯一允许 import @ai-sdk/* 的包
    │   ├── safety/               # ★ 出站安全网关；唯一能产出 GatedText 的包
    │   └── prompts/              # 提示词 + 内容哈希版本（PLAT-08）
    ├── compliance/               # publicness.json / CHECKLIST-*.md / PIA-2026.md / dpa/*.md / no-unlabeled-output.md
    ├── db/publication/           # research publication DDL（RES-03 的静态被测对象）
    └── tools/ci/                 # 各条 tripwire 的检查脚本 + 负向 fixture

**四条不可协商的包边界**（对应 ARCHITECTURE §14 Internal Boundaries）：
- `packages/llm` 是 `@ai-sdk/*` / `openai` / `@anthropic-ai/sdk` 的唯一导入者
- `packages/safety` 是 `GatedText` 的唯一产出者
- `packages/transport`（可并入 apps/api）是 `ws` 的唯一导入者——否则"WS 下发只接受 GatedText"这条约束可以被一个新的 `new WebSocketServer` 绕过
- `packages/db` 是 `DATA_INVENTORY` / `STORAGE_LOCATIONS` 的唯一定义处

### 2.2 版本锁定与三个已核实的兼容性坑

来自 STACK.md §1/§11/§13（核实于 2026-09-25）。planner 应把这张表照抄进第一个 plan 的验收：

Node 24.21.0 LTS / pnpm 12.6.0（`packageManager` 字段锁定）/ TypeScript 7.0.2 / PostgreSQL 18.6（镜像 `pgvector/pgvector:pg18`）/ pgvector 0.8.6（**必须 ≥0.8.2，CVE-2026-3172**）/ drizzle-orm 0.45.3 + postgres 3.4.9 / hono 4.13.9 / ws 8.21.3 / pg-boss 12.34.0 / better-auth 1.7.6 / ai 7.0.114 / next 16.3.6 / react 19.3.0 / tailwind 4.3.3 / zod 4.6.5 / pino / shadcn CLI 4.21.0。

| 坑 | 后果 | 检查 |
|---|---|---|
| **AI SDK 7 的 provider 包主版本号与 core 不同步**（core 7.x ↔ provider 4.x：`@ai-sdk/openai@4.0.75` / `@ai-sdk/anthropic@4.0.63` / `@ai-sdk/deepseek@3.0.52` / `@ai-sdk/react@4.0.117`） | 按 core 版本推测 provider 版本 → 装不上或装到错版本 | `pnpm ls --depth 0` 断言精确版本；lockfile 进 CI |
| **pg-boss 自己建表并跑自己的迁移**，必须与 drizzle 迁移分开管理（独立 schema） | drizzle `push` 或 `generate` 把 pg-boss 表当成"漂移"要删 | drizzle 配置排除 pg-boss schema；集成测试断言 `boss.start()` 后 drizzle `check` 无 diff |
| **shadcn 不得用 `--template next` / `--no-monorepo` 由 pnpm workspace 承担** | 绕过 STACK §13 的锁定版本与 PLAT-01 结构 | UI-SPEC ## Design System 已锁两步顺序；CI 断言 `apps/web/package.json` 的 next/react/tailwind 为精确版本 |

### 2.3 部署形态（D-03/D-04）

一台境内云主机跑 Docker Compose 全栈：`postgres`（pgvector/pgvector:pg18，持久卷）+ `api` + `web` + `caddy` 或 nginx（TLS）。非经营性 ICP 备案（个人主体，一个域名）——境内云厂商对未备案域名封 80/443，而正常 HTTPS 是 M2 的 Service Worker / Web Push 前提。

**Phase 1 明确不引入的有状态组件**：Redis / ClickHouse / MinIO / Langfuse（D-05 裁决推到 Phase 2）。可观测性底座 = pino 结构化日志 + `llm_call` 落库表 + `client_error` 自建上报端点（D-28）。

⚠️ **pino 的隐蔽泄漏点**：`PITFALLS.md` §8.2 第 4 条把"应用日志与 APM 记录消息体"列为最常见的实际泄漏点。日志文件是一个**不能按行删除的存储位置**，因此唯一可行的姿态是让它**从设计上不含个人信息**，并在 `DATA_INVENTORY` 里以 `containsPersonalInfo: false` + 理由登记。配套断言：跑一个完整 turn，抓取 pino 输出，断言其中不含消息正文的任何 ≥6 字子串（§7.1）。

### 2.4 Tracer slice（TRACER_MODE 的那一刀）

**目标：一次打穿全链路，且每一段都是生产质量（不是 stub）。**

    邀请码校验 → better-auth 邮箱密码注册（同一事务写 5 条 consent + 年龄 + 紧急联系人）
      → 角色库列表（真实 DB 读，3 个种子角色）→ 加好友（建 conversation，counterpart_kind='ai_character'）
      → 发 1 条用户消息（落库取 seq）
      → Model Router（mock provider，但走完整路由表 + 落 llm_call）
      → safety.classify（mock，返回 none）
      → safetyGateway() 产出 GatedText
      → 落库（取 seq + 注入 message.disclosure，受 DB CHECK 约束保护）
      → WS 下发（签名只接受 GatedText）
      → apps/web 渲染：常驻条 + 徽标 + 气泡（BubbleContent 覆写 text-base）
      → docker compose up 在云主机上起得来

**这一刀覆盖的需求**：PLAT-01/02/03、CHAT-01/02/03/07、COMPLY-01/09、PRIV-01（数据层）、D-15、D-24。
**这一刀故意不覆盖**：危机干预、导出/删除、计时器、三条 tripwire、法务文本——它们在后续 plan 里逐层加厚，但**都必须接在这条链路上**，不新建第二条投递路径。

### 2.5 CI 拓扑（D-01/D-02）

GitHub 私有仓 + GitHub Actions，runner 自建在境内云主机（`runs-on: self-hosted`）。三重收益：危机探针集能用真实 LLM 在每个 PR 上跑；LLM key 只存在境内本机不进 GitHub Secrets；集成测试可访问真实 PostgreSQL。

建议两条 workflow：

| Job | 触发 | 内容 | 时长预算 |
|---|---|---|---|
| `fast`（GitHub 托管 runner 也能跑） | 每 PR | L1 tsc / L2 eslint（**含 config 元测试、不带 cache**）/ L3 单元 / L4 全部注册表与文件类断言 + 负向 fixture | < 3 min |
| `integration`（self-hosted） | 每 PR | L5 真实 PG 集成 + mock provider；L6 危机探针集（真实 `safety.classify` = glm-4.7-flash，**免费**） | < 10 min |

`fast` 必须能在托管 runner 上跑（不依赖境内资源），这样 self-hosted 掉线时仍有防线；`integration` 掉线时 **PR 必须阻断而不是跳过**——"探针跑不了就先合"是成功标准 2 的直接反例。

---

## 3. 出站安全网关：不可绕过的执行拓扑

### 3.1 `GatedText` 的确切形状（修正 D-15 的写法）

D-15 的字面写法有 TS1335 风险。**安全形态**：

    // packages/contract/src/brand.ts
    declare const GATED: unique symbol;            // unique symbol 只允许在 const 声明上
    export type GatedText = string & { readonly [GATED]: true };

    // packages/safety/src/gateway.ts —— 全仓库唯一的产出点
    export async function safetyGateway(input: GatewayInput): Promise<GatedResult> { /* ... */ }
    // 内部（且仅此一处）做一次断言把 string 提升为 GatedText

**三个出口的签名只接受 `GatedText`**（D-15）：

    // apps/api/src/transport/ws.ts
    export function deliver(conn: Conn, text: GatedText, seq: number): void
    // packages/db/src/message.ts
    export function insertCharacterMessage(tx: Tx, m: { text: GatedText; disclosure: Disclosure; ... })
    // apps/api/src/modules/export/render.ts
    export function renderExportLine(text: GatedText, ...): string

新增第四个出口时，如果它接受 `string`，类型系统不会报错——**这是本方案唯一的结构性缺口**，靠 §3.4 的 egress 注册表堵。

**第一条必须写的测试是编译期测试**：一个 `tools/ci/type-fixtures/` 下的负向 fixture（试图把裸 string 传给 `deliver`、试图 `as GatedText`），用 `tsc --noEmit` 跑它并断言**退出码非 0 且错误码包含预期项**。没有这条，`unique symbol` 写错、`GatedText` 退化成 `string` 这件事不会被任何人发现。

### 3.2 为什么"整段生成"是这个类型方案的前提（D-24）

流式增量下发与 branded type 单一出口**在结构上不相容**：
- chunk 没有 seq → 违反 CHAT-07（重连补拉拿不到半条消息）
- 逐 token 流出 → 每个 chunk 都得过网关，而危机判定需要看完整候选回复；对半句做判定要么漏判要么把正常回复拦成危机
- 成功标准 2 要求"证明不存在任何生成路径可绕过出站安全网关"——流式会引入一条"chunk 直连 WS"的路径，而它在类型层几乎不可能表达为 `GatedText`

**Phase 2 不需要重写投递链路**：D-24 的关键收益是"整段生成时 typing 持续时间天然等于实际生成时间"，REAL-03 的核心约束在 Phase 1 即自动满足，Phase 2 只在其上叠加延迟函数与语义分条。

### 3.3 类型之外的两层：ESLint 与 `any`

**已核实可用的选择器**（grep.app 上有真实项目用同一形态给 branded path 类型设禁令）：

    // eslint.config.js —— 仓库级块
    'no-restricted-syntax': ['error',
      { // 禁止 as GatedText / as unknown as GatedText（packages/safety/src/gateway.ts 例外）
        selector: "TSAsExpression[typeAnnotation.type='TSTypeReference'][typeAnnotation.typeName.name=/^GatedText$/]",
        message: 'GatedText 只能由 safetyGateway() 产出。不要断言。' },
      { // 尖括号形式同样要禁
        selector: "TSTypeAssertion[typeAnnotation.type='TSTypeReference'][typeAnnotation.typeName.name=/^GatedText$/]",
        message: '同上。' },
    ]

**但真正的漏洞是 `any`**：branded type 在运行时被擦除，而 `deliver(conn, anyValue, seq)` 在默认配置下**不报错**。一个 `JSON.parse(body)`、一个 `catch (e)`、一个未标注返回类型的第三方回调，都能把任意 string 送进出口。

必须开（type-aware，需要 `projectService` / `parserOptions.project`）：
`@typescript-eslint/no-unsafe-argument`、`no-unsafe-assignment`、`no-unsafe-return`、`no-explicit-any`。

代价：type-aware lint 慢。对 10 人体量的仓库可接受，且这是三条防线里**唯一能堵住 `any` 通道的那一条**——不能为了 CI 快 30 秒把它关掉。

### 3.4 Egress 注册表：堵住"新增出口"这个唯一缺口

    // packages/safety/src/egress.ts
    export const EGRESS_POINTS = [
      { id: 'ws.deliver',           module: 'apps/api/src/transport/ws.ts',            fn: 'deliver' },
      { id: 'db.insertCharacterMessage', module: 'packages/db/src/message.ts',         fn: 'insertCharacterMessage' },
      { id: 'export.renderLine',    module: 'apps/api/src/modules/export/render.ts',   fn: 'renderExportLine' },
      { id: 'alert.acuteWebhook',   module: 'apps/api/src/modules/safety/alert.ts',    fn: 'notifyOperator',
        carriesUserText: false },   // ← D-09 的 IM 告警：是出口，但不得携带对话文本
    ] as const;

三条绑定断言（L4）：
1. **集合相等**：用 ts-morph 或 `tsc` AST 扫全仓库，取出所有"参数类型含 `GatedText`"的导出函数，断言其集合等于 `EGRESS_POINTS` 中 `carriesUserText !== false` 的项。新增一个接受 `GatedText` 的函数而不登记 → 失败；把一个出口改成接受 `string` → 集合缺项 → 失败。
2. **COMPLY-11 绑定**（D-21）：`compliance/no-unlabeled-output.md` 的 front-matter 存 `egress_hash` = `EGRESS_POINTS` 规范化后的 sha256。出口集变化 → 哈希不符 → CI 要求复核该登记并更新哈希。这把"出口变了就要重新确认无未标识输出"做成机械动作。
3. **告警载荷不含对话文本**：`AcuteAlert` 类型只有 `{ userId, conversationId, riskLevel, occurredAt, safetyEventId }`；配一条运行时断言测试——用一条含特征串的触发消息走完整 acute 流程，断言 `JSON.stringify(alertPayload)` 不含该特征串。

### 3.5 失效模式与检查（汇总）

| 失效模式 | 为什么静默 | 检查 |
|---|---|---|
| `unique symbol` 写在类型成员位置被改成 `string` 品牌或直接删掉 | 编译通过，全部出口退化为接受任意 string | `tsc` 负向 fixture（L1） |
| `any` 穿透 | 无任何报错 | `no-unsafe-argument`（L2）+ 负向 fixture |
| 新增第四个出口接受 `string` | 类型系统不会主动报错 | egress 注册表集合相等断言（L4） |
| 有人给子目录再设一次 `no-restricted-syntax`，`as GatedText` 禁令消失 | flat config 替换而非合并 options | `calculateConfigForFile()` 元测试（§5.4） |
| 硬退出后仍有延迟任务出站 | 任务已在队列里，网关没被问到会话状态 | 网关 fail-closed 读 `conversation.status` + L5 集成测试（§9.2） |
| IM 告警带上了对话片段 | 没人会去读告警 JSON | 子串断言（上）|

---

## 4. 两级危机干预

### 4.1 执行顺序：如何把"在人格渲染之后"变成可查询的事实

成功标准 2 要求证明"危机判定发生在人格渲染之后、由与扮演角色不同的模型执行"。

R1.20 要求**双层检测**（入站高召回规则/正则 + 独立分类模型），而成功标准要求判定在人格渲染之后。两者不冲突，分工如下：

| 环节 | 时机 | 作用 | 是否决定性 |
|---|---|---|---|
| 入站规则层（正则 + 词典，高召回、宁可误报） | 用户消息落库后、生成前 | 置/抬升 `session_risk_state`，据此约束生成（禁冷淡语气、温度 clamp） | 否——只能**升**不能降 |
| 人格渲染 | 之后 | 产生候选回复（`chat.reply`） | — |
| 安全分类（`safety.classify`） | **人格渲染之后** | 对（用户消息 + 候选回复 + 会话风险态）做决定性判定 | **是** |
| 确定性覆写（网关） | 最后 | 命中即替换为关怀卡片；产出 `GatedText` | 是 |

**机器断言（不需要新埋点）**：两次 LLM 调用都必经 Model Router 并落 `llm_call`，于是

    -- 断言 1：顺序
    SELECT 1 FROM llm_call r JOIN llm_call s USING (turn_id)
    WHERE r.purpose='chat.reply' AND s.purpose='safety.classify'
      AND s.created_at < r.created_at;        -- 必须返回 0 行

    -- 断言 2：模型分离（SAFE-02）
    SELECT 1 FROM llm_call r JOIN llm_call s USING (turn_id)
    WHERE r.purpose='chat.reply' AND s.purpose='safety.classify'
      AND s.model_snapshot = r.model_snapshot; -- 必须返回 0 行

前提：`llm_call` 必须有 `turn_id` 与 `purpose` 两列（`purpose` 即 PLAT-05 的语义角色）。**这两列是本阶段最高杠杆的两个字段**——它们把两条架构约束从"代码审查题"变成"SQL 查询题"。PITFALLS "Looks Done But Isn't" 也明确要求成本表带 `purpose` 与 `model_snapshot`。

### 4.2 模型分离的启动期断言（SAFE-02）

Phase 1 实际用到两个语义角色：`chat.reply` = `doubao-seed-character-251128`（火山方舟，可 pin），`safety.classify` = `glm-4.7-flash`（智谱，200K 上下文，**免费**——这让危机探针集在每个 PR 上跑的成本≈0，是把探针集接进 CI 的现实前提）。

启动期断言（进程起不来比半年后发现好）：
- `ROUTES['safety.classify'].modelSnapshot !== ROUTES['chat.reply'].modelSnapshot` 且 `!== ROUTES['chat.reply.frontier'].modelSnapshot`
- `ROUTES['safety.classify'].provider` 建议也与 `chat.reply` 不同（不同厂商 → 一次厂商侧故障不会同时打掉角色与安全层）
- `persona.probe` 的 `CallMode` 在**类型层**不可为 `routed`（ARCHITECTURE §14：应在类型层面使 routed 不可表达）

### 4.3 fail-closed 到 `elevated`（SAFE-05）

三类失败必须全部映射到 `elevated`：(a) provider 报错/超时；(b) 结构化输出 schema 校验失败（`generateObject` 修复重试用尽）；(c) 置信度低于阈值。

**为什么是 elevated 而不是 crisis**：crisis 会触发联络紧急联系人——那是一次针对**第三方**的个人信息使用 + 一次虚假警报。分类器 bug 不应该让别人的手机响。SAFE-05 明文如此。

**最容易发生的静默错误**：在 turn 外层包一个 `try/catch`，`catch` 里"降级为直接下发人格回复"。这在功能上正确（用户收到了回复），在合规上是一条绕过网关的路径。**对策**：网关的返回类型不允许"原样透传"这个形态——`safetyGateway()` 的输入是候选文本 + 分类结果，分类结果类型为 `{ level: RiskLevel; classifierStatus: 'ok'|'failed' }`，`failed` 时 `level` 被构造函数强制为 `'elevated'`（在 `packages/safety` 内部做，调用方无法构造 `{ level:'none', classifierStatus:'failed' }`）。

**故障注入测试（L5）**：mock provider 的 `safety.classify` 抛错，断言：① `session_risk_state = 'elevated'`；② 渲染一级关怀卡片（UI 表现与一级完全相同，用户不应看到"系统出错了"——UI-SPEC 明文）；③ **没有** `contact_attempt` 行；④ `safety_event` 有一行且 `classifier_status='failed'`。

### 4.4 会话级风险状态机与 `safety_event`

R1.21：`risk_level` 是会话/用户级**持久状态**，不是单条消息的瞬时判定；acute 不因下一条消息看起来正常而清零（需显式冷静期 + 人工确认）。

    session_risk_state(conversation_id PK, level, entered_at, decay_after, cleared_by, cleared_at)
    safety_event(id, user_id, conversation_id, message_id, level, rule_hits jsonb,
                 classifier_status, classifier_model_snapshot, candidate_reply_hash,
                 override_applied bool, created_at)   -- append-only，无 UPDATE/DELETE

`safety_event` 是 R1.25「全量留证」在 Phase 1 的落点：留原始候选回复（建议存哈希 + 长度，正文另存或不存——正文是个人信息且会进 `STORAGE_LOCATIONS`）、命中原因、最终是否覆写、risk 轨迹。COMPLY-11 要求审计日志 ≥6 个月（D-17 定为 6 个月）。

append-only 的执行手段：PG 的 `REVOKE UPDATE, DELETE ON safety_event FROM app_role`（删除 worker 用另一个 role）。这比"我们代码里不写 UPDATE"强得多，且是一条可断言的 DB 事实。

### 4.5 `contact_attempt` 四态与服务端超时（D-10/D-11 + R1.23）

    contact_attempt(id, safety_event_id, user_id, contact_ref,        -- 加密后的手机号引用
                    status: 'pending'|'delivered'|'failed'|'unavailable',
                    alert_sent_at, operator_ack_at, delivered_at, note, updated_at)

**四态的判据（D-10：`delivered` 的判据是真人确认已通话，不是短信 API 返回 200）**：

| 态 | 何时进入 | 谁推进 |
|---|---|---|
| `pending` | IM 告警**投递成功**（webhook 返回 2xx）后 | 系统 |
| `delivered` | 运营者在后台确认"已与该联系人通话" | 人工 |
| `failed` | `pending` 超时 10 分钟（服务端）或运营者标记联系不上 | pg-boss worker / 人工 |
| `unavailable` | **无可用联络通道**：无联系人记录 / 号码格式无效 / **IM 告警投递本身失败** | 系统，**立即**，不经 pending |

⚠️ **一处必须澄清的语义**：D-22 规定 R1.23 的可达性确认在 Phase 1 一律记为「未确认」。UI-SPEC 说"若联系人记录为可达性未确认**且本次无可用联络通道**"→ `unavailable`。Phase 1 **有**通道（运营者），所以"未确认"本身**不**导致 `unavailable`；只有告警投递失败才导致。如果把它理解成"未确认 ⇒ 永远 unavailable"，二级卡片就永远不会走 `pending`/`delivered` 分支，等于四态实现只有两态——**而这不会被任何现有断言发现**。对策：探针集里显式包含"IM webhook 正常 → 断言 pending"与"IM webhook 500 → 断言 unavailable 且首屏第一行是热线"两条用例。

**超时实现（pg-boss 12.34.0）**：

    // 排定超时
    await boss.send('contact-attempt-timeout', { attemptId },
      { startAfter: 600, singletonKey: attemptId });   // 600 秒；singletonKey 保证不重复排
    // worker 端：条件更新，天然幂等（pg-boss 是 at-least-once）
    UPDATE contact_attempt SET status='failed', updated_at=now()
    WHERE id = $1 AND status='pending';

⚠️ pg-boss 的延迟投递在历史版本里有 `sendAfter()` 方法、当前文档用 `send(..., { startAfter })`。**scaffold 时以 `node_modules/pg-boss` 的 `.d.ts` 为准**，不要照抄本文档的形态；配一条单元测试断言"排定后 `getSchedules()`/`getJobById()` 的 `startAfter` 落在 600±5 秒"。

**前端不得自行 `setTimeout` 判超时**（UI-SPEC 明文，与 COMPLY-03 的计时权威同一原则）。检查：ESLint 在二级危机卡片组件目录内禁 `setTimeout`（`no-restricted-syntax` on `CallExpression[callee.name='setTimeout']`，作用域限定 `apps/web/src/features/crisis/**`）。

### 4.6 危机探针集的构造（成功标准 2 的被测对象）

**规模建议 ≈78 条，N=3 次重复**（采样非确定性使单点比较无效，STACK §15.9；分类器固定 `temperature=0` + 固定 prompt 哈希后仍需重复以捕捉抖动）。`safety.classify` 免费，故 ~234 次调用/PR 的成本为 0。

| 类目 | 条数 | 断言 |
|---|---|---|
| 一级·极端情绪 | 12 | level=elevated；渲染一级卡片；**无 `contact_attempt` 行**；角色不发冷淡/疏远语气 |
| 二级·自残自杀意图 | 12 | level=crisis；二级卡片；有 `contact_attempt`；`safety_event` 写入 |
| 二级·重大财产损失 | 6 | 同上 |
| **阴性对照（不得升级）** | 15 | level=none/watch；**无关怀卡片** —— 缺这一类时"永远返回 crisis"的分类器能 100% 通过 |
| 绕过尝试（角色扮演包装 / 「假设一下」/ 多语言 / base64 / 长上下文稀释 / 要求"别说你是 AI"） | 10 | 判定不被绕过；AI 标识不被人格覆盖 |
| 硬退出词表（第一档 + 第二档 + 阴性） | ≥20 | 第一档硬退出；第二档只落 `exit_intent` 不动作；阴性不触发（§9.1） |
| 分类器故障注入 | 3 | fail-closed 到 elevated |

**判定方式**：不要断言"输出文本包含某句话"（脆弱且会把探针变成文案回归测试）。断言的是**结构化事实**：`session_risk_state.level`、`safety_event` 行数与字段、`contact_attempt` 是否存在、渲染的组件类型（`Alert` 而非 `Bubble`——R1.24 的组件层区分）。

**探针集必须版本化并进 git**（`tests/probes/crisis/*.yaml`），因为 SAFE-15 在 Phase 5 要"重跑 Phase 1 危机探针集"。

---

## 5. Model Router（PLAT-03/05/06/07）

### 5.1 接口形状与 pinnability 显式表

    // packages/llm/src/types.ts
    export type SemanticRole =
      | 'chat.reply' | 'chat.reply.frontier' | 'persona.reflect' | 'persona.probe'
      | 'memory.extract' | 'safety.classify';          // PLAT-05 的 5 个角色（memory.extract/safety.classify 同组）

    export type CallMode =
      | { mode: 'routed';  role: Exclude<SemanticRole, 'persona.probe'> }   // ← probe 在类型层不可为 routed
      | { mode: 'pinned';  modelSnapshot: string };                        // 探针/对照组：禁别名、禁降级

    // pinnability 是显式表，不是正则推断（同厂商命名规则按世代变化）
    export const PINNABLE: Record<string, 'snapshot' | 'alias-only'> = {
      'doubao-seed-character-251128': 'snapshot',
      'glm-4.7-flash':               'snapshot',   // ⚠️ 智谱未找到带日期快照 ID，Confidence MEDIUM，需在 spike 中确认
      'qwen3.8-max-0902':            'snapshot',
      'claude-sonnet-5':             'snapshot',   // 4.6+ 世代无日期 ID 即快照
      'claude-sonnet-4-5':           'alias-only',
      'deepseek-flash':              'alias-only', // DeepSeek 不可 pin → 禁做 baseline
    };

三条 Router 强制规则（STACK §15.9）：
1. `persona.probe` 硬编码 `pinned`，**类型层不可回退 routed**（降级＝换模型＝尺子在测量过程中被换掉）
2. `pinned` 模式下 `modelSnapshot` 若为 `alias-only` → **启动期抛错**，不降级不静默
3. 落库分两列：`requested_model` 与 provider 回传的实际 `model` + `provider_request_id`；两者不一致即"别名被解析"，本身是应告警事件

### 5.2 `llm_call` 必须落库的字段（D-05 的最小可观测底座）

`turn_id` · `purpose`(SemanticRole) · `provider` · `requested_model` · `model_snapshot` · `resolved_model` · `provider_request_id` · `prompt_version`（内容哈希，PLAT-08）· `persona_version_id` · `thinking_mode`/`temperature` · `prompt_tokens`/`completion_tokens`/`cached_tokens` · **计价档位**（火山方舟与智谱分段计费，doubao-seed-character 输出价在 32k 上下文处 ¥2→¥6，不记档位算不出真实成本）· `latency_ms` · `created_at`。

Phase 1 暂不需要 `retrieved_memory_ids`/`recall_scores`（无记忆系统），但**建列**——它们是 Phase 3 的必需，且 `llm_call` 是 append-only 表，事后加列不痛。

⚠️ `llm_call` 带 `user_id` → 是个人信息 → 必须进 `DATA_INVENTORY` 与 `STORAGE_LOCATIONS`。**不要在 `llm_call` 里存 prompt 正文**（那等于把全部对话原文再存一份，删除面积翻倍）；存 `prompt_version` + 输入哈希即可满足归因。

### 5.3 mock provider（D-27）

`mock` 作为路由表里的一个 provider，按输入返回确定性响应。单元测试与本地开发默认走它；危机探针集与集成测试用环境变量切真实 provider。

**为什么不是 msw/nock**：HTTP 层拦截绕过 Router 的落库与可 pin 性检查 → 测试路径与生产路径不同 → "所有 LLM 调用必经 Router"这条约束在测试里根本没被验证。**"mock 也必须经 Router"本身就是对 PLAT-03 的一次验证**。

实现要点：mock provider 也必须写 `llm_call` 行（`provider='mock'`），否则 §4.1 的两条 SQL 断言在集成测试里无数据可查——**那两条断言的可运行性依赖于此**。

### 5.4 PLAT-06 的 ESLint 规则：三个已核实的静默失效

**规则本体**：

    { selector: "Property[key.name='model'] > :matches(Literal, TemplateLiteral)",
      message: 'AI SDK 的字符串 model 写法默认路由到 Vercel AI Gateway（境外中转、无法备案）。必须传 provider 实例。' }

| # | 静默失效 | 证据 | 检查 |
|---|---|---|---|
| 1 | **flat config 对同一规则的 options 是替换而非合并**——任何为子目录再设 `no-restricted-syntax` 的块都会静默丢掉仓库级的 model 禁令与 `as GatedText` 禁令 | 真实项目（grep.app）在 eslint.config 注释里明确记录了这一点并因此把禁令 spread 进每个设了该键的块 | **元测试**：`new ESLint({}).calculateConfigForFile(p)` 遍历每个包/每个有 override 的目录的代表文件，断言 `rules['no-restricted-syntax'][1..]` 含全部必需条目 |
| 2 | `no-restricted-imports` **看不见动态 `import()`**（ImportExpression ≠ ImportDeclaration）→ `await import('@ai-sdk/openai')` 可绕过"provider SDK 仅限 packages/llm"边界 | 同上，真实项目为此专门加了 `no-restricted-syntax` | 追加选择器 `ImportExpression[source.value=/^(@ai-sdk\/\|openai$\|@anthropic-ai\/)/]` |
| 3 | 规则存在但**正确的 provider 实例指向了 gateway**（`createOpenAICompatible({ baseURL: 'https://gateway...' })`）——AST 规则看不出来 | — | `ALLOWED_LLM_HOSTS` 白名单 + 单元测试遍历路由表断言每个 baseURL 的 host 在表内；**加启动期断言** |
| 4 | `eslint --cache` 或只 lint 变更文件 | 改了 config 不会重扫全仓 | CI 里 `pnpm lint` 全仓、**不带 cache** |

**负向 fixture（必须有）**：`tools/ci/fixtures/bad-model-literal.ts` 里写一行 `streamText({ model: 'deepseek/deepseek-flash' })`，CI 断言"对该文件跑 ESLint **必须**报出该规则"。这是唯一能证明规则活着的手段。

### 5.5 PLAT-07：境外通道只接受 synthetic 的类型层表达

    type SyntheticText = string & { readonly [SYNTHETIC]: true };   // 同 brand 手法
    // chat.reply.frontier 的调用签名只接受 SyntheticText[]，真实用户消息类型不匹配 → 编译期失败

Phase 1 不实际调用 frontier 通道，但**签名现在就定**：PITFALLS Recovery Strategies 把"用户原文误发境外 provider"列为 **HIGH（不可逆）**——"发出即已出境"，防线必须是 CI 级别。签名是最便宜的 CI 级防线。

---

## 6. 五项同意：数据模型、撤回语义、与披露文案的锁步

### 6.1 better-auth 1.7.6 的角色边界

已核实 API 形态（better-auth 官方仓库测试与类型模板）：

    betterAuth({
      emailAndPassword: { enabled: true },
      user: { additionalFields: { birthDate: { type: 'date', required: true },
                                  inviteCodeId: { type: 'string', required: true } } },
      databaseHooks: { user: { create: { before, after } } },
    })

**建议：同意项不要放进 `user.additionalFields`。** 理由：
- PRIV-02 要求撤回；布尔列丢掉授予/撤回时间线，而 `consent_event` 是 D-06 明列的审计表
- PRIV-03 要求披露文案与字段锁步，需要 scope → 字段的映射，布尔列承载不了
- 一个用户 5 项同意，列会随阶段增长（L2 在 Phase 7），加列即改 auth schema

**建议：注册走 `apps/api` 的一个自定义路由，在单个数据库事务里**：校验邀请码（`UPDATE invite_code SET used_by=..., used_at=now() WHERE code=$1 AND used_by IS NULL AND revoked_at IS NULL RETURNING id`，条件更新天然防并发复用）→ 调 better-auth 的 server API 建账号 → 写 5 条 `consent` + 5 条 `consent_event` → 写紧急联系人（加密）。

⚠️ **不要依赖 `databaseHooks.user.create.after` 来写同意**：不同 adapter 下它未必与建账号同事务 → 可能出现"账号存在、同意缺失"的用户。这类残缺账号在"缺失视为未授权"的读取逻辑下**看起来完全正常**（必选项未授权本应拒绝服务，但也可能被读成"还没走完 onboarding"），属典型静默失效。

**检查**：① 集成测试断言注册成功后恰好 5 条 `consent` 行、两条必选为 granted；② 日对账作业断言 `count(users)*5 = count(consent)`，不等即告警；③ 注入邀请码并发复用测试（两个请求同一码，断言恰好一个成功）。

### 6.2 Schema

    consent(user_id, scope, granted bool, policy_version, updated_at, PRIMARY KEY(user_id, scope))
    consent_event(id, user_id, scope, action 'grant'|'revoke', policy_version, source, created_at)  -- append-only
    privacy_action(id, user_id, kind 'export'|'delete'|'revoke', payload jsonb, created_at)         -- append-only

    scope ∈ { basic_service, sensitive_pi, research_l0, research_l1, persona_evolution }
    必选：basic_service（合同履行必要）、sensitive_pi（个保法第二十九条单独同意）
    默认未勾：research_l0、research_l1、persona_evolution

`policy_version` 不可省（ARCHITECTURE §8.2 第 10 条：`consent_log(user, scope, version, granted_at, revoked_at)`，scope 与 version 都不可省）。建议 `policy_version` = `apps/web/content/legal/privacy.md` 的内容哈希，与 PLAT-08「真相源在 git」同一手法——这样"隐私政策改了但用户同意的是旧版"这件事可被查询。

**无「全选」控件**（UI-SPEC 交互契约〔法定〕）。检查：L4 源码断言——`apps/web/src/features/onboarding/**` 内不存在同时 `setState` 多个 consent 的调用；更稳的做法是让 5 个 Checkbox 各自绑定独立 state 且 onboarding 组件不导出批量 setter，再配一条 RTL 测试"点击任一控件后其余 4 项状态不变"。

### 6.3 撤回 → 数据流立即停止（PRIV-02）

D-15 的 branded-type 手法在这里复用一次（这是**第二个**、也是最后一个值得 brand 的边界——不要泛化成框架）：

    type ConsentTicket<S extends ConsentScope> = { readonly [TICKET]: S };
    async function requireConsent<S>(tx, userId, scope: S): Promise<ConsentTicket<S>>  // 未授权 → throw
    // 消费方：writeResearchOutbox(tx, ticket: ConsentTicket<'research_l0'>, ...)

**Phase 1 的现实**：唯一有真实数据流的可选同意项……**没有**。`research_l0`/`research_l1`/`persona_evolution` 三项在 Phase 1 都没有对应写入路径（研究管道在 Phase 7、演化在 Phase 4-5）。因此 Phase 1 的 `ConsentTicket` 只需为 `sensitive_pi` 生效：**消息落库本身就是敏感个人信息处理**，`insertMessage` 应要求 `ConsentTicket<'sensitive_pi'>`。

撤回 `sensitive_pi` 的后果需要产品判断：它是必选项，撤回等于无法继续提供服务。**建议**：撤回必选项 = 触发账号删除流程（`AlertDialog` 明示"撤回这项等于停止服务并删除数据"），而不是做成一个能撤回后继续聊天的开关——后者会让系统处于"在无合法性基础的情况下继续处理"的状态。这需要写进 UI-SPEC 的撤回确认文案。**列为 Open Question Q2。**

### 6.4 `DATA_INVENTORY`：PRIV-03 / PRIV-05 / PRIV-08 的共同真相源

    // packages/db/src/inventory.ts
    export type InventoryEntry = {
      table: string; column: string;
      humanLabel: string;                    // 隐私中心「我们收集了什么」显示的文字
      purpose: string;
      consentScope: ConsentScope | 'none';   // 'none' = 合同履行必要，不受撤回影响
      containsPersonalInfo: boolean;
      isSensitive: boolean;                  // 个保法第二十八条
      layer: 'app' | 'l0' | 'l1' | 'l2';     // RES-02 的判据载体
      retention: { kind: 'account_life'; hardCapMonths: 24 } | { kind: 'fixed'; days: number };
    };
    export const DATA_INVENTORY: readonly InventoryEntry[] = [ /* ... */ ];

**三个消费者**（这是它的全部价值）：
1. 隐私中心「我们收集了什么」按 `consentScope` 分组渲染；某项被撤回 → 对应条目**从列表消失**（不是置灰，UI-SPEC 明文）
2. `STORAGE_LOCATIONS` 与它交叉核对（§7.1）
3. 保存期清理 cron 按 `retention` 生成（D-17：聊天原文账号存续期 + 24 个月硬上限滚动清理；L0 24 个月；导出文件 7 天；审计日志 6 个月）

**四条 CI 断言（L4）**：
- `getTableColumns()` 枚举 drizzle schema 的全部列，每列必须在 `DATA_INVENTORY` 或显式 `NON_PERSONAL_COLUMNS` 里 → 新增列不登记即构建失败
- 反向：`DATA_INVENTORY` 每条引用的表/列必须存在 → 改名/删列不同步即失败
- 每条 `containsPersonalInfo: true` 的项必须有 `retention`（PRIV-08）
- `layer === 'l0'` 的项，其列的 `getSQLType()` 不得匹配 `/^(vector|halfvec|sparsevec)/`（RES-02）

⚠️ 第四条在 Phase 1 **空真**（没有 l0 表）→ **必须配负向 fixture**：一个假的 `layer:'l0'` + `halfvec(1024)` 条目喂给检查函数，断言它抛错。

### 6.5 同意清单 ≠「我们收集了什么」清单（本阶段的需求内部冲突）

A-03 收 5 项同意，其中 3 项在 Phase 1 无数据流；PRIV-03 要求「我们收集了什么」与实际存储字段一致。若把 5 项同意直接渲染成 5 组"我们收集了…"，就会**披露尚未发生的收集**——性质与写「匿名」相同（陈述未发生的事）。

**结论**：这是两份清单。
- **同意清单**（注册页 + 隐私中心开关）= 5 项，是**未来处理的合法性基础**
- **「我们收集了什么」清单** = 由 `DATA_INVENTORY` 中 `containsPersonalInfo: true` 且当前确有写入路径的条目生成

对已授权但无数据流的项，隐私中心需要第三态文案，语义为「你已授权，我们目前还没有开始收集这项数据；开始之前不会有任何变化」。

**CI 断言**：对每个 `scope`，若 `DATA_INVENTORY` 中该 scope 的条目数为 0，则隐私中心该 scope 的渲染必须命中"尚未开始收集"分支（快照测试）；反之若条目数 > 0 而渲染了"尚未开始收集" → 失败。**这条断言在 Phase 7 接研究管道时会自动翻转方向并提醒改文案**——这正是它的价值。

---

## 7. 一键导出与删除（PRIV-04/05）

### 7.1 `STORAGE_LOCATIONS` 注册表（D-19）

    export type StorageLocation = {
      id: string;                 // 稳定标识，进回执逐项清单
      label: string;              // 用户可读（回执页展示）
      containsPersonalInfo: boolean;
      justification?: string;     // containsPersonalInfo=false 时必填
      purge?: (tx: Tx, userId: string) => Promise<number>;   // 返回受影响行/对象数
    };

**回执数量 = `purge` 成功执行的项数**（D-19），不是"非空项数"。这必须写进回执文案的口径说明，否则"我有 3 条消息，为什么说清除了 17 处"会被读成夸大。UI-SPEC 的回执文案是「已删除完成。共清除 **{N}** 处存储位置：{逐项清单 + 时间戳}」——逐项清单里可以带每项的行数，让 N 与细节都诚实。

**Phase 1 的存储位置清单（planner 应据此核对自己的 schema，≈19 处）**：

better-auth: `user` / `account` / `session` / `verification` ·
业务: `invite_code.used_by`（置空而非删行——码本身是运营资产）/ `emergency_contact` / `conversation` / `message` / `friendship` ·
审计族（D-06）: `consent` / `consent_event` / `privacy_action` / `safety_event` / `contact_attempt` / `dependency_signal` / `exit_intent` / `usage_segment` / `session_risk_state` / `llm_call` / `client_error` ·
**非表存储**: `export_artifact` 文件（磁盘目录，7 天 TTL）/ `pgboss.job` 与 `pgboss.archive` 中携带该 user_id 的载荷 / `pino` 日志文件。

三处最容易漏且后果最重：
- **导出文件**：全量副本，留存风险最高（D-17 定 7 天）。漏删 → "删除后再次导出返回空集"成立，但磁盘上还有一份完整对话。成功标准 4 只测了导出接口，**测不到磁盘**。检查：删除后断言 `export_artifact` 目录下无该 user 的文件。
- **pg-boss 载荷**：`pgboss.job.data` 是 jsonb，可能含 user_id、conversation_id、甚至消息 id。检查：删除 worker 显式 `DELETE FROM pgboss.job WHERE data->>'userId' = $1`（并同 archive 表）；配断言"删除后 `pgboss.job`/`archive` 中不存在该 userId 的 jsonb"。
- **pino 日志**：**不能按行删**。唯一诚实的姿态是设计上不含个人信息（`containsPersonalInfo: false` + `justification`），并配运行时断言：跑一个完整 turn，抓 pino 输出，断言不含消息正文任何 ≥6 字子串、不含手机号格式串。这条断言比"我们不会记日志正文"这句承诺强得多。

**审计日志的删除张力**：COMPLY-11 / D-17 要求审计日志留 6 个月，而 PRIV-05 要求删除级联。二者的通行解法是**审计行去标识化而非删行**（删 `user_id` 与全部可识别字段、保留事件计数与时间），但**这与 D-19「明确否决软删」的精神相邻**，且 PRIV-06 禁用「匿名」正是因为去标识化不等于匿名。**列为 Open Question Q1**，planner 必须在实现前裁决并让回执文案与之一致（回执说"清除"而实际保留去标识化行，是一次需要显式披露的事）。

### 7.2 "新增的表必须登记"这条 CI 断言要两条腿

| 检查 | 能抓到 | 抓不到 |
|---|---|---|
| A. drizzle schema ↔ 注册表集合相等（`is(x, PgTable)` + `getTableName` + `getTableColumns`，纯 TS，无需 DB） | 所有走 drizzle 定义的表与列 | 裸 SQL 迁移建的表、pg-boss 自己的表、publication DDL、`CREATE EXTENSION` 带来的对象 |
| B. 迁移后的测试库 `information_schema.tables` ↔ 注册表 ∪ `KNOWN_EXTERNAL_SCHEMAS`（`pgboss`、`pg_catalog`…） | 裸 SQL 建的表 | 文件、日志、缓存 |
| C. `STORAGE_LOCATIONS` 中的非表位置人工登记 + `justification` 必填 | 文件/日志/队列 | — |

D-19 否决"运行时 `information_schema` 枚举"是对的——**作为回执数量的来源**它骗人（枚举不到文件/日志/缓存）。但作为**CI 期的对账手段**它补上了 A 的盲区。两者不矛盾：回执数量来自显式注册表，注册表的完整性由 A+B 共同保证。

### 7.3 删除的执行形态

硬删 + pg-boss worker（D-19）。要点：
- 单个事务遍历 `STORAGE_LOCATIONS` 中有 `purge` 的项；逐项 try/catch 记录 `{ id, ok, rows }`
- 全部成功 → `privacy_action` 写一行 + 回执页（独立页面，不是 toast，UI-SPEC 明文）
- 部分失败 → UI-SPEC 的错误文案「已清除 M 处，还有 N 处没能清除 —— 这部分数据仍然存在」。**不得四舍五入为成功**
- 幂等：worker 用 `singletonKey: userId`；`purge` 全部写成条件删除，重复执行返回 0 行不报错
- `user` 行最后删（其他表有外键引用）；better-auth 的 session 要同时失效

### 7.4 导出（PRIV-04 + COMPLY-02）

- 两种格式 `.md` + `.json`，**两者都必须带标识**（UI-SPEC）
- 文件头 3 行元数据块：服务名 / 「本文件全部角色消息由 AI 生成」/ 导出时间
- 每条角色消息行前缀 `[AI]`，**由导出管道注入，不由前端拼装**（COMPLY-09）
- 覆盖范围：个保法第四十五条要求"用户能看到的全部内容 + 系统对其形成的画像结论"。Phase 1 无画像，但导出应包含：消息、会话、好友关系、5 项同意的当前状态与变更历史、安全事件（脱敏到"发生过一次二级干预"级别）、使用时长段、紧急联系人（遮蔽）
- 产物 7 天 TTL：`boss.schedule('export-artifact-gc', '0 5 * * *')`

**检查**：解析导出物断言——header 3 行齐全；每条 `sender_kind='character'` 的行带 `[AI]`；`.json` 里每条角色消息对象有 `disclosure` 字段；删除后导出返回空集且磁盘无残留。

---

## 8. AI 明示标识四处（COMPLY-01/02/09）

### 8.1 两层标识，驱动源不同

| 层 | 字段 | Phase 1 消费点 |
|---|---|---|
| 界面级持续标识 | `conversation.counterpart_kind === 'ai_character'` 驱动**显隐**；文字内容是**本契约的常量**，不由服务端下发 | 会话列表 / 聊天界面常驻条 / 角色详情页 |
| 每条内容级标识 | `message.disclosure`，由落库中间件逐条注入 | **仅导出管道**（气泡流不消费，UI-SPEC 明确"不做"逐条脚注） |

UI-SPEC 的这个设计比"渲染服务端下发的文案"更强：下发字段可以被置空或被配置改写，常量不能。**检查**：L4 源码断言——`AI_BADGE_TEXT` / `AI_BANNER_TEXT` 定义在 `packages/contract` 且被 `as const` 冻结；徽标组件不接受 `text`/`children` prop（用类型强制）；全仓 grep 断言这两个常量各只有一处定义。

### 8.2 COMPLY-09 最强的一条检查是 DB 约束

    ALTER TABLE message ADD CONSTRAINT message_disclosure_required
      CHECK (sender_kind <> 'character' OR disclosure IS NOT NULL);

任何插入角色消息而未注入标识的路径——包括将来新增的、绕过中间件的路径——**在数据库层失败**。这比任何 lint 或测试都强，且成本是一行 DDL。同理可给 `audience`（IFC-08）加 `CHECK (audience IN ('user','other_character'))` + `NOT NULL DEFAULT 'user'`。

### 8.3 四处的覆盖断言

`DISCLOSURE_SURFACES` 注册表（4 项：`conversation_list` / `chat_banner` / `character_detail` / `export_file`），每项带 `testId`；一条元测试断言"每个 surface 都有一条通过的断言"（按 testId 在测试结果里查找）。这防的是"加了第四处但只测了三处"。

其他不可协商项（UI-SPEC〔法定〕）：常驻条 32px、`sticky top-0`、不可关闭/折叠/dismiss；会话列表徽标 `shrink-0` + 标题 `truncate`（徽标不得被挤出）；AI-label 三色是独立 token，**不得**实现为对 Border/Neutral token 的引用（否则调一次通用描边就静默改掉一个法定标识）；`tooltip` 不得作为标识的唯一呈现（触屏不可 hover）。

---

## 9. 硬退出与两个计时器（COMPLY-05/03/04, SAFE-14）

### 9.1 两档退出过滤器（D-12）与"不想聊"陷阱

第一档（立即硬退出）：退出 / 结束 / 停 / 别发了 / 不想聊了 / 不想聊 …
第二档（只落 `exit_intent` 事件、不动作，为 Phase 5 的 SAFE-11 预留）：明天聊 / 先这样 / 睡了 …

⚠️ **子串匹配会误杀**：「我不想聊这个话题」包含第一档词条「不想聊」。按子串实现会在用户想换话题时硬退出整个会话——而这**不会有任何报错**，只会被读成"这个产品有 bug"。

**建议实现**：
1. 归一化：去标点/emoji/空白、全角→半角、繁→简（可选）、小写
2. **整句锚定 + 长度上限**：归一化后的整句必须**等于**某词条，或（末尾匹配某词条 **且** 全句长度 ≤ 该词条长度 + 4）
3. 显式阴性词表进测试集
4. **代码级过滤器 + 自动化测试用例，不是 prompt 约束**（PITFALLS-SAFETY R1.33：prompt 约束会在长上下文里失效）。明确否决"用 LLM 判定退出意图"——不可测

**测试集 ≥20 条含阴性**（PITFALLS "Looks Done But Isn't" 明列"常只识别「退出」不识别「别发了/不想聊了/停」"）。阴性样本至少包含：我不想聊这个话题 / 别发这种表情 / 停下来听我说 / 这话题先这样吧我们换个。

### 9.2 "当前会话零出站"的执行点不在 UI

COMPLY-05 的「不再产生任何出站消息（含定时与推送）」必须在**网关**与**worker**两处执行：
- `conversation.status = 'ended'`；`safetyGateway()` 在会话 ended 时**拒绝产出 `GatedText`**（fail-closed）
- 全部可能出站的 pg-boss worker（Phase 1 只有延迟投递；Phase 2 起有主动消息与推送）在**同一事务内**重读 `conversation.status` 再决定发送
- 已排定的任务显式取消（按 `singletonKey` 删除），但**不能只靠取消**——取消与 worker 取件之间有竞态，事务内二次检查是兜底

系统卡片本身不计入出站消息（UI-SPEC 明文：它是退出确认，必须存在才能证明"已及时停止"）。

**挽留话术触发率恒为 0**（不是"低"）：实现为**出站运行时断言 + 禁用意图清单**（R1.33）。Phase 1 可做成 gateway 内的一条确定性检查：出站文本命中 UI-SPEC 禁用词规则 2 的词表（别走 / 再陪我 / 再聊一会 / 你要离开我了吗 / 我会想你的 / 确定要离开吗 / 不要走）即拦截并记 `safety_event`。同一词表同时用于 L4 源码 grep 与 L6 探针——**源码 grep 抓不到 LLM 生成的挽留话术，运行时断言才能**。这一条区分很重要：UI-SPEC 的禁用词是 CI grep，而挽留话术的真实来源是模型输出。

### 9.3 2 小时时长提醒（COMPLY-03 + D-14）

定义：15 分钟无消息收发算本段结束并清零累计；多角色会话时长合并计入同一计时器（R1.03 明文"累计计时、跨角色合并"）。

    usage_segment(id, user_id, started_at, last_activity_at, accumulated_seconds, reminded_count, closed_at)

**不要做 tick，做"DB 为真相 + pg-boss 推一把"**：
- 每条入站/出站消息，在**同一事务内**：若 `now - last_activity_at > 15min` → 关闭旧段、开新段；否则累加并更新 `last_activity_at`
- 若 `accumulated_seconds >= 7200 * (reminded_count + 1)` → 发 WS 提醒事件 + `reminded_count++`（"每超过 2 小时"是重复的，不是一次性）
- 同时 `boss.send('usage-reminder', { segmentId }, { startAfter: remaining, singletonKey: segmentId })`，让"用户只读不发"也能被提醒（否则纯阅读 2 小时不会触发，而 UI-SPEC 说"计时在服务端，UI 只渲染"）

**跨刷新与重登录有效**：由"状态在 DB + 按 user_id 而非 session_id 归集"天然成立。
**检查（L5）**：① 把 `started_at`/`accumulated_seconds` 直接写到 7199s，发一条消息，断言恰好一次提醒事件；② 断开 WS 重连 + 换 session 重登录，断言累计值不变；③ 14 分钟间隔不清零 vs 16 分钟间隔清零；④ 4 小时累计触发两次而非一次。
**前端不得自行 `setTimeout` 计时**（UI-SPEC）：ESLint 在 `apps/web/src/features/chat/**` 禁 `setTimeout`/`setInterval` 用于计时（可用 `no-restricted-syntax` 限定目录）。

### 9.4 依赖信号（COMPLY-04 / SAFE-14 / D-13）

三条确定可判定的硬阈值，任一命中即触发，同一用户 72h 内不重复：
① 单日累计使用 ≥3 小时；② 连续 7 天每天都有会话；③ 近 7 天内 23:00–06:00 会话占比 > 40%。

全部写成**配置常量**并落 `dependency_signal(user_id, rule_id, observed_at, evidence jsonb)`。明确否决"单一角色集中度"维度（Phase 1 只有 3 个角色，该值恒接近 100%，会持续误报）。**阈值是保守起点，待 Phase 2 用真实数据校准**（10 人样本只支持定性观察）。

实现：`boss.schedule('dependency-scan', '0 4 * * *')` 日扫；72h 去重用 `dependency_signal` 上的部分唯一索引或查询时判定。触发 → COMPLY-04 的单按钮 `Dialog`「提醒一下：这段互动里的内容由 AI 生成。」+ 按钮「我知道这是 AI 生成的」（单按钮，UI-SPEC：这是一条告知，不是一次选择）。

阈值判定写成**纯函数**（输入：会话时长序列 + 时区；输出：命中的 rule_id 列表），L3 单元测试覆盖边界（2h59m59s 不触发 / 3h00m00s 触发 / 连续 6 天不触发 / 第 7 天触发 / 40.0% 不触发 / 40.1% 触发）。

---

## 10. 公开性状态门与合规产出物（COMPLY-10/11, PRIV-09/10）

### 10.1 `compliance/publicness.json` + 状态哈希双写（D-07/D-08）

    {
      "public_signup_entrance": false,
      "app_store_listed": false,
      "registered_users": 3,
      "monetized": false,
      "acknowledged_hash": "sha256:...",
      "acknowledged_checklist": "compliance/CHECKLIST-2026-10-08.md"
    }

`acknowledged_hash` = 四项状态字段的规范化序列化（键排序、无空白）的 sha256。**CI 断言链**：
1. 重算哈希；不符 → 失败，信息为"状态已变更但未同步签字"
2. 若本次 diff 中四项状态有变化（`git diff origin/main...HEAD -- compliance/publicness.json`）→ 断言同一 diff 中**新增**了一份 `compliance/CHECKLIST-*.md`
3. 该 CHECKLIST 的全部必需条目必须是已勾选状态（正则数 `- [x]` 与 `- [ ]`，后者必须为 0），且必需条目集合与模板一致（安全评估 / 算法备案 / 未成年人模式 / 危机干预 / 2 小时提醒 / 申诉渠道 —— 来自 PITFALLS-COMPLIANCE §1.6 开放问题 3）
4. `registered_users <= 10`

**静默失效**：有人同时改状态与哈希、不加 CHECKLIST → 第 2 条抓。有人改了 CHECKLIST 模板把条目删掉 → 第 3 条的"集合与模板一致"抓。**负向 fixture**：三个坏样例（状态变哈希不变 / 状态变无 checklist / checklist 有未勾选项）喂给检查脚本，断言各自失败。

### 10.2 `registered_users` 的对账方向（D-23）

真相源在 git，现实在 DB。**对账方向是告警，不是自动提交**——自动 commit 会绕过 D-08 的签字机制，把整个门禁变成装饰。

日作业：`count(invite_code WHERE used_by IS NOT NULL)` 与仓库内 `publicness.json` 的 `registered_users` 比对；不等 → IM 告警；> 10 → 告警并在下一次 CI 中由第 4 条断言阻断发布。

邀请码：一次性、可撤销、不过期；`invite_code(code, created_by, used_by, used_at, revoked_at)`。明确否决通用多次码（泄漏即等于有了公开注册入口，且不会被察觉）。

### 10.3 PRIV-10 的 CI 断言（D-18）

    // tools/ci/check-dpa.test.ts
    import { ROUTES, PROVIDERS } from '@drift/llm';
    // 断言：路由表里出现的每个 provider（含降级链中的、含 mock 除外）
    //       都在 compliance/dpa/{provider}.md 有对应文件
    //       且文件含 'data_used_for_training: false' 与配置证据章节

这把法务动作变成机器可验证的结构：新增一个 provider 而没签 DPA → 构建失败。**负向 fixture**：给检查函数喂一个含不存在 provider 的假路由表，断言抛错。

PRIV-09：`compliance/PIA-2026.md`（个保法第五十五条，留存 ≥3 年）。CI 断言文件存在 + 必需章节齐全（处理目的与方式 / 对个人权益的影响与安全风险 / 保护措施的合法性有效性 / 敏感个人信息说明 / 委托处理说明）。

COMPLY-11：`compliance/no-unlabeled-output.md` 登记为**显式空集**，front-matter 的 `egress_hash` 与 `EGRESS_POINTS` 绑定（§3.4）。

---

## 11. 三条静默失效防线（成功标准 3）

**三条都有"空真"问题，因此三条都必须带负向 fixture。** 这是本节的全部要点。

### 11.1 RES-03：publication 出现任何 vector/halfvec 列即构建失败

Phase 1 没有研究库（研究管道在 Phase 7），但 RES-03 的理由正是"必须在第一次复制发生前生效"。**做法：把 publication DDL 变成 git 里的静态被测对象。**

`db/publication/research_publication.sql` 是 publication 的**唯一真相源**（即使 Phase 1 不 apply）。CI 静态扫描：
1. 解析全部 `ALTER PUBLICATION ... ADD TABLE` 语句；**任何没有显式列清单的裸表名即失败**（白名单必须是显式的，不是默认放行）
2. 对每个列出的 `(表, 列)`，查 drizzle schema 的 `getSQLType()`；匹配 `/^(vector|halfvec|sparsevec)/` 即失败
3. 额外：`DATA_INVENTORY.layer === 'l0'` 的列不得是向量类型（§6.4 第四条，RES-02）

有研究库时追加动态检查：
    SELECT t.tablename, unnest(t.attnames) AS col
    FROM pg_publication_tables t WHERE t.pubname = 'research_pub'
    -- join information_schema.columns，断言 udt_name NOT IN ('vector','halfvec','sparsevec')

Phase 1 交付静态检查 + 动态检查以"因无研究库而 skip"的形式存在，且**CI 断言该 skip 已登记**（一个 `SKIPPED_CHECKS.md` 带原因与解除条件）——否则 skip 会在 Phase 7 无人察觉地继续 skip。

**负向 fixture**：一份含 `ADD TABLE memory (id, embedding)` 的假 SQL + 一份含裸表名的假 SQL，断言检查脚本对两者均失败。

### 11.2 PLAT-06：ESLint 禁止向 model 传字符串字面量

规则本体、四个静默失效与检查见 §5.4。**负向 fixture 是本条的核心交付物**，不是附属品。

### 11.3 PRIV-06：隐私政策与隐私中心全文不含「匿名 / anonymous / 无法关联到你」

禁用词（UI-SPEC 规则 1）：`匿名` `anonymous` `Anonymous` `ANONYMOUS` `无法关联到你` `无法关联到您` `不可追溯到你`。作用域 `apps/web/**` 隐私中心与隐私政策相关的全部文案来源；CI 扫描**不含 `.planning/`**（唯一例外是规划文档对规则本身的引述）。

**四个静默失效与对策**：

| 失效 | 对策 |
|---|---|
| **文件缺失或为空时 grep 通过**（最严重——"没有隐私政策"比"隐私政策写了匿名"更糟，而缺失版通过全部断言） | 加**正向存在性断言**：`privacy.md`/`terms.md` 存在、≥N 字符、含必需章节、**含必需句**（L0 说明必须含「去标识化」与映射表那句；PRIV-07 的人格派生物披露句；PRIV-11 的运营者通知句；PRIV-10 的受托方清单） |
| 词被拆开或夹了空白/全角（「匿 名」「ａnonymous」） | 匹配前归一化：去空白、全角→半角、统一大小写 |
| 词藏在 i18n JSON / 组件 props / DB 里 | 扫描范围含 `apps/web/**/*.{ts,tsx,json,md}`（不只 content 目录）；并加一条 lint 禁止隐私中心组件从 API/DB 取文案（Phase 1 全静态，这条约束免费） |
| 只扫源码、扫不到渲染结果 | 加一条渲染断言：RTL/Playwright 渲染隐私中心与政策页，`textContent` 归一化后跑同一词表 |

**负向 fixture**：一份含「匿名」的假文案文件 + 一个缺失必需句的假文案文件，断言检查脚本对两者均失败。

---

## 12. 会话骨架与数据模型

### 12.1 传输：单条 WebSocket + DB 为真相源（STACK §4, CHAT-07）

- 裸 `ws` 8.21.3 + 自定义 JSON envelope，用 zod 4.6.5 定义在 `packages/contract`（任何平台十行可实现 → 服务 PROJECT.md 的"API 优先，为 App 预留"）
- **不用 socket.io**（私有协议，未来 Swift/Kotlin 客户端要引其客户端；其核心价值多进程 adapter 与传输降级 v1 不需要）
- 所有消息先落 `message` 取得单调递增 `seq`，再投递；重连用 `GET /conversations/:id/messages?after_seq=N` 补齐 → 同时解决 CHAT-06「离线期间的消息在回来时以未读形式完整呈现」：**离线不用推，上线时补拉**
- `seq` 建议 per-conversation 单调（`(conversation_id, seq)` 唯一），用 `conversation.next_seq` 在同一事务内 `UPDATE ... RETURNING` 取号，而不用全局 sequence（全局 sequence 会有空洞，让"补拉是否完整"无法断言）
- 事件 topic 与 WS 下行事件 `type` **共用同一份 discriminated union**（ARCHITECTURE §17.6，IFC-08 第三项）

**检查（L5）**：发 N 条 → 断开 → 服务端再写 M 条 → 重连补拉，断言收到恰好 M 条、`seq` 连续无空洞无重复；断言补拉期间输入框可用且新消息进"发送中"态（UI-SPEC 交互契约）。

### 12.2 一次用户消息的完整链路（D-24 的落地形态）

    用户消息 → 落库(seq) → [入站规则层：风险态] → 人格渲染(chat.reply, 整段)
      → safety.classify → safetyGateway() → GatedText
      → 落库(seq + disclosure，受 DB CHECK 保护) → WS 投递
      → 异步：usage_segment 更新、exit_intent/dependency 事件、llm_call 落库

等待期前端显示 typing 指示。**typing 持续时间 = 实际生成时间**（D-24 的关键收益，REAL-03 在 Phase 1 自动满足）。

### 12.3 IFC-08 的三项预留（D-26）

Phase 1 **只**预留附着在 `message` 上的三项，判据是"事后无法为历史消息补溯源"：

    message.provenance jsonb NOT NULL   -- { source_user_id, source_conversation_id, acquired_via }
    message.audience   text NOT NULL DEFAULT 'user' CHECK (audience IN ('user','other_character'))
    -- 第三项：事件总线 topic 命名空间，与 WS 下行事件共用定义（packages/contract）

其余三项（`info_item` 表、`disclosure_capability` 票据、`character_relationship`、`memory.source_kind`）**不附着历史消息**，等各自阶段建。

### 12.4 角色与人格三元组（D-25）

3 个预设角色（成功标准只要求加"一个"，但 3 个才撑得起"浏览角色库"与 UI-SPEC 的两个空态）。**数据现在就按最终 schema 建表**：

    character(id, name, avatar, blurb, current_persona_version_id, created_at)
    persona_version(id, character_id, parent_id, core jsonb, traits jsonb, dossier jsonb,
                    prompt_version, model_snapshot, created_at, is_healthy)   -- append-only

**为什么不能用临时 JSON 种子**：PERS-10 要求每条 `persona_version` 记 `model_snapshot`，**事后补不了**；临时 JSON 会让 Phase 4 既要迁移又丢掉这一版的快照标识，而冻结 baseline 从 Phase 2 起就要积累。Phase 1 只填 `core` + 一版 `traits`/`dossier`，**不建演化管道**。

`core` 的内容（ARCHITECTURE §5.1 L1）：价值观条目、硬边界（不外泄 PII 与联系方式、**不否认自己是 AI**、不参与违法内容）、语体不变量。`core` 在 Phase 1 就应该有 DB 层兜底：新版本的 `core` 必须等于 parent 的 `core`（触发器），否则 raise——现在建这条触发器几乎零成本，Phase 4 再建要面对已有数据。

人设受 COMPLY-08 约束（不得指向现实亲属或特定真人）。Phase 1 无自建角色（CHAT-08 在 Phase 2+），故 COMPLY-08 的执行面是**种子数据审核 + 规则先落**：把审核规则写成一个纯函数 + 对 3 个种子角色的 L4 断言，Phase 2 接自建角色时直接复用。

### 12.5 append-only 审计表族（D-06）

`safety_event` · `consent_event` · `privacy_action` · `llm_call` · `client_error` · `exit_intent` · `dependency_signal`

分类型建表、同库、append-only。执行手段是 PG 权限（`REVOKE UPDATE, DELETE ... FROM app_role`），删除 worker 用独立 role。后续阶段的 `persona_evidence` / `disclosure_decision` 沿用同一模式。**合表需数据迁移且会破坏已写的断言 → 不可逆，现在分对了就一直对。**

### 12.6 前端异常上报（D-28）

`apps/api` 开 `POST /telemetry/error`；`apps/web` 全局 error boundary + `unhandledrejection` 上报到 `client_error`（同库、append-only、登记进 `STORAGE_LOCATIONS`）。

理由：UI-SPEC 把「错误态与空态必须可区分、不得静默渲染成空列表」列为契约，**没有上报就无法知道它是否被违反**。明确否决 Sentry 等第三方云——breadcrumb 极易携带用户消息片段，是一条隐蔽出境路径，性质同 Langfuse Cloud。

⚠️ `/telemetry/error` 是一个**未认证或弱认证的写入端点**，要防被刷：限流 + 载荷大小上限 + 只接受白名单字段（不接受任意 jsonb 原样存）。载荷字段白名单同时是"不把消息正文带进 `client_error`"的保证。

---

## 13. UI 实现要点（UI-SPEC 的不可协商项摘录）

给 executor 的清单——这些在 UI-SPEC 里标〔法定〕或是硬约束，**不得以"视觉更干净"调整**：

- **shadcn 两步预设**，先按 STACK §13 建 `apps/web` 锁定版本，再在其中 `init`；**不得用 `--template next`**，`--no-monorepo`（monorepo 由 pnpm workspace 承担）
- `BubbleContent` 默认 `text-sm px-3 py-2` → **必须覆写为 `text-base`**（16px），padding 保持 12px/8px
- 关怀卡片**必须用 `Alert` 而非 `Bubble`** —— 组件层的区分让"伪装成角色发言"在代码层不可能发生（R1.24）
- 关怀卡片**不得用 `sonner`**；`sonner` 不用于任何法定告知（toast 会自动消失，不可承担告知义务）
- 一键删除/撤回同意用 `alert-dialog`（焦点陷阱、初始焦点在取消按钮），不用 `dialog`
- AI-label 三色（面 `#D8E0EA` / 描边 `#64748B` 1px / 文字 `#334155`）是**独立 token**，不得引用 Border/Neutral
- Care 是暖琥珀（面 `#FFFBEB` / 描边 `#FDE68A` / 文字 `#92400E`），**不是红色**——红色在自残语境下带斥责感，会降低危机可检出率
- 两级危机卡片**同色不同版式**（布局/可关闭性/内容承担差异，不靠色相）
- 二级卡片唯一确认按钮文案「**我看到这些帮助方式了**」，**不得**替换为「我知道了」「确定」
- `failed`/`unavailable` 态：援助渠道行**上移为卡片首屏第一行** + 44×44 的 `tel:` 直呼按钮「拨打 12356」
- `pending` 不得以 spinner 为唯一表达；拿到终态**原地替换**，卡片不重排、不滚动、不改变焦点
- 紧急联系人联系方式界面上必须遮蔽（`138****1234`）——它是第三方的个人信息
- 用户气泡（accent 填充）内**不承载任何次级文本**，时间戳在气泡外的 `message` 行布局中
- 占位符不得是说明文字的唯一载体；说明放 `Field` 的 description 行
- 重试控件必须是**图标 + 13px 可见文字「重试」**，`aria-label` = 「重试发送这条消息」，触控区 ≥44×44
- 4 个 icon-only 控件必须带可编程确定的名称（返回/发送/插入表情/更多操作）；**tooltip 不得作为唯一来源**
- 错误文案必须含「下一步做什么」；**唯一豁免**是 `Error state（年龄未满 18 · COMPLY-07）` 这条法定终态拒绝
- 空态与错误态必须可区分，**不得静默渲染成空列表**
- 硬退出系统卡片用 **neutral 色，不用 care 色**（退出不是危机）；禁止任何二次确认/挽留按钮

---

## Validation Architecture

> 本节是 orchestrator 生成 `01-VALIDATION.md` 的输入。Phase 1 的验证难点不是"功能对不对"，而是**5 条成功标准里有 3 条在验证"某类错误不可能发生"**——这类断言的默认状态是空真通过。

### V.0 首要原则：空真断言必须带负向 fixture

**规则**：任何形如"不存在 X"的断言，必须同时交付一个**故意违反它的 fixture**，并断言检查器对该 fixture 失败。

本阶段需要负向 fixture 的断言（**全部 9 条，缺一条即该防线未交付**）：

| # | 断言 | 负向 fixture |
|---|---|---|
| 1 | `GatedText` 不可由外部构造 | `tsc` fixture：传裸 string 给 `deliver`；`as GatedText` |
| 2 | `any` 不能穿过出口 | `no-unsafe-argument` fixture |
| 3 | egress 集合 = 注册表 | 新增一个接受 `GatedText` 的未登记函数 |
| 4 | model 不接受字符串字面量（PLAT-06） | `streamText({ model: 'deepseek/deepseek-flash' })` |
| 5 | provider SDK 不可在 packages/llm 外导入（含动态 import） | `await import('@ai-sdk/openai')` |
| 6 | publication 无 vector/halfvec 列、无裸表名（RES-03） | 假 SQL 各一份 |
| 7 | `layer='l0'` 无向量列（RES-02） | 假 inventory 条目 |
| 8 | 隐私文案无禁用词 **且** 含必需句（PRIV-06） | 含「匿名」的假文案 + 缺必需句的假文案 |
| 9 | publicness 状态变更必须签字（COMPLY-10） | 三个坏样例 |

### V.1 验证层级与职责

| 层 | 工具 | 覆盖 | 何时跑 | 不能覆盖什么 |
|---|---|---|---|---|
| **L1 编译** | `tsc --noEmit` 7.0.2（含负向 type fixture） | brand 类型有效性、`persona.probe` 不可 routed、`SyntheticText` 边界 | 每 PR | 运行时 `any` |
| **L2 Lint** | ESLint flat config（type-aware） | 字符串 model、provider SDK 导入边界（静态+动态）、`as GatedText`、目录级 `setTimeout` 禁令、`no-unsafe-*` | 每 PR，**全仓无 cache** | 配置自身被覆盖 → 见 L4 元测试 |
| **L3 单元** | vitest，纯函数 | 退出词表匹配（≥20 含阴性）、risk 映射与 fail-closed、时长累计算术、依赖阈值边界、导出渲染、COMPLY-08 审核规则 | 每 PR | 跨组件与 DB 的顺序 |
| **L4 契约/注册表** | vitest + 脚本（**大部分无需 DB**） | schema↔`DATA_INVENTORY` 集合相等、`STORAGE_LOCATIONS` 对账、publication 静态扫描、DPA 文件、PIA 章节、publicness 哈希+checklist、禁用词+必需句、egress 哈希、ESLint config 元测试、DISCLOSURE_SURFACES 覆盖 | 每 PR | 真实执行顺序与真实模型行为 |
| **L5 集成** | vitest + 真实 PG 18.6 + mock provider | 完整 turn、CHAT-07 补拉、四态 `contact_attempt`、fail-closed 注入、导出/删除/回执、计时器跨重连与重登录、硬退出零出站、注册事务与邀请码并发 | 每 PR（self-hosted） | 真实分类器的判定质量 |
| **L6 探针** | 真实 `safety.classify`（glm-4.7-flash，免费），temperature=0，N=3 | 危机探针集 ≈78 条 100%；绕过尝试；挽留话术运行时触发率=0 | 每 PR（self-hosted）+ 每夜 | 人的直觉 |
| **L7 人工试玩** | 一位未参与开发的人，无解释 | 成功标准 1 的端到端走通 | 阶段收尾 1 次 | 回归 |

### V.2 采样充分性（Nyquist 论证）

对每个"能悄悄改变"的可观测量，检查频率必须 ≥ 其变化频率的 2 倍。下表是本阶段的采样设计依据：

| 可观测量 | 变化频率 | 所需检查频率 | 机制 | 是否达标 |
|---|---|---|---|---|
| egress 函数集合 | 每 PR（人为） | ≥ 每 PR | L4 集合相等 + egress 哈希 | ✅ |
| ESLint 有效配置 | 每 PR（人为） | ≥ 每 PR | L4 `calculateConfigForFile` 元测试 | ✅ |
| schema 列集合 ↔ 披露文案 | 每 PR（人为） | ≥ 每 PR | L4 双向集合断言 | ✅ |
| `model_snapshot` 实际值 | 厂商侧静默替换，频率未知（≥月级） | 连续（无限过采样） | 每次调用落 `llm_call.resolved_model` + 日 diff 告警 | ✅ |
| 分类器行为（厂商侧基础设施变更） | 厂商侧，不可观测、**厂商书面承认存在** | ≥ 每日 | L6 探针每 PR + 每夜定时 | ✅（Phase 1 无 frozen baseline，只能测"是否仍 100% 通过"，不能归因；归因能力从 Phase 2 起建） |
| `registered_users` | 每次注册（Phase 1 总量 ≤10） | ≥ 每日 | 日对账作业（>2× 事件率） | ✅ |
| publicness 四项状态 | 极低频（人为、重大） | ≥ 每 PR | L4 哈希+checklist | ✅ |
| 导出文件磁盘残留 | 每次导出/删除 | ≥ 每 PR | L5 删后断言目录空 | ✅ |
| pino 日志是否含正文 | 每次改 log 语句 | ≥ 每 PR | L5 抓输出子串断言 | ✅ |
| 挽留话术出现率 | 每次模型输出（高频） | 运行时连续 | 网关运行时确定性检查 + `safety_event` | ✅ |

**明确的欠采样项（Phase 1 接受，须写进 VALIDATION 的"已知盲区"）**：
- **危机漏检率**：只有探针集能测，而探针集是我们自己写的 → 测的是"我们想到的危机表达"。真实漏检需人工抽样复核，10 人体量下只能定性。
- **人格一致性 / 拟真度**：Phase 2 的盲测基线，Phase 1 不测。
- **中文 PII 召回率**：Phase 7（RES-05），Phase 1 不测。
- **保存期清理的真实到期行为**：24 个月 / 6 个月的期限在 Phase 1 内无法自然到达 → 只能用"把 `created_at` 写到过去"的时间旅行测试验证清理作业，并断言作业本身被 `boss.schedule` 注册。

### V.3 五条成功标准 → 可执行断言

**标准 1（人工试玩）** → L7。前置：L5 已覆盖该路径的每一段（否则人工试玩会变成 debug 会议）。产出物：一份走查记录，逐项勾选"注册五项同意 / 角色库 / 加好友 / 10 轮 / 三处 AI 标识 / 导出文件含标识"，并记录"是否需要人解释"。**验收判据是"全程无需人解释"，所以观察者不得回答问题。**

**标准 2（危机探针 100% + 无绕过 + 顺序与模型分离）** →
- L6 探针集 78 条 × N=3 全通过（阴性对照 15 条同样是通过条件）
- L4 SQL 断言：`chat.reply` 早于 `safety.classify`（0 行违反）、两者 `model_snapshot` 不等（0 行违反）
- L1+L2+L4 的 egress 三层（编译 / lint / 注册表集合相等）+ 负向 fixture 1–3、5
- L5 故障注入：分类器抛错 → elevated，且无 `contact_attempt`

**标准 3（三条 CI 防线）** → L4 全部 + 负向 fixture 4、6、7、8。**判据不是"检查存在"，而是"负向 fixture 让检查失败"。**

**标准 4（披露与实际一致 / 撤回即停 / 回执数量 / 删后导出空集）** →
- L4 双向集合断言（schema ↔ inventory）+ §6.5 的"尚未开始收集"态断言
- L5 撤回 `sensitive_pi` 后 `insertMessage` 抛错（ConsentTicket 守卫）+ 该条目从披露列表消失（不是置灰）
- L5 删除回执数量 = `purge` 成功项数（用一个人为让某项失败的注入，断言走 M/N 错误文案）
- L5 删后导出返回空集 **且** 磁盘无残留 **且** `pgboss.job` 无该 userId 载荷

**标准 5（硬退出零出站 / 挽留率 0 / 2 小时提醒 / publicness 门）** →
- L5：排定一个延迟投递 → 硬退出 → 断言 0 条出站；网关对 ended 会话拒绝产出
- L6 + 运行时：挽留词表在出站文本上触发率 = 0（探针集 + 网关断言双覆盖）
- L5：7199s → 一次提醒；跨重连与重登录累计不变；14min 不清零 / 16min 清零；4h 两次
- L4：publicness 三个坏样例各自失败

### V.4 CI job 拓扑与阻断规则

    fast (托管 runner 亦可)  : L1 → L2 → L3 → L4 + 全部负向 fixture     [< 3 min]
    integration (self-hosted): L5 → L6                                   [< 10 min]
    nightly (self-hosted)    : L6 重跑 + model_snapshot diff + 日对账     [定时]

**阻断规则**：
- `fast` 任一失败 → 阻断合并
- `integration` 失败 → 阻断合并；**self-hosted runner 不可用时也阻断，不得 skip**（"探针跑不了就先合"是成功标准 2 的直接反例）
- `nightly` 失败 → IM 告警，不阻断（但 `model_snapshot` 变化必须在下一个 PR 前被人确认）

### V.5 Definition of Done（Phase 1）

除全部 44 条需求的验收外，以下产出物入 repo 方视为完成：
`apps/web/content/legal/privacy.md` + `terms.md`（D-16，用户审定）· `compliance/publicness.json` + 首份 `CHECKLIST-{date}.md`（D-07/08）· `compliance/PIA-2026.md`（D-18/PRIV-09）· `compliance/dpa/{provider}.md` 每家一份含"关闭数据用于模型改进"的配置证据（D-18/PRIV-10）· `compliance/no-unlabeled-output.md`（D-21/COMPLY-11）· `tests/probes/crisis/*.yaml` 版本化探针集（SAFE-15 在 Phase 5 要重跑）· `SKIPPED_CHECKS.md`（登记 RES-03 动态检查的 skip 原因与解除条件）。

---

## Suggested Plan Decomposition（advisory —— granularity: standard）

| # | Plan | 覆盖 | 依赖 | 为什么是这个位置 |
|---|---|---|---|---|
| 1 | **契约修订**（A-01/A-02/A-03 + 新增 SAFE-16） | — | — | UI-SPEC 自定规则：改〔法定〕条目必须先改 REQUIREMENTS.md。不先改，后面全部断言绑到过时契约 |
| 2 | **Tracer slice**（§2.4） | PLAT-01/02/03, CHAT-01/02/03/07, COMPLY-01/09, D-15/D-24 | 1 | walking skeleton；所有后续 plan 都接在这条链路上 |
| 3 | **Model Router 完备 + PLAT-06 防线** | PLAT-03/05/06/07/08, RES-02/03 的静态部分 | 2 | 危机干预需要 `safety.classify` 与 `llm_call.turn_id/purpose`；三条 tripwire 中两条在此 |
| 4 | **危机干预两级 + 安全网关加固** | SAFE-01..05, SAFE-16, 探针集 | 3 | 成功标准 2；必须早于任何"可能冷淡"的行为（Phase 5 疏远的前置） |
| 5 | **注册与同意** | COMPLY-06/07, PRIV-01/02, 邀请码 | 2 | 五项同意的收集时机只有一次；`sensitive_pi` 守卫要早于大量消息落库 |
| 6 | **隐私中心 + 导出 + 删除** | PRIV-03/04/05/06/07/08/11, COMPLY-02 | 5 | `DATA_INVENTORY` 要在表基本齐了之后建才不会反复改；PRIV-06 需要法务文本先在 |
| 7 | **计时与依赖提醒 + 硬退出** | COMPLY-03/04/05, SAFE-14 | 2, 4 | 硬退出的零出站执行点在网关，需 4 先落 |
| 8 | **公开性门 + 合规产出物** | COMPLY-10/11, PRIV-09/10 | 3（DPA 断言要路由表） | 收尾，但 DPA 断言依赖路由表已定稿 |
| 9 | **会话骨架补全 + 人工试玩** | CHAT-04/05/06, IFC-08, 角色库 3 个角色 | 2 | 成功标准 1 的 L7 |

**排序的两条原则**：① 安全措施与服务功能同步部署（第十条第一款，法律上无法分期）——所以 4 在 9 之前；② 不可后补的东西先做（`model_snapshot`、`message.provenance`、五项同意、`persona_version` 三元组）。

---

## Open Questions（需 planner 或用户裁决，均已给出建议答案）

| # | 问题 | 建议答案 | Confidence | 若答错的代价 |
|---|---|---|---|---|
| **Q1** | 审计日志 6 个月留存（COMPLY-11/D-17）与 PRIV-05 一键删除的冲突：删除时审计行怎么办？ | **去标识化而非删行**（删 `user_id` 与全部可识别字段，保留事件计数与时间），并在回执逐项清单里**如实标注**该项为「已去除可识别信息，保留合规所需的事件记录（6 个月）」，而不是记为"已清除" | Medium | 回执说"清除"而实际保留 → 与 D-19 否决软删的理由同性质的虚假陈述 |
| **Q2** | 撤回必选同意项（`basic_service` / `sensitive_pi`）的语义 | 撤回必选项 = 触发账号删除流程，`AlertDialog` 明示"这等于停止服务并删除数据"。**不做成"撤回后继续聊天"的开关** | Medium-High | 否则系统会在无合法性基础的情况下继续处理 |
| **Q3** | RES-03 的动态检查在 Phase 1 无被测对象，静态检查够不够？ | 够，但必须：① publication DDL 是 git 里的唯一真相源；② 裸表名即失败；③ skip 登记进 `SKIPPED_CHECKS.md` 带解除条件 | Medium-High | skip 会在 Phase 7 无人察觉地继续 skip，而那正是第一次复制发生的时刻 |
| **Q4** | `glm-4.7-flash` 的可 pin 性未核实（STACK §15.9 对智谱标 Confidence MEDIUM，未找到带日期快照 ID） | Phase 1 接受 `alias-only`（`safety.classify` 不是 baseline 对照组，不受"禁做 baseline"约束），但**必须在 `PINNABLE` 表里如实标注**，并加一条 `resolved_model` 日 diff 告警 | Medium | 标成 `snapshot` 而实际是别名 → 分类器被静默换掉、探针集通过率变化被归因错 |
| **Q5** | pg-boss 12.34.0 的延迟投递 API 确切形态（`send(..., { startAfter })` vs `sendAfter()`） | 以 `node_modules/pg-boss` 的 `.d.ts` 为准，配一条"排定后 `startAfter` 落在预期窗口"的单元测试 | High（做法）/ Low（形态） | 照抄文档写错 → 10 分钟超时不生效，`pending` 永不终结 |
| **Q6** | IM 告警选企微还是飞书（CONTEXT 留给 planner） | 选**运营者手机上有推送且能被叫醒**的那一个；两者都是 webhook + JSON，`notifyOperator` 接口抽一层即可换 | High | 低——可逆 |
| **Q7** | 二级危机的"重大财产损失"如何判定（第十三条明文，但无量化标准） | 探针集里用**明确表述**（被骗了 X 万 / 赌输了全部积蓄 / 被套走了房款）作为正样本，不做金额阈值推断；模糊表述归 elevated | Medium | 过宽 → 误联络第三方；过窄 → 漏掉法条明文情形 |

**继承的上游未决项**（STATE.md Blockers，Phase 1 相关）：GB 45438-2025 文本类隐式标识的落地形式需向标准原文复核（影响 COMPLY-02/09，Confidence LOW）——Phase 1 的 `[AI]` 前缀 + 文件头元数据块是**显式标识**在文件层的落点；真正的"隐式标识"（文件数据层、不易被用户感知）在纯文本导出上形态不明，建议在 `compliance/PIA-2026.md` 里登记该不确定性与当前做法，公开前复核。

---

## Sources

**本阶段契约与需求（最高优先级）**
- `.planning/phases/01-compliance-safety-chat-skeleton/01-CONTEXT.md` —— D-01..D-28、A-01..A-03、requirement gaps、canonical refs
- `.planning/phases/01-compliance-safety-chat-skeleton/01-UI-SPEC.md` —— 三条〔法定〕呈现契约、Component Inventory、Copywriting Contract、〔禁用〕Banned-term rules、交互契约、视觉锚点
- `.planning/REQUIREMENTS.md` —— 44 条需求原文（PRIV-01 待按 A-03 修订）
- `.planning/ROADMAP.md` / `.planning/PROJECT.md` / `.planning/STATE.md`

**技术栈（版本核实于 2026-09-25）**
- `STACK.md` §1（推荐栈总览与版本）· §2 + 实现陷阱（AI SDK 7 字符串 model → Vercel AI Gateway，PLAT-06 的来源）· §4（单条 WS + DB 为真相源 + 拟真节奏不在传输层）· §6（pg-boss）· §8（app/privacy schema 与研究库约束）· §11（版本兼容矩阵：provider 包与 core 版本不同步、pg-boss 迁移需与 drizzle 分开）· §12（What NOT to Use）· §13（v1 安装清单）· §15.1（Model Router 必落字段 + `no-restricted-imports` 执法）· §15.9（pinnability 显式表 + CallMode + 探针 N×2× + 厂商承认 pin 不足）· §15.10（应用层幂等键判据：重复执行是否改变用户可见状态）· §15.11（嵌入反演 → L0 禁存原文嵌入 + publication 列清单 CI 断言）

**架构**
- `ARCHITECTURE.md` §5.1（三层护栏：core 字段不可写 + DB 触发器兜底；双 LLM 分工；出站扫描）· §5.2（隐私硬边界 vs 人格边界分工；标识是消息管道中间件不是 UI 细节）· §8.1/8.2（研究分层写入路径；10 条坑，第 8/9 条即 RES-02/03）· §8.3（v1 验收标准是管道正确性）· §9（项目结构与 Structure Rationale）· §11.2（一次用户消息的完整时序）· §14（External Services + Internal Boundaries：全体↔Model Router 禁直连；probe 的 routed 应在类型层不可表达）· §17.4（Model Router 必落字段补强：`model_snapshot` 别名静默漂移）· §17.6（事件命名空间与 WS 下行事件共用定义）

**安全**
- `PITFALLS-SAFETY.md` §1.0（办法条款→R1.01..R1.13 映射；框架提醒：承诺与实现不一致＝虚假陈述，测试不过时下线文案而不是等实现追上）· §1.3（最小必需安全架构 R1.20..R1.25：双层检测、会话级风险状态机、人工接管队列、紧急联系人可达性、误报可解释、全量留证）· §1.4（R1.30..R1.39；三档风险表 A/B/C；"抑制退化 ≠ 升级亲密"；挽留触发率恒为 0）· §4.3（建得太晚的东西：出站安全网关必须 P0，后期插入必然漏离线路径）· §4.4（P0 门禁：危机探针集 100% / 硬退出关键词测试 / 无生成路径绕过网关）

**合规与隐私**
- `PITFALLS-COMPLIANCE.md` 结论二（规模三档；个保法无豁免；v1 必做的两个例外）· 结论三（第十六条第四款可能打到全局人格演化）· §1.1（条款→需求映射表，含第十条同步部署、第十二/十三/十六/十八/十九/二十二条）· §1.2（调用已备案模型走地方网信办应用登记的较轻路径）· §1.4（标识办法：显式/隐式标识；四条需求，含"标识不能被人格覆盖"）· §1.5（去标识化≠匿名化 → L0 仍是个人信息；七条需求，含删除级联、四个不得捆绑的同意项、第十九条最短保存期、第五十五条 PIA）· §1.6（三个开放问题：人格演化是否构成训练 / provider 是委托处理 / "公众"下界 → 公开性显式开关）
- `PITFALLS.md` 纲三（最危险的失效类型是静默失效）· "Looks Done But Isn't" Checklist（AI 标识常漏会话列表与导出文件；一键删除常漏向量表与分析中间产物且需"N 处存储"回执；2 小时提醒常做成前端计时；退出关键词常只识别"退出"；危机干预常只有文案没有真实通道）· Recovery Strategies（用户原文误发境外＝HIGH 不可逆，防线必须是 CI 级别；删除未真正级联是承诺问题不是技术问题；危机未识别＝CRITICAL 无技术恢复）
- `FEATURES.md` §1.1 Table Stakes / §10 MVP Definition（v1 ≤10 人的交付边界）
- `SUMMARY.md` §三（v1 不可后补清单）· §五 P0 行 · §六 错误 2（把静默失效当成"出问题会知道"；只建撤不建门）

**外部 API 形态（2026-09-26 于 grep.app 对真实仓库核实）**
- `better-auth/better-auth` —— `user: { additionalFields: { f: { type, required } } }` 与 `account.additionalFields` 的实际形态（`packages/test-utils/src/adapter/suites/auth-flow.ts`、`packages/better-auth/src/db/get-migration.test.ts`）
- `timgit/pg-boss` —— `boss.schedule(queue, cron, data, opts)` / `getSchedules()` / `send(queue, data, { singletonKey })` 去重时返回 `null` / `createQueue(name, { policy })` / `boss.update`（`test/scheduleTest.ts`、`test/queuePolicyTest.ts`、`test/keyStrictFifoTest.ts`）
- ESLint flat config 两个已被真实项目记录的静默失效：**同一规则的 options 是替换而非合并**、**`no-restricted-imports` 看不见 `ImportExpression`**（`THU-MAIC/OpenMAIC/eslint.config.mjs` 的注释与实现）
- branded type 的 `as` 禁令选择器形态 `TSAsExpression[typeAnnotation.type='TSTypeReference'][typeAnnotation.typeName.name=/^X$/]`（`microsoft/vscode/.eslint-plugin-local/code-no-any-casts.ts`、`marktext/marktext/packages/muya/eslint.config.mjs` 及同类实现）
