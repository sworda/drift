# Phase 1: 合规安全地基 + 会话骨架 - Context

**Gathered:** 2026-09-26
**Status:** Ready for planning

<domain>
## Phase Boundary

一个新用户能完成 18+ 注册（年龄、监护人或紧急联系人、互不捆绑的同意项）→ 浏览预设角色库并添加一个角色为好友 → 在类微信界面来回文字聊天 → 在会话列表 / 聊天界面 / 角色详情页 / 导出文件四处持续看到 AI 标识 → 两级危机干预路径真实可用 → 一键导出与删除自己的全部数据并拿到显示存储处数的回执。

**本阶段澄清的是「怎么实现」，不是「要不要加能力」。** 拟真度（分条 / 重尾延迟 / 真实 typing / 错字自更正 / 已读不回）全在 Phase 2；记忆在 Phase 3；人格三元组的**演化管道**在 Phase 4-5。Phase 1 只交付会话骨架与合规安全地基。

**仓库状态：全新工程。** 讨论时仓库仅含 `.planning/`，零业务代码、无 git remote。Phase 1 包含首次脚手架搭建。

</domain>

<decisions>
## Implementation Decisions

### 工程地基与 CI

- **D-01:** 代码托管在 **GitHub 私有仓**，CI 用 GitHub Actions。
- **D-02:** **Actions runner 自建在那台境内云主机上**（self-hosted runner）。三重收益：危机探针集（成功标准 2，需真实 LLM 调用）能在每次 PR 上跑；LLM API key 只存在于境内本机而不进 GitHub Secrets；集成测试可访问真实 PostgreSQL 实例。— **Reversibility:** reversible — 切回 GitHub 托管 runner 只需改 workflow 的 `runs-on`。
- **D-03:** 部署形态 = **一台境内云主机跑 Docker Compose 单机全栈**（PG 18.6 + pgvector 0.8.6 / `apps/api` / `apps/web`）。10 人体量下一台足够，数据落地位置完全自控，四条「不向境内公众提供」抗辩最易做成可审计状态。— **Reversibility:** costly — 迁移涉及数据库搬迁与备案主体变更。
- **D-04:** **做非经营性 ICP 备案**（个人主体，一个域名）。理由：境内云厂商对未备案域名封 80/443；正常 HTTPS 是 Service Worker / Web Push（M2 的 LIFE-06）的前提。备案不破坏抗辩 —— 四条抗辩是「无公开注册入口 / 不上架 / ≤10 用户 / 无商业化」。— **Reversibility:** costly — 备案有主体实名与数日到数周周期。
- **D-05:** Phase 1 可观测性 = **pino 结构化日志 + `llm_call` 落库表**。PLAT-03 已要求 Model Router 每次调用落 provider / model / model_snapshot / token 数，那张表即最小可观测底座，天然在境内、天然可被 SQL 查。**Langfuse 整体推到 Phase 2**（EVAL-01..07 真正需要 dataset / experiment / LLM-as-judge 时再上），避免 Phase 1 未写业务代码就先背 Postgres + ClickHouse + Redis + S3 四个有状态组件。**明确否决 Langfuse Cloud**（境外，「只传 L0 不传原文」无技术强制手段）。
- **D-06:** 审计日志 **分类型建表、同库、append-only**：`safety_event`（SAFE-04 已要求）、`consent_event`（同意项变更）、`privacy_action`（导出 / 删除 / 撤回）、`llm_call`、`client_error`。— **Reversibility:** costly — 后续合表需数据迁移且会破坏已写的断言。
- **D-07:** COMPLY-10 的公开性状态 = git 内 **`compliance/publicness.json`**（四项状态）+ CI 断言 + 每日运行时用户数对账作业。真相源在 git，与 PLAT-08「提示词真相源在 git」同一原则。
- **D-08:** 「显式签字」机制 = **状态哈希双写 + CI 比对**。`publicness.json` 内除四项状态外存 `acknowledged_hash`（四项状态的哈希）；CI 断言「状态变更但 hash 未同步更新即失败」，且更新 hash 必须同时新增一份已勾选的 `compliance/CHECKLIST-{date}.md`。机械、可验证、无法顺手绕过。

### 安全与危机干预

- **D-09:** **人工接管降级为「会话外联系」。** acute 事件 IM 告警（企微/飞书机器人 webhook）给运营者，运营者**从会话外**直接联系用户（电话 / 微信），不做「在会话内以平台身份发消息」的接管后台。理由：人工接管是《专家解读》口径（SHOULD），非第十三条明文（MUST）；而「运营者可读取用户与角色的私密对话」本身是实质隐私侵入，需要写进隐私政策。→ **触发 UI-SPEC 修订，见下方 Required Amendments。**
- **D-10:** SAFE-04 的 `contact_attempt` 四态由 **「告警给运营者 + 运营者人工联络 + 后台手动推进状态」** 驱动。`delivered` 的判据是**真人确认已通话**，而不是「短信 API 返回 200」。明确否决境内短信 / 语音外呼自动通道：需签名报备与模板审核（个人主体难申请、危机类文案难过审），且 API 成功回执只能证明「已提交运营商」，在非 `delivered` 时渲染「已经联系了」是 UI-SPEC 明文禁止的虚假陈述。
- **D-11:** `pending` **超时 10 分钟**，由**服务端**置为 `failed`（UI-SPEC：前端不得自行 `setTimeout`）。10 分钟 = 运营者被叫醒并完成一次通话的现实下限，同时对危机中的用户等待仍可接受。超时后按 UI-SPEC 已定行为把「拨打 12356」提到卡片首屏第一行。
- **D-12:** 硬退出关键词**分两档**：
  - 第一档 —— 明确指令（「退出」「结束」「停」「别发了」「不想聊了」「不想聊」）→ **立即硬退出**，走 COMPLY-05 全套（中性系统卡片 + 输入框禁用 + 当前会话零出站）。
  - 第二档 —— 模糊告别（「明天聊」「先这样」「睡了」）→ Phase 1 **只落 `exit_intent` 事件、不触发任何动作**，为 Phase 5 的 SAFE-11「退出意图处只能减少消息、永不增加」预留数据。
  - 实现为**代码级过滤器 + 自动化测试用例**，不是 prompt 约束（PITFALLS-SAFETY.md:156）。明确否决「用 LLM 判定退出意图」—— 不可测、会在长上下文失效。
- **D-13:** COMPLY-04 / SAFE-14 的依赖判据 = **三条确定可判定的硬阈值，任一命中即触发，同一用户 72h 内不重复**：① 单日累计使用 ≥3 小时；② 连续 7 天每天都有会话；③ 近 7 天内 23:00–06:00 会话占比 >40%。全部写成**配置常量**并落 `dependency_signal` 表。**阈值明确是保守起点、待 Phase 2 用真实数据校准**（SUMMARY：10 人样本只支持定性观察）。明确否决「单一角色集中度」维度（Phase 1 只有 3 个角色，该值恒接近 100%，会持续误报）。
- **D-14:** COMPLY-03 的「连续使用」定义 = **15 分钟无消息收发算本段结束并清零累计；多角色会话时长合并计入同一计时器**（R1.03 明文「累计计时、跨角色合并」）。计时器在服务端，跨页面刷新与重新登录有效（成功标准 5）。
- **D-15:** 出站安全网关的「不可绕过」用 **branded type 单一出口**保证：定义 `type GatedText = string & { readonly __gated: unique symbol }`，只有 `safetyGateway()` 能产出；**WS 下发 / 消息落库 / 导出管道三个出口的函数签名都只接受 `GatedText`**。绕过在编译期不可表达，新增出口时类型系统主动报错。叠加 ESLint 禁止 `as GatedText` 断言 + 集成测试兜底。— **Reversibility:** costly — 类型贯穿三个出口与全部调用点，改回运行时校验需重写签名。

### 隐私与法务交付物

- **D-16:** 隐私政策与服务协议正文 **由 Claude 按 PRIV-03/06/07 + UI-SPEC 的〔禁用〕规则与语气基线起草，落在 `apps/web/content/legal/privacy.md` 与 `terms.md`（静态 Markdown，可被 CI grep 直接扫到），由用户审定。** 公开上线前另取专业法律意见（PROJECT.md 已列为「仍需外部输入」）。明确否决通用模板起头 —— 模板几乎必然带「匿名」「不可追溯」，正是禁用词规则 1 要杀的东西。
- **D-17:** PRIV-08 保存期限**分层设定**（个保法第十九条要的是「实现处理目的所必要的最短时间」，本质是上限）：
  | 数据 | 期限 |
  |---|---|
  | 聊天原文 | 账号存续期间保留，**硬上限 24 个月**滚动清理 |
  | L0 行为特征 | 24 个月 |
  | 导出文件 | 生成后 **7 天**自动清理（全量副本，留存风险最高） |
  | 审计日志 | **6 个月**（COMPLY-11 的下界） |
  24 个月的理由：Phase 3 的长期记忆需要足够窗口，同时不是「先留着以后可能有用」。— **Reversibility:** costly — 延长容易，事后缩短会真实删除已有数据且影响记忆能力。
- **D-18:** PRIV-09（PIA）与 PRIV-10（provider DPA）**算 Phase 1 的 Definition of Done**，产出物入 repo：`compliance/PIA-2026.md`（第五十五条要求留存 ≥3 年）+ `compliance/dpa/{provider}.md`（每家一份，含「关闭数据用于模型改进」的配置证据）。加一条 **CI 断言：Model Router 路由表里出现的每个 provider 必须在 `compliance/dpa/` 有对应文件，否则构建失败** —— 把法务动作变成机器可验证的结构。
- **D-19:** 删除 = **硬删除 + pg-boss worker + 显式存储位置注册表**。代码维护 `STORAGE_LOCATIONS` 常量数组（每项 = 名称 / 删除函数 / 是否含个人信息）；删除 worker 遍历它，**回执数量 = 实际执行成功的项数**。配 CI 断言：**新增的表必须在注册表登记，或显式标注「不含个人信息」，否则构建失败**。这把 RES-10（不依赖外键、显式实现）与 PRIV-05（回执显示数量）统一成同一个可验证结构，并堵住「新增存储位置导致静默漏删」。明确否决软删（在用户面前说「已清除 N 处」而数据还在，与 `contact_attempt` 那条原则同性质）与运行时 `information_schema` 枚举（枚举不到导出文件 / 缓存 / 日志，数字显得精确却骗人）。— **Reversibility:** one-way — 硬删数据不可恢复。
- **D-20:** **同意项由 4 项改为 5 项，两必选三可选。** 详见下方 Required Amendments —— 这是一处需求内部不一致的裁决。— **Reversibility:** one-way — 事后补收同意即事后追认，已处理的历史数据无法被合法化（SUMMARY：「合规可以后补，历史不能」）。
- **D-21:** COMPLY-11 处理为**显式登记的空集**：Phase 1 所有对外提供路径（WS 下发、导出 .md/.json）都带标识（由 D-15 的三个出口 + 导出管道 `[AI]` 前缀保证），故留存义务为空集。落成 `compliance/no-unlabeled-output.md` 一份登记，并在 CI 里绑定「出站出口函数数量变化即要求复核该登记」。

### 会话骨架

- **D-22:** 注册准入 = **邀请码 + better-auth 邮箱密码**。年龄**自填生日即信**（COMPLY-07 只要求「确认已满 18」，不要求校验）。紧急联系人手机号**应用层加密存储**、界面遮蔽（`138****1234`）。**R1.23 的可达性确认明确记录为「未确认」** —— 这正是 R1.23 允许的第二条路，也正是 UI-SPEC 的 `unavailable` 态存在的原因。明确否决短信验证码（境内短信无资质）与手动建号（与成功标准 1「独立走完注册」冲突，四个同意项也失去收集时机）。— **Reversibility:** costly — 改认证方式需迁移已有用户凭证。
- **D-23:** 邀请码 = **一次性、可撤销、不过期**，`invite_code` 表记 `{ code, created_by, used_by, used_at, revoked_at }`。**联动：每日对账作业统计已使用码数写入 `publicness.json` 的 `registered_users`** —— 让 COMPLY-10 的「注册用户数」有单一可信来源，超过 10 即告警并阻断下次发布。明确否决通用多次码（泄漏即等于有了公开注册入口，且不会被察觉）。
- **D-24:** Phase 1 回复形态 = **整段生成 → 过出站安全网关 → 落库取 seq → 经 WS 投递**，等待期前端显示 typing 指示。关键收益：整段生成时 **typing 持续时间天然等于实际生成时间**，REAL-03 的核心约束在 Phase 1 即自动满足，Phase 2 只需在其上叠加延迟函数与语义分条，**不重写投递链路**；且 CHAT-07「先落库取 seq 再投递」严格成立。明确否决流式增量下发：与 CHAT-07 冲突（chunk 无 seq，重连补拉拿不到半条消息）、Phase 2 需整段重做、且逐 token 流出绕过了出站安全网关（成功标准 2 要求证明不存在此路径）。— **Reversibility:** costly — 改为流式需重写投递链路与网关接入点。
- **D-25:** 预设角色库 = **3 个角色**（成功标准只要求加「一个」，但 3 个才撑得起「浏览角色库」与 UI-SPEC 的两个空态）。人设由 Claude 按 PERS-03 的大五 5 维 + 9 个社交行为倾向维出草案，用户改到满意，受 COMPLY-08 约束（不得指向现实亲属或特定真人）。**数据现在就按最终 schema 建表**（`character` + `persona_version` 三元组），Phase 1 只填 `core` + 一版 `traits`/`dossier`、**不建演化管道**。关键理由：PERS-10 要求每条 `persona_version` 记 `model_snapshot`，事后补不了；临时 JSON 会让 Phase 4 既要迁移又丢掉这一版的快照标识，而冻结 baseline 从 Phase 2 起就要积累。— **Reversibility:** costly — 改回 JSON 种子需迁移且丢失 model_snapshot 起点。
- **D-26:** IFC-08 的六项数据模型，Phase 1 **只预留附着在 `message` 上的三项**：① `message.provenance`（来源用户 / 来源会话 / 获取方式）；② `message.audience` 枚举（Phase 1 恒为 `user`，为 `other_character` 预留）；③ 事件总线 topic 命名空间约定（与 WS 下行事件共用定义，ARCHITECTURE.md §17.6）。判据：IFC-08 的不可后补性来自「事后无法为历史消息补溯源」—— 只有附着在历史消息上的字段有这个性质。其余三项（`info_item` 表、`disclosure_capability` 票据、`character_relationship`、`memory.source_kind`）不附着历史消息，等各自阶段建。— **Reversibility:** one-way — 历史消息的溯源字段无法事后补齐。

### 开发与运维体验

- **D-27:** 本地开发与测试的 LLM 调用 = **在 Model Router 路由表里加一个 `mock` provider**（按输入返回确定性响应）；单元测试与本地开发默认走它，危机探针集与集成测试用环境变量切到真实 provider（在自建 runner 上跑）。复用 PLAT-03 已要求的必经路由，不引入第二套注入机制，且「mock 也必须经 Router」本身就是对 PLAT-03 的一次验证。明确否决 msw/nock HTTP 层拦截（绕过 Router 的落库与可 pin 性检查，测试路径与生产不同）与 fixture 回放（会腐坏且无人知晓）。
- **D-28:** 前端异常**自建最小上报端点**：`apps/api` 开 `/telemetry/error`，前端全局 error boundary + `unhandledrejection` 上报到 `client_error` 表（同库、append-only、同样登记进 `STORAGE_LOCATIONS`）。理由：UI-SPEC 把「错误态与空态必须可区分、不得静默渲染成空列表」列为契约，没有上报就无法知道它是否被违反。明确否决 Sentry 等第三方云 —— breadcrumb 极易携带用户消息片段，是一条隐蔽出境路径，性质同 Langfuse Cloud。

### Claude's Discretion

用户对全部 22 个问题都做了明确选择，无「你决定」项。以下留给 planner 在上述约束内自行决定：云厂商具体选型、Docker Compose 的服务编排细节、drizzle 迁移目录结构（STACK.md 已要求 app 与 research 分离）、`mock` provider 的响应构造方式、IM 告警机器人选企微还是飞书。

</decisions>

<required_amendments>
## Required Amendments —— Phase 1 的第一个 plan 必须先执行

本次讨论裁决了三处与现有已批准文档的冲突。**planner 必须把这三处修订排进第一个 plan，先修订再实现**（UI-SPEC 自定规则：改〔法定〕条目必须先改 REQUIREMENTS.md）。

### A-01 · UI-SPEC 危机干预契约的文案（因 D-09）

- **位置：** `01-UI-SPEC.md` ## 危机干预呈现契约 的二级卡片「必含内容」行
- **现文案：** 「极端情况下会有真人介入这段对话」
- **改为：** 语义等价于「我们已经收到通知，会尽快直接联系你」（不承诺会话内介入）
- **理由：** D-09 决定人工接管降级为会话外联系。留着原文案不实现即虚假陈述，与写「匿名」同性质。

### A-02 · 隐私中心新增「危机事件会通知运营者」披露（因 D-09）

- **需要一个新 REQ-ID**（建议 `PRIV-11`），否则这条文案无人负责、不会被验收
- **内容：** 隐私中心「我们收集了什么」须如实列明「触发二级危机时，系统会将该事件通知运营者（不含对话内容）」
- **理由：** PRIV-03 要求说明与实际数据流一致。D-09 的 IM 告警是一条新的个人信息流向，必须告知。

### A-03 · 同意项由 4 项改为 5 项（因 D-20）

- **冲突证据：** `REQUIREMENTS.md` PRIV-01 列「基础服务 / L0 行为特征研究 / L1 原文研究授权 / 人格演化贡献」；`PITFALLS-COMPLIANCE.md:174` 列「L1 研究授权 / L2 人工阅读授权 / 人格演化参与 / **敏感个人信息处理**」。两份清单不一致，且差的那项是法定的。
- **裁决：** 改为 5 个独立 `Checkbox`：
  | # | 同意项 | 必选 | 依据 |
  |---|---|---|---|
  | 1 | 基础服务与服务协议 | ✅ 必选 | 合同履行必要 |
  | 2 | **敏感个人信息处理** | ✅ 必选 | **个保法第二十九条单独同意；PROJECT.md 明写「陪伴聊天高概率含敏感个人信息」，Phase 1 第一条消息落库时即发生** |
  | 3 | L0 行为特征研究 | 默认未勾 | PRIV-01 |
  | 4 | L1 原文研究授权 | 默认未勾 | PRIV-01 |
  | 5 | 人格演化贡献 | 默认未勾 | PRIV-01 |
  仍**不存在「全选」控件**（UI-SPEC 交互契约，第十四条禁止捆绑）。
- **需同步修订：** `REQUIREMENTS.md` PRIV-01 正文；`01-UI-SPEC.md` ## 本阶段覆盖的用户可见面 第 1 行与 ## 交互契约「四个同意项（PRIV-01）」行。
- **注：** L2 人工阅读授权**不**纳入 Phase 1 —— 研究管道在 Phase 7，此时收一个无对应数据流的同意会违反 PRIV-03「说明与实际存储字段一致」。

</required_amendments>

<requirement_gaps>
## Requirement Gaps —— 本次讨论查出的覆盖缺口

以下能力在 research 的 P0 门禁里被明确要求，但在 `REQUIREMENTS.md` 的 Phase 1 清单里**没有对应 REQ-ID**。本次讨论已为它们定了实现方案（见 decisions），但 planner 应决定是补 REQ-ID 还是作为「实现细节」纳入既有需求的验收。

| 缺口 | research 出处 | 本次裁决 |
|---|---|---|
| 人工接管 / acute 事件告警 | `PITFALLS-SAFETY.md:117` R1.22；`PITFALLS-SAFETY.md:455` P0 门禁明列「危机检测与升级 **+ 人工接管**」 | D-09 + A-01 + A-02（建议新增 `PRIV-11`，并考虑为告警链路新增 `SAFE-16`） |
| 隐私政策 / 服务协议**正文** | `PITFALLS.md:393` 把二者列为 Phase 0 交付物；PRIV-06 的禁用词 CI 断言以它为作用域 | D-16（断言的被测对象由此产生） |
| 审计日志 / 可观测性 | `PITFALLS-SAFETY.md:455` P0 门禁含「审计日志」；SUMMARY P0 含 R-OBS-1/2；而 PLAT-11 被排到了 Phase 2 | D-05 + D-06 + D-28 |

</requirement_gaps>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 本阶段的已批准契约（最高优先级）

- `.planning/phases/01-compliance-safety-chat-skeleton/01-UI-SPEC.md` — **已 approved 的 UI 设计契约（60KB）。** 视觉、文案、交互、三条〔法定〕呈现契约（AI 明示标识 / 危机干预 / 硬退出）、视觉锚点、禁用词 CI 规则全部锁定。标〔法定〕的条目 executor 不得以「视觉更干净」调整。**注意：本文件有两处待修订，见 `<required_amendments>` A-01 / A-03 —— 先修订再实现。**

### 需求与范围

- `.planning/REQUIREMENTS.md` — 唯一的需求编号权威。Phase 1 = 44 条（COMPLY-01..11 / SAFE-01..05,14 / PRIV-01..10 / CHAT-01..07 / PLAT-01..03,05..08 / IFC-08 / RES-02,03）。**PRIV-01 待修订，见 A-03。**
- `.planning/ROADMAP.md` — Phase 1 的 Goal 与 5 条 Success Criteria（含 3 条【机器断言】）；§不可重排的排期约束表；两处对分派指令的显式偏离及理由。
- `.planning/PROJECT.md` — Core Value、Out of Scope（含 8 条永久排除）、Constraints（合规/隐私/出境硬约束）、22 条 Key Decisions、5 条 Resolved Questions。

### 技术栈与架构

- `.planning/research/STACK.md` §1 / §13 — 推荐栈总览与 v1 起步安装清单（Node 24.21 / pnpm 12.6.0 / TS 7.0.2 / hono 4.13.9 / ws 8.21.3 / pg-boss 12.34.0 / drizzle-orm 0.45.3 / **better-auth 1.7.6** / ai 7.0.114 / next 16.3.6 / react 19.3.0 / tailwind 4.3.3）。
- `.planning/research/STACK.md` §2 / §15.1 — AI SDK 7 + 自写路由表；Model Router 是可强制执行的边界；**§2 的实现陷阱必须写进代码规范**（PLAT-06 的 ESLint 规则来源）。
- `.planning/research/STACK.md` §4 — 单条 WebSocket 承载全部、DB 是真相源（CHAT-07 的依据，也是 D-24 否决流式的依据）。
- `.planning/research/STACK.md` §6 / §15.3 / §15.10 — pg-boss 选型理由、长任务租约续期、应用层幂等键。
- `.planning/research/STACK.md` §8 / §11 — 数据库与研究数据存储；版本兼容矩阵（**§11 的 Langfuse 自托管 vs Cloud 折中已由 D-05 裁决为「Phase 1 都不用」**）。
- `.planning/research/STACK.md` §15.9 — 模型可 pin 性矩阵（显式表，不得正则猜；PLAT-03 的依据）。
- `.planning/research/ARCHITECTURE.md` §9 — Recommended Project Structure（PLAT-01 的 `apps/web` + `apps/api` 结构来源）。
- `.planning/research/ARCHITECTURE.md` §14 — Integration Points：External Services 表 + Internal Boundaries 表（含「全体 ↔ Model Router 禁止直连 provider SDK」）。
- `.planning/research/ARCHITECTURE.md` §17.6 — 事件命名空间与 WebSocket 下行事件共用定义（**D-26 第三项的依据**）。
- `.planning/research/ARCHITECTURE.md` §11.2 — 一次用户消息的完整时序（D-24 投递链路的参照）。

### 安全与危机

- `.planning/research/PITFALLS-SAFETY.md` §1.x R1.01–R1.24 — 危机干预全套。**重点：R1.20 双层检测、R1.21 会话级风险状态机、R1.22 人工接管队列（D-09 降级的原始要求）、R1.23 紧急联系人可达性验证（D-22 的依据）、R1.24 覆写消息不得伪装角色发言（UI-SPEC 危机契约的承重约束）。**
- `.planning/research/PITFALLS-SAFETY.md` §1.4 三档风险状态表（A 常规 / B 关注 / C 高危）与「抑制退化 ≠ 升级亲密」界限。
- `.planning/research/PITFALLS-SAFETY.md` §4.4 P0 门禁 — 危机探针集 100% / 硬退出关键词测试 / 无生成路径绕过网关。
- `.planning/research/PITFALLS.md` §法条映射表（第十八、十九条行）— 退出关键词识别器的示例词表（D-12 第一档的起点）。

### 合规与隐私

- `.planning/research/PITFALLS-COMPLIANCE.md` §1.4 — AI 标识义务的两条预警信号（UI-SPEC 标识契约的依据）。
- `.planning/research/PITFALLS-COMPLIANCE.md` 第 174–176 行 — **同意项清单（A-03 的冲突证据）**、第十九条最短保存期限（D-17 的依据）、第五十五条 PIA（D-18 的依据）。
- `.planning/research/PITFALLS-COMPLIANCE.md` §规模三档与豁免强度 — 四条抗辩的构成要件（COMPLY-10 与 D-04/D-23 的依据）。
- `.planning/research/SUMMARY.md` §三「现在做 vs 公开前做」— v1 不可后补清单（Phase 1 范围的权威口径）。
- `.planning/research/SUMMARY.md` §五 P0 行 — 交付能力、需求类别、出场门禁。
- `.planning/research/SUMMARY.md` §六 错误 2 — 「把静默失效当成出问题会知道」+「只建撤不建门」（D-08/D-15/D-19 三条 CI 断言机制的共同理由）。

### 本阶段将产生的合规产出物（尚不存在，由 Phase 1 创建）

- `apps/web/content/legal/privacy.md` / `terms.md` — D-16；禁用词 CI 断言的作用域
- `compliance/publicness.json` + `compliance/CHECKLIST-{date}.md` — D-07 / D-08
- `compliance/PIA-2026.md` + `compliance/dpa/{provider}.md` — D-18
- `compliance/no-unlabeled-output.md` — D-21

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

**无 —— 全新工程。** 讨论时仓库仅含 `.planning/`（+ `.claude/`），零业务代码、零 `node_modules`、无 git remote、无 `components.json`。Phase 1 包含首次脚手架搭建。

可直接复用的是**外部 registry 资产**，已由 UI-SPEC 枚举并锁定：
- shadcn CLI 4.21.0 的 61 个 `registry:ui` 组件，Phase 1 实际子集见 `01-UI-SPEC.md` ## Component Inventory
- `bubble` / `message` / `message-scroller` 三个聊天原语（**`BubbleContent` 默认 `text-sm` 必须覆写为 `text-base`**，UI-SPEC 硬约束）
- 危机关怀卡片**必须用 `Alert` 而非 `Bubble`** —— 组件层的区分让「伪装成角色发言」在代码层不可能发生（R1.24）

### Established Patterns

尚无代码层模式。以下是本阶段必须**建立**并被后续阶段继承的结构性约束：

- **Model Router 必经** —— 禁止直连 provider SDK（PLAT-03 + ARCHITECTURE §14 Internal Boundaries）。D-27 的 `mock` provider 也走它。
- **branded type 单一出口** —— D-15；三个出口签名只接受 `GatedText`。
- **显式存储位置注册表** —— D-19；`STORAGE_LOCATIONS` + CI 断言，后续每个阶段新增表都要登记。
- **append-only 审计表族** —— D-06；后续阶段的 `persona_evidence` / `disclosure_decision` 等应沿用同一模式。
- **真相源在 git** —— PLAT-08（提示词）+ D-07（公开性状态）+ D-18（合规产出物）同一原则。
- **shadcn 两步预设，不得用 `--template`** —— 先按 STACK.md §13 建 `apps/web` 锁定版本，再在其中 init（UI-SPEC ## Design System 的硬约束，`--template next` 会绕过版本锁定与 PLAT-01 结构）。

### Integration Points

- **GitHub 私有仓 ↔ 境内云主机 self-hosted runner** — D-01 / D-02；CI 执行在境内，代码托管在境外（仅代码，不涉用户数据）
- **`apps/api` ↔ IM 机器人 webhook** — D-09；acute 事件告警的唯一出口
- **`apps/api` ↔ 单 PostgreSQL** — OLTP + pgvector（Phase 1 建列不用）+ pg-boss 队列共库（PLAT-02）
- **`apps/web` ↔ `apps/api`** — REST + 单条 WebSocket（STACK §4）
- **Model Router ↔ 5 个语义模型角色** — Phase 1 实际用到 `chat.reply`（doubao-seed-character-251128）与 `safety.classify`（glm-4.7-flash）；`persona.probe` 的无降级链约束现在就要在类型层表达（ARCHITECTURE §14：「应在类型层面使 routed 不可表达」）

</code_context>

<specifics>
## Specific Ideas

- **「像不像真人」在 Phase 1 不是目标，但投递链路要为它让路。** D-24 的整段生成之所以被选中，关键不是简单，而是「typing 时长天然等于生成时长」直接满足了 Phase 2 的 REAL-03 核心约束 —— Phase 2 只叠加延迟与分条，不重写链路。
- **「门先于撤」在 Phase 1 的三个具体落点。** D-08（publicness hash 比对）、D-15（branded type）、D-19（STORAGE_LOCATIONS 注册表）都是「让错误在编译期/CI 期不可能」而不是「出错后能查」—— 这是 PROJECT.md「门先于撤」原则在本阶段的全部兑现。
- **诚实优先于体验，且这条被用户反复确认。** D-10 拒绝自动短信是因为「API 返回 200」不能证明送达；D-19 拒绝软删是因为回执会陈述尚未发生的事；D-09 宁可改承诺文案也不做「留着不实现」。三处是同一个判断。
- **用户质疑了「真人介入 AI 对话」的正当性**，并在得知它是 SHOULD 而非 MUST、且介入本身构成隐私侵入后，选择降级承诺而非实现能力。这是一次明确的价值权衡，不是省事 —— planner 不得以「R1.22 说这是最有效的护栏」为由把接管后台加回来。

</specifics>

<deferred>
## Deferred Ideas

| 想法 | 去向 | 理由 |
|---|---|---|
| Langfuse v4 自托管（trace + prompt 版本 + dataset/experiment + LLM-as-judge） | **Phase 2** | D-05；EVAL-01..07 真正需要它时再上，Phase 1 不为四个有状态组件买单 |
| 会话内人工接管后台（以平台身份发消息） | **不做（已裁决）** | D-09；SHOULD 非 MUST，且构成隐私侵入。承诺文案改为会话外联系 |
| 境内短信 / 语音外呼自动联络通道 | **公开上线前（Phase 10）** | D-10；需签名报备与模板审核，个人主体难申请；且 API 回执不能作为 `delivered` 判据 |
| L2 人工阅读授权同意项 | **Phase 7** | A-03 注；研究管道在 Phase 7，提前收取会违反 PRIV-03「说明与实际存储字段一致」 |
| `info_item` 表 / `disclosure_capability` 票据 / `character_relationship` / `memory.source_kind` | **各自阶段（Phase 6 / Phase 9）** | D-26；这四项不附着历史消息，无 IFC-08 的不可后补性 |
| 「单一角色集中度」依赖度维度 | **Phase 2 之后** | D-13；Phase 1 只有 3 个角色，该值恒接近 100% 会持续误报 |
| 依赖阈值与节律窗口的**真实值** | **Phase 2 校准** | D-13；SUMMARY 明说 10 人样本只支持定性观察，Phase 1 的值是保守起点 |
| 前端 source map / 会话回放级别的错误诊断 | **v2 或不做** | D-28；Sentry 云端是出境路径，自托管运维量大于收益 |
| Web Push 触达 | **M2（LIFE-06）** | D-04 的 ICP 备案为它保留了 HTTPS 前提，但本身不属 Phase 1 |

**无 scope creep。** 讨论全程未偏离 Phase 1 域 —— 22 个决定全部是「怎么实现已在范围内的 44 条需求」，用户唯一一次追问（人工接管的正当性）反而**缩小**了范围。

</deferred>

---

*Phase: 1-compliance-safety-chat-skeleton*
*Context gathered: 2026-09-26*
