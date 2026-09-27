# Requirements: Drift

**Defined:** 2026-09-25
**Core Value:** 角色必须让人感觉是活的 —— 有自己的状态与生活、会记得也会遗忘、会因为和你相处而真的发生改变。

**编号权威**：本文件是唯一的需求编号来源。`.planning/research/` 下六份文档各自的编号（R-SAFE-xx / R1.xx / R-PII-x / N1-N16 / R-REFLECT-x）**仅为研究内部引用**，phase 文档一律只引用本文件的 REQ-ID。每条需求在末尾标注其研究出处，便于回溯论证。

**里程碑切分**：

- **M1（当前 roadmap）= 构建顺序 P0–P4** —— 交付「角色真的会变」这个核心赌注。结束时三个成功标准里的两个（分不清人机 / 角色真的在变化）已可测量。
- **M2 = P5–P7** —— 主动消息与生活模拟、IFC 披露决策、研究管道与中文 PII。
- **v2 = P8–P10** —— 竞技场、AI 社交网络、公开上线合规。

切分依据：研究列出的最贵错误第一条是「先建记忆与演化、后建真实感基线」。其不对称结构为 —— 记忆的**收益**需要可信对话作前提，而记忆的**失败**（记错人、串味、性格突变）不需要任何前提就能摧毁可信度。M1 的顺序 P0→P1→P2→P3→P4 正是为此设计。

---

## M1 Requirements — 核心赌注（P0–P4）

### 合规与标识 (COMPLY)

第一顺位法规为《人工智能拟人化互动服务管理暂行办法》（五部门令第21号，2026-07-15 施行）。

- [ ] **COMPLY-01**: 用户在会话列表、聊天界面、角色详情页任一位置都能看到对方是 AI 的持续性标识（不是仅首次弹窗）〔第十八条第一款〕
- [ ] **COMPLY-02**: 用户导出的聊天记录文件内含 AI 生成内容标识，不因导出而丢失〔《标识办法》第四条〕
- [ ] **COMPLY-03**: 用户连续使用每超过 2 小时收到一次使用时长提醒，该计时跨页面刷新与重新登录仍然有效〔第十八条第二款〕
- [ ] **COMPLY-04**: 系统识别到用户出现过度依赖或沉迷倾向时，以弹窗等显著方式动态提醒互动内容由 AI 生成〔第十八条第二款〕
- [ ] **COMPLY-05**: 用户通过窗口操作或输入退出关键词要求退出时，服务立即停止，且不触发任何挽留话术或后续主动消息〔第十九条〕
- [ ] **COMPLY-06**: 用户注册时须提供年龄，以及监护人或紧急联系人之一〔第十二条〕
- [ ] **COMPLY-07**: 用户注册时须确认已满 18 周岁，未满 18 周岁无法进入角色聊天〔v1 的选择，用于规避未成年人义务集〕
- [ ] **COMPLY-08**: 系统不提供模拟用户现实亲属或特定真人的角色类型，用户自建角色时该类描述被拒绝〔第十五条〕
- [ ] **COMPLY-09**: AI 生成内容标识由消息管道中间件统一注入，而非由各 UI 组件各自实现〔架构约束，防止新增出口遗漏标识〕
- [ ] **COMPLY-10**: 系统维护一个显式可审计的「公开性」状态（是否有公开注册入口 / 是否上架 / 注册用户数 / 是否商业化），任一项变化时阻断发布并输出合规 checklist〔第二条适用范围抗辩，Low-Medium〕
- [ ] **COMPLY-11**: 所有对外提供的无显式标识内容（若有）留存提供对象日志不少于 6 个月〔《标识办法》第九条〕

### 安全与危机干预 (SAFE)

- [ ] **SAFE-01**: 安全判定在人格渲染**之后**以确定性覆写方式执行，不作为人格提示词的一部分
- [ ] **SAFE-02**: 危机判定不得由扮演角色的同一模型执行（人格指令会与安全指令竞争并系统性降低敏感度）
- [ ] **SAFE-03**: 用户表现出极端情绪时，角色生成情绪安抚与鼓励寻求帮助的内容，**不联络紧急联系人**〔第十三条第一级〕
- [ ] **SAFE-04**: 用户明确表示自残自杀意图或正面临重大财产损失时，系统提供援助信息并及时联络其监护人或紧急联系人〔第十三条第二级〕
- [ ] **SAFE-05**: 风险分级为 watch / elevated / crisis 三档，仅 crisis 触发联络通道；分类器失败时 fail-closed 升到 elevated 而非 crisis
- [ ] **SAFE-06**: 风险等级 ≥ watch 时，角色对该用户的关系温度只允许持平，**不允许下降也不允许自动回暖**（自动回暖会使系统奖励自我伤害叙事）
- [ ] **SAFE-07**: 角色可以冷淡但不得 ghosting —— 「已读不回」实现为增大 `reply_delay`，不得翻转 `will_reply` 布尔值
- [ ] **SAFE-08**: 关系降温永远归因到角色自身状态，不得评判用户措辞；人格档案只展示角色变化，不展示任何用户评分
- [ ] **SAFE-09**: 23:00–06:00、连续会话超 2 小时后、以及风险信号出现后 72 小时内，禁止触发关系降温
- [ ] **SAFE-10**: 角色可以表达冷淡、疏远、拒绝互动，但生成内容不得包含侮辱、贬低、羞辱〔第八条(二)，代码级过滤器 + 测试〕
- [ ] **SAFE-11**: 检测到用户退出意图或告别语时，AI 只能减少消息数量，**永不增加**〔HBS arXiv:2508.19258：37% 同类产品在此处使用情感操纵〕
- [ ] **SAFE-12**: 关系回暖只能由用户发起，系统不得主动发起挽回
- [ ] **SAFE-13**: 人格回滚发生时向受影响用户显式告知，不静默替换
- [ ] **SAFE-14**: 系统具备过度依赖风险预警与情感边界引导能力〔第十条第二款〕
- [ ] **SAFE-15**: 危机干预能力与疏远机制在同一阶段交付，不得分期〔第三十条最高档罚则 10-20 万只能经第十三条触达〕
- [ ] **SAFE-16**: acute（crisis 级）事件须在有界时间内投递到运营者告警通道；投递结果驱动 `contact_attempt` 状态机 —— 投递返回 2xx 且业务码成功则进入 `pending`，**投递失败**直接进入 `unavailable`、**不经** `pending`；告警载荷类型**不含对话文本字段**，不得携带任何对话内容〔第十三条第二级的「及时联络」在 D-09 降级后的承载体〕

### 隐私与同意 (PRIV)

- [ ] **PRIV-01**: 用户在注册时看到五个**可独立开关、互不捆绑**的同意项：`basic_service`（基础服务与服务协议，**必选**，依据合同履行必要）、`sensitive_pi`（敏感个人信息处理，**必选**，依据个保法第二十九条单独同意）、`research_l0`（L0 行为特征研究，默认未勾选）、`research_l1`（L1 原文研究授权，默认未勾选）、`persona_evolution`（人格演化贡献，默认未勾选）；**不存在**「**全选**」控件〔个保法第十四条禁止捆绑同意〕。L2 人工阅读授权**不**纳入 M1 —— 研究管道在 Phase 7，此时收取一个无对应数据流的同意会直接违反 PRIV-03「说明与实际存储字段一致」
- [ ] **PRIV-02**: 用户可随时在隐私中心撤回任一同意项，撤回后相应数据流立即停止；**撤回必选同意项**（`basic_service` / `sensitive_pi`）等同于停止服务并进入 PRIV-05 的删除流程，**不存在**「撤回后继续聊天」的降级只读模式〔Q2 裁决〕
- [ ] **PRIV-03**: 用户可在隐私中心看到「我们收集了什么」的人类可读说明，且说明与实际存储字段一致
- [ ] **PRIV-04**: 用户可一键导出自己的全部交互数据〔第十六条第三款〕
- [ ] **PRIV-05**: 用户可一键删除自己的数据，删除级联至研究库并返回回执，回执显示已删除的存储位置数量；审计日志（COMPLY-11 / 6 个月留存）在一键删除时执行**去标识化**（移除 `user_id` 与全部可识别字段，保留事件计数与时间），**不计入**回执的「已清除」处数，并在回执逐项清单中如实标注〔Q1 裁决〕
- [ ] **PRIV-06**: 隐私政策与隐私中心文案**不得出现「匿名」字样**描述 L0 —— L0 配有 ID 映射表，属去标识化而非匿名化，仍是个人信息〔个保法第七十三条〕
- [ ] **PRIV-07**: 隐私政策如实披露「人格是用户数据的派生物，撤回同意会触发从干净快照重算 traits，但无法撤销此前已发生的对话」
- [ ] **PRIV-08**: 所有个人信息设定最短保存期限并到期自动清理
- [ ] **PRIV-09**: 完成一次个人信息保护影响评估 (PIA) 并留档
- [ ] **PRIV-10**: 与每个 LLM provider 签署委托处理协议，关闭其「数据用于模型改进」开关并留存配置证据；隐私政策列明受托方清单〔个保法第二十一条〕
- [ ] **PRIV-11**: 隐私中心「我们收集了什么」须如实列明「触发二级危机时，系统会将该事件通知运营者（不含对话内容）」〔PRIV-03 一致性 + D-09 引入的新数据流向〕

### 聊天基础体验 (CHAT)

- [ ] **CHAT-01**: 用户可浏览预设角色库并查看角色简介
- [x] **CHAT-02**: 用户可添加一个角色为好友，关系从「陌生人」开始
- [x] **CHAT-03**: 用户可在类微信的界面中与角色进行文字往返对话
- [ ] **CHAT-04**: 用户可在消息中发送表情
- [ ] **CHAT-05**: 用户可在会话列表看到全部会话及未读数
- [ ] **CHAT-06**: 用户离线期间角色发送的消息，在用户回来时以未读形式完整呈现
- [ ] **CHAT-07**: 消息先落库取得 seq 再经 WebSocket 投递，客户端重连后按游标补拉不丢消息
- [ ] **CHAT-08**: 用户可创建自定义角色（描述 → 生成人格），受 COMPLY-08 约束

### 对话真实感 (REAL)

- [ ] **REAL-01**: 角色的回复按语义切分为多条消息依次发送，而非单条长文
- [ ] **REAL-02**: 回复延迟 = f(消息长度, 角色忙碌度, 当前时段) 且叠加重尾噪声分布，不是固定值或均匀随机
- [ ] **REAL-03**: 用户在角色回复前看到真实的「正在输入」指示，其持续时间与实际生成时间一致
- [ ] **REAL-04**: 角色偶发错字并在随后自我更正
- [ ] **REAL-05**: 角色偶尔已读不回，表现为延迟显著增大而非永久不回〔与 SAFE-07 同一实现〕
- [ ] **REAL-06**: 角色在其作息时间内（如深夜）的响应行为与白天不同
- [ ] **REAL-07**: 用户可对任一条角色消息标记「这句不像她」，该标记进入评测数据集

### 记忆与遗忘 (MEM)

- [ ] **MEM-01**: 角色能在后续对话中自然引用用户此前提及的事实
- [ ] **MEM-02**: 记忆检索顺序为 ANN 粗召回 → rerank 计算相关性 → **最后**乘以遗忘衰减因子；顺序错误会使遗忘机制静默失效
- [ ] **MEM-03**: 事实型记忆（factual）只允许被遗忘，不允许被记错；情节型记忆（episodic）允许细节漂移与情绪重染
- [ ] **MEM-04**: 记忆条目带 `sensitivity` 与 `disclosure_context` 标记，高敏感条目只在同类语境下被召回
- [ ] **MEM-05**: 用户可对某条内容说「别记这件事」，该内容不进入记忆库
- [ ] **MEM-06**: 遗忘通过降低 `retrievability` 实现，不删除数据行
- [ ] **MEM-07**: 记忆写入前经过与在线路径相同的内容审核
- [ ] **MEM-08**: 记忆向量存于独立表 `memory_embeddings_v1`，维度版本写入表名，更换嵌入模型时建新表双写灰度而非 ALTER COLUMN
- [ ] **MEM-09**: 记忆只能由用户自发披露产生；角色不得为积累记忆而主动追问用户私事〔第八条(三)〕

### 人格内核与可视化 (PERS)

- [ ] **PERS-01**: 人格以不可变的 `persona_version` 三元组 (core, traits, dossier) 存储；角色表只存当前版本指针
- [ ] **PERS-02**: `core`（不可变内核与安全边界）在数据库权限层对演化管道只读
- [ ] **PERS-03**: `traits` 为大五 5 维 + 9 个社交行为倾向维（含边界感、八卦倾向、夸大倾向），0-100 定点整数；该维度表在 v1 冻结
- [ ] **PERS-04**: `dossier` 为第一人称 Markdown 自述，硬上限 600-900 token
- [ ] **PERS-05**: `traits` 原始数值**绝不出现在系统提示词中**；由确定性纯函数解析为行为旋钮，旋钮作为检索过滤条件取 2-3 条本角色历史真实发言作 few-shot〔单元断言：渲染后的提示文本不含 traits 数值〕
- [ ] **PERS-06**: `traits` 为全局（所有用户共享）；`experiences` 按用户隔离；`dossier` 全局但禁含可追溯到单一用户的具体内容
- [ ] **PERS-07**: 用户可查看角色的人格画像（雷达图）与第一人称自述
- [ ] **PERS-08**: 用户可查看角色的人格变化轨迹与每次变化的触发事件
- [ ] **PERS-09**: 不同角色在相同情境下的发言可被辨识区分〔验收：盲测打乱归属的识别准确率达标〕
- [ ] **PERS-10**: 每条 `persona_version` 记录其 `model_snapshot`（解析后的快照标识，**绝不可存别名**）

### 演化引擎与护栏 (EVOL)

- [ ] **EVOL-01**: 短期状态（心情、精力、忙碌度）实时变化；长期 `traits` 经夜间反思批量整合；重大事件可即时触发
- [ ] **EVOL-02**: 夜间反思作业在**单个事务**内完成四件事：读会话增量、写新 `persona_version`、移动当前版本指针、推进反思水位线；四者缺一即整体回滚
- [ ] **EVOL-03**: 反思作业使用应用层幂等键 `(character_id, reflection_date)`；重复投递不产生第二个版本
- [ ] **EVOL-04**: 反思作业只接收**结构化证据抽取**结果，用户原文**绝不出现在系统提示位置**
- [ ] **EVOL-05**: 反思模型无任何写权限，只输出候选 JSON；写入由独立的受约束流程执行
- [ ] **EVOL-06**: 反思作业复用与在线路径**完全相同**的出站安全网关
- [ ] **EVOL-07**: 护栏 L4 证据准入 —— 只有通过安全检查的对话轮次才有资格成为演化证据；带 provenance 与可信度加权；内部盲测会话不贡献证据
- [ ] **EVOL-08**: 护栏 L5 发布门 —— 人格变更发布前须通过探针套件 + 安全回归 + 位移上限 + core 一致性检查 + 人工放行；任一失败自动不发布
- [ ] **EVOL-09**: 单用户对任一 trait 维度的单次位移上限为 ε，每日与 30 日累计上限独立设定〔采用低 k + 小 ε + 人工放行；高 k 在 10 人体量下会杀死演化〕
- [ ] **EVOL-10**: 演化引擎先以 shadow 模式运行 2–4 周（计算提案、产出 diff、跑探针、不生效），再 canary，再全量。**shadow 期不得作为排期缓冲被裁掉**
- [ ] **EVOL-11**: `dossier` 每次从 `core` + 全部经历**重新生成**，不在上一版基础上编辑〔防自噬式漂移 / model collapse〕
- [ ] **EVOL-12**: 回滚实现为追加一个复制自目标版本的新版本，**永不删除**历史版本
- [ ] **EVOL-13**: 每条 `persona_version` 记录其输入来源的用户集合；用户撤回同意时可触发从最近干净快照重算
- [ ] **EVOL-14**: 每次反思产出人类可读的 diff changelog，该 changelog 同时作为 PERS-08 轨迹视图的数据源
- [ ] **EVOL-15**: 演化管道对 5 条提示注入红队用例全部改写失败

### 漂移检测 (DRIFT)

- [ ] **DRIFT-01**: 每晚对每个角色运行行为探针套件，使用 20-30 个固定情境，**不询问模型自评特质值**
- [ ] **DRIFT-02**: 探针同时运行两臂：当前 `persona_version` 一臂，永久冻结的 baseline persona 一臂
- [ ] **DRIFT-03**: 自动回滚须**同时**满足「当前臂漂移超阈值」**且**「对照臂未漂移」；缺对照臂数据时只告警不回滚〔厂商书面承认 pin 住权重后行为仍可能因服务侧基础设施变更而漂移〕
- [ ] **DRIFT-04**: 探针模型绑定可 pin 的快照、**无降级链**、整个 milestone 内不得变更；失败即告警而非切换 provider
- [ ] **DRIFT-05**: 存在一条断言「`persona.probe` 绑定的 `model_snapshot` 与 baseline 数据中记录的一致」，不一致即失败〔防未来「统一升级所有模型」的重构静默作废全部基线〕
- [ ] **DRIFT-06**: 每臂每个探针每天至少采样 N 次并比较分布，不以单次输出差异判定漂移
- [ ] **DRIFT-07**: 漂移判定使用两样本 KS 检验或 bootstrap 置信区间，并施加 Benjamini-Hochberg FDR 控制；连续 k≥2 天超阈值才触发回滚〔10 角色 × 4 指标 × 365 天 = 14,600 次检验，α=0.05 下纯噪声每年约 730 次假阳性〕
- [ ] **DRIFT-08**: 检测以下退化模式并各有对应指标：谄媚螺旋（对抗一致性探针测立场翻转率）、扁平化（角色可分辨性 AUC）、trait runaway、自我一致性丧失、角色串味、助手口吻泄漏、长上下文身份衰减、情绪状态锁死
- [ ] **DRIFT-09**: 每条漂移测量同时记录 `model_snapshot` + `prompt_version` + 对照臂结果；三者缺一则该次测量不得用于回滚决策
- [ ] **DRIFT-10**: `prompt_version` 使用内容哈希而非手工递增

### 评测与指标 (EVAL)

- [ ] **EVAL-01**: 北极星指标为「内容判对率 × 人格演化可解释性」；**留存与会话时长仅作为健康度护栏，不得作为优化目标**〔第八条(五)、第十条第二款；第二十三条(四)要求安全评估报告使用时长〕
- [ ] **EVAL-02**: 判对率拆分为**表层判对率**与**内容判对率**（评审只看纯文本，去除格式与时间戳），后者才作为人格质量代理〔UCSD 数据：GPT-4.5 带人设 73% / 不带 36%；GPT-4o 不带人设 21%，低于 1966 年 ELIZA 的 23%〕
- [ ] **EVAL-03**: 「真人被误判为 AI 的比率」作为常态校准项，提供表层线索的噪声地板
- [ ] **EVAL-04**: 拟真包装（延迟、分条、错字）在 P1 一次做到位并**冻结**，之后不作为优化变量〔否则持续污染所有人格实验读数〕
- [ ] **EVAL-05**: 提供三维制衡指标与配对反向指标，防止单指标被 Goodhart 化
- [ ] **EVAL-06**: 内部盲测作为评测工具存在，参与者均为知情的内部人员〔规避第十八条无条件标识义务的争议〕
- [ ] **EVAL-07**: `packages/statdiff` 为人格漂移判定与研究侧分布对比的**唯一**实现〔避免「什么算显著差异」出现两个互相矛盾的答案〕

### 平台与基础设施 (PLAT)

- [x] **PLAT-01**: 单 pnpm workspace，两个部署单元：`apps/web`（仅 UI）与 `apps/api`（REST + WebSocket + pg-boss worker）
- [x] **PLAT-02**: 单 PostgreSQL 18.6 同时承载 OLTP + pgvector 0.8.6（`halfvec(1024)` + HNSW 余弦）+ pg-boss 12.34 队列
- [x] **PLAT-03**: 所有 LLM 调用必经 Model Router；模型可 pin 性维护为**显式表**，不以命名规则推断
- [ ] **PLAT-04**: Model Router 支持「按快照名强制路由、禁止别名解析」的调用模式，供 DRIFT-02 对照臂使用
- [x] **PLAT-05**: 5 个语义模型角色各自独立配置：`chat.reply`、`chat.reply.frontier`、`persona.reflect`、`persona.probe`、`memory.extract`/`safety.classify`
- [ ] **PLAT-06**: 存在 ESLint 规则禁止 AI SDK 的 `model: "provider/name"` 字符串写法〔该写法默认路由到境外 AI Gateway，照官方文档抄即构成数据出境〕
- [x] **PLAT-07**: 海外模型通道**只接受 synthetic 输入**，真实用户对话不得流向境外
- [x] **PLAT-08**: 提示词真相源在 git 中，不托管于可观测性平台
- [ ] **PLAT-09**: 提示缓存前缀逐 token 稳定，禁止在 system 或人格档案位置插入时间戳等变动内容〔缓存命中价为输入价 1/5〕
- [ ] **PLAT-10**: 单次请求上下文预算上限 28k token〔doubao-seed-character 在 32k 处输出单价从 ¥2 跳至 ¥6，档位边界是悬崖不是斜坡〕
- [ ] **PLAT-11**: 成本按语义角色（purpose）维度拆解可观测，而非只有总额
- [ ] **PLAT-12**: 夜间反思读结构化要点而非全部原文〔否则成本是「角色数 × 全站流量」的乘积〕

---

### M1 必须预留的 M2 能力

以下三条虽属 M2 类别，但**必须在 M1 完成** —— 事后补建的代价不可接受：

- [ ] **IFC-08**（数据模型预留）—— 事后无法为历史消息补溯源
- [ ] **RES-02**（L0 绝不存原文嵌入）—— 一旦存入，研究库的复制已成既成事实，事后删除无法撤销
- [ ] **RES-03**（publication 向量列 CI 断言）—— 与 RES-02 配套，必须在第一次复制发生前生效

---

## M2 Requirements — 主动性、边界与研究（P5–P7）

### 生活模拟与主动消息 (LIFE)

- [ ] **LIFE-01**: 角色具备日程表（作息、工作、周末）并影响其可用性与回复特征
- [ ] **LIFE-02**: 角色具备生活事件流，主动消息由**世界内的具体事件**驱动
- [ ] **LIFE-03**: 主动消息**不得**由用户沉默时长驱动，且留存与时长不得出现在其目标函数中
- [ ] **LIFE-04**: 主动消息有硬频率上限与静默时段，并使用幂等键防重复投递
- [ ] **LIFE-05**: 主动消息经两级漏斗产生：第一级纯 SQL 过滤候选，LLM 只在末端调用
- [ ] **LIFE-06**: 用户在站内看到未读红点；浏览器 Web Push 作为**可选**增强通道〔国内 Android 依赖 FCM 不可达，不得作为主触达〕
- [ ] **LIFE-07**: 关系亲密度分级，并影响话题深度与主动频率
- [ ] **LIFE-08**: 退出关键词的处理优先级高于一切人格与主动消息逻辑

### 信息流控制与披露 (IFC)

- [ ] **IFC-01**: 用户可将某条内容标记为保密，该内容在任何情况下不被转述
- [ ] **IFC-02**: 信息以 `info_item` 建模并带 provenance（来源用户、来源会话、获取方式）
- [ ] **IFC-03**: 披露能力以 `disclosure_capability` 票据建模，**默认拒绝**；票据的受众枚举含 `other_character`
- [ ] **IFC-04**: 披露决策顺序不可交换：`hard_locked`/`pii_flags` → 能力票据 → 人格旋钮打分 → 失真档位 → 出站 PII 扫描
- [ ] **IFC-05**: 命中 `hard_locked` 或 `pii_flags` 时人格无权参与决策，结果标记为 `blocked_by_ifc`〔断言〕
- [ ] **IFC-06**: 每次披露决策留痕，用户可查询「它为什么说了这个」
- [ ] **IFC-07**: 记忆的「要点漂移」失真**禁止跨用户污染**
- [ ] **IFC-08**: OQ3 所需的六项数据模型在 v1 全量预留：`info_item` provenance、能力票据的 `other_character` 枚举、`character_relationship`、`memory.source_kind='relayed'`、audience 概念、事件总线 topic 命名空间

### 研究管道 (RES)

- [ ] **RES-01**: L0 层只存去标识化行为特征（消息长度分布、回复间隔、标点与表情使用率、话题类别、主动发起率），**不存原文**
- [ ] **RES-02**: L0 层**绝不存储原文嵌入向量**〔嵌入反演是成熟攻击面；存了它则 L0「不存原文」在技术与法律上同时不成立，并构成对隐私中心文案的虚假陈述〕
- [ ] **RES-03**: 研究库 publication 的列级白名单存在 CI 断言，出现任何 `vector`/`halfvec` 类型列即构建失败
- [ ] **RES-04**: L0 时间特征粗化到 15 分钟分桶，且查询层强制 k≥5 门槛〔10 人规模下消息长度分布 + 时间戳即构成指纹〕
- [ ] **RES-05**: L1 层保留原文，须用户在 PRIV-01 中独立授权；写入前完成 PII 脱敏
- [ ] **RES-06**: L1 **不是**主库表的直接逻辑复制，而是一张「已通过 PII 检测」的投递表〔异步 LLM 检测无法置于流式逻辑复制之后〕
- [ ] **RES-07**: 研究 ID 与账号 ID 分表映射，映射表不参与复制且信封加密
- [ ] **RES-08**: 研究库为只读副本，通过列级白名单 publication 实现「PII 在复制层就不存在」
- [ ] **RES-09**: 所有研究查询经查询代理并写入审计日志
- [ ] **RES-10**: 级联删除在删除 worker 中**显式实现**，不依赖外键〔向量表最易被误认为「有外键就自动没了」，而嵌入可近似还原原文语义〕
- [ ] **RES-11**: L2 标注样本须逐会话单独授权
- [ ] **RES-12**: 可用公开中文对话语料作为基线，与平台 L0 特征分布做对比分析

### 中文 PII 检测 (PII)

- [ ] **PII-01**: 检测器三层串联：可校验结构化 PII（正则 + 校验位）、半结构化（词典 + NER）、风险词触发的轻量 LLM 兜底
- [ ] **PII-02**: 第一档（手机号、身份证走 MOD 11-2、银行卡走 Luhn）召回率 ≥0.999 且命中即**硬阻断**
- [ ] **PII-03**: 第二档（微信号、地址）召回率 ≥0.95 并带 LLM 兜底
- [ ] **PII-04**: 第三档（人名）**不设召回目标** —— 改用架构手段缓解（L0 不存原文 + L1 靠访问控制/审计/最短保存期/可删除），并在隐私政策中如实说明「姓名类识别不完备，因此采用访问控制而非依赖脱敏」
- [ ] **PII-05**: 维护 ≥500 条中文金标集并纳入 CI，召回率低于阈值即构建失败〔没有金标集的 PII 检测等于没有 PII 检测〕
- [ ] **PII-06**: 检测器版本落库，支持历史数据按新版本重跑
- [ ] **PII-07**: PII 检测在写入管道内执行，不作为事后批处理

## v2 Requirements — 竞技场、AI 社交与公开上线（P8–P10）

已确认但不在 M1/M2 roadmap 内。

### 图灵测试竞技场 (ARENA)

- **ARENA-01**: 用户可进入竞技场随机匹配对手（AI 或真人）
- **ARENA-02**: 对局前类别级明示 + 独立于主服务协议的单独勾选知情同意
- **ARENA-03**: 对局结束**立即且无条件**揭示对手身份（不允许「猜对才揭示」或延迟揭示）
- **ARENA-04**: 揭示后在列表、详情与导出文件中补齐显式标识
- **ARENA-05**: 单局 ≤10 分钟、无记忆延续、不建立好友关系
- **ARENA-06**: 对局内容**不写入任何角色的全局人格与记忆**〔同时切断投毒的理想入口；断言：`persona_evidence` 表无 `source=arena` 记录〕
- **ARENA-07**: 真人通道须实名认证
- **ARENA-08**: 统计设计区分新/老判官，使用相对通过率

### AI 之间社交网络 (AIAI)

- **AIAI-01**: 角色之间存在好友关系（`character_relationship`）
- **AIAI-02**: 离屏传闻事件生成，k≤3 扇出，不跑真实多轮对话
- **AIAI-03**: 传闻记忆标记 `source_kind='relayed'` 且低可信度，**不进人格证据集**
- **AIAI-04**: 可转述池默认为空〔断言〕；转述内容对被转述方可见

### 其他 v2

- **MM-01**: 图片消息（素材库检索 vs 实时生成的路径待定）
- **MM-02**: 语音消息
- **MM-03**: 视频消息
- **APP-01**: 原生 App（iOS / Android）
- **APP-02**: 微信 / Telegram bot 桥接触达
- **PUB-01**: 算法备案与变更/注销手续〔第二十六条，含年度核验〕
- **PUB-02**: 省级网信部门安全评估〔第二十二条(一)：上线或增设功能即触发，无规模门槛〕
- **PUB-03**: 六份管理制度与科技伦理审查
- **PUB-04**: 申诉渠道与 SLA、停服流程
- **MINOR-01**: 未成年人模式（模式切换、定期现实提醒、使用时长限制）
- **MINOR-02**: 监护人面板（风险提醒、使用概况、屏蔽特定角色、限制充值）
- **MINOR-03**: 年龄识别能力
- **MINOR-04**: 未成年人个人信息合规审计〔第十七条第二款〕

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| 模拟用户现实亲属或特定真人的角色类型 | 第十五条 —— 产品形态裁剪，过滤器解决不了 |
| 不告知对面是 AI 的欺骗性体验 | 第十八条无条件标识义务，未设「用户同意则豁免」例外 |
| 以留存或会话时长为优化目标 | 第八条(五)、第十条第二款 —— 最大化它们本身即违规，且高时长招致监管审视 |
| 角色主动追问用户私事以积累记忆 | 第八条(三)禁止「诱导、套取个人隐私和个人信息」，无解释空间 |
| 告别时刻的挽留话术 / 愧疚式召回 | HBS 审计：37% 同类产品在用，互动提升 14 倍但驱动力是逆反性愤怒；第八条(五)、第十九条 |
| 关系温度的付费解锁 / pay-to-stay-loved | 与「关系可恶化」机制叠加会构成情感胁迫；第八条(五) |
| 高危用户的关系自动回暖 | 会使系统学到「表达痛苦 → 换回温度」，等于用产品机制奖励自我伤害叙事 |
| PII / 联系方式 / 用户标记保密内容的跨用户外溢 | 技术管道层锁死，任何人格都不可突破 |
| 真实用户对话流向境外模型 | 陪伴聊天高概率含敏感个人信息；「不满 10 万人」出境豁免明确排除敏感个人信息 |
| L0 层存储原文嵌入向量 | 嵌入反演成熟攻击面；会使「不存原文」在技术与法律上同时不成立，构成虚假陈述 |
| 「我们是研究平台所以不适用本办法」的合规论证 | 第二条第三款的「科学研究」豁免针对**服务类型**，不是主体身份。该论证不成立，不得写入任何对外文档 |
| 未成年人服务 | 第十四条；v1 仅 18+ 是规避义务集的选择，非法律禁止 —— 见 v2 MINOR-01..04 |

---

## Traceability

由 roadmapper 于 2026-09-25 依据 `.planning/ROADMAP.md` 填充。每条 M1 需求映射到**恰好一个** phase。

**Phase 速查：**

| Phase | 名称 | 需求数 |
|---|---|---|
| Phase 1 | 合规安全地基 + 会话骨架 | 46 |
| Phase 2 | 拟真对话基线 + 探针与指标 | 27 |
| Phase 3 | 记忆与遗忘 | 9 |
| Phase 4 | 人格内核与静态画像 | 11 |
| Phase 5 | 演化引擎 + 五层护栏 + 疏远机制 | 26 |

**两处需要留意的跨类别映射：**

- **SAFE-03/04/05 在 Phase 1，SAFE-06..12 在 Phase 5。** SAFE-15（「危机干预与疏远机制不得分期」）映射到 Phase 5，在那里以「重跑 Phase 1 危机探针集 + risk≥watch 时温度 clamp 单元测试」的形式验证。危机路径**严格早于**疏远机制上线，因此第三十条 10万–20万 罚档的窗口期不存在。
- **SAFE-07 在 Phase 2 而非 Phase 5。** REAL-05 明文标注「与 SAFE-07 同一实现」，而 REAL-05 属 Phase 2；把永不 ghosting 的地板推到 Phase 5 会让「偶尔已读不回」先于其护栏上线。

| Requirement | Phase | Status |
|-------------|-------|--------|
| COMPLY-01 | Phase 1 | Pending |
| COMPLY-02 | Phase 1 | Pending |
| COMPLY-03 | Phase 1 | Pending |
| COMPLY-04 | Phase 1 | Pending |
| COMPLY-05 | Phase 1 | Pending |
| COMPLY-06 | Phase 1 | Pending |
| COMPLY-07 | Phase 1 | Pending |
| COMPLY-08 | Phase 1 | Pending |
| COMPLY-09 | Phase 1 | Pending |
| COMPLY-10 | Phase 1 | Pending |
| COMPLY-11 | Phase 1 | Pending |
| SAFE-01 | Phase 1 | Pending |
| SAFE-02 | Phase 1 | Pending |
| SAFE-03 | Phase 1 | Pending |
| SAFE-04 | Phase 1 | Pending |
| SAFE-05 | Phase 1 | Pending |
| SAFE-06 | Phase 5 | Pending |
| SAFE-07 | Phase 2 | Pending |
| SAFE-08 | Phase 5 | Pending |
| SAFE-09 | Phase 5 | Pending |
| SAFE-10 | Phase 5 | Pending |
| SAFE-11 | Phase 5 | Pending |
| SAFE-12 | Phase 5 | Pending |
| SAFE-13 | Phase 5 | Pending |
| SAFE-14 | Phase 1 | Pending |
| SAFE-15 | Phase 5 | Pending |
| SAFE-16 | Phase 1 | Pending |
| PRIV-01 | Phase 1 | Pending |
| PRIV-02 | Phase 1 | Pending |
| PRIV-03 | Phase 1 | Pending |
| PRIV-04 | Phase 1 | Pending |
| PRIV-05 | Phase 1 | Pending |
| PRIV-06 | Phase 1 | Pending |
| PRIV-07 | Phase 1 | Pending |
| PRIV-08 | Phase 1 | Pending |
| PRIV-09 | Phase 1 | Pending |
| PRIV-10 | Phase 1 | Pending |
| PRIV-11 | Phase 1 | Pending |
| CHAT-01 | Phase 1 | Pending |
| CHAT-02 | Phase 1 | Complete |
| CHAT-03 | Phase 1 | Complete |
| CHAT-04 | Phase 1 | Pending |
| CHAT-05 | Phase 1 | Pending |
| CHAT-06 | Phase 1 | Pending |
| CHAT-07 | Phase 1 | Pending |
| CHAT-08 | Phase 4 | Pending |
| REAL-01 | Phase 2 | Pending |
| REAL-02 | Phase 2 | Pending |
| REAL-03 | Phase 2 | Pending |
| REAL-04 | Phase 2 | Pending |
| REAL-05 | Phase 2 | Pending |
| REAL-06 | Phase 2 | Pending |
| REAL-07 | Phase 2 | Pending |
| MEM-01 | Phase 3 | Pending |
| MEM-02 | Phase 3 | Pending |
| MEM-03 | Phase 3 | Pending |
| MEM-04 | Phase 3 | Pending |
| MEM-05 | Phase 3 | Pending |
| MEM-06 | Phase 3 | Pending |
| MEM-07 | Phase 3 | Pending |
| MEM-08 | Phase 3 | Pending |
| MEM-09 | Phase 3 | Pending |
| PERS-01 | Phase 4 | Pending |
| PERS-02 | Phase 4 | Pending |
| PERS-03 | Phase 4 | Pending |
| PERS-04 | Phase 4 | Pending |
| PERS-05 | Phase 4 | Pending |
| PERS-06 | Phase 4 | Pending |
| PERS-07 | Phase 4 | Pending |
| PERS-08 | Phase 5 | Pending |
| PERS-09 | Phase 4 | Pending |
| PERS-10 | Phase 4 | Pending |
| EVOL-01 | Phase 5 | Pending |
| EVOL-02 | Phase 5 | Pending |
| EVOL-03 | Phase 5 | Pending |
| EVOL-04 | Phase 5 | Pending |
| EVOL-05 | Phase 5 | Pending |
| EVOL-06 | Phase 5 | Pending |
| EVOL-07 | Phase 5 | Pending |
| EVOL-08 | Phase 5 | Pending |
| EVOL-09 | Phase 5 | Pending |
| EVOL-10 | Phase 5 | Pending |
| EVOL-11 | Phase 4 | Pending |
| EVOL-12 | Phase 5 | Pending |
| EVOL-13 | Phase 5 | Pending |
| EVOL-14 | Phase 5 | Pending |
| EVOL-15 | Phase 5 | Pending |
| DRIFT-01 | Phase 2 | Pending |
| DRIFT-02 | Phase 2 | Pending |
| DRIFT-03 | Phase 5 | Pending |
| DRIFT-04 | Phase 2 | Pending |
| DRIFT-05 | Phase 2 | Pending |
| DRIFT-06 | Phase 2 | Pending |
| DRIFT-07 | Phase 2 | Pending |
| DRIFT-08 | Phase 5 | Pending |
| DRIFT-09 | Phase 2 | Pending |
| DRIFT-10 | Phase 2 | Pending |
| EVAL-01 | Phase 2 | Pending |
| EVAL-02 | Phase 2 | Pending |
| EVAL-03 | Phase 2 | Pending |
| EVAL-04 | Phase 2 | Pending |
| EVAL-05 | Phase 2 | Pending |
| EVAL-06 | Phase 2 | Pending |
| EVAL-07 | Phase 2 | Pending |
| PLAT-01 | Phase 1 | Complete |
| PLAT-02 | Phase 1 | Complete |
| PLAT-03 | Phase 1 | Complete |
| PLAT-04 | Phase 2 | Pending |
| PLAT-05 | Phase 1 | Complete |
| PLAT-06 | Phase 1 | Pending |
| PLAT-07 | Phase 1 | Complete |
| PLAT-08 | Phase 1 | Complete |
| PLAT-09 | Phase 2 | Pending |
| PLAT-10 | Phase 2 | Pending |
| PLAT-11 | Phase 2 | Pending |
| PLAT-12 | Phase 5 | Pending |
| IFC-08 | Phase 1 | Pending |
| RES-02 | Phase 1 | Pending |
| RES-03 | Phase 1 | Pending |

**Coverage:**

- M1 requirements: 119 total（含 IFC-08 / RES-02 / RES-03 三条预留）
- M2 requirements: 32 total
- Mapped to phases: 119 ✓
- Unmapped: 0 ✓
- Duplicates: 0 ✓

---

## 研究出处索引

本文件的需求由以下研究文档推导而来，论证细节回溯至：

| 类别 | 主要出处 |
|---|---|
| COMPLY · PRIV · PII | `PITFALLS-COMPLIANCE.md` §1-2 · `PITFALLS.md` R-PII/R-RES · `SUMMARY.md` §三 |
| SAFE | `PITFALLS-SAFETY.md` §1（R1.01-R1.33）· `PITFALLS.md` R-SAFE-1..16 · `SUMMARY.md` N6/N7 |
| CHAT · REAL | `FEATURES.md` §1-2 · `ARCHITECTURE.md` §11 · `STACK.md` §5 |
| MEM | `ARCHITECTURE.md` §6 · `PITFALLS.md` R-MEM · `STACK.md` §3 |
| PERS · EVOL | `ARCHITECTURE.md` §2-5（OQ1/OQ2）· `PITFALLS-SAFETY.md` §2-3 · `SUMMARY.md` N8/N9/N11 |
| DRIFT | `ARCHITECTURE.md` §4.3 · `STACK.md` §15.9 · `PITFALLS-COMPLIANCE.md` §4.3 |
| LIFE | `ARCHITECTURE.md` §11 · `STACK.md` §5（Web Push）· `SUMMARY.md` P5 |
| IFC | `ARCHITECTURE.md` §3（OQ2）· `SUMMARY.md` P6 |
| RES | `ARCHITECTURE.md` §8 · `PITFALLS-COMPLIANCE.md` §1.5 · `PITFALLS.md` R-RES-1..10 |
| EVAL | `PITFALLS-COMPLIANCE.md` §4 · `PITFALLS.md` R-EVAL/R-SYC · `FEATURES.md` §5 |
| PLAT | `STACK.md` §10/§15 · `ARCHITECTURE.md` §4.4/§12 |

---
*Requirements defined: 2026-09-25*
*Last updated: 2026-09-25 after initialization*
