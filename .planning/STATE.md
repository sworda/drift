---
gsd_state_version: "1.0"
current_phase: 01
current_phase_name: 合规安全地基 + 会话骨架
status: executing
stopped_at: Completed 01-06-PLAN.md
last_updated: "2026-09-27T04:57:39.017Z"
last_activity: 2026-09-26
last_activity_desc: Phase 01 execution started
state_head: 8b71be34731dc9b888e01b291bc077afb3bed136
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 15
  completed_plans: 6
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-25)

**Core value:** 角色必须让人感觉是活的 —— 有自己的状态与生活、会记得也会遗忘、会因为和你相处而真的发生改变。
**Current focus:** Phase 01 — 合规安全地基 + 会话骨架

## Current Position

Phase: 01 (合规安全地基 + 会话骨架) — EXECUTING
Plan: 7 of 15
Status: Ready to execute
Last activity: 2026-09-26 — Phase 01 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 22 min | 3 tasks | 7 files |
| Phase 01 P02 | 1h 1m | 3 tasks | 33 files |
| Phase 01 P03 | 1h 22m | 3 tasks | 45 files |
| Phase 01 P04 | 21 min | 3 tasks | 77 files |
| Phase 01 P05 | 30 min | 3 tasks | 35 files |
| Phase 01 P06 | 51 min | 3 tasks | 21 files |

## Accumulated Context

### Decisions

完整决策表在 PROJECT.md Key Decisions（22 条）。影响当前工作的：

- [Roadmap]: 合规安全地基与会话骨架合并为 Phase 1 —— 第十条第一款要求安全措施与服务功能同步部署、同步使用，法律上无法分期
- [Roadmap]: 危机干预（SAFE-01..05）落在 Phase 1 而非与疏远机制同批 —— 严格早于疏远即消除第三十条 10万–20万 罚档的窗口期；SAFE-15 在 Phase 5 以「重跑危机探针集 + clamp 测试」形式验证
- [Roadmap]: SAFE-07（永不 ghosting 地板）落在 Phase 2 —— REQUIREMENTS.md 标注其与 REAL-05 同一实现，不能让「偶尔已读不回」先于其护栏上线
- [Roadmap]: Phase 2 → Phase 3 之间设硬门禁 —— 盲测内容判对率未达阈值且不可复现时不得开始记忆阶段
- [Roadmap]: 演化 shadow 期 2–4 周是 Phase 5 的第一个交付物与第一条成功标准，不是缓冲区
- [Phase 01]: 同意项定为五项（两必选三可选），新增 sensitive_pi 敏感个人信息处理单独同意；L2 人工阅读授权不纳入 M1 — PITFALLS-COMPLIANCE 的清单含法定的敏感个人信息处理项而 PRIV-01 原文没有；个保法第二十九条要求单独同意，且陪伴聊天第一条消息落库时即发生。L2 的研究管道在 Phase 7，提前收取一个无对应数据流的同意会违反 PRIV-03。
- [Phase 01]: 危机二级卡片撤下「会话内真人介入」承诺，改为不承诺会话内介入的等价文案；本阶段不提供会话内人工接管 — D-09 已把人工接管降级为会话外联系。留着不实现的承诺与在隐私文案里写「匿名」是同一性质的虚假陈述，不是待办事项。
- [Phase 01]: 三处契约修订与五份权威文档的一致性固化为 tools/ci/check-contract-amendments.mjs 的 13 条机械断言（含负向 fixture 与 --self-test） — Plan 02-15 的每条验收断言都绑定到这批契约文本，而绑定到过时契约的错误在测试全绿时不会被任何人发现；检查器自带负向输入以证明断言不是空真的。
- [Phase 01]: apps/api 的 import specifier 必须是 .ts：Node 24 不会把 ./x.js 改写成 ./x.ts，而被 tsconfig references 引用的项目不得 noEmit（TS6310），两条约束交集只剩 emitDeclarationOnly + allowImportingTsExtensions — 源码直连（Plan 02 的包 exports 策略）要求运行时能加载 TS；两条限制都是实测确认。给 Plan 04 的直接后果：跨包运行时 import 必须验证 specifier 形态，否则会 ERR_MODULE_NOT_FOUND
- [Phase 01]: pino 日志是白名单式的（logEvent + LOG_ALLOWED_FIELDS + redact 两道防线），不导出裸 logger；logError 只取 error.name，不取 message 或 stack — 日志文件是一个不能按行删除的存储位置，PRIV-05 的一键删除级联不到它，唯一诚实的姿态是从设计上不含个人信息。pg 的报错串里可能带 SQL 参数，而参数就是消息正文
- [Phase 01]: ws 与 process.env 两条包边界写进 eslint（ws 用 regex 而非 group），T-03-03 的 CI 放行构造断言搬进 ci:fast，都不再只是 PLAN 里的一次性 grep — 一条只在写代码那天跑过的 grep 与一条不存在的检查没有区别。group 形式会把相对路径 ./ws/server.ts 也算命中，会让「唯一导入者」退化成「谁都不能引用 ws 目录」
- [Phase 01]: shadcn 的 @shadcn/theme-slate 已不在 registry（现 214 项、零 theme 条目），init 现在强制要求 --preset；改取 preset nova 并移除它注入的 next/font Geist，调色板由 tokens.css 按 UI-SPEC ## Color 表逐值落地 — UI-SPEC 的 preset_field_note 已预先授权此类处置；两步预设的实质是「冷灰中性基座 + 覆写 --primary」，由 tokens.css 完全满足。所有 preset 都带网络字体，与「零网络字体开销」这条法定项冲突
- [Phase 01]: PG 18+ 官方镜像的数据卷挂载点是 /var/lib/postgresql 而非 /var/lib/postgresql/data；pnpm 12 写的 0600 lockfile 经 COPY 进镜像后非 root 用户读不到（两个 Dockerfile 都 chmod -R a+rX） — 两条都是实测踩到的部署坑。后者在 CI 的全新 clone 上复现不了（git 只存可执行位），只在构建上下文来自 pnpm 跑过的工作树时出现 —— 也就是本地构建与带缓存的 runner
- [Phase 01]: 本 plan 一次性定型 Phase 1 全部 22 张表：message.provenance/audience（IFC-08，one-way）、persona_version 三元组带 model_snapshot（PERS-10）、七张审计表族 append-only 由 PG 权限保证（D-06）。 — 三类字段事后补不了：无法为历史消息补溯源、无法为已有版本补快照标识、同意的收集时机事后补收即事后追认。
- [Phase 01]: drizzle-kit check 不连数据库，不能当漂移门禁；真正的门禁是 packages/db/scripts/assert-no-drift.mjs（drizzle-kit push + 断言 No changes detected 且输出无 pgboss）。 — 实测 check 在库与 schema 明显不一致时仍输出 Everything is fine 并退出 0。为了让「零漂移」可达，同时去掉了表达式 id 默认值与命名复合主键两处 drizzle-kit 往返噪声。
- [Phase 01]: llm_call 按每次 provider 调用各自短事务落库，不横跨 provider 网络调用；角色消息另起短事务。 — 崩溃只可能留下「有 llm_call、没有消息」（安全方向），反向由调用顺序排除。横跨网络调用的事务会把连接池上限直接变成并发上限。
- [Phase 01]: 不引入 @shadcn/react（message-scroller 的依赖）；chat-view 只用 bubble + message 两个原语加本地滚动锚定。 — UI-SPEC v1 明确不做虚拟滚动，该包唯一难自行实现的能力用不到；T-04-SC 禁止新增未经核验的包，而「脚手架顺手拉进来」正是它要拦的失效模式。
- [Phase 01]: 境外通道 chat.reply.frontier 从 CallMode 中整个移除，唯一入口是 callFrontier(readonly SyntheticText[]) — RESEARCH §5.1 只把 persona.probe 排除在 routed 之外。但「真实用户原文误发境外 provider」被 PITFALLS 列为 HIGH 且不可逆（发出即已出境），运行时判断与代码评审都来不及。把 frontier 也移出 CallMode 之后，境外通道在类型层只能接受合成文本，负向 type fixture（probe-routed.ts）证明普通 string 传不进去。
- [Phase 01]: LLM host 白名单拆成境内（ALLOWED_LLM_HOSTS）与仅合成（SYNTHETIC_ONLY_HOSTS）两张互斥表，另加已知网关黑名单 DENIED_LLM_HOSTS — 单张白名单不可同时满足 PLAT-06（真实对话只走境内 host）与 PLAT-07 + PLAT-05（必须存在一个境外的 frontier 条目且不得留空洞）。照字面实现只有两种结果：把境外 host 放进境内白名单（把 T-05-01 降级成一次代码评审），或给 frontier 填一个假 baseURL（配置与它声明的模型不自洽）。分成两张互斥表后，断言按角色分类判定，且两张表都不得与网关黑名单相交。
- [Phase 01]: prompt_version 取系统提示词的内容哈希，不取拼装后整段文本的哈希 — 01-04 用整段文本（含人格小传与本轮用户消息）的哈希做 version，于是每一行 llm_call 的 prompt_version 都不相同 —— 「当时生效的是哪一版提示词」这个问题反而答不出来，而那正是 PLAT-08 存在的理由。人格侧版本由 persona_version_id 负责，逐轮输入的同一性由 input_hash 负责，三者分工不重叠。
- [Phase 01]: glm-4.7-flash 的可 pin 性如实标成 alias-only（Q4），并在 SKIPPED_CHECKS.md 登记为一次检查强度降级 — 01-04 的 PINNABLE 里该模型是未核实的 snapshot。STACK §15.9 明确未找到带日期的快照 ID（Confidence MEDIUM）。标错的后果是 safety.classify 被厂商静默换掉而探针通过率的变化被归因错。三层处理：pinned 模式拒绝启动、routed 模式要求书面 aliasOnlyWaiver、nightly 的 resolved_model 日 diff 连续采样。
- [Phase 01]: 真实 provider 实例用 fetch 直连 git 写死的 baseURL，暂不引入 ai / @ai-sdk/* — 仓库里没有安装任何 provider SDK，而安装它是一次阻断式人工包合法性确认（Plan 02 协议）；Phase 1 的 LLM_PROVIDER_MODE 默认 mock。方向上直连也更强：PLAT-06 怕的是 AI SDK 字符串 model 写法默认路由到境外 AI Gateway，而直连一个写死的 baseURL 结构上没有这个形态。接 live 时再走一次 checkpoint 引入 AI SDK，届时 providers/openai-compatible.ts 是唯一需要替换的实现。
- [Phase 01]: EGRESS_POINTS 出口注册表 + AST 集合相等断言堵住 branded type 方案唯一的结构性缺口（新增出口接受 string 不报错） — 类型系统只检查已写成 GatedText 的签名，对「本该写 GatedText 却写成 string」没有意见；注册表把该缺口变成一条可失败的检查，失配信息分「未登记」与「已消失」两类以免修法搞反
- [Phase 01]: COMPLY-11 落成显式空集登记，front-matter 的 egress_hash 与 EGRESS_POINTS 绑定且不许 CI 自动更新 — 空集结论只在当时的出口集合上成立；自动更新哈希会绕过人工复核，把登记变成装饰
- [Phase 01]: 挽留话术改为网关内运行时拦截（词表一份定义，命中即不产出 GatedText 并写 safety_event） — 源码 grep 抓不到模型生成的挽留话术；验收目标是触发率恒为 0 而非低，故归一化去标点与零宽字符，接受极少数过拦截
- [Phase 01]: safetyGateway 的拒绝态沿用 Plan 04 的 outcome 判别式，不改成 PLAN 写的 ok:false — 两个判别式可以互相矛盾（ok:true + outcome:refused），而「不可表达」是这套类型方案的全部价值

### Pending Todos

None yet.

### Blockers/Concerns

- **中文 PII 检测器实际召回率未知**（Confidence LOW）—— 属 M2/P7，但 Phase 1 的 RES-02/RES-03 CI 断言必须先行，否则第一次复制发生后不可逆
- **GB 45438-2025 文本类隐式标识的落地形式需向标准原文复核**（Confidence LOW）—— 影响 Phase 1 的 COMPLY-02/09
- **张力 1 的法律侧未决**：全局 traits 演化是否构成第十六条第四款的「模型训练」。已按「构成」设计，公开上线前应取专业法律意见
- **Phase 2 需要一次 spike**：doubao-seed-character-251128 vs claude-sonnet-5 vs glm-5.3-flash vs qwen3.8-flash 的中文角色一致性盲测（成本约几十元，v1 最高价值 spike）
- **Phase 5 的 ε/k/位移上限/探针阈值不可靠讨论决定**，必须由 shadow 期数据校准
- 宿主 glibc 2.28 低于 Next 16 原生 SWC 要求的 GLIBC_2.29：本机无法 next build / next dev，前端开发必须在容器内进行或换宿主（01-03-SUMMARY Issues #1）
- integration / nightly 两条 workflow 目前必然为红（test:integration / test:probes 无被测对象；nightly 的两个脚本未落地），且三条 workflow 从未真实执行过（仓库无 git remote）—— 阻断规则的另一半是 GitHub 上的 required check 配置，不在仓库文件里

## Deferred Items

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-09-27T04:57:17.687Z
Stopped at: Completed 01-06-PLAN.md
Resume file: None
