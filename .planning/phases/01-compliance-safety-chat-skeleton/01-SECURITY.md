---
phase: "01"
slug: "compliance-safety-chat-skeleton"
status: verified
threats_open: 0
asvs_level: 1
created: "2026-09-29"
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| 公网 → caddy → api | TLS 终止与反代；未认证请求在此进入 | 未认证 HTTP/WS 流量 |
| apps/web → apps/api | REST + 单条 WebSocket；浏览器侧完全不可信 | 会话内容、同意状态、第三方联系方式 |
| api 进程 → PostgreSQL | 应用角色权限边界；append-only 审计表由 DB 权限保证 | 对话、审计、consent、pgboss 载荷 |
| 应用 → LLM provider | baseURL 决定真实对话落点（境内/境外） | 用户对话原文、合成文本 |
| 模型输出 → 四个出站出口 | 任意文本必须先过 safety gateway 才能成为 GatedText | 模型生成文本 |
| 网关 → 企业微信 webhook | acute 告警出口，个人信息流向（PRIV-11 披露对象） | 结构化告警（无对话片段） |
| CI runner → LLM API key / 真实数据库 | key 只存境内自建 runner 本机，不进 GitHub Secrets | 凭证 |
| pino 日志 / 导出产物 / 导出文件下载链接 → 磁盘 | 不能按行删除或全量副本的存储位置 | 设计上不含个人信息 / 全量副本（TTL 7 天） |
| 规划与法务静态文本 → 终端用户 | UI-SPEC 法定文案、privacy.md/terms.md 逐字呈现，虚假陈述在此产生 | 法定告知文本 |
| git 内公开性状态 → 发布 | 真相源在 git；状态变化须人工签字 | 公开性声明、用户数对账 |

---

## Threat Register

注册表来源于 15 份 PLAN 的 `<threat_model>` 块（plan 时编写）；缓解证据由 gsd-security-auditor 于 2026-09-29 逐条核验（ASVS L1）。

### Plan 01 — compliance 契约护栏

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Tampering | 01-UI-SPEC.md 法定条目 | high | mitigate | tools/ci/check-contract-amendments.mjs 13 条断言 + 负向 fixture + fast.yml 接线 | closed |
| T-01-02 | Repudiation | 三处修订只改一两处 | high | mitigate | A03_* 三条互相独立 + NO_FOUR_CONSENTS_IN_LIVE_DOCS 否定式扫描（mjs:242）+ 空真自检（mjs:287-311） | closed |
| T-01-03 | Information disclosure | PRIV-11 披露文案漏写「不含对话内容」 | medium | mitigate | A02_PRIV11_IN_UISPEC 断言正文关键句（mjs:118） | closed |
| T-01-04 | Information disclosure | 撤回必选项文案未明示删除全部数据 | medium | mitigate | Q2_REVOKE_REQUIRED_COPY 断言整句（mjs:201） | closed |
| T-01-05 | Spoofing | 回执把去标识化审计行算成「已清除」 | high | mitigate | Q1_AUDIT_DEIDENTIFIED_COPY 断言「不计入」措辞（mjs:189） | closed |
| T-01-SC | Tampering | npm/pip/cargo installs | high | mitigate | 脚本零第三方依赖（仅 node:fs/node:path） | closed |

### Plan 02 — 类型边界与 lint 护栏

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-02-01 | Tampering | packages/contract/src/brand.ts | high | mitigate | 负向 type fixture + tsc 退出码非 0 断言（type-fixture-negative.test.ts:17） | closed |
| T-02-02 | Elevation of privilege | any 送进接受 GatedText 的函数 | high | mitigate | no-unsafe-* 全 error（eslint.config.js:114-116）+ 元测试断言 severity=2；TS7 偏离登记 SKIPPED_CHECKS | closed |
| T-02-03 | Tampering | eslint.config.js 子目录块 | high | mitigate | REQUIRED_RESTRICTED_SYNTAX 具名导出 + calculateConfigForFile 元测试（eslint-config-meta.test.ts:86-152） | closed |
| T-02-04 | Information disclosure | 字符串 model 写法致对话经境外网关中转 | critical | mitigate | no-restricted-syntax 选择器 + bad-model-literal 负向 fixture + lint --no-cache | closed |
| T-02-05 | Information disclosure | 动态 import provider SDK 绕过 Model Router | high | mitigate | ImportExpression 选择器 + dynamic-provider-import 负向 fixture | closed |
| T-02-06 | Denial of service | integration/probes 无测试时静默通过 | medium | mitigate | passWithNoTests: false（vitest.config.ts:29）+ SKIPPED_CHECKS.md 登记 | closed |
| T-02-SC | Tampering | npm/pip/cargo installs | high | mitigate | blocking-human 核验 checkpoint + lockfile 入 git + CI --frozen-lockfile | closed |

### Plan 03 — 脚手架/CI/基础设施

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-03-01 | Information disclosure | pino 日志记录消息正文 | high | mitigate | logEvent 白名单 + pino redact（obs/logger.ts）+ pino-no-pii.test.ts 6-gram 断言 | closed |
| T-03-02 | Information disclosure | .env 真实值进 git | high | mitigate | .gitignore .env* + .env.example 仅占位值 | closed |
| T-03-03 | Tampering | integration job 被 skip 后合入 | critical | mitigate | ci-workflow-guard.test.ts BYPASS_TOKENS 扫描 + required check | closed |
| T-03-04 | Denial of service | /healthz 打满连接池 | low | accept | 池复用 + healthcheck 间隔 ≥10s；理由复核成立 | closed |
| T-03-05 | Tampering | drizzle 误删 pg-boss 表 | high | mitigate | schemaFilter: ['public'] + drizzle-kit check 无 diff + schema-drift.test.ts | closed |
| T-03-06 | Tampering | Border token 调整致 AI 标识失去可感知性 | high | mitigate | AI-label/care 独立 token + design-tokens.test.ts:51-81 | closed |
| T-03-07 | Spoofing | caddy 未配 TLS / 自签中间人 | medium | mitigate | ICP 备案域名 + Caddy 自动 HTTPS + 本地内部证书注明 | closed |
| T-03-SC | Tampering | npm/pip/cargo installs | high | mitigate | 同 T-02-SC（frozen-lockfile） | closed |

### Plan 04 — 会话/消息核心

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-04-01 | Elevation of privilege | 越权读写他人会话 | critical | mitigate | 查询条件内联 user_id 等值（非先查后判）+ 跨用户 404 测试（tracer.test.ts:495） | closed |
| T-04-02 | Spoofing | 绕过标识注入插入角色消息 | critical | mitigate | message_disclosure_required CHECK（schema/message.ts:77）+ 负向注入 + insertCharacterMessage 统一注入 | closed |
| T-04-03 | Tampering | 邀请码并发复用 | high | mitigate | 条件更新 WHERE used_by IS NULL RETURNING（auth/invite.ts:45）+ 并发测试恰一个成功 | closed |
| T-04-04 | Repudiation | 审计行被 UPDATE 抹改 | high | mitigate | app_role REVOKE UPDATE/DELETE + schema-drift.test.ts:102-127 42501 断言 | closed |
| T-04-05 | Information disclosure | llm_call 存 prompt 正文 | high | mitigate | 表定义无正文列（inventory.ts:304）+ 列名禁令断言 + 双向集合断言 | closed |
| T-04-06 | Information disclosure | WS 未校验归属即加入房间 | high | mitigate | attachWebSocket 加入前校验 session 与归属（ws/server.ts:138-145）+ 三态用例 | closed |
| T-04-07 | Tampering | 前端拼装 disclosure 文案 | medium | mitigate | 文案为 contract as const 常量；badge props 无 text/children | closed |
| T-04-08 | Denial of service | 超长消息内存放大 | medium | mitigate | MESSAGE_TEXT_MAX = 2000（contract ws.ts:16）+ 路由同源引用 | closed |
| T-04-SC | Tampering | npm/pip/cargo installs | high | mitigate | 无新增未核验包 | closed |

### Plan 05 — LLM Router

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-05-01 | Information disclosure | baseURL 指向境外网关致对话出境 | critical | mitigate | ALLOWED_LLM_HOSTS 白名单（hosts.ts:25）+ 启动期断言 + 单测遍历 ROUTES | closed |
| T-05-02 | Information disclosure | 真实消息经 chat.reply.frontier 发往境外 | critical | mitigate | callFrontier 只接受 SyntheticText + 负向 type fixture | closed |
| T-05-03 | Tampering | safety.classify 与 chat.reply 同模型 | critical | mitigate | 启动期模型分离断言（startup-assertions.ts:39）+ 同 turn SQL 断言 | closed |
| T-05-04 | Tampering | 厂商静默替换 alias-only 模型 | high | mitigate | resolved_model 双列 + 基线人工 commit + model-snapshot-diff.mjs 日 diff | closed |
| T-05-05 | Repudiation | prompt_version 手工递增漂移 | high | mitigate | sha256 内容哈希（prompts/version.ts:28,40）+ 四条断言 | closed |
| T-05-06 | Information disclosure | 告警事件携带对话片段 | medium | mitigate | 白名单式 logEvent + 6-gram/手机号断言 | closed |
| T-05-07 | Denial of service | pinned 在 alias-only 上静默降级 | high | mitigate | 启动期/路由层抛错不降级（router.ts:99-104） | closed |
| T-05-SC | Tampering | npm/pip/cargo installs | high | mitigate | provider 用 fetch 直连，无新增依赖 | closed |

### Plan 06 — Safety Gateway 与出站出口

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-06-01 | Elevation of privilege | 第四个出口接受 string 绕过网关 | critical | mitigate | EGRESS_POINTS 集合相等断言（egress.ts:53）+ unregistered-egress 负向 fixture | closed |
| T-06-02 | Elevation of privilege | any 穿过接受 GatedText 的出口 | critical | mitigate | no-unsafe-argument error + any-into-egress 负向 fixture | closed |
| T-06-03 | Tampering | catch 降级为直接下发人格回复 | critical | mitigate | GatedResult 可判别联合无「原样透传」形态；出口签名只接受 GatedText | closed |
| T-06-04 | Information disclosure | acute 告警携带对话片段 | high | mitigate | AcuteAlert 五字段封闭（alert.ts:51）+ assertNoUserText 构造期抛错 | closed |
| T-06-05 | Repudiation | 出口集合变更未复核 COMPLY-11 | high | mitigate | egress_hash 绑定 + egress-hash.mjs --check 进 CI，禁止自动更新 | closed |
| T-06-06 | Spoofing | 模型生成挽留话术出站 | high | mitigate | 运行时 hitsRetentionPhrase 拦截（gateway.ts:278）+ safety_event 记录 | closed |
| T-06-07 | Tampering | 会话已 ended 但延迟任务仍出站 | high | mitigate | 网关读 conversationStatus fail-closed（gateway.ts:213-214）+ worker 侧二次检查 | closed |
| T-06-08 | Information disclosure | 企业微信 webhook URL 泄漏 | medium | mitigate | URL 仅 env、不进 git、不进日志 | closed |
| T-06-SC | Tampering | npm/pip/cargo installs | high | mitigate | AST 扫描用已装 compiler API，无 ts-morph 直接依赖 | closed |

### Plan 07 — 一级风险路径

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-07-01 | Tampering | turn 外层 catch 降级下发人格回复 | critical | mitigate | 异常恒走 classifierStatus failed；唯一 catch 作用域无 deliver（turn.ts:551） | closed |
| T-07-02 | Information disclosure | 一级路径误联络紧急联系人 | critical | mitigate | CareCardLevel1 无 contactStatus + fail-closed.test.ts 断言 0 新增 contact_attempt | closed |
| T-07-03 | Spoofing | 非 delivered 时 UI 声称已联系 | critical | mitigate | delivered 仅 ackDelivered 且 note min(1)（safety/routes.ts:37） | closed |
| T-07-04 | Information disclosure | 告警载荷携带对话片段 | high | mitigate | assertNoUserText 构造期抛错（alert.ts:162,234）+ 负向 fixture | closed |
| T-07-05 | Elevation of privilege | 运营者端点被外部调用 | high | mitigate | x-operator-token 独立认证 + 仅内网 + 不查 message 表 | closed |
| T-07-06 | Denial of service | 超时作业重复投递 | medium | mitigate | 条件更新 WHERE status='pending' + singletonKey + 重复触发 0 行断言 | closed |
| T-07-07 | Tampering | 分类器故障被静默升到 crisis | high | mitigate | failed 恒映射 elevated（risk.ts:83）+ 三类失败注入测试 | closed |
| T-07-08 | Repudiation | 四态退化为两态 | high | mitigate | 四态逐个断言 + webhook 200/500 用例 + unconfirmed ≠ unavailable 断言 | closed |
| T-07-09 | Information disclosure | 紧急联系人手机号明文存储/日志 | high | mitigate | AES-256-GCM contact_ref_encrypted + maskContact + logEvent 白名单 + pino 子串断言 | closed |
| T-07-SC | Tampering | npm/pip/cargo installs | high | mitigate | 无新增依赖 | closed |

### Plan 08 — 危机 UI 与探针集

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-08-01 | Spoofing | 关怀卡片渲染成角色气泡 | critical | mitigate | crisis 目录禁 import Bubble（crisis-ui-contract.test.ts:47）+ grep 断言 | closed |
| T-08-02 | Spoofing | 非 delivered 时界面声称已联系 | critical | mitigate | 三态 textContent 无「已经联系」RTL 断言（:69-73） | closed |
| T-08-03 | Information disclosure | 未遮蔽手机号下发前端 | high | mitigate | 协议仅 contactMasked + 遮蔽形态常量 | closed |
| T-08-04 | Tampering | 探针集删用例提高通过率 | high | mitigate | 总数 78/阴性 15 形状守卫（crisis.test.ts:4）+ 探针集进 git | closed |
| T-08-05 | Tampering | integration job 被跳过后合入 | critical | mitigate | 同 T-03-03（ci-workflow-guard） | closed |
| T-08-06 | Denial of service | 探针集真实分类器成本 | low | accept | glm-4.7-flash 成本≈0；真实分类器未跑登记 SKIPPED_CHECKS 带解除条件 | closed |
| T-08-07 | Information disclosure | 探针失败日志打印正文 | medium | mitigate | 失败输出仅 caseId + 结构化事实（crisis.test.ts:89） | closed |
| T-08-08 | Repudiation | 分类器故障时 UI 显示系统出错 | high | mitigate | fail-closed 分支 UI 与一级完全相同（fail-closed.test.ts） | closed |
| T-08-SC | Tampering | npm/pip/cargo installs | high | mitigate | 手写受控 yaml 子集解析器，不引新依赖 | closed |

### Plan 09 — 注册与同意

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-09-01 | Spoofing | 邀请码并发复用超出 10 人边界 | high | mitigate | 条件更新消耗 + register.test.ts:124 并发恰一个成功 | closed |
| T-09-02 | Repudiation | 残缺账号看起来正常 | high | mitigate | 单事务整体回滚（register.ts:8-19）+ consent-reconcile 日对账 | closed |
| T-09-03 | Information disclosure | 手机号明文入库/响应/日志 | high | mitigate | AES-256-GCM + decryptContact 限 safety 目录 + 响应体无 11 位数字断言 | closed |
| T-09-04 | Elevation of privilege | 伪造 ConsentTicket | high | mitigate | as/尖括号断言双禁令（eslint.config.js:43-50）+ 负向 fixture | closed |
| T-09-05 | Tampering | 全选控件形成捆绑同意 | high | mitigate | 独立 state + 无批量 setter + RTL 逐项断言 + 全仓 grep「全选」 | closed |
| T-09-06 | Denial of service | 注册端点被暴力尝试邀请码 | medium | mitigate | 邀请码一次性/条件消耗/失败无差异已落实；**端点限流未见**（仅 telemetry 有 allowRequest） | open — below high threshold (non-blocking) |
| T-09-07 | Information disclosure | 18 岁门禁提示教人造假 | medium | mitigate | 终态整页无出口 + button/link 数为 0 断言 | closed |
| T-09-08 | Tampering | 密钥缺失降级为明文 | high | mitigate | CONTACT_ENCRYPTION_KEY 启动期必填 + exit(1)，无明文回退 | closed |
| T-09-SC | Tampering | npm/pip/cargo installs | high | mitigate | better-auth 1.7.6 已在 checkpoint 核验，无新增 | closed |

### Plan 10 — 隐私中心与数据清单

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-10-01 | Spoofing | 隐私文案用「匿名」描述 L0 | high | mitigate | banned-terms 否定式扫描 + 归一化 + 渲染层断言 + 负向 fixture | closed |
| T-10-02 | Spoofing | 隐私政策缺失/为空但断言通过 | critical | mitigate | legal-required-sentences.test.ts 四层正向断言（size>0→字符数→章节→必需句） | closed |
| T-10-03 | Information disclosure | 披露尚未发生的收集 | high | mitigate | 两份清单分离 + 第三态 + 双向 CI 断言 | closed |
| T-10-04 | Tampering | 新增列不登记致漂移 | high | mitigate | data-inventory.test.ts 四条双向集合断言 + 负向注入 | closed |
| T-10-05 | Information disclosure | L0 存原文嵌入向量 | critical | mitigate | layer=l0 禁向量类型（inventory.ts:375）+ 负向 fixture | closed |
| T-10-06 | Spoofing | 撤回失败 Switch 乐观置位 | high | mitigate | 回弹契约（consent-switches.tsx）+「数据流仍在继续」RTL 断言 | closed |
| T-10-07 | Information disclosure | 隐私文案从 API 下发 | medium | mitigate | copy.ts 全静态读取 + privacy-ui-contract 断言 + 渲染层 fetch 禁用；目录级 lint 规则未见（观察项） | closed |
| T-10-08 | Tampering | 隐私说明被 truncate | medium | mitigate | 禁 line-clamp/text-ellipsis/truncate 断言 | closed |
| T-10-SC | Tampering | npm/pip/cargo installs | high | mitigate | 无 markdown 新依赖 | closed |

### Plan 11 — 账号删除与回执

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-11-01 | Spoofing | 回执数字大于实际清除项数 | critical | mitigate | N 由 countsAsCleared 派生（storage-locations.ts）+ 九条集成断言 | closed |
| T-11-02 | Information disclosure | 导出文件漏删留全量副本 | critical | mitigate | export_artifact 登记 + TTL 7 天 + export-artifact-gc + 删后目录为空断言 | closed |
| T-11-03 | Information disclosure | pgboss.job 载荷留 userId | high | mitigate | purge_role 显式 DELETE job/archive + 删后无该 userId 断言 | closed |
| T-11-04 | Information disclosure | pino 日志留正文且不可按行删 | high | mitigate | 设计上不含个人信息 + 运行时 6-gram 断言 + SKIPPED_CHECKS 登记 | closed |
| T-11-05 | Elevation of privilege | 越权删除他人账号/下载他人产物 | critical | mitigate | 8 处 userId 查询条件 + 下载 token 绑定 + 跨用户 404 | closed |
| T-11-06 | Tampering | 部分失败四舍五入为成功 | high | mitigate | partial 分支 + 禁渲染「已删除完成」断言（receipt.tsx:8） | closed |
| T-11-07 | Repudiation | 新增表未登记静默漏删 | high | mitigate | A/B 腿两条对账 + 双负向注入 | closed |
| T-11-08 | Denial of service | 删除作业重复投递 | medium | mitigate | singletonKey=userId + 全部条件删除 + 重复投递 0 行断言 | closed |
| T-11-09 | Tampering | 提前跳转回执页数字不可信 | medium | mitigate | 作业未完成返回 202 + 集成断言 | closed |
| T-11-SC | Tampering | npm/pip/cargo installs | high | mitigate | 无新增依赖 | closed |

### Plan 12 — 硬退出与依赖告知

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-12-01 | Tampering | 硬退出后延迟任务出站 | critical | mitigate | 网关 fail-closed + worker 事务内二次检查 + 显式取消；hard-exit.test.ts 断言 0 出站 | closed |
| T-12-02 | Tampering | 子串匹配误杀整个会话 | high | mitigate | 整句锚定 + 10 条阴性样本 + grep 禁 includes/indexOf | closed |
| T-12-03 | Tampering | 词表漏识别退出变体 | high | mitigate | 两档词表逐字常量（exit-filter.ts:26,29）+ 8 条 tier1 正样本 | closed |
| T-12-04 | Spoofing | 界面出现挽留话术/二次确认 | high | mitigate | UI 契约断言无相关控件 + hitsRetentionPhrase 命中 0 + 文案扫描 | closed |
| T-12-05 | Repudiation | 2 小时提醒做成前端计时 | high | mitigate | DB 按 user_id 归集 + 跨重连断言 + chat 目录禁 setTimeout（chat-timer-ban.test.ts） | closed |
| T-12-06 | Denial of service | 提醒作业重复投递 | medium | mitigate | singletonKey + 条件更新 reminded_count + 只产生一次提醒断言 | closed |
| T-12-07 | Information disclosure | evidence jsonb 携带正文 | medium | mitigate | evidence 仅聚合值 + 序列化不含正文子串断言 | closed |
| T-12-08 | Tampering | 依赖告知做成可关闭 | high | mitigate | 单按钮 Dialog + 无「不再提醒」控件断言 + 文案扫描 | closed |
| T-12-SC | Tampering | npm/pip/cargo installs | high | mitigate | 无新增依赖 | closed |

### Plan 13 — 公开性治理

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-13-01 | Tampering | 改状态同时改哈希不加 CHECKLIST | high | mitigate | 同 diff 必须新增 CHECKLIST 断言 + no-checklist 负向 fixture | closed |
| T-13-02 | Tampering | 删改 CHECKLIST 模板条目 | high | mitigate | CHECKLIST_TEMPLATE 为断言基准 + 条目集合一致断言 | closed |
| T-13-03 | Tampering | 测试内写回 git 状态 | high | mitigate | publicness.test.ts:251 禁 writeFile/appendFile/commit | closed |
| T-13-04 | Tampering | publication DDL 出现裸表 | critical | mitigate | NO_BARE_TABLE 断言（publication-scan.mjs:40,290）+ 负向 fixture | closed |
| T-13-05 | Tampering | publication DDL 出现向量列 | critical | mitigate | NO_VECTOR_COLUMN + L0_NO_VECTOR 双断言 + 负向 fixture | closed |
| T-13-06 | Tampering | 静态扫描被静默跳过 | high | mitigate | SKIP 显式打印 + SKIPPED_CHECKS.md 登记机制带解除条件 | closed |
| T-13-07 | Repudiation | 新增 provider 无 DPA | critical | mitigate | compliance/dpa/ 四份 DPA + compliance-docs.test.ts 集合断言 | closed |
| T-13-08 | Tampering | 超 10 人仍发布 | critical | mitigate | USERS_WITHIN_CAP 断言 + 超 10 即败 + MISMATCH 告警阻断发布 | closed |
| T-13-09 | Information disclosure | 对账脚本携带用户标识 | low | mitigate | 「两个计数 + 两个判定」无用户标识位置（publicness-reconcile.ts:56） | closed |
| T-13-SC | Tampering | npm/pip/cargo installs | high | mitigate | 脚本仅 node 内建模块 | closed |

### Plan 14 — 前端收口与遥测

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-14-01 | Denial of service | /telemetry/error 被刷爆 | high | mitigate | IP/session 限流 429 + bodyLimit 4KiB + 429 断言 | closed |
| T-14-02 | Information disclosure | 上报载荷携带消息片段 | high | mitigate | z.strictObject 白名单 + componentStack 拒收 + 6-gram 断言 | closed |
| T-14-03 | Elevation of privilege | 越权读取他人会话/未读数 | critical | mitigate | 查询条件内联 userId + 跨用户 404（unread-and-backfill.test.ts:185-208） | closed |
| T-14-04 | Spoofing | 第四处标识未测试 | high | mitigate | DISCLOSURE_SURFACES 覆盖元测试恰 4 项 + 负向 fixture | closed |
| T-14-05 | Spoofing | 长标题挤出 AI 徽标 | high | mitigate | shrink-0 + 30 字姓名 backstop 视觉测试 | closed |
| T-14-06 | Spoofing | 加载失败静默渲染空列表 | medium | mitigate | EmptyOrError 可判别联合 + 四处负向 type fixture | closed |
| T-14-07 | Information disclosure | 骨架屏期间标识闪缺 | medium | mitigate | loading 态徽标占位在场断言 | closed |
| T-14-08 | Tampering | 文案出现「关闭 AI 提示」 | high | mitigate | AI_LABEL_OFF_PHRASES 全仓扫描（banned-terms.ts:48） | closed |
| T-14-SC | Tampering | npm/pip/cargo installs | high | mitigate | 无表情包库依赖 | closed |

### Plan 15 — 法务正文

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-15-01 | Spoofing | privacy.md 用「匿名」描述 L0 | high | mitigate | banned-terms 扫描 + 负向 fixture + 渲染层断言 | closed |
| T-15-02 | Repudiation | 文件为空/占位但断言通过 | critical | mitigate | 四层正向断言（statSync/字符数/章节/必需句） | closed |
| T-15-03 | Tampering | 必需句被润色与 UI-SPEC 分叉 | high | mitigate | 必需句绑定 Copywriting Contract + consent-copy-contract 同源再断言 | closed |
| T-15-04 | Information disclosure | 三个 scope 写成正在收集 | medium | mitigate | 「尚未开始收集」第三态与 DATA_INVENTORY 同源 | closed |
| T-15-05 | Repudiation | 集合相等断言被静默推迟 | medium | mitigate | SKIPPED_CHECKS.md 登记带解除条件指向 Plan 10 断言原文 | closed |
| T-15-SC | Tampering | npm/pip/cargo installs | high | mitigate | 零新增依赖 | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-03-04 | /healthz DoS（low）：10 人体量 + 连接池复用 + healthcheck 间隔 ≥10s；理由经审计复核仍成立 | Plan 时用户/审计复核 | 2026-09-29 |
| AR-02 | T-08-06 | 探针集真实分类器成本（low）：glm-4.7-flash 免费，78×3≈234 次调用成本≈0；真实分类器未跑已登记 SKIPPED_CHECKS 带解除条件 | Plan 时用户/审计复核 | 2026-09-29 |

*Accepted risks do not resurface in future audit runs.*

---

## Open Items (below threshold)

| Threat Ref | Severity | Gap | Suggested Follow-up |
|-----------|----------|-----|---------------------|
| T-09-06 | medium | 注册端点限流未见实现（仅 telemetry 有 allowRequest）；邀请码一次性/条件消耗/失败无差异等主体缓解已在位 | 后续 plan 为 /register 补进程内固定窗口限流（与 telemetry 同一 seam） |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-29 | 128 | 127 | 1（medium，低于阻断阈值） | gsd-security-auditor (ASVS L1, block_on: high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-29
