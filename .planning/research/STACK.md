# Stack Research

**Domain:** AI 社交 / AI 陪伴平台（中文市场，类微信 IM 交互）+ 分层脱敏聊天行为研究管道
**Researched:** 2026-09-25
**Confidence:** HIGH（版本与价格已逐条对官方文档/registry 核实）/ MEDIUM（"哪个模型中文角色扮演更好"无公开权威 benchmark，需自测）

> 本文回答 PROJECT.md 的 **Open Question 4（模型与 provider 策略）** 与 **Open Question 5（技术栈）**，结论见 §10 与 §7。
> 所有版本号均在 2026-09-25 通过 npm registry / PyPI / PGXN / 厂商官方文档核实，未使用训练数据记忆。

---

## 0. 三条决定全局的约束（先读这个）

写在最前面，因为下面每一个选型都由它们推导而来：

1. **产品面向中国用户 → 模型必须走已备案的国内通道。** 截至 2026-08-31，国家网信办累计 1112 款生成式 AI 服务完成备案、731 款「通过 API 调用已备案模型」的应用/功能完成地方网信办登记（来源：[cac.gov.cn 2026-07-10 公告](https://www.cac.gov.cn/2026-07/10/c_1785427810632554.htm)、[2026 年 7–8 月备案公告](https://cloud.tencent.com/developer/article/2746205)）。合规路径是明确的：**调用国内已备案模型 + 自己做应用登记**。Anthropic / OpenAI / Google 无法进入这条链路。
   → **推论：v1（10 人内部）可以用任何模型探效果上限，但架构里模型必须是可替换的插槽，且「未来公开上线路径」上的默认模型必须是国内的。**
2. **v1 ≤ 10 人 → 任何以「可扩展性」为理由的组件都是负债。** 不引入 Kafka / ClickHouse / Milvus / K8s / 独立向量库 / 托管实时服务。单 Postgres + 单 Node 进程能撑到几千人。
3. **隐私是硬约束且是产品功能（隐私中心、一键删除级联）→ 数据不能出境，且真相源必须在自己的 Postgres 里。** 这一条直接否掉了 OpenRouter、Vercel AI Gateway、Clerk/Auth0、Braintrust、Zep Cloud、Mem0 Cloud、Pusher/Ably。

---

## 1. 推荐栈总览

### Core Technologies

| Technology | Version (核实于 2026-09-25) | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Node.js** | **24.21.0 LTS (Krypton)** | 运行时 | Active LTS（26.10.0 是 current，非 LTS）。[nodejs.org/dist/index.json](https://nodejs.org/dist/index.json) |
| **pnpm** | **12.6.0** | 包管理 | 用户既有约定；workspace 是本项目单仓多包的前提 |
| **TypeScript** | **7.0.2** | 语言 | 已进入 7.x。跨端共享契约类型是本栈最大杠杆 |
| **PostgreSQL** | **18.6** | 唯一 OLTP + 向量库 + 任务队列 | 受支持主版本 14–18，18 为最新（[postgresql.org/versions.json](https://www.postgresql.org/versions.json)）。一个库同时吃下关系数据、向量检索、任务队列 → 「夜间反思」能在**单个事务**里读写人格快照，不产生半更新人格 |
| **pgvector** | **0.8.6** (2026-07-29) | 向量检索 | 支持 PG 13+；0.8.0 起有 iterative index scan（解决过滤后召回不足）；支持 halfvec/binary/sparse 与 L1/Hamming/Jaccard 距离。[PGXN](https://pgxn.org/dist/vector/) ⚠️ 必须 ≥0.8.2：该版修复了并行 HNSW 构建的缓冲区溢出 CVE-2026-3172。**列类型定为 `halfvec(1024)` + HNSW 余弦（`halfvec_cosine_ops`）**，与 ARCHITECTURE.md §1.2 一致；1024 是 qwen3.7-text-embedding 的默认维度，halfvec 相比 vector 省一半存储且召回损失可忽略。⚠️ **pgvector 列维度是固定的** → 换嵌入模型不是改一个版本字符串就行，见 §15.2 |
| **Drizzle ORM** | **0.45.3** | 数据访问 | SQL-first，能直接写 pgvector 算子、窗口函数、自定义打分表达式 —— 遗忘曲线的核心就是一个自定义 ORDER BY 表达式，ORM 不能挡路。Prisma 8 仍是 8.0.0-rc.17，不用 |
| **Hono** | **4.13.9** | API 服务（REST + WS + worker 宿主） | 轻、Web 标准（Request/Response）、可跑在裸 Node 长驻进程上。API 优先约束要求 API 是独立单元，不是 Next.js 的附属品 |
| **ws** | **8.21.3** | WebSocket 传输 | 裸协议 + 自定义 JSON envelope，未来 Swift/Kotlin 客户端可直接复用。见 §4 |
| **Next.js** | **16.3.6** | Web 前端（类微信 UI） | React 19.3.0 配套；App Router + RSC 做会话列表 SSR。**只做 UI**，不承载 WS 与任务 |
| **React** | **19.3.0** | UI | Next 16 配套版本 |
| **Vercel AI SDK (ai)** | **7.0.114** | LLM 统一层 | 当前主版本 7.0（[migration guides](https://ai-sdk.dev/docs/migration-guides) 最新条目为 "6.x → 7.0"）。是**库不是服务** → 零额外网络跳数、零境外依赖。见 §2 |
| **pg-boss** | **12.34.0** | 任务队列 + cron | Postgres 原生队列。「夜间反思」「角色生活事件调度」「拟真回复延迟」「删除队列」四类任务都需要与业务数据同事务。见 §6 |
| **Langfuse (self-hosted)** | **v4**（JS SDK langfuse 3.39.2 / Py 4.15.6） | Trace / prompt 版本 / 数据集实验 / LLM-as-judge | OSS 可自托管 → 对话原文不出境；基于 OpenTelemetry；原生有 **sessions**（多轮会话）与 **users** 维度，正好对应「一个用户 × 一个角色」的长期关系。依赖 Postgres + ClickHouse + Redis + S3（[self-hosting 文档](https://langfuse.com/self-hosting)） |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | **4.6.5** | 契约 schema | packages/contract 里定义 WS 消息 envelope、LLM 结构化输出 schema、API DTO。一份 schema 三处复用 |
| @ai-sdk/anthropic | **4.0.63** | Anthropic 协议 provider | 用于 Claude **以及**所有提供 Anthropic 兼容端点的国内厂商（DeepSeek /anthropic、MiniMax、qwen3.8-flash） |
| @ai-sdk/openai / @ai-sdk/openai-compatible | **4.0.75** | OpenAI 协议 provider | 国内厂商主通道（百炼 / 火山方舟 / 智谱 / Kimi 全部 OpenAI 兼容） |
| @ai-sdk/deepseek | **3.0.52** | DeepSeek 官方 provider | 夜间反思批量任务 |
| better-auth | **1.7.6** | 认证 | 自托管、schema 落在**你自己的** Postgres → 「一键导出 / 一键删除」能级联到账号表。不要 Clerk/Auth0（PII 出境） |
| web-push | **3.6.7** | Web Push（VAPID） | 自建推送，无第三方。**但见 §5：不要把主触达押在它上面** |
| pino | latest | 结构化日志 | 研究查询审计日志需要结构化落库 + 落文件双写 |
| croner | **10.0.1** | 进程内定时 | ⚠️ 仅本地开发，生产用 pg-boss 的 schedule |
| duckdb (Python) | **1.5.5** | 研究侧分析 | 读研究库导出的 parquet，在 notebook 里做分布统计。不需要服务化 |
| polars (Python) | **1.44.2** | 研究侧分析 | 同上 |
| promptfoo | **0.123.1** | CI 红队 / 回归断言 | 断言「三层人格护栏不可被越狱」「PII 不跨用户外溢」。见 §9 |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Vite **8.3.1** | 独立子应用构建 | 主应用用 Next 自带构建；此项仅用于竞技场/管理后台等独立子应用 |
| Tailwind CSS **4.3.3** | 样式 | 类微信 UI 是高密度列表 + 气泡，utility-first 合适 |
| Docker Compose | 本地 Postgres 18 + pgvector + Langfuse | 镜像 pgvector/pgvector:pg18 |
| drizzle-kit | 迁移 | 研究库 schema 必须独立迁移目录（app vs research） |

---

## 2. 多 provider 抽象层 —— 结论：AI SDK 7 + 自写一张路由表

### 结论（Confidence: HIGH）

> **用 ai@7.0.114 做类型与流式的统一层，provider 一律显式实例化直连厂商 endpoint，禁用 AI Gateway；在其上加一层薄薄的 packages/llm（目标 < 300 行），只做「语义角色 → 模型」映射、降级链、记账、厂商特有参数白名单透传。**

### WHY

1. **抽象层的真实工作量比想象小。** 已核实：国内厂商现在普遍**同时**提供 OpenAI 兼容与 Anthropic 兼容端点 ——
   - DeepSeek：https://api.deepseek.com（OpenAI 格式）与 https://api.deepseek.com/anthropic（Anthropic 格式）并列列在[官方定价页](https://api-docs.deepseek.com/quick_start/pricing)
   - qwen3.8-flash：官方称"兼容 OpenAI 与 Anthropic 主流接口协议"（[阿里云文档](https://help.aliyun.com/zh/model-studio/text-generation-model)）
   - MiniMax：文本 API 参考页路径即 text-anthropic-api（[MiniMax 模型文档](https://platform.minimax.ac.cn/docs/guides/models-intro)）
   - 火山方舟 / 智谱 / Kimi：OpenAI 兼容
   → 所以**真正需要抽象的不是 chat completion，而是非标准扩展**：thinking 开关（enable_thinking vs reasoning.effort）、显式/隐式缓存参数、**前缀续写（chat prefix completion）**、缓存 TTL 档位。这些无法被任何通用框架抹平，只能白名单透传 —— 这恰好就是「自己写一层薄的」擅长的事。
2. **AI SDK 是 TS 栈里唯一把 Core（streamText / generateObject / tool calling）与 UI（流协议 + useChat）一体化做好的选择**，而本项目 100% 需要 UI 流式。
3. **它是库，不是代理服务** → 不增加一跳网络、不增加一个要运维的进程、不让对话原文离开你的 VPC。

### ⚠️ 具体实现陷阱（必须写进代码规范）

AI SDK 7 的文档首例是 `model: "spacexai/grok-4.7"` 这种字符串形式 —— **这会默认路由到 Vercel AI Gateway**（境外中转）。本项目必须**永远传 provider 实例**，不传裸字符串：

```ts
// ❌ 会走 Vercel AI Gateway（境外、无法备案）
streamText({ model: "deepseek/deepseek-flash", ... })

// ✅ 直连厂商 endpoint
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
const ark = createOpenAICompatible({
  name: "ark",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  apiKey: process.env.ARK_API_KEY,
});
streamText({ model: ark("doubao-seed-character-251128"), ... })
```

建议在 ESLint 里加一条规则：禁止给 model 参数传字符串字面量。

### 评估过的替代方案

| 方案 | 结论 | 理由 |
|------|------|------|
| **LiteLLM** (Python 1.102.1) | ❌ 不用（除非后端是 Python） | 价值在「统一网关 + 预算/限流 + 100+ provider」，代价是给 TS 栈引入一个 Python 服务 + 一跳网络 + 一个要运维的进程。10 人体量下纯负债。**若 OQ5 最终选 Python 后端，LiteLLM 就是正解** |
| **LangChain 1.5.12 / LangGraph 1.4.18** | ❌ 不用 | 本项目的编排复杂度**不在 LLM 调用图上**，而在领域状态机（人格演化、关系状态、记忆重固化）。这些状态必须落 Postgres、可审计、可回滚快照 —— PROJECT.md 的「三层护栏 + 定期人格快照可回滚」就是这个要求。LangGraph 的 checkpointer 会把状态语义搬进框架，正好拿走你最需要控制的东西。概念税远大于收益 |
| **OpenRouter** | ❌ 不用 | 境外中转：延迟不可控、数据出境、无法备案。它解决的「一个 key 用所有模型」问题在国内只需 3 个 key 就覆盖 —— 因为百炼和火山方舟自己就在**代理**第三方模型（已核实：百炼上架 deepseek-v4-pro / glm-5.2 / kimi-k2.7-code / MiniMax-M3；火山方舟上架 glm-5.3-flash / glm-5.2 / deepseek-v4 系列）。**这是国内独有的杠杆：百炼/方舟本身就是合规的 OpenRouter。** |
| **Vercel AI Gateway** | ❌ 不用 | 同上 |
| **纯手写 fetch adapter** | ➖ 不够 | 省不了多少（各家都 OpenAI 兼容），但会丢掉 AI SDK 的 UI 流协议、tool calling 类型、generateObject 的 schema 修复重试。不值得 |

---

## 3. 记忆与检索 —— 结论：pgvector 自建，遗忘曲线绝不外包

### 结论（Confidence: HIGH）

> **pgvector 0.8.6 存储在主 Postgres 18 里，召回打分函数、衰减、重固化（记错）全部自己实现。Mem0 / Zep / Letta 作为设计参考读，不作为依赖引入。**

### WHY —— 遗忘曲线是产品的核心机制，不是基础设施细节

PROJECT.md 写的是「记忆会衰减、**会记错**」。「记错」意味着需要**主动改写记忆内容**（reconsolidation），而不只是降低检索权重。任何托管记忆服务都只提供后者。

召回打分需要形如（这是要落到 SQL 里的一等公民）：

```sql
-- 阶段 1：HNSW ANN 粗召回（过滤后召回不足用 iterative scan 兜住）
SET LOCAL hnsw.iterative_scan = relaxed_order;
WITH cand AS MATERIALIZED (
  SELECT id, content, salience, last_recalled_at, recall_count, created_at,
         embedding <=> :query_vec AS dist
  FROM memories
  WHERE character_id = :cid AND NOT tombstoned
  ORDER BY dist LIMIT 200
)
-- 阶段 2：遗忘曲线二次打分（这一段是产品逻辑，必须在我们手里）
SELECT *, (1 - dist)
     * exp( - extract(epoch from now() - last_recalled_at)
             / (halflife_base * (1 + salience * k)) )   -- 显著性拉长半衰期
     * (1 + ln(1 + recall_count))                       -- 每次被想起就更牢（间隔重复）
     AS recall_score
FROM cand ORDER BY recall_score DESC LIMIT 12;
```

pgvector 对此毫无阻碍：ANN 索引只负责粗召回，ORDER BY 可以是任意表达式，relaxed_order + materialized CTE 是官方推荐的「过滤 + 严格排序」组合（[pgvector README](https://pgxn.org/dist/vector/)）。

### 各方案对比

| 方案 | 版本 | 对 decay / salience 打分的支持 | 结论 |
|------|------|-------------------------------|------|
| **pgvector** | **0.8.6** | ✅ 完全自由。ANN 粗召回 + SQL 任意二次打分；hnsw.iterative_scan（0.8.0+）解决按 character_id / user_id 过滤后召回不足；halfvec 省一半存储 | ✅ **采用** |
| Qdrant | server 最新（@qdrant/js-client-rest **1.19.0**、qdrant-client **1.19.1**） | ✅ 支持 payload 参与打分/公式查询 | ➖ 能做，但多一套存储 = 记忆与关系数据跨库无事务。「夜间反思」要在一个事务里改人格 + 改记忆，跨库就要写补偿逻辑。**10 人体量为此付代价不值** |
| Milvus | pymilvus **3.0.2** | ✅ | ❌ 分布式向量库。10 人规模引入它是自伤 |
| **Mem0** | npm mem0ai **3.3.0** / py **2.2.0** | ⚠️ 有官方 **Memory Decay**：per-project recency re-rank，近期记忆最高 1.5× boost，闲置的降权（[Mem0 blog 2026-05-13](https://mem0.ai/blog/memory-decay-for-long-running-agents-how-recency-aware-ranking-fixes-retrieval-staleness)） | ❌ **衰减策略是它的，不是你的**。1.5× recency boost 是为了「修 RAG staleness」，不是「模拟人类遗忘」。且不支持 reconsolidation（记错） |
| **Zep / Graphiti** | zep-cloud **3.30.0** | ⚠️ **bi-temporal 知识图**：同时记录事实发生时间与摄入时间；新事实与旧事实冲突时给旧边打 invalid_at 而**不删除**；检索用 cosine + BM25 + BFS 图遍历，再 RRF/MMR/cross-encoder 重排（[架构解读](https://signals.aktagon.com/articles/2026/07/zep-a-temporal-knowledge-graph-architecture-for-agent-memory)） | ❌ 作为**设计参考极有价值**（「保留历史 + 标记失效」正是人格快照回滚需要的语义），但产品形态是托管服务 + 独立图存储。**强烈建议借鉴 bi-temporal + edge invalidation 建模，自己在 Postgres 里实现** |
| **Letta (MemGPT)** | letta **0.33.1** / @letta-ai/letta-client **1.12.1** | ⚠️ **Sleep-time Compute**：后台 agent 在用户不交互时扫描对话、提炼要点、异步更新 core memory —— 与 PROJECT.md 的「夜间反思」概念同构 | ❌ 它把 agent 状态托管在自己的 server 里。「全局人格」是本项目最核心的资产，必须我们持有、可快照、可回滚。**借鉴 sleep-time compute 的分层（core / archival memory + 异步整合），不引入依赖** |
| VectorChord | — | 磁盘优先架构，官方宣称大规模下远快于 pgvector（[对比文章](https://blog.51cto.com/u_12641824/14565737)） | ➖ **规模问题出现后再换**。它是 PG 扩展，迁移成本低，现在换只是给自己找罕见 bug |

### 记忆分层设计（借鉴 Letta + Zep，自己实现）

| 层 | 存储 | 更新时机 |
|----|------|----------|
| 短期状态（心情/精力/忙碌度） | characters.state JSONB | 实时，每轮对话后 |
| 情节记忆 episodes | memories 表 + vector | 写入即存原文（非损耗底座，对应 Graphiti 的 Episodes） |
| 语义事实 facts | facts 表，带 valid_at / invalid_at 双时间戳 | 夜间反思抽取；冲突时标 invalid_at 不删（Graphiti 语义） |
| 长期人格 | persona_snapshots 表，append-only | 夜间反思批量整合 + 重大事件触发；**append-only 即天然可回滚** |

---

## 4. 实时传输 —— 结论：单条 WebSocket 承载全部，DB 是真相源

### 结论（Confidence: HIGH）

> **ws@8.21.3 裸 WebSocket，一个连接承载所有实时语义（token 流、打字中、已读回执、在线态、AI 主动消息）。消息持久化在 Postgres，WS 只是投递层；客户端用游标补偿断线期间的消息。不用 socket.io，不用托管实时服务。**

### WHY

| 需求 | SSE 能做吗 | 结论 |
|------|-----------|------|
| AI 回复 token 流 | ✅ | SSE 够 |
| 用户「正在输入」上行 | ❌ 单向下行 | 需要上行；用 HTTP POST 每次多一轮 RTT 且难做去抖 |
| 已读回执上行 | ❌ | 同上 |
| 在线态 / 应用层心跳 | ❌ | SSE 无双向心跳，只能靠断流探测 |
| **AI 主动发消息（用户在线但未发言）** | ➖ 要长期挂一条 SSE | 一个会话一条 HTTP 连接；打开 5 个会话就 5 条连接 |

→ 需要上行 + 需要服务端无请求主动推 + 需要复用一条连接 = **WebSocket**。这不是偏好，是需求推导。

### 为什么不用 socket.io（4.8.3）

- 它的核心价值是 **多进程 adapter + 传输降级**。v1 单进程，两者都不需要。
- 它是**私有协议**：未来原生 App 阶段要在 Swift/Kotlin 引入 socket.io 客户端。而裸 WS + 自定义 JSON envelope（用 Zod 定义在 packages/contract）任何平台都能十行实现 —— 这直接服务于 PROJECT.md 的「API 优先，为 App 预留」。
- 当真的需要多进程时，用 Postgres LISTEN/NOTIFY 或加 Redis pub/sub，比换掉 socket.io 简单。

### 关键设计约束（比选哪个库更重要）

1. **WS 不可靠，DB 可靠。** 所有消息先落 messages 表拿到单调递增 seq，再投递。客户端重连时用 `GET /conversations/:id/messages?after_seq=N` 补齐。→ 这同时解决了「AI 主动消息在用户离线时抵达」：**离线不用推，上线时补拉**。
2. **「拟真回复节奏」不在传输层实现。** 回复延迟 / 打字中 / 已读不回是**调度状态机**（pg-boss 延迟任务），传输层只忠实投递事件。否则延迟逻辑会散落在 WS handler 里无法测试。
3. **明确不用托管实时服务**（Pusher / Ably / PartyKit 0.0.115 / Supabase Realtime / Electric）：境外延迟 + 把消息投递真相源放到外部，与「离线补偿 + 一键删除」语义冲突。

---

## 5. Web Push —— 结论：技术上可做，但 v1 不要把「AI 主动找你」押在它上面

### 结论（Confidence: HIGH 对技术事实 / MEDIUM 对国内浏览器覆盖率细节）

> **用 web-push@3.6.7 + 自建 VAPID。但把它定位为 iOS-PWA 与桌面浏览器上的加分项，v1 的主触达是「站内未读 + WS 在线投递 + 上线补拉 + 标签页标题/favicon 角标」。**

### 硬事实

| 事实 | 来源 |
|------|------|
| Push API 已是 Baseline "widely available"，自 2023-03 起跨浏览器可用 | [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) |
| **每个浏览器的推送服务不可更换**：Chrome→Google FCM、Firefox→Mozilla autopush、Safari→APNs | 同上 |
| **Chrome 的推送要求浏览器能访问 Google 推送服务** → 中国大陆网络下不可达 | [web-push 实践项目说明](https://github.com/magiccode1412/web-push) |
| **Edge for Android 虽声称支持 Push API，但返回 permanently-removed.invalid 的无效 endpoint** | 同上 |
| iOS/iPadOS Safari 自 16.4 起支持 Web Push，但**必须先「添加到主屏幕」安装为 PWA**，且权限请求必须由用户手势触发 | [WebKit Features in Safari 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)、[Apple: Sending web push notifications](https://developer.apple.com/documentation/usernotifications/sending_web_push_notifications_in_web_apps_and_browsers) |
| 国内 Android 设备普遍无 GMS + 厂商深度休眠 → FCM 类长连接推送不可靠 | [国内安卓 FCM 不可达原因分析](https://ask.csdn.net/questions/9572789) |
| Firefox 对非通知类 push 有配额限制，Chrome 无 | [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) |
| push endpoint 是 capability URL，泄露即可被第三方向你的用户推送（MDN 明确警告） | 同上 |

### 因此的产品级结论（这条要交给 roadmap）

**「AI 主动发起对话」这个核心真实感机制，在 v1 的 Web 形态下无法靠推送可靠送达国内 Android 用户。** 唯一较可靠的国内 Web Push 通道是 **iOS Safari PWA（APNs 在国内可达）**。

→ v1 应该：
1. 把 AI 主动消息的价值兑现在**「回来时看到未读」**上，而非「实时被打扰」—— 这恰好也更像真人（微信消息也不是每条都弹）。
2. 引导 iOS 用户「添加到主屏幕」（顺带解决全屏沉浸感）。manifest 需 display: standalone + 图标；Service Worker 处理 push 事件后调 showNotification()。
3. **不要**为了推送覆盖率去接第三方推送 SDK（JPush/个推）—— 它们是原生 SDK，Web 端同样受制于浏览器推送服务，且引入 PII 出境风险。
4. 真正的触达能力属于 App 阶段（厂商推送通道），这与 PROJECT.md 已有的范围划分一致。**但需要把「v1 触达能力天花板低」明确写进假设，否则会误判「用户不回来」的原因。**

### 不要用

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| OneSignal / 直连 Firebase Cloud Messaging | 境外服务；FCM 国内不可达；订阅 endpoint 与用户标识出境 | 自建 web-push + VAPID |
| 推送正文里带对话内容 | endpoint 泄露即被滥用；内容出境经过 FCM/APNs | 推送只带「有 N 条新消息」，内容靠上线后拉取 |

---

## 6. 定时/后台任务 —— 结论：pg-boss

### 结论（Confidence: HIGH）

> **pg-boss@12.34.0。夜间反思、角色生活事件调度、拟真回复延迟、删除队列四类任务全部走它。**

### WHY

1. **同事务性是决定性因素。** 「夜间反思」要读全量对话增量 → 调 LLM → 写 persona_snapshots → 更新 characters.state → 标记已处理水位。这必须**原子**，否则会产生「半更新的人格」—— 而人格是全局共享的，半更新会污染所有用户。pg-boss 的任务状态就在同一个 Postgres 里，可以和业务写入同一事务提交。
2. **不引入 Redis。** v1 里唯一需要 Redis 的场景是 socket.io adapter（不用）和 BullMQ（不用）。少一个有状态组件 = 少一类运维事故。
3. **cron 与延迟任务都有**：schedule() 做 cron（夜间反思 / 生活事件生成），sendAfter() 做延迟（拟真回复延迟、已读不回后的「过一会儿才回」）。
4. **可观测**：任务表就是普通表，能直接 SQL 查「昨晚反思为什么没跑」。

### 对比

| 方案 | 版本 | 结论 |
|------|------|------|
| **pg-boss** | **12.34.0** | ✅ 采用 |
| BullMQ | **6.3.8** | ➖ 更快、功能更全（flow / rate-limit），但需 Redis 且与 Postgres 跨存储无事务。**吞吐成为瓶颈时再换**（10 人体量不会） |
| graphile-worker | **0.18.0** | ➖ 同为 Postgres 队列，更轻、延迟更低（LISTEN/NOTIFY）。**cron 能力弱于 pg-boss**，而本项目 cron 是一等需求。次优选择 |
| Inngest **4.21.0** / Trigger.dev **4.6.4** | — | ❌ 托管（境外）。事件与任务定义出境；且其价值（durable workflow）在这里可被「状态落表 + 幂等 worker」替代 |
| croner **10.0.1** / node-cron | — | ❌ 进程内定时器：重启丢任务、无重试、无幂等、无可观测。**仅限本地开发** |
| Celery **5.6.3** / APScheduler **3.11.3** / TaskIQ **0.12.6** | — | ➖ 仅当后端是 Python 时考虑（Celery 需 broker；APScheduler 无持久重试语义） |

---

## 7. Open Question 5 的答案 —— Web/后端框架与语言

### 结论（Confidence: HIGH）

> **TS 全栈（单 pnpm workspace，两个可部署单元）。Python 只以「离线分析脚本 / notebook」形态存在，v1 不拆分析服务。**

```
drift/                          # pnpm workspace, packageManager: pnpm@12.6.0
├─ apps/
│  ├─ web/          Next.js 16.3.6 + React 19.3.0 + Tailwind 4.3.3   # 只做 UI
│  └─ api/          Hono 4.13.9 on Node 24.21 LTS                     # REST + WS + pg-boss worker（v1 同进程）
├─ packages/
│  ├─ contract/     Zod 4.6.5          # WS envelope / API DTO / LLM 结构化输出 schema（三处复用）
│  ├─ db/           Drizzle 0.45.3     # app schema + research schema 双迁移目录
│  ├─ llm/          ai 7.0.114 封装    # 语义角色→模型映射、降级链、记账、厂商参数白名单（<300 行）
│  ├─ persona/      人格演化状态机      # 纯函数 + Postgres 持久化，无框架
│  ├─ statdiff/     分布比较（KS / bootstrap CI）  # 人格漂移判定与研究侧语料分布对比共用同一实现
│  └─ memory/       pgvector 召回/衰减/重固化
└─ research/        Python (uv) + DuckDB 1.5.5 + Polars 1.44.2        # notebook + 批处理脚本，非服务
```

### WHY（逐条回应三个候选）

**为什么不是「Python 后端 + React」：**
- 本项目的**实时侧复杂度远高于分析侧复杂度**。要做的是：WS 长连接 + 打字指示器 + 已读回执 + 在线态 + token 流 + 延迟投递状态机。这些在 TS 里是主流路径（ws + AI SDK 的 UI 流协议 + useChat 一条龙），在 Python 里要自己拼 FastAPI 0.141.1 + WebSocket + 手写 SSE 协议 + 前端再手写流解析。
- 前后端契约会分裂成两套（Pydantic + TS 类型），而本项目的契约特别多（WS 事件类型、LLM 结构化输出 schema、研究数据 L0 特征 schema）。
- v1 ≤ 10 人，**分析侧根本不需要在线服务**。

**为什么不是「TS 聊天服务 + Python AI/分析服务」：**
- 拆分的收益（Python 的 sklearn / statsmodels / pandas 生态）在 10 人体量下**为零** —— 10 人产不出统计结论，PROJECT.md 自己也写了「v1 的研究目标是把管道和指标建好」。
- 拆分的成本是**立即且固定**的：两套部署、两套依赖管理、schema 双写、跨服务调用与鉴权、本地开发要起两个栈。
- 分析工作的**真实形态是批处理**：读只读副本 → 算分布 → 出图。这是一条 uv run 脚本或一个 notebook，**不需要变成 service**。服务化是把「我要跑个脚本」误当成「我要个 API」。
- **升级路径清晰且便宜**：当 L1/L2 人工标注工具 + 统计检验成为常态工作流时，再拆出 Python 分析服务 —— 它**只读 replica、不写主库**，所以拆分时不需要动任何业务代码。这是「推后决策几乎无成本」的典型，符合避免过度设计原则。

**为什么 Next.js 与 API 拆成两个单元（而不是全塞 Next.js route handlers）：**
- PROJECT.md 硬约束是「架构 API 优先，为 App 预留」。API 必须能被非 Web 客户端消费，不能是 Next.js 的内部实现细节。
- WebSocket 需要长驻进程。Next.js route handler 在 serverless/edge 形态下无法维持长连接。
- pg-boss worker 需要常驻。放 Next.js 里会随请求生命周期被回收。

### 唯一会让我改主意的条件

如果团队里**没有人写过 TS 但有人是资深 Python 工程师**，则翻转为「FastAPI 0.141.1 + uvicorn 0.54.0 + LiteLLM 1.102.1 + Celery 5.6.3 + SQLAlchemy 2.1.0 + pgvector(py) 0.5.0 + React 19.3」。语言熟练度在 10 人产品的验证期胜过生态匹配度。代价是实时聊天部分要显著多花时间，且契约分两套。

---

## 8. 数据库与研究数据存储

### 结论（Confidence: HIGH）

**主库（OLTP）：PostgreSQL 18.6 + pgvector 0.8.6，单实例。** Schema 划分：

| Schema | 内容 | 访问者 |
|--------|------|--------|
| app | 用户、会话、消息、角色、人格快照、记忆、facts、pg-boss 任务表 | API 服务（读写） |
| privacy | 授权记录（L0/L1/L2 分层同意、逐会话确认）、导出任务、删除队列 | API 服务（读写），**独立审计** |

**研究库：独立物理 Postgres 实例，通过逻辑复制（publication / subscription）订阅主库白名单表 → 天然只读。**

这里的关键不是选型，而是**满足约束的具体结构**：

| 约束（来自 PROJECT.md） | 具体落地 |
|----|----------|
| 研究库为**只读副本** | 逻辑复制订阅端；分析 role 只有 SELECT；default_transaction_read_only = on |
| **研究 ID 与账号 ID 分表映射，映射表单独加密** | research.subject_map(research_id uuid pk, account_ref bytea)：account_ref 用 **envelope encryption**（密钥在 KMS / 独立 secret，不在 DB 里）。该表**不参与逻辑复制**，由删除 worker 单独持有解密权限。分析 role 对它 REVOKE ALL → 分析者物理上无法反查真人 |
| 研究库**不含联系方式** | 复制 publication 用**列级白名单**（PG 15+ 支持 ALTER PUBLICATION ... ADD TABLE 时指定列清单）→ **PII 在复制层就不存在**，而不是复制后再删 |
| **PII 检测在写入管道内，而非事后** | 消息写入路径上同步跑检测器，结果落 app.messages.pii_flags；L1 原文写研究库前必须 pii_flags 为空或已脱敏。见下方 ⚠️ |
| L0 / L1 / L2 分层 | 同一 research 库内三组表 + 行级 consent_level；**L2 额外要求逐会话 privacy.sample_consents 记录存在**，用 RLS 强制 |
| 一键删除**级联到研究库**，走删除队列 | privacy.deletion_queue → pg-boss worker：① 主库软删→硬删；② 研究库按 research_id 删 L1/L2；③ L0 已完全去标识的聚合特征按隐私政策声明保留或一并删（**需产品决策，写进隐私中心文案**）；④ 删 subject_map 行；⑤ 写审计 |
| 所有研究查询留**审计日志** | 分析访问统一走受审计的查询入口（视图 + SECURITY DEFINER 函数记录 research.audit_log），并开 pgaudit。禁止分析者直连 |

⚠️ **PII 检测的中文现实（Confidence: MEDIUM，需专项验证）**：presidio-analyzer **2.2.364** 是主流开源 PII 检测器，但其识别器与 NLP 管道以英文为中心。中文场景（手机号 / 身份证 / 微信号 / QQ 号 / 地址 / 人名）需要**自建正则 + 词典 + 一个轻量 LLM 兜底分类**（推荐 glm-4.7-flash 免费档或 doubao-seed-2.0-mini ¥0.2/¥2.0）。**建议由 pitfalls 维度专门立项。**

**分析引擎：v1 不引入 ClickHouse。** 用 Postgres 聚合 + 导出 parquet → DuckDB 1.5.5 / Polars 1.44.2 在 notebook 里分析。
- ClickHouse 当前稳定版为 26.7.x（[Releases](https://github.com/ClickHouse/ClickHouse/releases)），但它解决「十亿行扫描」，10 人体量的数据量连内存都装得下。
- ⚠️ 注意：**Langfuse v4 自托管自带一个 ClickHouse**。那是它的内部存储，**不要复用为业务分析库** —— 会把可观测性数据与研究数据的生命周期/权限耦合在一起。

---

## 9. 评测工具 —— 「感觉像人吗」没有现成答案

### 结论（Confidence: HIGH 对工具选择 / LOW 对「能否测出像人」）

> **Langfuse v4 自托管（trace + prompt 版本 + dataset/experiment + LLM-as-judge）+ promptfoo 0.123.1（CI 断言与红队）+ 图灵测试竞技场本身作为终极 eval harness。**

### 分工

| 层 | 工具 | 测什么 |
|----|------|--------|
| 生产可观测 | **Langfuse v4**（自托管） | 每轮对话的 trace、成本、延迟；**sessions** 视角看一段关系的完整轨迹；userId 维度成本；prompt 版本与效果关联 |
| 离线批量评分 | **Langfuse Datasets + Experiments + LLM-as-judge** | 固化「难例集」（人格被试探、被要求泄露他人隐私、关系转冷场景），换模型/换 prompt 后跑回归 |
| CI 硬断言 | **promptfoo 0.123.1** | ① 三层护栏不可越狱（核心价值观/安全边界不可被用户改写）；② **PII 不跨用户外溢**（给角色喂 A 用户的手机号，断言对 B 用户的任意提问都不复现）；③ 「始终明示是 AI」在被追问时不被绕过。这是 PROJECT.md 硬约束的自动化载体 |
| 人类偏好（金标准） | **图灵测试竞技场**（产品功能即 eval） | 盲测判对率 —— 唯一能测「分不清人机」的东西。PROJECT.md 把它纳入 v1 是正确的，它**同时**是度量场、数据源、增长玩法 |

### 需要自建的 judge rubric（没有现成工具）

通用 eval 框架测的是「正确性 / 忠实度 / 相关性」，**和「像人」正交**。要自己定义并做成 Langfuse 的 LLM-as-judge 模板：

1. **出戏检测**：是否出现「作为一个 AI 语言模型」「我无法」「希望这对你有帮助」等助手腔；是否使用 Markdown 列表/标题（真人微信不这么聊）。
2. **一致性**：与人格档案 + 被检索记忆是否矛盾；**「完美记忆」是破绽，所以过度准确也要扣分**。
3. **节奏真实度**：单条消息长度分布、是否会分多条发、标点/表情使用率 —— **可以直接拿研究管道的 L0 真人特征分布做 KL 散度对比**。这是本项目独有、别人做不到的评测能力，应当在 roadmap 里被当成一等功能。
4. **信息披露适当性**：转述/八卦倾向是否符合人格设定，且未越过 PII 底线（对应 Open Question 2）。

### 不要用

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Braintrust** (braintrust 3.35.0) | 托管、境外。对话原文出境，与隐私硬约束冲突 | 自托管 Langfuse v4 |
| **DeepEval** (4.2.6) / **Ragas** (0.4.3) | Python，且指标体系围绕 RAG/QA 正确性（faithfulness、answer relevancy）。本项目没有「正确答案」 | 自建 rubric + 人类偏好对战 |
| 用通用 benchmark 分数（MMLU/GPQA）选模型 | 与中文角色扮演一致性零相关 | 自建 100 条难例集 + 自己的 rubric 跑 A/B |

---

## 10. Open Question 4 的答案 —— 模型与 provider 策略

### 已核实的价格/规格底表（2026-09-25）

**国内（人民币 / 百万 token，除注明外）**

| 模型 | 上下文 | 输入 | 缓存命中 | 输出 | 来源 |
|------|--------|------|----------|------|------|
| **doubao-seed-character-251128**（豆包角色扮演模型，官方定位「面向新一代虚拟陪伴场景」） | 分档 0–32k / 32–128k | ¥0.80 / ¥1.20 | ¥0.16 | **¥2.00 / ¥6.00** | [火山方舟模型价格](https://www.volcengine.com/docs/82379/1099320)、[豆包大模型产品页](https://www.volcengine.com/product/doubao/) |
| qwen3.8-flash | **1M**（输出 128K，CoT 256K） | ¥0.80 | ¥0.10 | ¥2.70 | [阿里云 qwen3.8-flash 说明](https://developer.aliyun.com/article/1761526) |
| qwen3.7-plus / qwen3.8-max | 1M | — | — | — | [百炼文本生成](https://help.aliyun.com/zh/model-studio/text-generation-model)（max 为旗舰，价格未核实，Confidence: LOW） |
| qwen-plus-character / qwen-flash-character（角色扮演专用） | **32k / 8k**，无 FC、无结构化输出、无 thinking | — | — | — | 同上 |
| glm-5.3 | 1M（输出 128K） | ¥8 | ¥2 | ¥28 | [智谱定价](https://docs.bigmodel.cn/cn/guide/start/pricing) |
| **glm-5.3-flash** | 1M | ¥0.80 | ¥0.23 | ¥2.80 | 同上 |
| glm-4.7-flash | 200K | **免费** | — | **免费** | 同上 |
| kimi-k3 | **1,048,576** | ¥20 | ¥2 | ¥100 | [Kimi 定价](https://platform.kimi.com/docs/pricing/chat) |
| doubao-seed-2.1-pro | 1M（0–1024k 档） | ¥6 | ¥1.20 | ¥30 | 火山方舟价格页 |
| doubao-seed-2.0-mini | 分档 | ¥0.20 | ¥0.04 | ¥2.00 | 同上 |
| Embedding-3（智谱） | 8K | ¥0.50 | — | — | 智谱定价 |

**DeepSeek 官方（美元 / 百万 token；峰谷价差 2×）**

| 模型 | 上下文 / 最大输出 | 输入(未命中) 谷/峰 | 输入(命中) 谷/峰 | 输出 谷/峰 | 备注 |
|------|------|------|------|------|------|
| deepseek-flash（V4.1-Flash） | **1M / 384K** | $0.15 / $0.30 | $0.003 / $0.006 | **$0.60 / $1.20** | 支持 vision、FIM、**chat prefix completion** |
| deepseek-v4-pro（V4-Pro-0813） | 1M / 384K | $0.66 / $1.32 | $0.022 / $0.044 | $1.98 / $3.96 | 同时提供 OpenAI 与 **Anthropic 格式**端点 |

> ⏰ **峰时为 UTC 周一至周五 01:00–04:00 与 06:00–10:00**（= 北京时间 09:00–12:00 与 14:00–18:00），其余时段含周末与中国公假全天为谷时，谷时价为峰时一半（[DeepSeek 定价页](https://api-docs.deepseek.com/quick_start/pricing)）。
> → **「夜间反思」在北京时间深夜跑，天然吃到 50% 折扣。这是免费的成本优化，应写进调度器设计。**

**MiniMax**：MiniMax-M3（1M 上下文，多模态）、**MiniMax-M2.7（官方特性明确列出「充满角色的丰富互动」）**、MiniMax-M2.7-highspeed（[模型总览](https://platform.minimax.ac.cn/docs/guides/models-intro)）。文本定价页未能核实（Confidence: LOW on price）。注意 MiniMax 已从 abab 世代迁移到 M 系列，abab 命名已过时。

**海外（美元 / 百万 token）**

| 模型 | 上下文 | 输入 | 输出 | 来源 |
|------|--------|------|------|------|
| claude-sonnet-5 | **1M**（输出 128K） | **$2** | **$10** | [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview) |
| claude-opus-5-5 | 1M | $4 | $20 | 同上 |
| claude-fable-5-1 | 1M | $10 | $50 | 同上 |
| claude-haiku-4-5-20251001 | 200K | $1 | $5 | 同上 |
| gpt-6-sol | 1.05M | $2 | $10 | [OpenAI models](https://developers.openai.com/api/docs/models) |
| gpt-6-luna | 1.05M | **$0.1** | **$0.5** | 同上 |
| gpt-6-astra | 1.05M | $10 | $50 | 同上 |
| gemini-3.8-flash | — | — | — | [Gemini models](https://ai.google.dev/gemini-api/docs/models)（价格未核实，Confidence: LOW） |

### 结论：不选「一个模型」，选**按任务角色分配的模型矩阵 + 两条并行通道**

| 语义角色（packages/llm 里的 key） | 主选 | 降级 | 为什么 |
|---|---|---|---|
| **chat.reply**（角色实时回复，**产品命脉**） | **doubao-seed-character-251128** | glm-5.3-flash → qwen3.8-flash | **目前唯一一个厂商明确定位「角色扮演 / 虚拟陪伴」的商用 API 模型**，且价格极低（¥0.8/¥2.0）。它是「拟真度」的默认基线，也是合规路径上的默认模型。⚠️ 但它上下文分档到 128k 且未列 FC / 结构化输出 → 只用于**产出自然语言回复**，不承担结构化任务 |
| **chat.reply.frontier**（**实验通道**，质量上限标尺） | **claude-sonnet-5** | gpt-6-sol | v1 成本不设限，目标是「探到像真人的效果天花板在哪」。$2/$10 + 1M 上下文让「把完整人格档案 + 经历库直接塞进上下文」这种粗暴方案在 v1 变得可行 —— 这对 Open Question 1（人格表示）的快速验证极有价值。**必须标记为不可进入公开上线路径** |
| **persona.reflect**（夜间反思、人格整合；长、结构化、不敏感于延迟） | **deepseek-v4-pro**（北京深夜=谷时，半价） | glm-5.2 → qwen3.7-plus | 1M 上下文 + 384K 输出能一次吃下一整天的全量增量；Anthropic 格式端点让它与 chat.reply.frontier 共用同一套 adapter 代码；谷时半价 |
| **persona.probe**（漂移探针 / 冻结 baseline 对照组）⚠️ **不可降级、不可别名** | **doubao-seed-character-251128**（可 pin 快照） | **无降级链 —— 失败即告警，不换模型** | ⚠️ **与 persona.reflect 完全解耦，即使反思为谷时折扣换 provider，探针也不跟着换。** 理由：探针的唯一职责是充当**不变的尺子**；尺子跟着被测物一起变，测量就无意义。必须用可 pin 快照（见 §15.9 可 pin 性矩阵）—— 这排除了 DeepSeek（无法 pin），也正是为什么它不能和 persona.reflect 共用角色配置。推荐就用生产同款 doubao-seed-character-251128：对照组与生产同款才可比 |
| **memory.extract** / **safety.classify** / **research.l0**（高频、短、纯分类抽取） | **glm-4.7-flash（免费，200K）** | doubao-seed-2.0-mini（¥0.2/¥2.0） | 每条消息都要跑，成本必须趋零。免费档在 10 人体量下完全够 |
| **embedding** | **qwen3.7-text-embedding**（百炼，dimensions=1024，**最大输入 131,072 tokens**） | 智谱 Embedding-3（256–2048 可选，8K 上下文，¥0.5/M）→ 自部署 bge-m3（sentence-transformers 6.1.0） | ⚠️ **此项已于 arch 对齐后修正**：原推荐 Embedding-3，但其**单条输入上限仅 3072 tokens、数组最多 64 条**，会强制把长情节记忆切块 —— 而「一次完整的对话片段」正是情节记忆的天然单位，切块会破坏语义。qwen3.7-text-embedding 的 131K 输入上限让整段会话可以整体向量化，且 1024 维是其默认值（与 arch 侧 halfvec(1024) 一致）。百炼本来就是三个 provider 账号之一，零新增依赖 |
| **rerank**（可选，记忆召回二阶段） | qwen3.7-text-rerank（30,000 tokens/条） | qwen3-rerank / gte-rerank-v2 | ⚠️ **重排器与遗忘曲线会打架**：reranker 输出的是「与 query 的相关性」，会覆盖衰减权重。正确的组合顺序是 `ANN 粗召回 → rerank 得相关性分 → 再乘遗忘曲线衰减因子`，**不能反过来**，否则「被遗忘的高相关记忆」会被重排器捞回来，遗忘机制失效 |

**Provider 账号只需要三个**（国内独有的杠杆）：
- **火山方舟**（doubao-seed-character + doubao-seed-2 系列 + 代理的 glm-5.3-flash / glm-5.2 / deepseek-v4 系列）
- **阿里云百炼**（qwen3.8 系列 + 代理的 deepseek-v4-pro / glm-5.2 / kimi-k2.7 / MiniMax-M3）
- **DeepSeek 官方**（谷时价 + Anthropic 端点 + prefix completion）

→ 百炼与火山方舟自己就是**合规的 OpenRouter**。所以「避免供应商锁定」在国内不需要中间商，只需要在 packages/llm 里维护一张映射表。

⚠️ **但"可替换"有一个例外，必须写进映射表的注释里**：persona.probe 是**故意不可替换**的。整张映射表的设计目标是"任何角色都能换 provider"，而探针角色的设计目标恰恰相反 —— 它必须在整个 milestone 内保持同一个快照不变，否则历史漂移数据不可比。**这是唯一一个"供应商锁定"是特性而非缺陷的位置**，需要显式注释，否则未来某次"统一升级所有模型"的重构一定会顺手把它一起改掉，而那会静默作废在此之前积累的全部漂移基线。

### 明确不做的事

| 不做 | 为什么 |
|------|--------|
| 把 qwen-plus-character 当主力 | 32k 上下文装不下「人格档案 + 检索记忆 + 近期对话 + 角色状态」；且无 FC / 无结构化输出 / 无 thinking，扩展性差 |
| 自部署开源模型（v1） | v1 ≤10 人、成本不设限 → 自部署只带来运维成本与更差效果。**v2 若要压成本或要「记忆不出站」再评估**（届时 qwen3.5-27b / MiniMax-M3 开源权重是候选） |
| 用海外模型作为未来公开上线的默认 | 无法备案。见 §0 |
| 用 benchmark 分数选 chat.reply | 没有公开的中文长程角色扮演一致性 benchmark。**必须自测** |

### 必须自己验证的事（roadmap 第一批 spike）

1. **doubao-seed-character vs claude-sonnet-5 vs glm-5.3-flash vs qwen3.8-flash 的中文角色一致性盲测**（同一人格档案、同一 20 轮剧本、同一 rubric）。这是 v1 最高价值的 spike，成本约几十元。
2. **doubao-seed-character 的实际能力边界**：是否支持 system prompt 里的长人格档案？是否支持多轮工具调用？分档计费在 32k 处**输出价跳 3 倍（¥2→¥6）**，意味着**上下文预算管理是硬工程需求**，而非优化项。
3. **DeepSeek chat prefix completion** 能否用来实现「AI 主动消息的开头由调度器决定、后续由模型续写」—— 这可能是「生活事件驱动主动发消息」最优雅的实现。

---

## 11. Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| next@16.3.6 | react@19.3.0 | Next 16 要求 React 19+ |
| ai@7.0.114 | @ai-sdk/openai@4.0.75、@ai-sdk/anthropic@4.0.63、@ai-sdk/deepseek@3.0.52、@ai-sdk/react@4.0.117 | ⚠️ AI SDK 7 的 provider 包主版本号与核心包**不同步**（core 7.x 对应 provider 4.x），锁版本时不要按 core 版本推测 |
| pgvector@0.8.6 | PostgreSQL 13+（推荐 18.6） | 必须 ≥0.8.2（CVE-2026-3172）。Docker 用 pgvector/pgvector:pg18 |
| drizzle-orm@0.45.3 | postgres@3.4.9 或 pg | pgvector 自定义类型需 customType；HNSW 索引用 sql 模板原样写 |
| pg-boss@12.34.0 | PostgreSQL 13+ | 会在指定 schema 建表；其迁移需与 Drizzle 迁移**分开**管理 |
| zod@4.6.5 | ai@7 的 generateObject / tool schema | Zod 4 与 3 的 API 有差异，确保 AI SDK 侧走 v4 适配 |
| Langfuse v4 self-host | Postgres + ClickHouse 26.x + Redis/Valkey + S3/MinIO | **四个有状态组件**。v1 若不想运维，先用 Langfuse Cloud 做**只含 L0 特征、不含原文**的 trace；原文 trace 等自托管就绪再开 |
| web-push@3.6.7 | Service Worker + VAPID | iOS 需 PWA 安装；见 §5 |
| Node 24.21.0 | pnpm 12.6.0、TypeScript 7.0.2 | 用 package.json 的 packageManager 字段锁定 pnpm |

---

## 12. What NOT to Use（汇总）

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **OpenRouter / Vercel AI Gateway** | 境外中转：延迟不可控、数据出境、无法备案 | 直连火山方舟 / 百炼 / DeepSeek（它们本身就代理多家模型） |
| **AI SDK 的字符串 model 写法** | 默认路由到 Vercel AI Gateway | 一律传 provider 实例；加 ESLint 规则禁止 |
| **LangChain / LangGraph** | 把领域状态机（人格演化、记忆重固化）的语义搬进框架 checkpointer，拿走你最需要审计与回滚的东西 | Postgres 里的显式状态机 + 纯函数 |
| **LiteLLM**（在 TS 栈里） | 引入一个 Python 服务 + 一跳网络，换来你已经有的东西 | packages/llm 薄封装 |
| **Mem0 / Zep Cloud / Letta Cloud** | 遗忘曲线与全局人格是**产品核心资产**，不能外包；且托管即出境 | pgvector 自建；借鉴其 bi-temporal / sleep-time compute 设计 |
| **Milvus / 独立 Qdrant**（v1） | 10 人体量的分布式向量库；跨库无事务会让「夜间反思」原子性破功 | pgvector 同库 |
| **ClickHouse**（作为业务分析库，v1） | 解决十亿行扫描问题，你有几万行 | Postgres 聚合 + parquet 导出 + DuckDB |
| **socket.io** | 私有协议（未来 App 端要引入其客户端）；其核心价值（多进程 adapter / 传输降级）v1 不需要 | ws + Zod 定义的 JSON envelope |
| **Pusher / Ably / PartyKit / Supabase Realtime / Electric** | 境外 + 把消息投递真相源放到外部，与离线补偿 / 一键删除冲突 | 自建 WS，DB 为真相源 |
| **BullMQ**（v1） | 需要 Redis，且与 Postgres 跨存储无事务 | pg-boss |
| **croner / node-cron 裸定时器**（生产） | 重启丢任务、无重试、无幂等、无可观测 | pg-boss schedule() |
| **Clerk / Auth0 / Supabase Auth** | 用户 PII 出境；「一键删除级联」需要账号表在自己库里 | better-auth 1.7.6 |
| **Braintrust** | 托管境外，对话原文出境 | 自托管 Langfuse v4 |
| **DeepEval / Ragas** | 指标体系围绕 RAG 正确性，本项目没有正确答案 | 自建 rubric + 竞技场人类偏好 |
| **OneSignal / 直连 FCM** | 境外服务；FCM 国内不可达 | 自建 web-push + VAPID，并接受其覆盖率上限 |
| **Prisma 8** | 当前为 8.0.0-rc.17，未 GA；且其抽象会挡住 pgvector 自定义打分表达式 | Drizzle 0.45.3 |
| **qwen-plus-character 作为主力** | 32k 上下文 + 无 FC + 无结构化输出 | doubao-seed-character-251128 |
| **presidio 单独用于中文 PII** | 识别器与 NLP 管道以英文为中心 | 自建正则 + 词典 + glm-4.7-flash 兜底分类（需专项验证） |

---

## 13. Installation（v1 起步）

```bash
# 前置：Node 24.21 LTS, pnpm 12.6.0, Docker
corepack enable && corepack prepare pnpm@12.6.0 --activate

# 本地依赖服务
docker run -d --name drift-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=dev pgvector/pgvector:pg18

# 仓库骨架
pnpm init && pnpm add -Dw typescript@7.0.2 @types/node

# apps/api
pnpm --filter api add hono@4.13.9 ws@8.21.3 pg-boss@12.34.0 \
  drizzle-orm@0.45.3 postgres@3.4.9 zod@4.6.5 pino \
  ai@7.0.114 @ai-sdk/openai-compatible @ai-sdk/anthropic@4.0.63 @ai-sdk/deepseek@3.0.52 \
  better-auth@1.7.6 web-push@3.6.7 langfuse@3.39.2
pnpm --filter api add -D drizzle-kit @types/ws @types/web-push

# apps/web
pnpm --filter web add next@16.3.6 react@19.3.0 react-dom@19.3.0 \
  @ai-sdk/react@4.0.117 zod@4.6.5
pnpm --filter web add -D tailwindcss@4.3.3 @tailwindcss/postcss

# 评测（dev）
pnpm add -Dw promptfoo@0.123.1

# 研究侧（独立，非 workspace）
cd research && uv add duckdb==1.5.5 polars==1.44.2 jupyterlab
```

---

## 14. Stack Patterns by Variant

**如果团队无 TS 经验但有资深 Python 工程师：**
- 翻转为 FastAPI 0.141.1 + uvicorn 0.54.0 + LiteLLM 1.102.1 + Celery 5.6.3（或 TaskIQ 0.12.6）+ SQLAlchemy 2.1.0 + pgvector(py) 0.5.0 + React 19.3
- 因为语言熟练度在 10 人验证期胜过生态匹配；此时 LiteLLM 从「负债」变成「正解」
- 代价：实时聊天（WS + 打字指示器 + 流式协议）要多花显著时间，且契约分两套

**如果 Open Question 1 的人格表示最终选「(C) 经历驱动」：**
- 记忆层从「配角」升为「主角」→ 此时**才**评估把记忆检索迁到 Qdrant 1.19（更强的 payload 打分与 filter 性能）
- 且 chat.reply 的上下文预算会暴涨 → doubao-seed-character 的 32k 分档会频繁越界（输出价 ¥2→¥6），需重做成本模型，可能要换到 qwen3.8-flash（1M，均一价 ¥0.8/¥2.7）

**如果 Open Question 3（AI 之间的社交网络）v1 就做：**
- 出现「角色 A 向角色 B 转述用户 X 的事」→ **跨用户信息流动**，PII 外溢风险从「单点」变成「图」
- 必须在 packages/memory 加一层**出站过滤器**（记忆条目带 source_user_id + shareability 标签，跨角色检索时强制过滤），且 promptfoo 红队断言要覆盖二跳传播
- 定时任务量级上升（角色之间的对话也要调度）→ pg-boss 依然够，但需要单独队列与并发上限

**如果要给竞技场做真人 ↔ 真人聊天：**
- 复用同一条 WebSocket 与 messages 表，只是把会话类型标为 arena 且对端是真人
- 这反向验证了「WS 为唯一实时通道」的选择：真人对局天然需要双向 + 低延迟，SSE 无法支撑

---

---

## 15. 架构侧对齐（与 ARCHITECTURE.md 的交叉约束）

> 本节是与 arch-researcher 核对后追加的。arch 侧的约束里 **5 条我完全同意并已收紧**，**1 条（Python 切分线）我保留 TS 全栈但给出可接受的折中**，**1 条（任务队列）我认为应该升级**。

### 15.1 Model Router 是硬约束 —— 我把它从「建议」升级为「可强制执行的边界」

arch 侧要求：所有 LLM 调用必须经 Model Router，必须落 provider + model + 版本 + token 数，禁止任何服务直连 provider SDK。**完全同意，且这条要求让我上调了 packages/llm 的规模预算（原 <300 行 → 目标 <500 行）。**

理由（arch 侧说得对，我补充为什么它比一般的"统一入口"更刚性）：**换模型会改变人格表现，而本项目要度量的恰恰是"角色真的在变化"。** 如果漂移归因不能区分「人格变了」和「模型变了」，PROJECT.md 三个成功标准里的第三个（角色真的在变化）就是不可证伪的 —— 整个人格演化引擎的价值无法被证明。

**必须落库的字段**（不是只写 Langfuse trace —— trace 有采样与保留期，归因分析需要 OLTP 里的确定性记录）：

| 字段 | 为什么必须有 |
|---|---|
| provider / model_id | 基础归因 |
| **model_snapshot**（如 qwen3.8-max-0902、doubao-seed-character-251128、claude-haiku-4-5-20251001） | ⚠️ **别名会静默漂移**：DeepSeek 官方明确写了旧名 deepseek-v4-flash「仍然接受，但对应模型已下线，请求由 DeepSeek-V4.1-Flash 承接并按 Flash 价格计费」。只记别名 = 归因数据在你不知道的时候失真。**能拿到快照版号就必须记快照版号** |
| prompt_version | 见 §15.4 |
| persona_version | arch 侧已在 persona_version 表里 |
| retrieved_memory_ids + recall_scores | 否则无法回答「这次回复为什么是这样」—— 记忆召回是人格表达的另一半输入 |
| thinking_mode / reasoning_effort / temperature 等采样参数 | thinking 开关对角色语气的影响可能大于人格变化本身 |
| prompt_tokens / completion_tokens / cached_tokens / 计价档位 | 火山方舟与智谱是**分段计费**（输入长度跨档单价跳变，doubao-seed-character 输出价在 32k 处 ¥2→¥6），不记档位就算不出真实成本 |
| latency_ms + provider_request_id | 降级链触发分析、事故回溯 |

**可强制执行的边界（给 roadmap 的具体动作）**：用 ESLint `no-restricted-imports` 把 `@ai-sdk/*`、`openai`、`@anthropic-ai/sdk` 的导入限定在 `packages/llm` 内，其余包一律报错。这比"约定"可靠 —— 架构约束必须有 CI 期的执法者，否则半年后一定会有人为了赶功能直连 provider。

### 15.2 embedding_model_version 不够 —— pgvector 的列维度是固定的

arch 侧要求 v1 就建 embedding_model_version 列，**同意**，但有一个会在换模型当天才被发现的坑：

**pgvector 的 halfvec(1024) 维度写在列类型里。** 所以「换嵌入模型需全量重建索引」只在新模型也是 1024 维时成立；若新模型维度不同（或想从 1024 升到 2048 提精度），需要的是**新列/新表**，而 ALTER COLUMN TYPE 会重写整表并在重写期间锁表。

**建议的结构**（比在 memories 表上加一列更能支持平滑迁移）：

```sql
-- 记忆内容与元数据（稳定）
CREATE TABLE memories (
  id uuid PRIMARY KEY, character_id uuid NOT NULL, content text NOT NULL,
  salience real NOT NULL, last_recalled_at timestamptz, recall_count int NOT NULL DEFAULT 0,
  tombstoned boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);

-- 向量单独一表，版本写进表名而非仅一列
-- → 迁移期可双写新旧两个版本，灰度切换检索，回滚只是改一个配置
CREATE TABLE memory_embeddings_v1 (
  memory_id uuid PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  embedding_model_version text NOT NULL,   -- 'qwen3.7-text-embedding@1024'
  embedding halfvec(1024) NOT NULL
);
CREATE INDEX ON memory_embeddings_v1 USING hnsw (embedding halfvec_cosine_ops);
```

新维度 = 新表 memory_embeddings_v2（列类型 halfvec(2048)），检索层按配置选表。代价是一次 JOIN；收益是换嵌入模型从「停机重建」变成「双写 + 灰度」。**在一个以"长期记忆"为核心机制的产品里，嵌入模型迟早要换，这个结构值这次 JOIN。**

⚠️ 同时注意：向量表上的 ON DELETE CASCADE 是对的，但**研究库那侧的级联删除不能靠外键** —— 逻辑复制订阅端的删除由复制流驱动，若研究库做了列级白名单投影，删除语义必须在删除 worker 里显式写（见 §8）。

### 15.3 任务队列：我认为应该用 pg-boss，而不是手写 Postgres 表 + 轮询

arch 侧说「v1 用 Postgres 表 + 轮询即可，不要引入额外中间件」—— **意图我完全同意（不引入中间件），但结论要修正一个事实前提：pg-boss 不是中间件。**

pg-boss 就是「Postgres 表 + 轮询」，只是别人已经写好并在生产里跑了多年。它不引入任何新进程、新端口、新有状态组件 —— 它是一个 npm 包，在你自己的库里建几张表。所以 arch 侧的约束（不引入额外中间件）与用 pg-boss **不冲突**。

手写会缺的东西，而这四类任务恰好每一项都需要：

| 能力 | 谁需要它 | 手写的代价 |
|---|---|---|
| cron 调度 | 夜间反思、角色生活事件生成 | 要自己处理时区、错过窗口的补跑、多实例互斥 |
| 延迟投递（sendAfter） | 拟真回复延迟、已读不回后的「过一会儿才回」 | 这是本产品的核心体验，不能靠 setTimeout（进程重启即丢） |
| 指数退避重试 + 死信 | LLM 调用失败、provider 降级 | 手写重试很容易写成"无限重试打爆 provider 配额" |
| visibility timeout / 单次消费保证 | 夜间反思（**重复执行会把人格演化算两次**） | 最危险的一项：幂等靠手写 SELECT FOR UPDATE SKIP LOCKED 能做，但漏掉租约续期就会在长任务上重复投递 |

**「夜间反思重复执行 = 人格被演化两次」在全局人格下是污染事故，会影响所有用户。** 为省一个 npm 包而自己实现租约与幂等，是在最不该冒险的地方冒险。

（若 arch 侧的真实顾虑是「pg-boss 的表与迁移会污染我们的 schema」：它支持指定独立 schema，放 pgboss schema 即可，与 app / privacy / research 并列，互不干扰。）

### 15.4 提示词包 + prompt_version —— 同意，但真相源应在 git 而不在 Langfuse

arch 侧要求提示词独立成包带版本号，persona_version 表已有 prompt_version 列。**完全同意，且这条比看起来更重要**：提示词改动不记录，漂移分析会把它误判成人格演化 —— 这会直接伪造 PROJECT.md 的核心成功指标。

具体做法（有一个取舍要说清楚）：

- Langfuse v4 有完整的 Prompt Management（版本控制、label 部署、与 trace 关联、Playground 内测试）。诱惑是把提示词托管在 Langfuse 里。
- **但那会让 Langfuse 变成聊天主链路的运行时依赖** —— Langfuse 挂了，角色就不会说话了。对一个可观测性组件来说这是不可接受的耦合。

→ **推荐：packages/prompts 在 git 里是唯一真相源**，版本号用**内容哈希**（如 persona_reply@a3f19c2）而非手写递增（手写版本号一定会有人忘记改，内容哈希不会）。构建时把提示词**注册**到 Langfuse 以获得 trace 关联与对比分析，但运行时从代码里读。这样既拿到 arch 侧要的可归因性，又不给主链路加依赖。

### 15.5 事件总线 topic 命名空间 —— 同意，并补一条

arch 侧要求 v1 就定 character.event.* / rumor.* 的 topic 命名空间，便于 v2 换传输层。**同意。** 补充一条来自 §4 的约束：**这套 topic 命名空间应与 WebSocket 下行事件的 type 字段共用同一份 Zod 定义**（放 packages/contract）。

理由：v1 里「事件总线」和「WS 投递」大量重叠（角色生活事件 → 主动消息 → 推给客户端）。如果两边各定一套名字，v2 拆传输层时要做一次全量映射表，而那正是最容易漏掉边缘事件的时候。一份 discriminated union，服务端内部用它做事件总线 topic，序列化后就是 WS 帧 —— 零映射成本。

（注意区分：**共用类型定义 ≠ 内部事件全部外发**。rumor.*（AI 之间转述）绝大部分不应出现在客户端，这靠出站白名单控制，而不是靠"用两套命名"来保证。恰恰相反，共用定义 + 显式白名单比两套命名更安全，因为白名单是可被测试断言的。）

### 15.6 Python 切分线：我保留 TS 全栈，但接受一个明确的折中

arch 侧建议 research/featurize + persona/probes（心理测量与行为探针评分）用 Python，其余全 TS，并指出「若你倾向 TS 全栈，架构上也完全成立，只是探针评分要自己写」。

**我的立场（Confidence: HIGH）：v1 全 TS。但切分线本身我接受 —— 差别只在「Python 是服务还是批处理」。**

关键区分不是语言，而是**部署形态**：

| | Python 作为**服务** | Python 作为**批处理** |
|---|---|---|
| 部署单元 | +1 | 0（一个 uv run 脚本 / cron 里的一行） |
| schema 所有权 | 双写、要同步迁移 | 只读 replica + 写回一张窄表（probe_scores） |
| 本地开发 | 必须起两个栈 | 不跑也能开发全部功能 |
| 调用路径 | 聊天主链路依赖它 → 它挂了功能就挂 | 离线，挂了只是分数晚出 |

→ **接受 arch 的切分线，但约束为批处理形态**：research/ 目录下的 Python 脚本只读研究副本、只写 probe_scores / style_profile 这类窄结果表，**不进入任何在线请求路径**。这满足 arch 想要的"心理测量用 Python 生态"，又不引入第二个服务。

**v1 具体做什么：**
- 探针评分（量表的加权求和、行为频次统计）**在 TS 里写**。这是算术，不需要 Python —— arch 说的"要自己写"其实是几十行。
- 当需要**因子分析 / IRT / 显著性检验**时（≥ 数百样本才有意义，v1 的 10 人达不到），它自然是一个批处理作业，那时用 Python 且零迁移成本（它读的是 replica，不动业务代码）。
- 这正是 §7「推后决策几乎无成本」的同一条推理：**现在拆的成本是立即且固定的，收益要等到样本量上来才存在。**

### 15.7 PostgreSQL 18.x 而非 19 —— 同意，并补充理由

arch 侧核对到 PG 19 还是 Beta 4。我独立核实的结果一致：[postgresql.org/versions.json](https://www.postgresql.org/versions.json) 的受支持主版本为 14–18，最新 18.6，19 未出现在受支持列表中。

补一条选 18 的具体收益（不只是"稳"）：**§8 的研究库设计依赖逻辑复制的列级白名单**（publication 指定列清单），该能力自 PG 15 起可用 —— 在 18 上可用且成熟。这是让"PII 在复制层就不存在"而非"复制后再删"的技术前提，是本项目隐私硬约束的实现基础。

### 15.8 由此产生的一处**改动**：embedding 主选从 Embedding-3 换成 qwen3.7-text-embedding

arch 侧定了 halfvec(1024)，这促使我去核实各家 embedding 的维度与输入上限，结果改变了我原来的推荐（已在 §1、§10 修正）：

| 模型 | 维度 | 单次最大输入 | 价格 | 判断 |
|---|---|---|---|---|
| **qwen3.7-text-embedding**（百炼） | 256~2560，**默认 1024** | **131,072 tokens** | 未核实（Confidence: LOW on price） | ✅ **主选**。131K 输入上限让「一整段对话」能作为一条情节记忆整体向量化 |
| qwen3.7-text-embedding-flash | 256~1024，默认 1024 | 131,072 | 未核实 | ➖ 成本敏感时的替代 |
| text-embedding-v4（百炼） | 64~2048，默认 1024 | 8,192 | 未核实 | ➖ |
| 智谱 Embedding-3 | 256–2048，默认 2048 | 8K 上下文，但**单条 ≤3072 tokens、数组 ≤64 条** | ¥0.5/M（已核实） | ⚠️ 降为备选：3072 的单条上限会强制切分长情节记忆，而「一次完整的对话片段」正是情节记忆的天然单位 |

来源：[百炼向量与重排序](https://help.aliyun.com/zh/model-studio/embedding-rerank-model)、[智谱 Embedding-3](https://docs.bigmodel.cn/cn/guide/models/embedding/embedding-3)

**并新增一条 arch 侧需要知道的检索顺序约束**：若引入 rerank（qwen3.7-text-rerank，30,000 tokens/条），顺序必须是 **ANN 粗召回 → rerank 算相关性 → 再乘遗忘曲线衰减因子**。反过来的话，重排器会把「本该被遗忘但与当前话题高度相关」的记忆捞回最前，**遗忘机制静默失效** —— 而这是产品核心机制，失效不会报错，只会表现为"这个 AI 记性太好了"。

---

### 15.9 回应 arch (A)：模型可 pin 性矩阵 —— 这条决定了 baseline 对照组只能用哪些模型

arch 侧因 model_snapshot 推出「每晚探针跑两遍，一遍当前 persona_version、一遍永久冻结的 baseline persona 作对照组」，并要求 Model Router 支持「按快照名强制路由、禁止别名解析」。

**我去核实了各 provider 到底能不能 pin。结论：不是所有 provider 都能，而这直接决定 baseline 只能选谁。** 同时这次核实**修正了我在 §15.1 的一处表述**（见下）。

| Provider | 能否按快照 pin | 依据 | 可否做 baseline |
|---|---|---|---|
| **火山方舟 / 豆包** | ✅ **能**。model id 自带版本号：doubao-seed-character-251128、doubao-seed-2-0-pro-260215 | 火山方舟模型广场模型详情页标注 "model id: doubao-seed-2-0-pro-260215" | ✅ **推荐** |
| **阿里云百炼 / Qwen** | ✅ **能**。官方提供快照版本：qwen3.8-max-0902、qwen3.7-plus-2026-05-26、qwen3.7-flash-2026-07-15、qwen3.6-plus-2026-04-02 | [百炼文本生成](https://help.aliyun.com/zh/model-studio/text-generation-model) 每个模型下列"查看快照版本" | ✅ 可 |
| **Anthropic** | ✅ **能，但规则与直觉相反** —— 见下方「修正」 | [Model IDs and versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions) | ✅ 可（但海外，不进公开路径） |
| **DeepSeek** | ❌ **不能**。model 参数只接受 deepseek-flash / deepseek-v4-pro 两个名字；"MODEL VERSION: DeepSeek-V4.1-Flash / DeepSeek-V4-Pro-0813" 是**文档字段，不是可传的 model 值** | [DeepSeek 定价页](https://api-docs.deepseek.com/quick_start/pricing) | ❌ **禁止做 baseline** |
| 智谱 GLM | ⚠️ 未找到带日期的快照 ID（glm-5.3 / glm-5.2 等均为无日期名） | [智谱模型概览](https://docs.bigmodel.cn/cn/guide/start/model-overview)（Confidence: MEDIUM，未找到明确的版本锁定文档） | ⚠️ 不推荐，除非确认 |

#### ⚠️ 对我 §15.1 的修正：Anthropic 的无日期 ID 不是别名，它就是快照

我在 §15.1 里把"无日期后缀"当成了别名的标志，这对 Claude 4.6 及之后的世代是**错的**。官方原文：

> "A common misconception is that dateless model IDs such as claude-sonnet-4-6 behave as evergreen pointers that route to the latest or best-performing version. That is not the case. ... It maps to a single, fixed model snapshot. Anthropic does not update the weights or configuration of an existing model ID. When an updated version is available, it ships under a new model ID."

规则是：
- **4.6 世代及之后**（claude-sonnet-5 / claude-opus-5-5 / claude-fable-5-1）：无日期 ID **就是 pinned snapshot** ✅
- **4.6 之前**（claude-sonnet-4-5-20250929 / claude-haiku-4-5-20251001）：ID 带日期 = 快照；另有无日期短别名（claude-sonnet-4-5）指向该 minor 版本的最新快照 ⚠️

→ 所以判断可 pin 性**不能靠"有没有日期后缀"这个启发式**，必须按 provider 的规则逐个查。Model Router 里应维护一张显式的 pinnability 表，而不是用正则猜。

#### 更重要的发现：**pin 住快照仍然不足，而这正好从官方文档印证了 arch 的对照组是必需的**

Anthropic 在同一页明确写了（这是我这次核实里最有价值的一条）：

> "Model weights are fixed for a given ID, but the serving infrastructure around the model can change over time. This infrastructure includes components such as the request router, safety classifiers, and sampling logic. Occasionally, infrastructure updates produce minor differences in observable behavior even when the model ID and weights have not changed."

**即：即使完美 pin 住快照、权重一字未改，可观测行为仍可能因服务侧基础设施（请求路由器、安全分类器、采样逻辑）变更而漂移 —— 厂商自己把这件事写进了文档。**

这件事的意义：
- 我在 §15.1 提的 model_snapshot 落库是**必要的**，但**可证明地不充分** —— 不是"也许还不够"，是厂商书面承认它不够。
- arch 的**冻结 baseline 对照组是唯一能观测到这类漂移的手段**。没有它，一次 provider 侧的安全分类器更新会被四类漂移指标读成"人格自己变了"，并触发回滚、污染版本链。
- → **arch (A) 不是"加一个保险"，而是这套漂移归因体系的可行性前提。完全支持，并建议写成验收标准而非 nice-to-have。**

#### Model Router 的接口口子（arch 要的那个）

```ts
// packages/llm —— 两种互斥的调用模式
type CallMode =
  | { mode: "routed";  role: SemanticRole }        // 生产路径：走映射表 + 降级链
  | { mode: "pinned";  modelSnapshot: string };    // 探针/对照组：禁止别名解析、禁止降级

// pinnability 是显式表，不是正则推断
const PINNABLE: Record<string, "snapshot" | "alias-only"> = {
  "doubao-seed-character-251128": "snapshot",
  "qwen3.8-max-0902":             "snapshot",
  "claude-sonnet-5":              "snapshot",   // 4.6+ 世代无日期 ID 即快照
  "claude-sonnet-4-5":            "alias-only", // 4.6 之前的无日期名是别名
  "deepseek-flash":               "alias-only", // DeepSeek 无法 pin
  "deepseek-v4-pro":              "alias-only",
};
```

三条必须由 Router 强制的规则：

0. **语义角色 persona.probe 必须硬编码为 pinned 模式，禁止回退到 routed。** 这是 arch §4.3 的要求，也是本节结论的直接推论：routed 模式带降级链，而降级就是换模型 —— 允许探针回退到 routed 等于允许尺子在被测量的过程中被静默替换。Router 里应把 persona.probe 的 CallMode 做成类型层面不可为 routed（而不是运行时判断），这样"不小心让探针走了降级"在编译期就不可表达。

1. **pinned 模式下若 modelSnapshot 的 pinnability 是 alias-only → 直接抛错，不降级、不静默继续。** 这类错误必须在启动期或 CI 期就炸，而不是半年后才发现 baseline 数据一直在漂。建议加一条启动期断言：遍历所有 baseline 配置，任一不可 pin 即拒绝启动。
2. **pinned 模式下禁用降级链。** 降级本身就是换模型 —— 对照组静默降级会让"对照组也漂了"变成假阳性，进而让真实的人格漂移被当成基础设施噪声忽略掉。宁可这一晚探针失败并告警，也不要拿降级后的结果入库。
3. **落库时把 requested_model 与 provider 回传的实际模型标识（响应体里的 model 字段、provider_request_id）分两列存。** 两者不一致就是别名被解析了，这本身就是一条应该告警的事件。

#### 一个会影响调用量估算的方法论问题

arch 说"探针跑两遍 → 调用量翻倍，10 人规模下每晚几十次"。**实际会比 2× 更多，原因不在对照组，而在采样非确定性**：

MoE 架构 + 生产推理栈下，即使 temperature=0 也不保证逐 token 确定（专家路由、批处理内核、浮点累加顺序都会引入抖动）。所以**单次采样的差异无法区分"人格漂移"和"采样噪声"** —— 探针必须每臂重复 N 次并比较**分布**，而不是比较两个单点输出。

→ 调用量是 `探针条目数 × N × 2 臂`。若 N=5，那是 10× 而非 2×。在 10 人规模下依然便宜（每晚几百次、成本量级几块钱），但**roadmap 的成本与时长估算要按 10× 而非 2× 来列**，否则第一次跑就会超预期。

配套建议：
- 探针路径固定 temperature（推荐 0）与固定 prompt hash，把可控变量全部锁死，让剩下的方差只来自模型侧。
- 若 provider 支持 seed 参数则一并固定（**未核实各家支持情况，Confidence: LOW**，需 spike 验证）。
- 漂移判定用分布检验（两样本 KS 检验 / bootstrap 置信区间），不要用"两次输出不一样就算漂移"。这与 §9 里"拿 L0 真人特征分布做 KL 散度对比"是同一套统计工具，可复用实现。

### 15.10 回应 arch (B)：应用层幂等键 —— 同意，且这不是"不信任 pg-boss"

arch 在 pg-boss 之上加 `(character_id, reflection_date)` 唯一约束。**完全同意，且我认为这条应该是通用规则而不是只给反思用。**

队列的语义边界说清楚：pg-boss 提供的是 **at-least-once + 租约**，不是 exactly-once。分布式系统里 exactly-once 投递不存在；能做到的是 **at-least-once 投递 + 幂等消费 = effectively-once**。所以「队列保证」与「数据库唯一约束」不是二选一，而是**同一个方案的两半** —— arch 的表述完全正确。

建议推广到另外两类任务（同样是"重复执行有业务后果"的）：
- **拟真回复延迟**：唯一键 `(conversation_id, trigger_message_id)` —— 否则重复投递会让角色对同一条消息回两次，这在聊天产品里是显而易见的破绽。
- **角色生活事件生成**：唯一键 `(character_id, event_date, event_slot)` —— 否则同一天生成两个"今天我去看了牙医"，角色生活时间线自相矛盾。

反过来，**不需要**幂等键的是纯读取类任务（L0 特征重算、研究导出）—— 重复执行只是浪费，不产生错误状态。把幂等键加在不需要的地方会让 schema 变复杂且给人虚假的安全感，所以判据是明确的：**重复执行是否改变用户可见状态**。

### 15.11 回应 arch (C)：向量表是"漏删原文"的隐蔽路径 —— 同意，并补一条

arch 把向量表接到了"删除队列漏派生物"的坑清单上，并指出**嵌入向量可近似还原原文语义，漏删它就是漏删原文**。这条我完全同意，而且它比直觉上更严重 —— 补一条技术依据：

嵌入反演（embedding inversion）已是成熟攻击面，从向量恢复出语义近似的原文是可行的。所以在隐私分层语义下：**嵌入向量的敏感级别应当等同于它所编码的原文，而不是被当作"派生特征"。** 这有两个直接后果：

1. **L0 层（默认只存脱敏行为特征、不存原文）绝不能存原文嵌入。** 否则 L0 在法律与技术上都不再是"不存原文" —— 这会击穿 PROJECT.md 的隐私分层设计，而且是在文档声称"只存消息长度分布、回复间隔、标点与表情使用率"的情况下击穿。只有 L1（用户显式授权保留原文）才能持有原文嵌入。
2. **研究库的列级白名单必须显式拒绝 embedding 列**，而不是靠"我们没加它"。白名单本来就是正向清单，这一点成立 —— 但建议在 CI 里加一条断言：扫描 publication 的列清单，出现任何 vector/halfvec 类型列即失败。这类错误一旦上线就是既成事实（数据已复制过去了），事后删除无法撤销已发生的复制。

---

## Sources

**官方文档（价格/规格/版本，2026-09-25 核实）**
- https://api-docs.deepseek.com/quick_start/pricing — DeepSeek 模型、1M 上下文、峰谷价、Anthropic 端点、prefix completion
- https://platform.kimi.com/docs/pricing/chat — Kimi K3 / K2.7 / K2.6 上下文与价格
- https://platform.claude.com/docs/en/about-claude/models/overview — Claude Fable 5.1 / Opus 5.5 / Sonnet 5 / Haiku 4.5 的 ID、上下文、价格
- https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions — **4.6+ 世代无日期 ID 即 pinned snapshot（不是别名）**；4.6 之前的无日期名才是别名；**并明确承认"权重固定但服务侧基础设施（请求路由器/安全分类器/采样逻辑）变更可能改变可观测行为"** —— 这是 §15.9 的核心依据
- https://help.aliyun.com/zh/model-studio/embedding-rerank-model — qwen3.7-text-embedding（256~2560，默认 1024，131,072 tokens）/ text-embedding-v4 / qwen3.7-text-rerank 等规格
- https://docs.bigmodel.cn/cn/guide/models/embedding/embedding-3 — Embedding-3 维度 256–2048 可自定义、**单条 ≤3072 tokens、数组 ≤64 条**
- https://developers.openai.com/api/docs/models — GPT-6 Astra / Sol / Luna 的 ID、上下文、价格
- https://ai.google.dev/gemini-api/docs/models — Gemini 3.8 Flash 等模型 ID
- https://help.aliyun.com/zh/model-studio/text-generation-model — 百炼推荐模型矩阵、qwen-plus-character 角色扮演模型、代理的第三方模型
- https://developer.aliyun.com/article/1761526 — qwen3.8-flash 1M 上下文与 ¥0.8/¥2.7 定价
- https://www.volcengine.com/docs/82379/1099320 — 火山方舟完整价格表（含 doubao-seed-character、在线/低优/批量三档）
- https://www.volcengine.com/product/doubao/ — 「豆包角色扮演模型 Doubao-Seed-Character，面向新一代虚拟陪伴场景」
- https://docs.bigmodel.cn/cn/guide/start/pricing 与 https://docs.bigmodel.cn/cn/guide/start/model-overview — GLM-5.3 / 5.3-Flash / 4.7-Flash（免费）/ Embedding-3
- https://platform.minimax.ac.cn/docs/guides/models-intro — MiniMax M3 / M2.7（「充满角色的丰富互动」）
- https://www.postgresql.org/versions.json — 受支持主版本 14–18，最新 18.6
- https://pgxn.org/dist/vector/ — pgvector 0.8.6（2026-07-29）、PG 13+、iterative scan / halfvec / 量化
- https://ai-sdk.dev/docs/migration-guides — AI SDK 当前主版本 7.0
- https://ai-sdk.dev/docs/introduction 与 https://ai-sdk.dev/providers/community-providers — provider 列表、Gateway 默认行为、HarnessAgent
- https://langfuse.com/self-hosting — Langfuse v4 架构（Postgres + ClickHouse + Redis + S3）
- https://developer.mozilla.org/en-US/docs/Web/API/Push_API — Push API Baseline、推送服务不可更换、Firefox 配额、endpoint 保密警告
- https://webkit.org/blog/13966/webkit-features-in-safari-16-4/ — iOS Web Push 需「添加到主屏幕」
- https://developer.apple.com/documentation/usernotifications/sending_web_push_notifications_in_web_apps_and_browsers — Apple Web Push 要求
- https://nodejs.org/dist/index.json — Node 24.21.0 LTS / 26.10.0 current
- npm registry / PyPI — 全部库版本（逐包 npm view / PyPI JSON API 查询）

**合规**
- https://www.cac.gov.cn/2026-07/10/c_1785427810632554.htm — 生成式 AI 服务备案 + API 调用类应用地方登记机制
- https://cloud.tencent.com/developer/article/2746205 — 截至 2026-08-31 累计 1112 款备案 / 731 款应用登记

**技术分析（Confidence: MEDIUM，非一手来源）**
- https://signals.aktagon.com/articles/2026/07/zep-a-temporal-knowledge-graph-architecture-for-agent-memory — Graphiti bi-temporal 模型与 invalid_at 边失效
- https://mem0.ai/blog/memory-decay-for-long-running-agents-how-recency-aware-ranking-fixes-retrieval-staleness — Mem0 Memory Decay（1.5× recency boost）
- https://github.com/magiccode1412/web-push — Chrome 推送需可达 Google 服务、Edge Android 返回无效 endpoint
- https://ask.csdn.net/questions/9572789 — 国内 Android FCM 不可达原因
- https://blog.51cto.com/u_12641824/14565737 — pgvector 0.8.2 CVE-2026-3172；VectorChord 对比
- https://github.com/ClickHouse/ClickHouse/releases — ClickHouse 26.7.x stable

---
*Stack research for: 中文 AI 社交/陪伴平台 + 分层脱敏研究数据管道*
*Researched: 2026-09-25*
