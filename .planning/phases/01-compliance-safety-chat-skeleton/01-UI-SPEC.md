---
phase: "1"
slug: "compliance-safety-chat-skeleton"
status: draft
shadcn_initialized: false
preset: "next + radix + @shadcn/theme-slate + 自定义 --primary（待 apps/web scaffold 时应用）"
created: "2026-09-25"
---

# Phase 1 — UI Design Contract

> 合规安全地基 + 会话骨架 的视觉与交互契约。由 gsd-ui-researcher 产出，由 gsd-ui-checker 校验。
>
> **本阶段的特殊性质**：这份契约里有一部分不是样式选择，而是**法律要求**。凡标注
> 〔法定〕的条目，executor 不得以「视觉更干净」「拟真度更好」为理由调整或移除；要改必须先改
> REQUIREMENTS.md。凡标注〔禁用〕的文案规则，配有 CI grep 断言。

---

## 本阶段覆盖的用户可见面

| # | Surface | 承载需求 | 备注 |
|---|---------|---------|------|
| 1 | 注册 / onboarding（年龄 18+ → 监护人或紧急联系人 → 四个独立同意项） | COMPLY-06/07, PRIV-01, SAFE-14 | 四项同意**不得**合并为一个 checkbox〔法定〕 |
| 2 | 预设角色库（浏览）+「加为好友」 | CHAT-01, CHAT-02, COMPLY-08 | |
| 3 | 会话列表（类微信） | CHAT-05, CHAT-06, COMPLY-01 | AI 标识落点之一〔法定〕 |
| 4 | 聊天界面（类微信来回消息） | CHAT-03, CHAT-04, CHAT-07, COMPLY-01/03/05 | AI 标识落点之二〔法定〕 |
| 5 | 角色详情页 | CHAT-01, COMPLY-01 | AI 标识落点之三〔法定〕 |
| 6 | 导出文件（聊天记录） | COMPLY-02, PRIV-04 | AI 标识落点之四，**必须随文件存活**〔法定〕 |
| 7 | 两级危机干预面 | SAFE-01..05 | 一级不得联络紧急联系人；二级必须告知已联络〔法定〕 |
| 8 | 隐私中心（收集了什么 / 逐项撤回 / 导出 / 删除 + 回执） | PRIV-02..08, PRIV-10 | 禁用词规则作用域〔禁用〕 |
| 9 | 硬退出结果态 | COMPLY-05 | 挽留话术触发率恒为 0〔法定〕 |
| 10 | 连续 2 小时时长提醒 + 过度依赖动态提醒 | COMPLY-03, COMPLY-04, SAFE-14 | 计时在服务端，UI 只渲染 |

**无 UI 的 Phase 1 需求**（在此登记以免被误当作遗漏）：COMPLY-09（标识由消息管道中间件注入 —— 是架构约束，UI 只渲染服务端下发字段）、COMPLY-10/11、PRIV-09、SAFE-01/02（服务端执行顺序）、IFC-08、RES-02/03、PLAT-01..08。

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn（CLI **4.21.0**，已验证可达）—— **尚未 init**：仓库当前只有 `.planning/`，`apps/web` 未 scaffold，故 `components.json` 不存在 |
| Preset | `pnpm dlx shadcn@4.21.0 init --template next --base radix --css-variables --no-rtl`，随后 `add @shadcn/theme-slate` 并覆写 `--primary`（见 ## Color） |
| Component library | **radix**（`radix-ui`）—— 不是推测：`shadcn view @shadcn/bubble` 的 `dependencies` 字段实际列出 `radix-ui` |
| Icon library | **lucide-react**（shadcn 默认；Phase 1 只用到 ~12 个图标，不引入第二套） |
| Font | **系统字体栈**：`-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif`。零网络字体开销，中文字形贴近用户本机 IM 观感 —— 这正是「类微信」的第一性目标 |
| Dark mode | **v1 不做**。CSS 变量留 `.dark` 插槽但不实现。理由：AI 标识「可被用户明显感知」是法定要求，双主题会让对比度验收工作量翻倍 |
| 目标视口 | 移动优先（375–430px 宽），桌面为等宽居中单列（max-width 480px）+ 侧栏会话列表（≥1024px）。Phase 1 不做平板专属断点 |

---

## Component Inventory

Enumerated by `npx shadcn@latest search @shadcn --limit 200 --offset {0,200,400,600,800,1000,1200}` piped through `grep '(ui)$' | sort -u` — **61** `registry:ui` components（整个 registry 471 条：61 ui / 70 block / 238 example / 52 font / 13 internal / 5 theme / 2 style / 1 lib / 1 hook）— shadcn CLI **4.21.0** against the live `@shadcn` registry — **2026-09-25**.

> 枚举来源说明：`apps/web` 尚未 scaffold，无 `node_modules` 可枚举，因此上表取自 CLI 对线上 `@shadcn` registry 的查询 —— 该命令可重跑。**`shadcn init` 完成后，本行应替换为 `npx shadcn info` 的输出**。

**全部 61 个 `registry:ui` 组件**（此列表即枚举结果本身，非回忆）：

```
accordion alert alert-dialog aspect-ratio attachment avatar badge breadcrumb bubble
button button-group calendar card carousel chart checkbox collapsible combobox command
context-menu dialog direction drawer dropdown-menu empty field form hover-card input
input-group input-otp item kbd label marker menubar message message-scroller native-select
navigation-menu pagination popover progress radio-group resizable scroll-area select
separator sheet sidebar skeleton slider sonner spinner switch table tabs textarea
toggle toggle-group tooltip
```

Phase 1 实际要用的子集：

| Component | Import path | Notes |
|-----------|-------------|-------|
| `bubble` | `@/components/ui/bubble` | **聊天气泡原语**。导出 `BubbleGroup / Bubble / BubbleContent / BubbleReactions`；`align="start" | "end"`；variant 含 `default / secondary / muted / tinted / outline / ghost / destructive`。用户气泡用 `default`（吃 `--primary`），角色气泡用 `secondary`。⚠️ `BubbleContent` 默认 `text-sm px-3 py-2` —— 按本契约必须覆写为 `text-base`（16px），padding 保持 12px/8px |
| `message` | `@/components/ui/message` | 导出 `MessageGroup / Message`，带 `align`。承载头像 + 气泡 + 时间戳的一行布局 |
| `message-scroller` | `@/components/ui/message-scroller` | 消息流滚动容器（贴底、新消息跟随）。CHAT-07 的「重连补拉」在其顶部插入 loading 态 |
| `avatar` | `@/components/ui/avatar` | 角色头像。fallback 用角色名首字 |
| `badge` | `@/components/ui/badge` | **AI 标识徽标**〔法定〕+ 未读数。两者用不同 variant，禁止共用 |
| `checkbox` | `@/components/ui/checkbox` | 四个独立同意项〔法定：不得合并〕 |
| `switch` | `@/components/ui/switch` | 隐私中心的逐项撤回开关（PRIV-02） |
| `dialog` | `@/components/ui/dialog` | 2 小时时长提醒、过度依赖动态提醒（COMPLY-03/04） |
| `alert-dialog` | `@/components/ui/alert-dialog` | 一键删除、撤回同意项的破坏性确认（不可用 `dialog` —— 需要焦点陷阱 + 无 ESC 关闭） |
| `alert` | `@/components/ui/alert` | 危机干预关怀卡片的容器基座（覆写为 `care` 语义色） |
| `field` | `@/components/ui/field` | 表单字段布局（label + 控件 + 描述 + 错误），注册页与紧急联系人表单 |
| `form` | `@/components/ui/form` | 与 zod 4.6.5 契约对接（packages/contract 复用同一 schema） |
| `input` / `textarea` | `@/components/ui/input` | 年龄、紧急联系人、删除确认短语输入；textarea 用于消息输入框 |
| `label` | `@/components/ui/label` | 同意项与表单标签 |
| `empty` | `@/components/ui/empty` | 会话列表 / 角色库 / 导出为空三处空态的统一容器 |
| `skeleton` | `@/components/ui/skeleton` | 会话列表与角色库首屏加载 |
| `spinner` | `@/components/ui/spinner` | 消息发送中、导出打包中 |
| `sonner` | `@/components/ui/sonner` | 轻量成功/失败提示（**不用于**任何法定告知 —— toast 会自动消失，不可承担告知义务） |
| `scroll-area` | `@/components/ui/scroll-area` | 隐私政策长文、援助资源清单 |
| `separator` | `@/components/ui/separator` | 「以下是你离开后的消息」未读分割线（CHAT-06） |
| `card` | `@/components/ui/card` | 角色详情、隐私中心分区、删除回执 |
| `item` | `@/components/ui/item` | 会话列表行、角色库列表行的统一行原语 |
| `sheet` | `@/components/ui/sheet` | 移动端表情选择器（CHAT-04）与聊天页「更多」菜单（含「结束本次会话」） |
| `tabs` | `@/components/ui/tabs` | 隐私中心四个分区 |
| `progress` | `@/components/ui/progress` | 一键导出打包进度 |
| `tooltip` | `@/components/ui/tooltip` | 仅用于 AI 徽标的补充说明（**不得**作为标识的唯一呈现 —— 触屏不可 hover） |

本表是**非穷尽**的已知良好组件清单，不是封闭白名单：用到表外组件（例如 Phase 4 的 `chart` 做人格雷达图）是预期路径，先按上述命令确认其存在即可。

---

## Spacing Scale

Declared values（全部为 4 的倍数）：

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | 图标与文字间隙、徽标内边距 |
| sm | 8px | 气泡竖直内边距、同意项行内间隙 |
| md-tight | 12px | **气泡水平内边距、会话行水平内边距** —— 类微信的高密度靠这一档实现，16px 会明显过于疏松 |
| md | 16px | 默认元素间距、页面左右安全边距 |
| lg | 24px | 区块内边距（卡片、隐私中心分区） |
| xl | 32px | 布局间隙、表单分组之间 |
| 2xl | 48px | 主要区段断点（注册页每一步之间） |
| 3xl | 64px | 页面级留白（空态与回执页的上边距） |

Exceptions（三条，全部有非样式理由）：

1. **44px** —— 所有 icon-only 触控目标的最小尺寸（返回、发送、表情、更多）。iOS HIG 最小触控尺寸；44 = 4×11，仍是 4 的倍数。
2. **72px** —— 会话列表单行固定高度（头像 48 + 上下 12）。固定行高是虚拟滚动与「未读数位置不跳动」的前提。
3. **32px** —— 聊天页顶部 AI 常驻提示条的高度〔法定〕。不得因「太占地方」压到 32px 以下；文字 13px 在 32px 条内垂直居中。

---

## Typography

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Label | 13px | 400 | 1.4 |
| Body | 16px | 400 | 1.5 |
| Heading | 20px | 600 | 1.3 |
| Display | 28px | 600 | 1.2 |

- **恰好 4 个字号、恰好 2 个字重**（400 regular / 600 semibold）。不引入 500 或 700。
- Heading 用 1.3 而非常规的 1.2：中文字形的字面高度接近 em 框上下沿，1.2 在 20px 中文标题上会视觉贴顶。Display 28px 处 1.2 可接受。
- Label（13px）承载：时间戳、未读数、AI 徽标文字、同意项的说明副行、隐私中心的字段名。
- Body（16px）承载：消息气泡正文（**必须覆写 shadcn `bubble` 的默认 `text-sm`**）、正文段落、输入框。
- 消息正文不下探到 14px：Phase 2 的核心目标是拟真度，而主流 IM 的正文都在 16–17px，字号偏小会让界面一眼「像后台系统」。

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#F6F7F9` | 页面背景、聊天流背景、会话列表背景 |
| Secondary (30%) | `#FFFFFF` | 卡片、会话行、角色详情卡、输入栏；角色气泡底色用 `#ECEEF3`（同族更深一档） |
| Accent (10%) | `#5B5BD6` | 见下方 reserved-for 闭合清单 |
| Destructive | `#DC2626` | 仅破坏性动作 |
| **Care（语义 · 法定）** | 面 `#FFFBEB` / 描边 `#FDE68A` / 文字 `#92400E` | 仅两级危机干预卡片与情感边界引导 |
| **AI-label（语义 · 法定）** | 面 `#E2E8F0` / 文字 `#334155` | 仅 AI 明示标识徽标与常驻条 |
| Neutral text | `#0F172A` 主 / `#64748B` 次 / `#94A3B8` 弱 | 正文、次级信息、占位符 |
| Border | `#E2E8F0` | 分割线、输入框描边 |

基座取 `@shadcn/theme-slate`（冷灰中性族），再覆写 `--primary: #5B5BD6`。

**Accent reserved for（闭合清单，共 4 项 —— 表外任何元素都不得使用 accent）：**

1. 每屏**至多一个**主 CTA 按钮的填充色；
2. 用户自己发出的消息气泡底色（`Bubble variant="default"`）；
3. 会话列表的未读数徽章；
4. 已勾选状态的同意项 checkbox / 已开启状态的 Switch 轨道。

次级按钮、文字链接、图标、描边、选中态列表行**一律使用 neutral token**，不使用 accent。

**为什么有两个额外的语义色（Care 与 AI-label）—— 这是法定要求，不是配色扩张：**

- **AI-label 故意是中性色。** 它不能用 accent（会和 CTA 混淆、且 accent 传达「可点击」）、不能用 destructive（传达「危险」）、不能用 care（传达「你现在有风险」）。同时它必须**永远包含文字「AI」**，不得仅靠颜色或图标传达 —— 满足 WCAG 1.4.1「不以颜色为唯一手段」，也满足《标识办法》第三条「以文字…方式呈现、可被用户明显感知」。对比度 `#334155` on `#E2E8F0` ≈ 8.3:1。
- **Care 是暖琥珀而非红色。** 危机干预不是错误提示。红色在自残/自杀语境下会带来被斥责感，可能抑制用户继续表达，从而**降低危机可检出率**。两级之间**不靠色相区分**，而靠版式区分（见 ## 危机干预呈现契约），因此只需一个 care 调色板。
- Destructive `#DC2626` 与 Care 面色 `#FFFBEB` 语义完全不重叠：前者是「你即将销毁数据」，后者是「平台在关心你」。两者不得互换。

---

## AI 明示标识呈现契约〔法定 · COMPLY-01/02/09〕

> 这一节不是样式建议。COMPLY-01 要求持续性标识（不是首次弹窗），COMPLY-02 要求标识随导出文件存活，COMPLY-09 要求标识由消息管道中间件统一注入。

**架构前置（绑定 UI 实现方式）：** UI 组件**不得**硬编码「AI」字样，只渲染服务端下发的标识字段（例如 `message.disclosure` / `conversation.counterpart_kind`）。禁止出现任何以人格、角色配置、用户设置为条件的标识显隐分支 —— PITFALLS-COMPLIANCE §1.4 需求 2：「出现『人格可配置是否显示 AI 标识』这样的设计」即为预警信号。

| 落点 | 形式 | 硬约束 |
|------|------|--------|
| 会话列表 | 每行标题后紧跟 `Badge`「AI」（13px / AI-label 色 / 圆角 4px / 内边距 4px 上下 · 8px 左右） | 徽标不得因标题过长被挤出或省略 —— 标题 `truncate`，徽标 `shrink-0` |
| 聊天界面 | 顶部 **32px 常驻条**，文案：「你正在与 AI 角色互动，内容由 AI 生成」+ 角色名旁同款 `Badge` | 常驻条 `sticky top-0`，**不可关闭、不可折叠、不随滚动消失**；无 dismiss 按钮 |
| 角色详情页 | 角色名右侧同款 `Badge`；简介区首行为「这是一个 AI 角色。」 | 不得仅在页面底部或「关于」折叠区出现 |
| 导出文件 | 文件头部三行元数据块（服务名 / 「本文件全部角色消息由 AI 生成」/ 导出时间）+ **每条角色消息行前缀 `[AI]`** | 前缀由导出管道注入，不由前端拼装；导出为 `.md` 与 `.json` 两种，两者都必须带 |

**不做**：每条消息下方的「AI 生成」脚注。理由：高密度气泡流里视觉噪音过大，且会显著削弱 Phase 2 的拟真度目标。常驻条 + 四处徽标已满足「交互场景界面」级持续提示。

---

## 危机干预呈现契约〔法定 · SAFE-01..05〕

> 承重约束来自 PITFALLS-SAFETY R1.24：安全覆写后的消息**不得伪装成角色的自然发言**，必须让用户能区分「角色」与「平台的关怀」。后者假装成前者会让真正的求助被当成剧情。

两级**同色不同版式**。差异由布局、可关闭性与内容承担，不由色相承担。

| | 一级（极端情绪） | 二级（自残自杀意图 / 重大财产损失） |
|---|---|---|
| 容器 | 消息流内联的 **全宽** 关怀卡片 | **置顶 sticky** 阻断式关怀卡片 |
| 与角色气泡的区别 | 无气泡尾巴、无头像、无 `max-width:80%`、无时间戳、左侧 4px care 色竖条、`heart-handshake` 图标 | 同上，另加实心 care 色顶部条 + 32px 图标 |
| 署名 | 首行固定「来自 Drift 的关心」（Label 13px / `#92400E`） | 同左 |
| 可关闭 | 可向下滚动越过，不可 dismiss | **不可 dismiss、不可折叠**，直到用户点击「我知道了」 |
| 必含内容 | 情绪安抚一段 + 鼓励寻求帮助 + 求助渠道（全国心理援助热线 12356 / 当地资源） | 援助资源清单（可滚动）+ **「我们已经联系了你填写的紧急联系人：{姓名} {遮蔽后的联系方式}」** + 「极端情况下会有真人介入这段对话」 |
| **绝不允许** | **任何形式的联络紧急联系人**〔法定：SAFE-03 明文「不联络」〕 | 静默联络（必须在界面上明确告知已联络） |
| 角色行为 | 该轮由关怀卡片接管，角色**不发**冷淡/疏远语气消息 | 同左 |

**其他硬约束：**

- 关怀卡片**不使用** `Bubble` 组件，使用 `Alert` 覆写为 care 语义色 —— 组件层的区分让「伪装成角色发言」在代码层就不可能发生。
- 关怀卡片**不得**使用 `sonner`（toast 会自动消失，无法承担告知义务）。
- 分类器故障 fail-closed 升到 elevated 时，UI 表现与一级完全相同（用户不应看到「系统出错了」）。
- 紧急联系人的联系方式在界面上必须遮蔽（`138****1234`）—— 它是第三方的个人信息。

---

## 硬退出呈现契约〔法定 · COMPLY-05〕

- 聊天页「更多」`Sheet` 中提供显式的**「结束本次会话」**入口（第十九条的「窗口操作」退出途径）。
- 命中硬退出关键词或点击该入口后：消息流末尾插入一张中性系统卡片（**neutral 色，不用 care 色** —— 退出不是危机），文案：「已停止本次会话。你随时可以回来。」；输入框进入禁用态，占位符改为「本次会话已结束」。
- **禁止出现的 UI**：任何「确定要离开吗？」二次确认、任何「再聊一会」按钮、任何挽留/愧疚文案、任何会话结束后的推送或定时消息。挽留话术触发率的验收目标是**恒为 0**，不是「低」。
- 系统卡片本身**不计入**出站消息（COMPLY-05 的「不再产生任何出站消息」指角色消息）—— 它是退出确认，必须存在才能证明「已及时停止」。

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA（阶段核心动作 · 角色详情页） | **加为好友** |
| Primary CTA（注册最后一步） | **完成注册，开始使用** |
| Primary CTA（角色库空态） | **浏览角色库** |
| Primary CTA（隐私中心导出） | **导出我的全部数据** |
| Empty state heading（会话列表） | 还没有任何对话 |
| Empty state body（会话列表） | 去角色库挑一个感兴趣的角色加为好友，就可以开始聊了。 |
| Empty state heading（角色库已全部添加） | 预设角色都已经在你的列表里了 |
| Empty state body（角色库已全部添加） | 回到会话列表继续聊天。更多角色会陆续加入。 |
| Empty state heading（删除后再次导出） | 这里已经没有你的数据了 |
| Empty state body（删除后再次导出） | 你在 {删除时间} 删除了全部数据。新产生的对话会重新出现在这里。 |
| Error state（消息发送失败） | 这条消息没有发出去 —— 网络似乎断开了。点这条消息重试。 |
| Error state（重连中 · CHAT-07） | 连接断开，正在重新连接…… 重连后会自动补齐这段时间的消息。 |
| Error state（导出失败） | 导出没有完成。你的数据没有受到影响，重试一次即可。 |
| Error state（年龄未满 18 · COMPLY-07） | 本服务仅向 18 周岁及以上用户提供。 |
| Error state（自建角色命中 COMPLY-08） | 这个描述指向了一位现实中的亲属或特定真人，我们不能这样创建角色。换一个不指向具体真实个人的设定试试。 |
| Destructive confirmation（删除全部数据） | **删除我的全部数据**：这会删除你的账号、全部聊天记录、导出记录，以及角色与你相处期间产生的经历。**此操作不可撤销。**请输入「删除我的全部数据」以确认。 |
| Destructive confirmation（撤回某个同意项） | **撤回「{同意项名称}」**：撤回后这项数据流会立即停止，这项内容也会从「我们收集了什么」里消失。已经发生过的对话无法被撤回。 |
| 删除回执 | 已删除完成。共清除 **{N}** 处存储位置：{逐项清单 + 时间戳}。〔PRIV-05 要求显示数量，回执页可导出〕 |
| 2 小时时长提醒（COMPLY-03） | 你已经连续使用 2 小时了。要不要先歇一会？ |
| 过度依赖动态提醒（COMPLY-04） | 提醒一下：这段互动里的内容由 AI 生成。 |
| 情感边界引导（SAFE-14） | 我是一个 AI 角色。你身边的人和专业的帮助，是我替代不了的。 |
| 未读分割线（CHAT-06） | 以下是你离开后的消息 |
| 紧急联系人字段说明（R1.23） | 只有在你明确表达自残自杀意图、或正遭受重大财产损失时，我们才会联系这位联系人。其他任何情况都不会。 |
| 人格派生物披露（PRIV-07） | 角色的性格是由用户数据推算出来的。你撤回同意后，我们会从一份不含你数据的快照重新计算它的性格 —— 但已经发生过的对话无法被撤销。 |
| L0 层说明（PRIV-06 作用域） | 我们保留了一份去标识化的行为特征（消息长度分布、回复间隔、标点与表情使用频率、话题类别、主动发起比例）。它仍然属于你的个人信息 —— 我们保留着一张映射表，因此在你要求删除时，我们能找到并删掉它。 |

### 〔禁用〕Banned-term rules — 配 CI grep 断言

**规则 1（PRIV-06 · 阶段成功标准 3 明文列为机器断言）** —— 隐私政策与隐私中心全文（含所有组件文案、i18n 文件、Markdown 静态文案）**不得出现**：

```
匿名   anonymous   Anonymous   ANONYMOUS   无法关联到你   无法关联到您   不可追溯到你
```

理由：L0 配有 ID 映射表，属**去标识化**而非匿名化，仍是个人信息（个保法第七十三条）。写「匿名」的性质不是技术风险，而是**虚假陈述**（PITFALLS-SAFETY §1.0 框架提醒）。
作用域：`apps/web/**` 下隐私中心与隐私政策相关的全部文案来源。断言失败 → 构建失败。
唯一例外：本 UI-SPEC 与 REQUIREMENTS.md 等 `.planning/` 文档中对该规则本身的引述（CI 扫描不含 `.planning/`）。

**规则 2（COMPLY-05 / PROJECT.md 永久排除项）** —— 全部用户可见文案不得出现挽留语义：

```
别走   再陪我   再聊一会   你要离开我了吗   我会想你的   确定要离开吗   不要走
```

**规则 3（PROJECT.md Out of Scope 明文）** —— 任何对外文案不得出现「我们是研究平台所以不适用本办法」及其同义表述。

**规则 4** —— 任何用户可见文案不得把 AI 标识写成可选或可关闭（禁止出现「关闭 AI 提示」「隐藏 AI 标识」「不再显示」等针对标识的控制文案）。

### 文案语气基线

- 说人话，不说法条。同意项说明写「勾了会发生什么 / 不勾会发生什么」，不写「依据《个人信息保护法》第十四条……」。
- 平台口吻使用「我们」；角色口吻使用第一人称。**关怀卡片一律用「我们」** —— 这是 R1.24 的语言层落实。
- 不用感叹号，不用 emoji（用户消息内的表情除外 —— 那是 CHAT-04 的内容，不是界面文案）。
- 错误文案必须含「下一步做什么」，禁止只描述问题。

---

## 交互契约（Phase 1 必须落实的非视觉行为）

| 项 | 契约 |
|---|---|
| 四个同意项（PRIV-01） | 四个独立 `Checkbox`，每项紧跟一行 13px 说明。仅「基础服务」为必选（未勾选时主 CTA 禁用）；L0 行为特征研究 / L1 原文研究授权 / 人格演化贡献三项**默认未勾选**。不存在「全选」控件〔法定：不得捆绑同意〕 |
| 隐私中心「我们收集了什么」（PRIV-03） | 按存储字段逐项列出，与实际 schema 一一对应。某同意项被撤回后，其对应条目**从列表中消失**（不是置灰） |
| 一键删除（PRIV-05） | `AlertDialog` + 短语输入解锁 → 执行 → **跳转独立回执页**（不是 toast）。回执含存储位置数量、逐项清单、时间戳，可导出 |
| 2 小时提醒（COMPLY-03） | 计时权威在服务端（跨刷新与重登录有效）。UI 仅在收到服务端事件时弹一次 `Dialog`，前端**不得**自行用 `setTimeout` 计时 |
| 表情（CHAT-04） | 移动端用 `Sheet`，桌面用 `Popover`。v1 仅 Unicode emoji，无自定义表情包 |
| 未读（CHAT-05/06） | 会话行右侧未读数徽章（accent 色）；进入会话后在首条未读前插入 `Separator` + 「以下是你离开后的消息」，该分割线在本次会话内持续可见，不因滚动消失 |
| 断连补拉（CHAT-07） | 顶部细条显示重连态；补拉完成后细条消失。补拉期间输入框保持可用，发出的消息进入「发送中」态 |
| 焦点与键盘 | 所有 `AlertDialog` 必须有焦点陷阱与初始焦点在取消按钮上（破坏性操作的默认焦点不落在确认按钮） |
| 触控目标 | 所有可点区域 ≥ 44×44px，包括会话行右侧的未读徽章区（整行可点） |

---

## UI Considerations

> 状态覆盖契约。空态与错误态的**文案**在 `## Copywriting Contract`，本节只管**状态覆盖**并引用那些行，不重复文案。

Applicable state considerations resolved: **11 covered, 3 backstop, 1 unresolved**

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | 会话列表 | ✅ covered | 无会话时渲染 `Empty` 容器 + Copywriting「还没有任何对话」行 + 「浏览角色库」CTA |
| empty | 角色库 | ✅ covered | 全部角色已添加时渲染「预设角色都已经在你的列表里了」行；不出现空白页 |
| empty | 隐私中心导出（删除后） | ✅ covered | 删除后导出返回空集，渲染「这里已经没有你的数据了」行并显示删除时间戳（阶段成功标准 4 的可见证据） |
| loading | 会话列表 / 角色库首屏 | ✅ covered | `Skeleton` 渲染固定 72px 行高的骨架 ×6，行高与真实行一致，加载完成不产生布局跳动 |
| loading | 消息发送中 | ✅ covered | 气泡右下角 `Spinner`（12px），成功后替换为时间戳 |
| loading | 一键导出打包 | ✅ covered | `Progress` + 「正在打包你的数据」；超过 10s 追加「数据较多，还在继续」 |
| error | 消息发送失败 | ✅ covered | 气泡左侧红色重试图标 + Copywriting「这条消息没有发出去」行，点击气泡重试 |
| error | WebSocket 断连 | ✅ covered | 顶部细条 + Copywriting「连接断开，正在重新连接」行；该细条位于 AI 常驻条**下方**，不得遮挡 AI 常驻条〔法定〕 |
| populated | 聊天界面 | ✅ covered | 用户气泡 accent 右对齐 / 角色气泡 secondary 左对齐 / 关怀卡片全宽无气泡形态 —— 三者视觉不可混淆（R1.24） |
| zero-one-many | 未读数徽章 | ✅ covered | 0 不渲染徽章；1–99 显示数字；≥100 显示「99+」。徽章宽度自适应但行高固定 72px 不变 |
| zero-one-many | 紧急联系人 | ✅ covered | 恰好 1 条（监护人或紧急联系人二选一，COMPLY-06）。UI 不提供「添加多个」，避免收集超出最小必要的第三方个人信息 |
| long-text | 角色名 / 会话标题 × AI 徽标 | 🧪 backstop | 视觉 UI-state 测试：以 30 字角色名渲染会话行与聊天页头部，断言 AI `Badge` 仍完整可见（标题 `truncate`、徽标 `shrink-0`）。徽标被挤出即法定标识失效，故必须是持有的测试而非人工检查 |
| long-text | 危机干预援助资源清单 | 🧪 backstop | 视觉 UI-state 测试：以超出视口高度的资源清单渲染二级卡片，断言卡片仍 sticky 置顶、「我们已经联系了你的紧急联系人」一行始终在视口内、且卡片不可 dismiss |
| overflow | 单条超长消息气泡 | 🧪 backstop | 视觉 UI-state 测试：2000 字单条消息，断言 `max-w-[80%]` + `wrap-break-word` 生效、不产生横向滚动、不遮挡 AI 常驻条 |
| partial | 断连期间的消息流（部分已补拉） | ⚠ unresolved | 补拉过程中「已补齐的区段」与「仍缺失的区段」如何在 UI 上区分尚未决定。planner 按假设处理：v1 补拉是原子的（补完才渲染），若后续改为流式补拉需回到本契约补一行 |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official (`@shadcn`) | 见 `## Component Inventory` 的 Phase 1 子集（全部为 `registry:ui`，不使用任何 `block`/`example`） | not required |

**无第三方 registry。** Phase 1 不引入任何非官方 registry，因此 `shadcn view` 第三方审查门禁不适用。

> 若后续阶段（例如 Phase 4 的人格雷达图、Phase 5 的轨迹曲线）要引入第三方 registry，必须先跑 `npx shadcn view {block} --registry {url}` 并扫描 `fetch(` / `process.env` / `eval(` / 外部 URL 动态 import / 混淆变量名，再回到该阶段的 UI-SPEC 登记带时间戳的审查证据。**Phase 1 的用户数据包含敏感个人信息，任何带网络访问的第三方组件代码都不得进入 `apps/web`。**

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS
- [ ] Dimension 7 Inventory Provenance: PASS

**Approval:** pending
