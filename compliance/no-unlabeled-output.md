---
egress_hash: sha256:64cce2d35c35482f61df8ff06fc1a8a7589a65b4fd187d62b840533d7db0a70c
reviewed_at: 2026-09-27
reviewed_by: zexueli
---

# 无显式标识对外提供内容登记（COMPLY-11）

**结论：Phase 1 的对外提供路径全部带 AI 明示标识，因此《互联网信息服务深度合成管理
规定》配套的《人工智能生成合成内容标识办法》第九条所指「留存提供对象日志」的对象是
一个空集。本文件即该结论的登记。**

《标识办法》第九条要求：服务提供者向他人提供**未添加显式标识**的生成合成内容时，应当
留存提供对象的相关日志不少于六个月。它的适用前提是「存在未添加显式标识的对外提供
行为」。Phase 1 不存在这样的行为，所以留存义务的对象为空集 —— 不是「我们不留」，而是
「没有需要留的对象」。这两者的区别正是本文件存在的理由：前者是一次违规，后者是一个
需要被登记、被复核、被机械绑定的事实。

## 出口逐条核实

下表逐条覆盖 `packages/safety/src/egress.ts` 的 `EGRESS_POINTS` 五项。判据只有两种：
**它带标识**，或者**它不构成「对外提供生成合成内容」**。没有第三种。

### 1. `ws.deliver` —— WebSocket 下发（`apps/api/src/ws/server.ts`）

**判据：带标识。** 下发帧的 `payload.disclosure` 不是由 WS 层构造的，而是
`insertCharacterMessage()` 落库时注入、再由投递读出的同一个对象（见第 2 条）。WS 层
拿不到一条没有 `disclosure` 的角色消息：`deliver()` 的入参 `disclosure` 来自落库返回
值，而落库那一步有 DB CHECK 兜底。另一条下行路径 `publish()` 的类型刻意排除了
`message.created`，因此它不可能承载消息正文 —— 一条不含正文的事件不构成「提供生成
合成内容」。

### 2. `db.insertCharacterMessage` —— 消息落库（`packages/db/src/message.ts`）

**判据：带标识，且是标识的唯一注入点（COMPLY-09）。** `disclosure` **不作为参数传入**：
调用方给不了它，也就改不了它。标识内容由本函数与 `@drift/contract` 的常量共同决定，
角色消息一律注入 `kind: 'ai_generated'` 与 `labelerVersion`。数据库层还有一条 CHECK
兜底：`sender_kind = 'character'` 的行 `disclosure` 不得为空。于是「新增一条绕过标识
注入的写入路径」在数据库层失败，而不是在 code review 里失败。

### 3. `export.renderLine` —— 导出文件渲染（`apps/api/src/modules/export/render.ts`）

**判据：带标识，且标识随文件存活（COMPLY-02）。** 角色消息行由本函数注入 `[AI] `
前缀写进文件正文。前缀而非后缀、写进正文而非依赖查看器：导出的 `.md` / `.json` 会离开
本平台，任何依赖平台侧渲染的标识在那一刻就消失了。文件头三行元数据与 `.json` 形态在
Plan 11 补齐，届时本条须连同 `egress_hash` 一起重新复核。

### 4. `alert.acuteWebhook` —— 二级危机的运营者告警（`apps/api/src/modules/safety/alert.ts`）

**判据：不构成「对外提供生成合成内容」。** 告警载荷类型 `AcuteAlert` 只含 `userId` /
`conversationId` / `riskLevel` / `occurredAt` / `safetyEventId` 五个字段，**类型中不存在
任何对话文本字段**，因此该出口从不传输任何生成内容 —— 既不是带标识的生成内容，也不是
未带标识的生成内容。它在 `EGRESS_POINTS` 中登记为 `carriesUserText: false`，并由
`tools/ci/egress-registry.test.ts` 的第三条绑定断言守着：用一条含特征串的触发消息走到
载荷构造点，断言序列化后的 webhook 载荷不含该特征串的任何片段。

该出口同时是 D-09 引入的**一条新的个人信息流向**（向运营者披露「某用户触发了二级
危机」这一事实）。它在隐私中心「我们收集了什么」中如实列明（PRIV-11），与本条的
「不含对话内容」结论一致。

### 5. `reconcile.publicnessWebhook` —— 公开性对账告警（`apps/api/src/worker/jobs/publicness-reconcile.ts`）

**判据：不构成「对外提供生成合成内容」。** 载荷类型 `ReconcileReport` 只有四个字段
（`declared` / `actual` / `matches` / `withinCap`）—— 两个计数加两个布尔判定，**类型中
不存在任何文本字段**，因此该出口从不传输任何生成内容，也从不传输任何用户标识。它在
`EGRESS_POINTS` 中登记为 `carriesUserText: false`，并由 `RECONCILE_REPORT_FIELDS_MATCH_TYPE`
这条编译期断言守着字段集合：给 `ReconcileReport` 加一个字段而不改字段清单即编译失败。

它与第 4 条是**两个函数而不是一个**，这是刻意的。复用 `notifyOperator` 要么谎报一次危机
（`AcuteAlert.riskLevel` 恒为 `'crisis'`），要么把 `AcuteAlert` 放宽成一个能装任何东西的
类型 —— 后者直接废掉「载荷里不存在文本字段」这条编译期保证。抽一个
`postWecomText(content: string, …)` 更糟：一个接受任意字符串的导出投递函数，正是
`GatedText` 方案要堵的那个缺口（AST 扫描只看得见参数类型里的 `GatedText`，看不见
`string`）。代价是两处各有十几行 fetch 可能分叉，收益是两条出口的载荷类型各自都不可能
承载文本 —— 这笔交换是本条登记的实质内容。

该出口与第 4 条一样是一条**个人信息流向**吗？不是：它披露的是两个聚合计数，不涉及任何
可识别到个人的信息。它披露的是「本平台有几个注册用户」这一运营事实（COMPLY-10 的四条
抗辩之一），受众是运营者本人。

## 复核触发条件

**`EGRESS_POINTS` 集合发生任何变化（新增项、删除项、改 `module` / `fn` /
`carriesUserText`）时，必须重新复核本文件的逐条核实，并更新 front-matter 的
`egress_hash` 与 `reviewed_at` / `reviewed_by`。**

机械保证：`tools/ci/egress-hash.mjs` 计算 `EGRESS_POINTS` 的规范化 sha256，front-matter
的 `egress_hash` 与它不符时 CI 失败（`node tools/ci/egress-hash.mjs --check`，并由
`tools/ci/egress-registry.test.ts` 在 `ci:fast` 里驱动同一个 CLI）。

⚠️ **这条哈希不得由 CI 自动更新。** 自动更新会绕过「出口变了就要重新确认无未标识
输出」这个人工复核动作，把本登记变成装饰：CI 自己把哈希改对了，于是「有人重新读过这
份登记吗」这个问题永远答不出来。`egress-hash.mjs` 因此不含任何写文件调用，并有一条
断言守着这一点。

更新流程（人工，三步）：

1. 读完上面的「出口逐条核实」，对新的出口集合逐条给出判据（带标识 / 不构成对外提供）；
2. 跑 `node tools/ci/egress-hash.mjs --print`，把输出写进 front-matter 的 `egress_hash`；
3. 更新 `reviewed_at` / `reviewed_by`，与出口改动在**同一个 commit** 里提交。

## 适用范围备注

本登记的作用域是 Phase 1 的出口集合。Phase 2 起的主动消息与推送、Phase 7 的研究数据
对外提供，都是新的出口，落地时按上面的复核流程处理。若将来确实出现一条「未添加显式
标识的对外提供」路径，本文件的结论从空集变为非空集，届时须同时落地第九条要求的提供
对象日志（留存 ≥ 6 个月），并在 `DATA_INVENTORY` 与一键删除的去标识化流程（PRIV-05）
中登记该日志。
