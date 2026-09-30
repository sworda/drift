# API Coverage — Phase 1 的三个外部集成面

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
>
> 探测器判定：`detected: true`（信号 `(surface)/sdk`）。本阶段确实集成外部 API，故产出矩阵而非声明。
> 本阶段有**三个**外部集成面，各自从 full-coverage 基线独立决定 —— 第二个 provider **不**继承第一个的 opt-out（同一 need 的第二次集成必须重新逐项决定）。

---

## 1. LLM Provider 面 —— AI SDK 7（`ai@7.0.114`）经 `packages/llm` Model Router

**已签约通道（Phase 1 实际使用）：** 火山方舟 `doubao-seed-character-251128`（`chat.reply`）、智谱 `glm-4.7-flash`（`safety.classify`）、`mock`（本地与单测）。
**边界：** `packages/llm` 是 `@ai-sdk/*` 的唯一导入者；能力只以 Router 的 `CallMode` 暴露，不透传 SDK 原生入口。

| capability | decision | reason |
|---|---|---|
| `generateText`（整段生成） | INTEGRATE | |
| `generateObject`（结构化输出 + schema 校验 + 修复重试） | INTEGRATE | `safety.classify` 的风险分级必须是结构化的；校验失败即 fail-closed 到 `elevated`（SAFE-05） |
| 调用元数据落库（provider / model / token / 计价 / latency） | INTEGRATE | PLAT-03 + RESEARCH §5.2；落库字段含 requested_model / resolved_model / provider_request_id；`turn_id` 与 `purpose` 是本阶段最高杠杆的两列 |
| `pinned` 快照调用模式（禁别名解析、禁降级） | INTEGRATE | PLAT-04 的类型层形状现在就定（`persona.probe` 在类型层不可为 `routed`），Phase 2 才有对照臂数据 |
| 超时 / 取消（AbortSignal） | INTEGRATE | 超时必须映射到 fail-closed `elevated`，不能挂起 turn |
| 重试策略（`maxRetries`） | INTEGRATE | 需显式设定，默认值会让 `safety.classify` 的失败被静默吞掉 |
| `streamText` / `streamObject`（流式） | OPT-OUT | D-24 已裁决整段生成：流式与 CHAT-07（chunk 无 seq）和出站安全网关（半句无法判定）结构上不相容；Phase 2 也不启用 |
| `embed` / `embedMany`（嵌入） | OPT-OUT | 记忆系统在 Phase 3；RES-02 明文禁止 L0 存原文嵌入，Phase 1 建列不用 |
| tool calling / function calling | OPT-OUT | Phase 1 无工具位面；角色不调用任何外部能力 |
| 图片 / 文件 / 音频多模态输入 | OPT-OUT | Phase 1 只有文本消息（UI-SPEC E4 明确未指派 `media` kind），多模态属 v2 的 MM 类别 |
| reasoning / thinking 模式与 reasoning token 回传 | OPT-OUT | 本阶段两个语义角色都不需要；`llm_call.thinking_mode` 列先建、值恒为关闭 |
| prompt caching（缓存前缀） | OPT-OUT | 属 PLAT-09，在 Phase 2；Phase 1 的提示词尚未稳定到值得冻结前缀 |
| provider 中间件 / 自定义 fetch 包装 | OPT-OUT | 会成为绕过 Router 落库与可 pin 性检查的第二条路径，与 PLAT-03 冲突 |
| 降级链（fallback chain 自动换 provider） | OPT-OUT | DRIFT-04 明文「无降级链，失败即告警而非切换 provider」；`safety.classify` 失败走 SAFE-05 的 fail-closed 而不是换模型 |
| Vercel AI Gateway（`model: "provider/name"` 字符串写法） | OPT-OUT | **法定禁止** —— 该写法默认路由到境外网关，照官方文档抄即构成数据出境（PLAT-06）；由 ESLint 规则 + 负向 fixture 强制 |
| 境外 frontier 通道（`chat.reply.frontier`） | OPT-OUT | Phase 1 不调用；但签名现在就定为只接受 `SyntheticText`（PLAT-07），因为「发出即已出境」不可逆 |

---

## 2. 运营者告警面 —— 企业微信群机器人 Webhook（`notifyOperator`）

**基线重置说明：** 这是对「把 acute 事件送到运营者手上」这个 need 的**第一次**集成。Q6 已裁决只实现企业微信；飞书通道若将来加入，从**同一条 full-coverage 基线**重新逐项决定，不继承本表的 opt-out。

| capability | decision | reason |
|---|---|---|
| `msgtype: text` 发送 | INTEGRATE | SAFE-16 的唯一投递形态；载荷类型 `AcuteAlert` 只含 `{ userId, conversationId, riskLevel, occurredAt, safetyEventId }` |
| `mentioned_list` / `mentioned_mobile_list`（@运营者） | INTEGRATE | 「运营者手机上有推送且能被叫醒」是 Q6 的选型判据，不 @ 到人等于没告警 |
| HTTP 响应码与 `errcode` 判读 | INTEGRATE | 2xx + `errcode:0` 才是 `contact_attempt.pending` 的进入条件；其余一律 `unavailable`（RESEARCH §4.5） |
| 投递超时与失败分支 | INTEGRATE | 投递失败必须**立即**进 `unavailable` 并把热线提到卡片首屏第一行，不得先渲染 `pending` 再翻成失败 |
| `msgtype: markdown` / `markdown_v2` | OPT-OUT | 富文本会诱使把对话上下文塞进告警；纯 text + 固定字段是「告警载荷不含对话文本」这条断言的最简保障 |
| `msgtype: image` / `news` / `file` / `voice` | OPT-OUT | 本阶段无需要投递的媒体；且文件类投递是一条新的个人信息出境面 |
| `msgtype: template_card`（交互卡片、按钮回调） | OPT-OUT | 交互回调需要公网回调地址与应用凭证，且会把「运营者确认已通话」这个**必须是真人判断**的动作变成一次点击（D-10 明文否决把非真人确认当作 `delivered`） |
| `upload_media`（素材上传） | OPT-OUT | 仅服务于媒体消息类型，已 opt-out |
| 企业微信应用消息 / 通讯录 / OAuth 身份 | OPT-OUT | 群机器人 webhook 已满足需求；引入应用凭证会把企业微信变成一个身份提供方，超出本阶段范围 |
| 告警回执写回（运营者在企微内直接推进 `contact_attempt` 状态） | OPT-OUT | 状态推进在自建后台完成（D-10）；让状态机有第二个写入方会破坏「`delivered` 的判据是真人确认已通话」 |

---

## 3. 外部依赖但非 API 集成面（登记以免被误读为遗漏）

| 依赖 | 性质 | 说明 |
|---|---|---|
| better-auth 1.7.6 | 进程内库，非外部 API | 邮箱密码在本库落地，不调用任何外部身份提供方；社交登录 / 邮箱验证 / 双因素等能力面**全部 OPT-OUT**：D-22 明确注册准入是「邀请码 + 邮箱密码」，且境内短信无资质 |
| pg-boss 12.34.0 | 进程内库 + 同库 schema | 非网络 API；延迟投递 API 形态以 `node_modules/pg-boss` 的 `.d.ts` 为准（Q5） |
| PostgreSQL 18.6 / pgvector 0.8.6 | 自托管服务 | 同机 Docker Compose，非第三方 API |
| Langfuse Cloud / Sentry / 境外可观测性 SaaS | **永久 OPT-OUT** | D-05 / D-28：均为隐蔽出境路径（trace 与 breadcrumb 极易携带用户消息片段），与 PLAT-07 冲突 |
