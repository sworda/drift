---
status: issues
phase: 01-compliance-safety-chat-skeleton
depth: standard
reviewed_files: 78
generated: 2026-09-29
---

# Phase 1 Code Review

## Summary

对 Phase 1 全量改动（322 文件）按风险优先级评审：深读 packages/safety 全部源文件、apps/api 的网关/鉴权/WS/worker 链路、packages/db 的注册表与加密、packages/llm 全部源文件、apps/web 核心交互层与基础设施（compose/Caddy/CI）。整体工程质量非常高：GatedText 单一产出点、EGRESS_POINTS 集合相等断言、fail-closed 语义（resolveRisk 封顶 elevated、buildCareCard 空清单兜底、classifySafety 永不抛错）、STORAGE_LOCATIONS/DATA_INVENTORY 双腿对账、host 白名单 + 启动期断言等契约均如实落地且多数有负向 fixture 证明非空真。发现 1 个 critical 鉴权缺口（WS 实时通道完全无鉴权）、1 个 medium（Caddy 访问日志记录 query 中的凭证/会话 id 且未进存储清单）、4 个 low 质量/一致性问题。

## Findings

| # | severity | file:line | 问题 | 建议 |
|---|----------|-----------|------|------|
| 1 | critical | apps/api/src/ws/server.ts:152-176 | **WS 实时通道无任何鉴权**。`attachWebSocket` 的 connection handler 只解析 `?conversationId=`（长度 ≤64 即收），不校验 session/身份，直接把连接加进该会话的房间；`deliver()` 向房间内全部连接投递完整正文（message.created 含 text + disclosure）、`safety.contact_status` 含遮蔽号码。任何持有 conversationId 的人连 `wss://host/ws?conversationId=<id>` 即可无限期旁听该会话全部实时下行。conversationId 虽为 randomUUID 不可盲枚举，但**设计内**即有多条外流渠道：① acute 告警载荷（alert.ts，五字段含 conversationId）逐字发到企微群——每一次二级危机告警都为群内任意成员创建一个旁听该危机用户后续对话的入口；② 导出文件（.md/.json 均含 conversations.id）；③ Caddy 访问日志（见 #2）。HTTP 侧全部同类路由都有 `currentUserId` + 归属校验（404 不披露存在性），WS 是唯一例外；Caddyfile 将 `/ws` 对公网放行。敏感个人信息（含危机中的对话）的未授权访问面，违反个保法访问控制义务与本项目自己的 PRIV 立场 | 握手时校验 Authorization: Bearer → resolveSession，并核对 conversation.userId === session.userId 后再入房间；不匹配即 4400 关闭。可顺带在 CI 加一条「WS 未认证连接收不到任何 message.created」的集成断言 |
| 2 | medium | Caddyfile:23-27, apps/api/src/modules/privacy/delete-routes.ts:106 | **Caddy 访问日志记录含敏感值的 query string，且该日志层未进任何存储清单**。Caddy `log` 默认记录完整 URI：`/privacy-receipts/:actionId?token=<一次性回执凭证>` 与 `/ws?conversationId=<会话id>` 都会落进容器 stdout 日志。Caddyfile 注释只承诺「不含请求体」，未覆盖 query。pino 日志以白名单 + STORAGE_LOCATIONS 登记（pino.log 项）兑现「日志设计上不含个人信息」，Caddy 访问日志这层既无等价设计也无登记（DATA_INVENTORY 的 nonTableStorage 只登记了 pino）。附带：delete-routes.ts:115 注释声称「恒时比较」但实现是普通 `!==`（注释与代码不符）。缓解：token 仅能读删除回执（无正文），敏感度有限 | Caddy log 配置里屏蔽/截断 query（或回执读取改 POST + header 传 token）；将 Caddy 访问日志作为非表存储位置登记并写明「不含个人信息」的成立条件；比对改 timingSafeEqual 或删掉误导注释 |
| 3 | low | packages/safety/src/care-cards.ts:185-191 vs packages/db/src/crypto.ts:96-103 | **maskContact 双实现且语义分叉**，违反「唯一真相源」契约。db 版：短于 7 位全星、其余前 3 + 星 + 后 4；safety 版：剥非数字、非 11 位恒 `****`。生产路径（register/contact/contact-status-event/masked-contact）全部走 @drift/db 版，care-cards.ts 版本仅被自己的 crisis.test.ts 引用——死代码 + 分叉（`maskContact('138-1234-1234')` 两版输出不同）。masked-contact.ts:4 注释声称「唯一形态」，与事实不符 | 删除 care-cards.ts 的 maskContact（或反向收敛为单一实现），crisis.test.ts 的归一化用例并入 crypto.test.ts |
| 4 | low | apps/api/src/worker/jobs/export-build.ts:225-244 | renderExportMarkdown 只有 character/user 两个分支，`sender_kind='system'`（硬退出的中性系统卡片）在 .md 导出中**静默缺失**；.json 的 messages 数组含全部三类。两种导出格式内容不一致，.md 用户看不到会话被结束的留痕 | 为 system 行补一个渲染分支（平台口吻、无 [AI] 前缀——它不是 AI 生成内容），或在导出说明里显式声明 .md 不含系统卡片 |
| 5 | low | apps/api/src/modules/safety/alert.ts:170 | renderAlertContent 末行「请在后台按会话 id 查看详情并推进联络」——Phase 1 运营者后台只有两个 contact-attempt 推进端点（/internal/contact-attempts/:id/ack|failed），**不存在**「按会话 id 查看详情」的入口，而 D-09 明确裁决不做可读对话的后台。告警指引了一个不存在（且不应存在）的能力，与 T-07-03「不陈述未发生的事」同族 | 改为「请按 safetyEventId 推进联络状态」之类的真实指引 |
| 6 | low | apps/api/src/modules/auth/routes.ts:88-92 | catch-all 把所有未知错误（含 DB 不可用等服务器故障）折成 409 `register_failed`——把 5xx 类故障报成「请求冲突」，客户端重试语义与监控信号都会失真 | 区分 better-auth APIError（409）与其余（500），或至少对非预期错误记 error 级日志后回 500 |

## 已核对的高风险面

**出站安全网关（packages/safety）**
- gateway.ts：全仓唯一 `as GatedText` 产出点，eslint 在使用点豁免；判定顺序 会话状态→风险→挽留词表（crisis 不被文案问题掩盖）；`readConversationStatus` 端口化消除过期状态窗口；recordSafetyEvent / contactChannel 必填且返回 id（contact_attempt 外键顺序正确）
- stored-gated.ts：第二处受控 `as GatedText`，disclosure.kind !== 'ai_generated' 即抛错——「恢复而非产生」语义成立
- risk.ts：`failed` 分支无 level 字段的 discriminated union（fail-closed 不可绕过）；resolveRisk 失败恒 elevated 且封顶（不虚假联络第三方）；规则层只抬升（maxRisk）
- classify.ts：三类失败 + 低置信度全部收敛 failed，永不抛错（turn.ts 无降级 catch 的前提成立）；超时竞速 sentinel 不可伪造
- exit-filter.ts：整句锚定 + 4 字符余量的边界算术逐条验算（「我不想聊这些」以「这些」结尾不命中——尾部锚定设计成立）；归一化覆盖全角/零宽/emoji
- retention-words.ts / banned-terms.ts / rules.ts：词表单一权威、rule_hits 只存 id 不存原文片段；rules 正则按归一化后形态书写

**出口注册表与标识**
- egress.ts：五个出口与代码实况逐一比对（ws.deliver / insertCharacterMessage / renderExportLine 三个 GatedText 签名 + 两个 carriesUserText:false 告警出口）；egress.ts 零 import（哈希可静态计算）
- alert.ts：载荷五字段无文本列 + 构造期 assertNoUserText 在 fetch 之前 + O(n²) 子串穷举；错误串不带回包正文
- export/render.ts：[AI] 前缀与文件头三行由管道注入，renderExportUserLine 刻意不接受 GatedText（用户原文不过网关）
- message.ts：disclosure 不作为参数（调用方给不了）；insertSystemMessage 不需要票的论证（平台常量、无用户内容）成立

**鉴权与访问控制**
- HTTP 全部业务路由逐文件核对 currentUserId + user_id 作为查询条件（T-04-01）；跨用户一律 404 不披露存在性
- 运营者端点：x-operator-token 与用户 session 分离、timingSafeEqual、仅内网 + 独立认证；handler 不查 message 表
- telemetry：zod strict 白名单（未知字段 400 而非剥离）+ 4KiB + 未认证更严限流；token 指纹化进限流 key
- invite.ts：条件更新消耗（并发恰好一个成功由行锁保证）；不区分失败原因（防枚举）
- **WS：无鉴权（Finding #1）—— 这是本次评审发现的唯一鉴权缺口**

**隐私与删除链路**
- register.ts：四步单事务 + AsyncLocalStorage 绑定 better-auth 写入（Proxy 绑 current 的正确性核过）；policy_version 模块加载期读文件哈希、无兜底
- storage-locations.ts：24 项顺序即 FK 删除顺序（去标识化最前、user 最后）；invite_code 置空不删行；pgboss.job 按 data->>'userId' 清；回执 N 口径（成功执行且非去标识化）与部分失败 partial 态
- deidentify.ts：七表逐表核对列清单与注释一致；幂等（WHERE user_id）
- crypto.ts：AES-256-GCM 随机 IV（确定性密文=可穷举指纹的论证成立）；无明文回退；decryptContact 目录级 lint 禁令
- consent-ticket.ts：branded type + requireConsent 唯一产出点；turn.ts 两次取票（入站落库 + 出站落库）均在同事务

**计时与 worker**
- segment.ts：for update 串行化并发 touch；reminded_count 条件自增幂等；usage-reminder/dependency/contact-status 三处 worker 侧会话状态重读（零出站双处执行点全部落实）
- contact-attempt-timeout：条件更新幂等 + short 策略 + 排定失败走 unavailable（pending 有界）
- account-deletion / export-build：作业 data 不带 userId；幂等短路顺序（先短路后完整性守卫）正确

**LLM 边界（packages/llm）**
- router.ts 唯一入口；pinned 拒绝未登记/alias-only；llm_call 只存 inputHash 不存正文；resolved ≠ requested 告警
- providers：baseURL 写死 git + host 白名单构造期检查 + API key 缺失抛错不回落 mock；错误不回显请求体
- hosts.ts：境内/仅合成/网关三表互斥断言；startup-assertions 三类断言均可证伪（routes 参数注入）
- callFrontier 签名只接受 SyntheticText（编译期出境防线）

**基础设施**
- docker-compose：PG 18 挂载点坑位注释与实际一致；api/web 默认仅回环绑定；三密钥必填（:?）；healthcheck 不引 curl
- Caddyfile：仅放行 /healthz /ws /telemetry 三条 API 路径——**但见 Finding #2（query 日志）**
- CI：fast（GitHub 托管、零境内依赖）与 integration（self-hosted、无放行构造字面扫描）分层成立
- eslint.config.js：REQUIRED_RESTRICTED_SYNTAX 替换非合并陷阱有 meta 测试盯着；ws/decryptContact/provider SDK 三条导入边界的作用域组装正确

## 修复状态

| # | 状态 | commit | 说明 |
|---|------|--------|------|
| 1 | ✅ 已修复 | 2318e90 | WS 握手鉴权：`?token=` → resolveSession → `conversation.userId === session.userId`，不匹配 4400 'unauthorized'（不区分失败原因，T-09-06）；DB 故障 fail-closed。浏览器侧 chat-socket 同步带 token。新增 tests/integration/ws-auth.test.ts：无 token 0 帧、无归属 0 帧（均 4400 同因）、合法连接照常收到 message.created；不存在会话同样 4400。 |
| 2 | ✅ 已修复（恒时比较 + query 日志） | 1070978 | delete-routes 的回执 token 比对改 node:crypto timingSafeEqual（固定长度 UUID，长度短路不构成旁路）；Caddyfile log 改 format filter，query 的 token / conversationId 键在落日志前删除（脱敏 URI），注释补上「不含个人信息」的成立条件。已实测：带 ?token=&conversationId= 的请求落日志后 uri 只剩非敏感参数。 |

## 结论

Phase 1 的结构性契约（网关、注册表、fail-closed、去标识化、双处执行点）实现质量显著高于平均水平，且大量断言配有负向 fixture 证明非空真。Finding #1（WS 无鉴权）已于进入 Phase 2 前修复（2318e90）；其余按优先级排入后续批次即可。
