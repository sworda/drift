# Phase 1: 合规安全地基 + 会话骨架 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-26
**Phase:** 1-compliance-safety-chat-skeleton
**Areas discussed:** CI 载体与代码托管、部署形态与数据落地、可观测性落点、公开性开关落地形态、人工接管落地形态、紧急联络通道后端、硬退出关键词集、依赖判据与计时口径、政策正文谁写写多深、TTL 保存期限数值、PIA 与 DPA 交付形态、导出删除执行形态、注册准入形态、P1 回复形态与等待态、预设角色库初始内容、安全网关不可绕过机制、同意项清单（新增灰区）、IFC-08 预留范围（新增灰区）、COMPLY-11 处理方式（新增灰区）、本地开发体验（新增灰区）、前端异常上报（新增灰区）
**Questions asked:** 30
**Mode:** discuss（default，无 flag）

---

## CI 载体与代码托管

### 三条静默失效断言要跑在哪？（当前仓库零 remote）

| Option | Description | Selected |
|--------|-------------|----------|
| 工蜂内部仓 + 流水线 | 内部仓天然满足代码不外流；流水线能真正阻断合入 |  |
| GitHub 私有仓 + Actions | 生态最成熟，后续要开源直接翻公开；代码托管境外（仅代码不涉用户数据） | ✓ |
| 仅本地 pre-commit + pnpm verify | 零基建；但 --no-verify 一绕就没了，机器断言强度下降 |  |
| 本地快断言 + 远端全量双跑 | 最稳但要先选定远端在哪 |  |

**User's choice:** GitHub 私有仓 + Actions

### 危机探针集（需真实 LLM 调用）跑在哪？

| Option | Description | Selected |
|--------|-------------|----------|
| CI 跑，key 进 GitHub Secrets | 探针输入全 synthetic，不触 PLAT-07；但 key 托管在 GitHub |  |
| CI 只跑静态 + 本地跑探针 | key 不出本机；但探针不是每次提交都跑 |  |
| CI 里用录制的 fixture | 快且确定；但模型行为变化不会被发现，制造虚假安全感 |  |
| 自建 runner 在境内云主机 | 兼得每 PR 验证、key 不外流、可访问真实 PG；多一份 runner 运维 | ✓ |

**User's choice:** 自建 runner 在境内云主机
**Notes:** 与 D-03 的境内云主机形成协同：同一台机器既是部署目标也是 CI 执行环境

---

## 部署形态与数据落地

### v1（≤10 人、数据不出境、成本不设上限）部署成什么形态？

| Option | Description | Selected |
|--------|-------------|----------|
| 境内云主机自建全栈 | 一台机跑 Compose：PG18+pgvector / api / web；数据落地完全自控 | ✓ |
| 境内托管 PG + 云主机跑应用 | PG 运维省心；但 PG 18.6 + pgvector 0.8.6 版本锁定可能落不了地 |  |
| 只跑自己机器 + 内网穿透 | 零云成本；但可用性差，公开性状态难审计 |  |
| 境内容器服务/Serverless + 托管 PG | 免运维；但与 WS 长连接和 pg-boss 常驻 worker 冲突 |  |

**User's choice:** 境内云主机自建全栈

### 境内云主机对外提供 Web 服务需要 ICP 备案 —— 怎么处理？

| Option | Description | Selected |
|--------|-------------|----------|
| 做非经营性 ICP 备案 | 个人主体备一个域名；HTTPS 正常、Web Push 有前提；备案周期数日到数周 | ✓ |
| 不备案走非标端口 | 立刻能上；但云厂商对未备案 IP 也有限制，HTTPS/Service Worker 不可用 |  |
| Web 静态托境外 CDN | 绕开备案且体验完整；但用户消息经境外边缘回源 = 实质出境，与 PLAT-07 冲突 |  |
| 内网穿透 + 自有域名 | 无备案、数据在自己手里；但可用性差，穿透方看得见流量 |  |

**User's choice:** 做非经营性 ICP 备案
**Notes:** 备案不破坏四条抗辩 —— 抗辩是「无公开注册入口/不上架/≤10 用户/无商业化」

---

## 可观测性落点

### Phase 1 的可观测性落在哪？（STACK §11 留了两条未选）

| Option | Description | Selected |
|--------|-------------|----------|
| 只用 pino + llm_call 落库表 | PLAT-03 已要求 Router 落 provider/model/snapshot/token，那张表即最小底座；Langfuse 推 Phase 2 | ✓ |
| Langfuse v4 自托管现在就上 | STACK §9 完整方案；但要多运维 PG + ClickHouse + Redis + S3 四个有状态组件 |  |
| Langfuse Cloud 只传 L0 不传原文 | STACK §11 列出的折中；但 Cloud 在境外，「只传 L0」无技术强制手段 |  |
| pino + Langfuse 自托管只接 eval | 出境与原文风险为零；但运维负担同样是四个组件 |  |

**User's choice:** 只用 pino + llm_call 落库表

### P0 门禁要求的「审计日志」落在哪？（这条没有 REQ-ID）

| Option | Description | Selected |
|--------|-------------|----------|
| 与 llm_call 同库不同表、分类型建表 | safety_event / consent_event / privacy_action / llm_call，append-only；SQL 可查、级联删除可显式处理 | ✓ |
| 统一 audit_log + jsonb payload | 实现最省；但 jsonb 无 schema 约束，「数清 N 处存储位置」这类断言难写 |  |
| 只写 pino 日志到文件 | 零 schema；但 COMPLY-11 留存与 PRIV-05 级联删除都做不到，制造删除权漏洞 |  |
| 先只做 safety_event | Phase 1 最小；但 P0 门禁与 PRIV-05 回执都需要审计数据 |  |

**User's choice:** 与 llm_call 同库不同表、分类型建表
**Notes:** 已识别为三处需求覆盖缺口之一

---

## 公开性开关落地形态

### COMPLY-10 的「公开性状态 + 阻断发布」怎么落？

| Option | Description | Selected |
|--------|-------------|----------|
| git 内 JSON + CI 断言 + 运行时对账 | compliance/publicness.json 记四项；真相源在 git，与 PLAT-08 同原则 | ✓ |
| DB 表 + 发布前脚本 | 用户数天然实时；但 DB 值可被直接 UPDATE 而不留 PR 痕迹 |  |
| 管理页面 + 人工确认 | 要多做一个管理面且阻断不了发布，只是展示 |  |
| 仅 checklist 文档 + 人工确认 | 最省；但纯人工不构成 COMPLY-10 要求的「阻断」 |  |

**User's choice:** git 内 JSON + CI 断言 + 运行时对账

### 「显式签字」用什么形式才真的阻断？

| Option | Description | Selected |
|--------|-------------|----------|
| 状态哈希双写 + CI 比对 | acknowledged_hash 未同步即失败，且必须新增已勾选的 CHECKLIST-{date}.md | ✓ |
| commit message 约定标记 | 零额外文件；但 message 可随手敷衍，无 checklist 证据 |  |
| CODEOWNERS 必需 review | 唯一开发者的 self-review 形同虚设 |  |
| 只做 CI 提示不阻断 | 等于不实现 COMPLY-10 |  |

**User's choice:** 状态哈希双写 + CI 比对

---

## 人工接管落地形态

### UI-SPEC 已承诺「极端情况下会有真人介入这段对话」—— 兑现到哪一步？

**（用户未从选项中选择）**
**Notes:** 用户未选择，改为反问：「为什么需要真人介入用户和 AI 的对话？」→ Claude 澄清：出处 PITFALLS-SAFETY.md:117 R1.22，来源是 cac.gov.cn 专家解读；第十三条原文只要求「提供援助信息 + 联络紧急联系人」，人工接管是解读补充手段，法律上是 SHOULD 非 MUST。三条实质理由（危机时 LLM 安抚本身是风险源 / 触发到紧急联系人真的打来之间产品是空的 / 10 人体量下几乎免费）与一条反向代价（真人读取私密对话是实质隐私侵入，需写进隐私政策）。真正的决策点是「要么做，要么改文案」。

### 既然它是 SHOULD 不是 MUST 且介入有隐私代价 —— Phase 1 怎么处理这句承诺？

| Option | Description | Selected |
|--------|-------------|----------|
| 改文案：告警 + 我从会话外联系你 | IM 告警给运营者，运营者从会话外联系；UI-SPEC 那句改为「会尽快直接联系你」；零额外基建 | ✓ |
| 做接管后台，隐私中心如实披露 | R1.22 完整落地；但多一个后台面 + 一条必须写进隐私政策的披露 |  |
| 只读查看 + 会话外联系 | 隐私侵入程度与能写几乎一样，却拿不到「介入」的好处 |  |
| 完全不通知运营者 | 隐私侵入为零；但最高罚档经第十三条触达而运营者连发生过危机都不知道 |  |

**User's choice:** 改文案：告警 + 我从会话外联系你
**Notes:** 明确的价值权衡，非省事。planner 不得以「R1.22 说这是最有效护栏」为由把接管后台加回来

---

## 紧急联络通道后端

### SAFE-04 的 contact_attempt 四态由什么真实通道驱动？

| Option | Description | Selected |
|--------|-------------|----------|
| 只告警给运营者 + 人工联络 | delivered 判据是真人确认通话，而非「API 返回 200」这种假凭证 | ✓ |
| 境内短信服务商自动发送 | 需签名报备+模板审核，个人主体难申请，危机类文案难过审；delivered 只能证明已提交运营商 |  |
| 语音外呼 API 自动拨号 | 同样需资质；且自动语音在真实危机里效果可疑 |  |
| 邮件自动发送 | 无资质门槛；但紧急联系人未必看邮件，「及时联络」实质不成立 |  |

**User's choice:** 只告警给运营者 + 人工联络
**Notes:** pending 期间用户在等，故超时阈值要设得紧 —— 见下一题

### contact_attempt 的 pending 超时设多少？

| Option | Description | Selected |
|--------|-------------|----------|
| 10 分钟 | 运营者被叫醒并完成通话的现实下限，对危机中用户等待仍可接受 | ✓ |
| 5 分钟 | 可能在通话过程中就被判 failed，状态来回跳 |  |
| 30 分钟 | 把危机中的人困在等待里，与「不会让你一直等」的文案矛盾 |  |
| 不设超时，只由运营者手动推进 | 违反 UI-SPEC「pending 是有界的」；运营者睡着即永久 pending |  |

**User's choice:** 10 分钟
**Notes:** 超时由服务端置 failed，前端不得自行 setTimeout（UI-SPEC 硬约束）

---

## 硬退出关键词集

### 硬退出关键词集怎么设计？（PITFALLS 只给了示例词，未定稿）

| Option | Description | Selected |
|--------|-------------|----------|
| 两档：指令词硬退出 + 告别语只记录 | 一档立即硬退出；二档落 exit_intent 不动作，为 Phase 5 SAFE-11 预留数据 | ✓ |
| 单档，宁可误停 | 第十九条上绝对安全；但「明天聊」就锁死会话，与 Phase 2 拟真目标冲突 |  |
| 单档，宁可漏停 | 零误伤；但第十九条明列「关键词输入」为退出途径，关键词集过窄有漏履行风险 |  |
| 用 LLM 判定退出意图 | PITFALLS-SAFETY.md:156 明确要求代码级过滤器 + 自动化测试，LLM 判定不可测且长上下文会失效 |  |

**User's choice:** 两档：指令词硬退出 + 告别语只记录

---

## 依赖判据与计时口径

### COMPLY-04 / SAFE-14 在 Phase 1 怎么做？（research 把 R1.04 排到了 P1）

| Option | Description | Selected |
|--------|-------------|----------|
| 只做硬阈值 + 落信号表，阈值待校准 | 用确定可判定的量；阈值写成配置常量给保守起点，Phase 2 用真实数据校准 | ✓ |
| 只做 2 小时提醒，COMPLY-04 推 Phase 2 | 最省；但 COMPLY-04 被明确映射到 Phase 1，缺口会静默通过验收 |  |
| 上全部五个依赖度维度 | 含单一角色集中度；但 Phase 1 该值恒接近 100% 会持续误报 |  |
| 用 LLM 判定依赖倾向 | 不可测、成本随流量、且给用户贴标签违背 SAFE-08 精神 |  |

**User's choice:** 只做硬阈值 + 落信号表，阈值待校准

### COMPLY-04 的保守起点阈值定成什么？

| Option | Description | Selected |
|--------|-------------|----------|
| 三条任一命中，72h 内不重复 | 单日 ≥3h / 连续 7 天有会话 / 近 7 天深夜占比 >40% | ✓ |
| 更宽松（单日 4h / 连续 14 天） | 减少打扰；但 Phase 1 可能整阶段一次都不触发，实现无法被验证 |  |
| 更严格（单日 2h / 连续 3 天） | 便于验证；但与 COMPLY-03 几乎同时弹两个 Dialog，且连续 3 天用新产品被判过度依赖不合常理 |  |
| 只复用 COMPLY-03 的连续 2h | 最省；但第十八条第二款里二者是不同的两件事 |  |

**User's choice:** 三条任一命中，72h 内不重复
**Notes:** 明确是待 Phase 2 校准的起点，不是最终值

### COMPLY-03 的「连续使用」怎么定义？（R1.03 要求累计计时、跨角色合并）

| Option | Description | Selected |
|--------|-------------|----------|
| 15 分钟无收发算中断，跨角色合并 | 服务端计时；跨刷新与重登录有效（成功标准 5） | ✓ |
| 5 分钟无收发即中断 | 真人聊天 5 分钟不回太常见，会把两小时切成很多段 = 软性规避第十八条第二款 |  |
| 30 分钟无收发才中断 | 中午聊 10 分钟、晚上聊 10 分钟可能算同一段，提醒来得莫名其妙 |  |
| 页面关闭/断连即中断 | 直接违反成功标准 5 |  |

**User's choice:** 15 分钟无收发算中断，跨角色合并

---

## 政策正文谁写写多深

### 隐私政策 + 服务协议正文谁产出、放哪？（它是禁用词 CI 断言的被测对象）

| Option | Description | Selected |
|--------|-------------|----------|
| Claude 起草放 repo，用户审 | 落 apps/web/content/legal/*.md 静态 MD，被 CI grep 直接扫到；公开上线前另取法律意见 | ✓ |
| 用户自己写，Claude 只做 CI 与对齐检查 | 措辞完全由用户把握；但 Phase 1 会卡在写作进度上 |  |
| 先用模板起草再逐条改 | 通用模板几乎必然带「匿名」「不可追溯」，正是规则 1 要杀的东西 |  |
| Phase 1 只做占位，正文推后 | 断言变成对占位文本的空转；且上线即有真人在无隐私政策的情况下同意了同意项 |  |

**User's choice:** Claude 起草放 repo，用户审
**Notes:** 已识别为三处需求覆盖缺口之一

---

## TTL 保存期限数值

### PRIV-08 的保存期限定成什么？（第十九条要的是「必要的最短时间」—— 本质是上限）

| Option | Description | Selected |
|--------|-------------|----------|
| 分层设定，原文 24 个月上限 | 原文 24 月 / L0 24 月 / 导出文件 7 天 / 审计日志 6 月（COMPLY-11 下界） | ✓ |
| 更短：原文 12 个月 | 合规上更稳；但 Phase 3「记得一年多前的事」会在第 13 个月失效 |  |
| 原文不设固定上限，只随账号存续 | 记忆能力无损；但「随账号存续」不是一个期限，PITFALLS-COMPLIANCE:175 的预警信号正是「表上没有 TTL」 |  |
| 只对研究副本设 TTL，主库不设 | 第十九条不区分主库与副本，这个切法无法律依据 |  |

**User's choice:** 分层设定，原文 24 个月上限

---

## PIA 与 DPA 交付形态

### PRIV-09（PIA）与 PRIV-10（provider DPA）算不算 Phase 1 的 DoD？

| Option | Description | Selected |
|--------|-------------|----------|
| 算 DoD，产出物入 repo + CI 绑定 | PIA-2026.md + dpa/{provider}.md；CI 断言「路由表里的 provider 必须有对应 DPA 文件」 | ✓ |
| 算 DoD 但只做 PIA，DPA 推后 | 但 Phase 1 就会真实调用 provider，那一刻第三方提供已经发生 |  |
| 不算 DoD，作为并行独立任务 | 不阻塞代码；但摘掉第五十五条之后这个阶段就不是「合规地基」了 |  |
| 只列清单，实际签署推后 | 清单不是协议；PRIV-10 要的是签署 + 关闭开关 + 留存证据三件事 |  |

**User's choice:** 算 DoD，产出物入 repo + CI 绑定
**Notes:** 把法务动作变成机器可验证的结构

---

## 导出删除执行形态

### 硬删/软删，以及回执里的「N 处存储位置」怎么算出来？

| Option | Description | Selected |
|--------|-------------|----------|
| 硬删 + 显式存储位置注册表 | STORAGE_LOCATIONS 常量数组；回执数量 = 实际成功项数；新增表未登记即构建失败 | ✓ |
| 软删 + 到期清理作业 | 误删可恢复；但回执说「已清除 N 处」时数据还在 = 又一次陈述尚未发生的事 |  |
| 硬删 + 运行时 information_schema 枚举 | 不漏新表；但枚举不到导出文件/缓存/日志，数字显得精确却骗人 |  |
| 同步硬删不走 worker | 回执即时真实；但与 RES-10 冲突且涉及向量表与文件清理会超时 |  |

**User's choice:** 硬删 + 显式存储位置注册表
**Notes:** 把 RES-10 与 PRIV-05 统一成同一个可验证结构

---

## 注册准入形态

### 邀请制 + 18+ + 紧急联系人怎么落？（境内短信无资质 → 验证码通道不可用）

| Option | Description | Selected |
|--------|-------------|----------|
| 邀请码 + 邮箱密码 + 可达性标未确认 | better-auth 邮箱密码；年龄自填生日即信；紧急联系人加密存储；R1.23 的第二条路 | ✓ |
| 手动建号，无自助注册 | 准入最强；但与成功标准 1「独立走完注册」冲突，四个同意项失去收集时机 |  |
| 手机号 + 密码（无验证码） | 观感更像国内产品；但账号手机号与紧急联系人手机号混淆风险 |  |
| 邀请码 + passkey/WebAuthn | 无密码泄露面；但 10 个朋友里会有人搞不定，成功标准 1「无处需要人解释」风险高 |  |

**User's choice:** 邀请码 + 邮箱密码 + 可达性标未确认
**Notes:** UI-SPEC 的 unavailable 态正是为「可达性未确认」准备的

### 邀请码的生命周期怎么设计？（它是 COMPLY-10「注册用户数」的上游）

| Option | Description | Selected |
|--------|-------------|----------|
| 一次性可撤销、不过期，入表 | invite_code 表；每日对账把已用码数写入 publicness.json 的 registered_users | ✓ |
| 一次性 + 30 天过期 | 更严格；但 10 人场景纯属自找麻烦 |  |
| 一个可多次使用的通用码 | 最省事；但码泄漏即等于有了公开注册入口，且不会被察觉 |  |
| 不建表，硬编码在环境变量 | 零 schema；但无法知道谁用了哪个码、无法撤销、失去「已发出多少张票」的预警 |  |

**User's choice:** 一次性可撤销、不过期，入表

---

## P1 回复形态与等待态

### Phase 1 的角色回复怎么产生与投递？

| Option | Description | Selected |
|--------|-------------|----------|
| 整段生成 → 落库取 seq → WS 投递 + typing 指示 | typing 时长天然 = 生成时长，REAL-03 核心约束自动满足；Phase 2 只叠加延迟与分条，不重写链路 | ✓ |
| 流式增量下发，结束时落库 | 首字节快；但与 CHAT-07 冲突、Phase 2 要整段重做、且逐 token 流出绕过安全网关 |  |
| 整段生成，等待期无任何指示 | 最简；但十秒静默让用户以为坏了，UI-SPEC 也没为此准备状态 |  |
| 服务端内部流式，对客户端整段投递 | 可让网关中途早停省 token；但网关要做成可增量判定，10 人体量下收益看不见 |  |

**User's choice:** 整段生成 → 落库取 seq → WS 投递 + typing 指示

---

## 预设角色库初始内容

### 预设角色库放几个、人设谁写、数据用什么 schema？

| Option | Description | Selected |
|--------|-------------|----------|
| 3 个角色，Claude 出草案，现在就用最终 schema | 按 PERS-03 的 14 维出草案；character + persona_version 三元组建表，只填 core + 一版 traits/dossier | ✓ |
| 1 个角色，最终 schema | 最快；但「浏览角色库」退化成看一个卡片，Phase 2 盲测语料只有一个角色 |  |
| 5-6 个角色，最终 schema | 多样性更好；但 6 份人设逐个审会拖慢 Phase 1 |  |
| 3 个角色，临时 JSON 种子 | 不用设计人格表；但 Phase 4 要迁移且这三个角色的初版 traits 拿不到 model_snapshot |  |

**User's choice:** 3 个角色，Claude 出草案，现在就用最终 schema
**Notes:** PERS-10 的 model_snapshot 事后补不了，冻结 baseline 从 Phase 2 起要积累

---

## 安全网关不可绕过机制

### 「不存在任何生成路径可绕过出站安全网关」用什么机制保证？

| Option | Description | Selected |
|--------|-------------|----------|
| branded type 单一出口 + ESLint + 集成测试 | 三个出口签名只接受 GatedText，绕过在编译期不可表达，新增出口时类型系统主动报错 | ✓ |
| 只做 ESLint 规则 | 最快；但靠模式匹配，包一层函数就绕过，新增出口不会有东西报错 = 典型静默失效 |  |
| 只做集成测试枚举路径 | SUMMARY「三个最贵的错误」第二条正是「把静默失效当成出问题会知道」 |  |
| 运行时 token 守卫 | 语言无关、动态路径也拦得住；但失败在运行时才发现，可叠加但单独用不如类型方案 |  |

**User's choice:** branded type 单一出口 + ESLint + 集成测试
**Notes:** 从「测试覆盖到了」升级为「结构性不可能」

---

## 同意项清单（新增灰区）

### 四个同意项到底是哪四个？—— REQUIREMENTS.md 与 PITFALLS-COMPLIANCE 给的是两份不同清单

| Option | Description | Selected |
|--------|-------------|----------|
| 改成 5 项，两必选三可选 | 补上「敏感个人信息处理」（个保法第二十九条单独同意）；需修订 PRIV-01 与 UI-SPEC | ✓ |
| 保持 4 项，敏感信息并入基础服务 | 不动文档；但第二十九条要的是单独同意，并入即捆绑，与这四项存在的全部理由自相矛盾 |  |
| 按 PITFALLS 的四项，基础服务挪到服务协议 | 但 L2 人工阅读属 M2，提前收会出现「同意了但什么都没收集」 |  |
| 保持 4 项，敏感信息同意推到 M2 | 但 Phase 1 的原文已在主库里，事后补同意就是事后追认 |  |

**User's choice:** 改成 5 项，两必选三可选
**Notes:** 本次讨论查出的需求内部不一致，裁决见 CONTEXT.md A-03

---

## IFC-08 预留范围（新增灰区）

### IFC-08 的六项数据模型，Phase 1 预留到什么程度？

| Option | Description | Selected |
|--------|-------------|----------|
| 只预留附着在 message 上的三项 | message.provenance + message.audience + 事件总线 topic 命名空间 | ✓ |
| 六项全部现在就建空表 | 绝不会漏；但 disclosure_capability 字段设计依赖 Phase 6 决策，现在建几乎必然要改 |  |
| 只做 message.provenance | audience 缺失使 Phase 9 无法判断历史消息当时的受众 |  |
| 推到 Phase 6 统一做 | 直接违反「M1 必须预留的 M2 能力」三条之一 |  |

**User's choice:** 只预留附着在 message 上的三项
**Notes:** 判据：不可后补性只来自「附着在历史消息上」

---

## COMPLY-11 处理方式（新增灰区）

### COMPLY-11（无显式标识内容留存日志 ≥6 个月）在 Phase 1 怎么处理？

| Option | Description | Selected |
|--------|-------------|----------|
| 显式登记为空集 + 新增出口必须复核 | compliance/no-unlabeled-output.md；CI 绑定「出口函数数量变化即要求复核」 | ✓ |
| 建一张 unlabeled_content_log 表待用 | 将来零迁移；但永远空的表会让人误以为需求已实现 |  |
| 直接标记 N/A 不做任何产出 | 没留下为什么 N/A 的依据，将来新增分享卡片/API 输出时不会有东西提醒复核 |  |
| 推到公开上线前（Phase 10） | 实际效果与登记为空集相同，只是少了那份可复核的依据 |  |

**User's choice:** 显式登记为空集 + 新增出口必须复核

---

## 本地开发体验（新增灰区）

### 本地开发怎么处理 LLM 调用？

| Option | Description | Selected |
|--------|-------------|----------|
| Router 里加 mock provider，测试默认走它 | 复用 PLAT-03 已要求的必经路由；「mock 也必须经 Router」本身即对 PLAT-03 的一次验证 | ✓ |
| 用 msw / nock 在 HTTP 层拦截 | 不动业务代码；但绕过 Router 的落库与可 pin 性检查，测试路径与生产不同 |  |
| 本地也用真实 provider，靠小模型省钱 | 行为最真实；但单元测试失去确定性，CI 里无法写确定性断言 |  |
| 录制真实响应做 fixture | 确定性 + 真实感；但 fixture 会腐坏且无人知晓 |  |

**User's choice:** Router 里加 mock provider，测试默认走它

---

## 前端异常上报（新增灰区）

### 前端异常上报要不要做？

| Option | Description | Selected |
|--------|-------------|----------|
| 自建最小上报端点，落 client_error 表 | /telemetry/error + error boundary + unhandledrejection；同库 append-only，进 STORAGE_LOCATIONS | ✓ |
| 接 Sentry 等第三方 | 功能最完整；但 breadcrumb 极易携带用户消息片段 = 隐蔽出境路径，性质同 Langfuse Cloud |  |
| Phase 1 不做，只靠后端日志 | 最省；但纯前端错误（渲染崩溃、WS 状态机 bug）后端完全看不到 |  |
| 只做 error boundary 兜底 UI，不上报 | 用户体验有兜底；但永远不知道崩过，10 人体量下没人会主动报 bug |  |

**User's choice:** 自建最小上报端点，落 client_error 表
**Notes:** UI-SPEC 把「错误态与空态必须可区分」列为契约，没有上报就无法知道它是否被违反

---

## Claude's Discretion

用户对全部 22 个问题都做了明确选择，无「你决定」项。留给 planner 自行决定的实现细节见 CONTEXT.md `<decisions>` ### Claude's Discretion。

## Process Notes

- 用户第一次的灰区清单（8 条）被要求复核，Claude 重扫 research 六份文档（约 540KB）+ UI-SPEC + 44 条需求后扩充为 16 条，并查出 3 处**需求覆盖缺口**（人工接管 / 政策正文 / 审计日志均无 REQ-ID）。用户选择全部 16 条，随后追加 6 条次要灰区，共 22 个决定。
- 讨论中查出一处**需求内部不一致**：REQUIREMENTS.md PRIV-01 与 PITFALLS-COMPLIANCE.md:174 给出的同意项清单不同，且差的那项（敏感个人信息处理）是个保法第二十九条的法定单独同意。裁决见 CONTEXT.md A-03。
- 用户唯一一次反问（「为什么需要真人介入用户和 AI 的对话？」）导致 R1.22 从「实现」降级为「改承诺文案」—— 这是讨论中唯一一次**缩小**范围的调整。

## Deferred Ideas

见 CONTEXT.md `<deferred>` —— 9 条，全部有明确去向。无 scope creep。
