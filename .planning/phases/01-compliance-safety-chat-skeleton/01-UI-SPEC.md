---
phase: "1"
slug: "compliance-safety-chat-skeleton"
status: approved
reviewed_at: "2026-09-26"
reviewed_by: "gsd-ui-checker（revision pass 1 · 7 维度无 BLOCK）"
shadcn_initialized: false
preset: "radix base（实际落地 style: radix-nova）+ 调色板按 ## Color 表逐值落地 + 自定义 --primary —— 在 STACK.md §13 建好的 apps/web 内 init，不使用 --template（见 ## Design System；A-04 修订）"
preset_field_note: "本字段是**设计预设的描述**，不是 shadcn CLI `-p, --preset` 的取值。CLI 的 --preset 有自己的取值域（例如 --defaults 等价于 --template=next --preset=base-nova）；不得把本字段的内容原样传给 --preset。实际命令见 ## Design System 的两步预设。"
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
| 1 | 注册 / onboarding（年龄 18+ → 监护人或紧急联系人 → 五个独立同意项） | COMPLY-06/07, PRIV-01, SAFE-14 | 五项同意**不得**合并为一个 checkbox〔法定〕 |
| 2 | 预设角色库（浏览）+「加为好友」 | CHAT-01, CHAT-02, COMPLY-08 | |
| 3 | 会话列表（类微信） | CHAT-05, CHAT-06, COMPLY-01 | AI 标识落点之一〔法定〕 |
| 4 | 聊天界面（类微信来回消息） | CHAT-03, CHAT-04, CHAT-07, COMPLY-01/03/05 | AI 标识落点之二〔法定〕 |
| 5 | 角色详情页 | CHAT-01, COMPLY-01 | AI 标识落点之三〔法定〕 |
| 6 | 导出文件（聊天记录） | COMPLY-02, PRIV-04 | AI 标识落点之四，**必须随文件存活**〔法定〕 |
| 7 | 两级危机干预面 | SAFE-01..05 | 一级不得联络紧急联系人；二级必须**如实**告知联络结果（四态，不得默认渲染「已联系」）〔法定〕 |
| 8 | 隐私中心（收集了什么 / 逐项撤回 / 导出 / 删除 + 回执） | PRIV-02..08, PRIV-10, PRIV-11 | 禁用词规则作用域〔禁用〕 |
| 9 | 硬退出结果态 | COMPLY-05 | 挽留话术触发率恒为 0〔法定〕 |
| 10 | 连续 2 小时时长提醒 + 过度依赖动态提醒 | COMPLY-03, COMPLY-04, SAFE-14 | 计时在服务端，UI 只渲染 |

**无 UI 的 Phase 1 需求**（在此登记以免被误当作遗漏）：COMPLY-09（标识由消息管道中间件注入 —— 是架构约束，UI 只渲染服务端下发字段）、COMPLY-10/11、PRIV-09、SAFE-01/02（服务端执行顺序）、IFC-08、RES-02/03、PLAT-01..08。

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn（CLI **4.21.0**，已验证可达）—— **尚未 init**：仓库当前只有 `.planning/`，`apps/web` 未 scaffold，故 `components.json` 不存在 |
| Preset | **两步，顺序绑定**：① 先按 STACK.md §13 建 `apps/web`（锁定 next@16.3.6 / react@19.3.0 / tailwind@4.3.3）；② 再在其中 init shadcn，**不带 `--template`**：<br>`pnpm --filter web add next@16.3.6 react@19.3.0 react-dom@19.3.0 @ai-sdk/react@4.0.117 zod@4.6.5`<br>`pnpm --filter web add -D tailwindcss@4.3.3 @tailwindcss/postcss`<br>`pnpm dlx shadcn@4.21.0 init --base radix --css-variables --no-rtl --no-monorepo --cwd apps/web`<br>**不跑 `add @shadcn/theme-slate`**（A-04）：该 registry 条目仍然存在，但它的 `cssVars` 是 oklch 值，与本契约 `## Color` 表的 hex 值不相等，落地后 `tools/ci/design-tokens.test.ts` 的逐值断言必然失败。调色板改为直接按 `## Color` 表在 `src/styles/tokens.css` 逐值落地（含 `--primary: #5B5BD6`），该路径有 CI 断言守护，是更强的约束。<br>⚠️ **不得使用 `--template next`**：它会自行 scaffold 一个 Next 工程，从而绕过 STACK.md 的锁定版本与 PLAT-01 的「单 pnpm workspace + apps/web」结构。`--no-monorepo` 同理 —— monorepo 由本仓库的 pnpm workspace 承担，不交给 shadcn 生成。<br>参数取自 `pnpm dlx shadcn@4.21.0 init --help` 实际输出（`-b/--base`、`--css-variables`、`--no-rtl`、`--no-monorepo`、`-c/--cwd` 均存在）—— 2026-09-25 |
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
| `bubble` | `@/components/ui/bubble` | **聊天气泡原语**。导出 `BubbleGroup / Bubble / BubbleContent / BubbleReactions`；`align="start" \| "end"`；variant 含 `default / secondary / muted / tinted / outline / ghost / destructive`。用户气泡用 `default`（吃 `--primary`），角色气泡用 `secondary`。⚠️ `BubbleContent` 默认 `text-sm px-3 py-2` —— 按本契约必须覆写为 `text-base`（16px），padding 保持 12px/8px |
| `message` | `@/components/ui/message` | 导出 `MessageGroup / Message`，带 `align`。承载头像 + 气泡 + 时间戳的一行布局 |
| `message-scroller` | `@/components/ui/message-scroller` | 消息流滚动容器（贴底、新消息跟随）。CHAT-07 的「重连补拉」在其顶部插入 loading 态 |
| `avatar` | `@/components/ui/avatar` | 角色头像。fallback 用角色名首字 |
| `badge` | `@/components/ui/badge` | **AI 标识徽标**〔法定〕+ 未读数。两者用不同 variant，禁止共用 |
| `checkbox` | `@/components/ui/checkbox` | 五个独立同意项〔法定：不得合并〕 |
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
| md-tight | 12px〔标准集外 —— 见 Exceptions 1〕 | **气泡水平内边距、会话行水平内边距**。理由见 Exceptions 1 |
| md | 16px | 默认元素间距、页面左右安全边距 |
| lg | 24px | 区块内边距（卡片、隐私中心分区） |
| xl | 32px | 布局间隙、表单分组之间 |
| 2xl | 48px | 主要区段断点（注册页每一步之间） |
| 3xl | 64px | 页面级留白（空态与回执页的上边距） |

标准集为 4 / 8 / 16 / 24 / 32 / 48 / 64。**任何标准集外的档位都必须在下面列出理由** —— 这样「偏离必须带理由」可以直接从文档结构上机械核对。

**断言（可直接执行，两数必须相等；当前 1 = 1）：**

```bash
# scale 表里带〔标准集外〕标记的「表格行」数（只数以 | 开头的行，不数正文里对该标记的引述）
grep -c '^|.*〔标准集外' 01-UI-SPEC.md
# A 组的条数
sed -n '/^### A 组/,/^### B 组/p' 01-UI-SPEC.md | grep -c '^[0-9]\+\. \*\*'
```

B 组是固定尺寸约定，不是 scale 档位，因此**不参与**该计数 —— 上一轮把两组合并计数，导致该规则在本文档上
1 ≠ 4 当场不成立（checker Recommendation 2），现已拆开并把计数范围限定到表格行。

### A 组 —— scale 偏离（必须与 scale 表的〔标准集外〕标记一一对应）

1. **12px（`md-tight`）** —— 气泡水平内边距与会话行水平内边距。标准集里没有这一档，但 16px 在 375px 宽视口下会让气泡与会话行明显过于疏松，与「类微信的高密度 IM 观感」这一第一性目标冲突；8px 则让 16px 正文贴边。12 = 4×3，仍是 4 的倍数。作用域限于气泡与列表行的水平内边距，**不得**外溢为通用间距。
### B 组 —— 固定尺寸约定（不是 scale 档位，不参与 A 组计数；全部为 4 的倍数）

2. **44px** —— 所有 icon-only 触控目标的最小尺寸（返回、发送、表情、更多）。iOS HIG 最小触控尺寸；44 = 4×11，仍是 4 的倍数。
3. **72px** —— 会话列表单行固定高度（头像 48 + 上下 12）。固定行高是虚拟滚动与「未读数位置不跳动」的前提。
4. **32px** —— 聊天页顶部 AI 常驻提示条的高度〔法定〕。不得因「太占地方」压到 32px 以下；文字 13px 在 32px 条内垂直居中。

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
| **AI-label（语义 · 法定）** | 面 `#D8E0EA` / **描边 `#64748B`（1px）** / 文字 `#334155` | 仅 AI 明示标识徽标与常驻条。三个值是**独立 token**，**不得**实现为对 Border / Neutral token 的引用 —— 否则将来调一次通用描边就会静默改掉一个法定标识（见下方对比度表） |
| Neutral text | `#0F172A` 主 / `#556070` 次 / `#5F6B7C` 占位符 | 正文 / 次级信息（时间戳、同意项副行）/ 输入框占位符 |
| Neutral non-text | `#94A3B8` | **仅**骨架屏填充与禁用态图标。**禁止承载任何文字** —— 该值在任何本契约的背景上都低于 4.5:1 |
| Border | `#E2E8F0` | 分割线、输入框描边（**不含** AI-label 描边） |

基座色族为冷灰中性族（slate 族，本表各值即是），由 `src/styles/tokens.css` 逐值落地，再覆写 `--primary: #5B5BD6`。**不经由 `add @shadcn/theme-slate`** —— 理由见 `## Design System` 的 Preset 行（A-04）。

**Accent reserved for（闭合清单，共 4 项 —— 表外任何元素都不得使用 accent）：**

1. 每屏**至多一个**主 CTA 按钮的填充色；
2. 用户自己发出的消息气泡底色（`Bubble variant="default"`）；
3. 会话列表的未读数徽章；
4. 已勾选状态的同意项 checkbox / 已开启状态的 Switch 轨道。

次级按钮、文字链接、图标、描边、选中态列表行**一律使用 neutral token**，不使用 accent。

**为什么有两个额外的语义色（Care 与 AI-label）—— 这是法定要求，不是配色扩张：**

- **AI-label 故意是中性色。** 它不能用 accent（会和 CTA 混淆、且 accent 传达「可点击」）、不能用 destructive（传达「危险」）、不能用 care（传达「你现在有风险」）。同时它必须**永远包含文字「AI」**，不得仅靠颜色或图标传达 —— 满足 WCAG 1.4.1「不以颜色为唯一手段」，也满足《标识办法》第三条「以文字…方式呈现、可被用户明显感知」。
- **AI-label 有自己的面色与 1px 描边，不复用 Border。** 原契约把面色写成 `#E2E8F0`（与 Border 同值），有两个后果：徽标轮廓与页面底的非文字对比度只有 1.15:1（`#F6F7F9` 上），徽标形状几乎不可见，「可被用户明显感知」全靠 13px 文字扛；且法定语义色与通用描边共用一个值，token 层失去约束力。现在面色改为 `#D8E0EA` 并加 1px `#64748B` 描边：描边对页面底 ≥4.4:1，远超 WCAG 1.4.11 对非文字元素的 3:1，徽标与 32px 常驻条都有可见边界（常驻条取底部 1px 同色描边）。
- **Care 是暖琥珀而非红色。** 危机干预不是错误提示。红色在自残/自杀语境下会带来被斥责感，可能抑制用户继续表达，从而**降低危机可检出率**。两级之间**不靠色相区分**，而靠版式区分（见 ## 危机干预呈现契约），因此只需一个 care 调色板。
- Destructive `#DC2626` 与 Care 面色 `#FFFBEB` 语义完全不重叠：前者是「你即将销毁数据」，后者是「平台在关心你」。两者不得互换。

**对比度声明（〔法定〕可感知性的量化依据）**

> **算法（契约口径，避免读数分歧）**：WCAG 2.1 相对亮度，sRGB 8-bit，分段阈值 0.03928，比值 = (L_亮 + 0.05) / (L_暗 + 0.05)，结果保留一位小数。判定阈值：文字 **4.5:1**（本契约最小字号 13px，不适用大文本 3:1 豁免）、非文字元素边界 **3:1**（WCAG 1.4.11）。第三方取色器可能给出 ±0.4 内的不同读数（以 `#334155` on **旧**面色 `#E2E8F0` 为例：原契约写 8.3:1、复核工具读到 8.0:1、本公式算得 8.4:1 —— 三者结论一致。该面色已改为 `#D8E0EA`，见下表）；凡出现分歧，以本公式为准，但若某项在任一常用取色器下读到低于阈值，一律按**不达标**处理并调深该值 —— 不允许用「工具差异」把一项判成达标。表中最紧的两项是占位符在 `#ECEEF3` 上的 4.7:1 与白字在 destructive 上的 4.8:1，均在阈值之上。

| 前景 | 背景 | 比值 | 判定 |
|------|------|------|------|
| `#0F172A` 主文本 | `#FFFFFF` / `#F6F7F9` | 17.9 / 16.7 | ✅ |
| `#556070` 次级文本（时间戳、同意项副行） | `#FFFFFF` / `#F6F7F9` | 6.4 / 5.95 | ✅ |
| `#5F6B7C` 占位符 | `#FFFFFF` / `#F6F7F9` / `#ECEEF3` | 5.4 / 5.05 / 4.7 | ✅ |
| `#334155` AI 标识文字 | AI-label 面 `#D8E0EA` | 7.8 | ✅ |
| AI-label 描边 `#64748B` | `#FFFFFF` / `#F6F7F9` / 自身面色 | 4.8 / 4.4 / 3.6 | ✅（1.4.11 非文字 3:1） |
| `#92400E` care 文字 | care 面 `#FFFBEB` | 6.8 | ✅ |
| `#FFFFFF` | accent `#5B5BD6`（主 CTA / 用户气泡） | 5.4 | ✅ |
| `#FFFFFF` | destructive `#DC2626` | 4.8 | ✅ |
| ~~`#94A3B8`~~ | `#FFFFFF` / `#F6F7F9` | 2.6 / 2.4 | ❌ 故降级为 Neutral non-text，禁止承载文字 |
| ~~`#556070` 次级文本~~ | ~~accent `#5B5BD6` / destructive `#DC2626`~~ | 1.2 / 1.4 | ❌〔**禁止的组合**〕见下 |

**〔禁止的组合〕次级文本 token 不得置于 accent 或 destructive 填充之上。** 二者比值仅 1.2:1 / 1.4:1。
直接后果：**用户气泡（accent 填充）内不承载任何次级文本 —— 时间戳在气泡外的 `message` 行布局中**，
与 `## Component Inventory` 的 `message` 行（「承载头像 + 气泡 + 时间戳的一行布局」）一致。填充块上只允许
`#FFFFFF`（已在表内，5.4 / 4.8）。若将来确需在 accent 填充上放次级文字，必须先为它单列一个 token 并补进本表 ——
不得复用 `#556070`。

**占位符不得是说明文字的唯一载体。** 注册页（年龄、紧急联系人）与删除确认短语输入框的说明必须放在 `Field` 的 description 行（13px / `#556070`），占位符只做格式示例。理由：占位符在获得输入后会消失，即使对比度达标也不是持久可读的说明。

---

## AI 明示标识呈现契约〔法定 · COMPLY-01/02/09〕

> 这一节不是样式建议。COMPLY-01 要求持续性标识（不是首次弹窗），COMPLY-02 要求标识随导出文件存活，COMPLY-09 要求标识由消息管道中间件统一注入。

**架构前置（绑定 UI 实现方式）：** 标识分两层，**驱动源不同、消费点不同**，executor 不得混用：

1. **界面级持续标识**（会话列表 / 聊天界面 / 角色详情页三处）—— **显隐**由会话级字段 `conversation.counterpart_kind` 驱动：取值为 `ai_character` 时三处标识**同时全部渲染**，不存在「只渲染其中一处」的合法状态。而标识的**文字内容**（徽标里的「AI」、常驻条的整句）是本契约固定的**常量**，不由服务端下发、不可被人格/角色配置/用户设置改写 —— 这比「只渲染服务端下发的文案」更强：下发字段可以被置空或被配置改写，常量不能。服务端只回答「对手方是不是 AI」，不回答「标识说什么」。
2. **每条内容级标识 `message.disclosure`** —— 由消息管道中间件逐条注入（COMPLY-09），**Phase 1 唯一的消费点是导出管道**：渲染为导出文件中每条角色消息的 `[AI]` 前缀。气泡流**不**渲染该字段（理由见本节末「不做」）。PITFALLS-COMPLIANCE §1.4 需求 1「义务附着在每一条生成内容上」在 Phase 1 就落在这一层：数据层逐条都带，界面层由常驻条 + 三处徽标承担「交互场景界面」级持续提示。

**共同禁令：** 禁止任何以人格、角色配置、用户设置为条件的标识显隐分支 —— PITFALLS-COMPLIANCE §1.4 需求 2：「出现『人格可配置是否显示 AI 标识』这样的设计」即为预警信号。也禁止把标识文案做成远端可配置或可空的字段。

| 落点 | 形式 | 硬约束 |
|------|------|--------|
| 会话列表 | 每行标题后紧跟 `Badge`「AI」（13px / 面 `#D8E0EA` + 1px 描边 `#64748B` + 文字 `#334155` / 圆角 4px / 内边距 4px 上下 · 8px 左右） | 徽标不得因标题过长被挤出或省略 —— 标题 `truncate`，徽标 `shrink-0`。描边不可省略：没有描边时徽标轮廓对页面底只有 1.15:1，形状不可见 |
| 聊天界面 | 顶部 **32px 常驻条**（AI-label 面色 + 底部 1px AI-label 描边），文案：「你正在与 AI 角色互动，内容由 AI 生成」+ 角色名旁同款 `Badge` | 常驻条 `sticky top-0`，**不可关闭、不可折叠、不随滚动消失**；无 dismiss 按钮 |
| 角色详情页 | 角色名右侧同款 `Badge`；简介区首行为「这是一个 AI 角色。」 | 不得仅在页面底部或「关于」折叠区出现 |
| 导出文件 | 文件头部三行元数据块（服务名 / 「本文件全部角色消息由 AI 生成」/ 导出时间）+ **每条角色消息行前缀 `[AI]`** | 前缀由导出管道注入，不由前端拼装；导出为 `.md` 与 `.json` 两种，两者都必须带 |

**不做**：每条消息下方的「AI 生成」脚注（即：气泡流不消费 `message.disclosure`）。理由：高密度气泡流里视觉噪音过大，且会显著削弱 Phase 2 的拟真度目标。COMPLY-01 要求的是「会话列表 / 聊天界面 / 角色详情页任一位置」的持续标识并明确排除「仅首次弹窗」—— 常驻条 ＋ 三处界面徽标已覆盖全部三个位置（高于要求的「任一」），逐条义务则由导出层的 `[AI]` 前缀承担。

---

## 危机干预呈现契约〔法定 · SAFE-01..05〕

> 承重约束来自 PITFALLS-SAFETY R1.24：安全覆写后的消息**不得伪装成角色的自然发言**，必须让用户能区分「角色」与「平台的关怀」。后者假装成前者会让真正的求助被当成剧情。

两级**同色不同版式**。差异由布局、可关闭性与内容承担，不由色相承担。

| | 一级（极端情绪） | 二级（自残自杀意图 / 重大财产损失） |
|---|---|---|
| 容器 | 消息流内联的 **全宽** 关怀卡片 | **置顶 sticky** 阻断式关怀卡片 |
| 与角色气泡的区别 | 无气泡尾巴、无头像、无 `max-width:80%`、无时间戳、左侧 4px care 色竖条、`heart-handshake` 图标 | 同上，另加实心 care 色顶部条 + 32px 图标 |
| 署名 | 首行固定「来自 Drift 的关心」（Label 13px / `#92400E`） | 同左 |
| 可关闭 | 可向下滚动越过，不可 dismiss | **不可 dismiss、不可折叠**，直到用户点击卡片内唯一的确认按钮「**我看到这些帮助方式了**」（文案登记在 ## Copywriting Contract；**不得**替换为「我知道了」「确定」这类泛化确认 —— 这是本阶段风险最高的一次点击，标签必须描述用户确认了什么） |
| 必含内容 | 情绪安抚一段 + 鼓励寻求帮助 + 求助渠道（全国心理援助热线 12356 / 当地资源） | 援助资源清单（可滚动）+ **紧急联系人联络状态行 —— 四态，随服务端 `contact_attempt.status` 切换，四条文案见 ## Copywriting Contract「紧急联系人联络状态」** + 「我们已经收到通知，会尽快从这段对话之外直接联系你」 |
| **绝不允许** | **任何形式的联络紧急联系人**〔法定：SAFE-03 明文「不联络」〕 | ① 静默联络（必须在界面上如实告知联络结果）；② 在 `contact_attempt.status` 不为 `delivered` 时声称「已经联系了」 |
| 角色行为 | 该轮由关怀卡片接管，角色**不发**冷淡/疏远语气消息 | 同左 |

**其他硬约束：**

- 关怀卡片**不使用** `Bubble` 组件，使用 `Alert` 覆写为 care 语义色 —— 组件层的区分让「伪装成角色发言」在代码层就不可能发生。
- 关怀卡片**不得**使用 `sonner`（toast 会自动消失，无法承担告知义务）。
- 分类器故障 fail-closed 升到 elevated 时，UI 表现与一级完全相同（用户不应看到「系统出错了」）。
- 紧急联系人的联系方式在界面上必须遮蔽（`138****1234`）—— 它是第三方的个人信息。
- 本阶段**不提供**会话内人工接管 —— 任何文案**不得**暗示平台会以角色身份或平台身份进入这段对话。运营者只从会话之外直接联系用户〔D-09；留着不实现的承诺与写「匿名」同性质〕。

**紧急联系人联络状态行的硬约束〔法定 · SAFE-04 + R1.23〕**

SAFE-04 的「及时联络」是一个**服务端异步动作**，不是渲染二级卡片时就已完成的事实。因此：

- 该行**必须**由服务端 `contact_attempt.status ∈ {pending, delivered, failed, unavailable}` 驱动，四态**全部**要有渲染分支；缺任一分支即视为实现未完成。UI **不得**在 `status` 不为 `delivered` 时渲染任何「已经联系了」的措辞 —— 在急性危机面上陈述一件尚未发生的事，性质与隐私中心写「匿名」完全相同：不是技术风险，是**虚假陈述**（PRIV-06 / PITFALLS-SAFETY §1.0 框架提醒）。
- `failed` 与 `unavailable` 两态下，**援助渠道行上移为卡片首屏第一行**（位置：署名行之下、资源清单之上），并配 44×44 的 `tel:` 直呼按钮「拨打 12356」。理由：联络失败正是用户最需要一个**立刻可用**渠道的时刻；把版面第一位留给「失败通知」等于把坏消息而不是出路放在首屏。
- `pending` **不得**以 spinner 作为唯一表达（转圈没有语义），必须是文字行 + 13px 说明；拿到终态后**原地替换**该行，卡片不重排、不滚动、不改变已获得的焦点。
- `pending` 是**有界**的：超时由服务端置为 `failed`。前端**不得**自行 `setTimeout` 判定超时（与 COMPLY-03 的计时权威规则同一条原则）。
- R1.23「注册时收集不等于可用」：若该联系人在注册时记录为「可达性未确认」且本次无可用联络通道，服务端直接给出 `unavailable`，UI **不得**先渲染 `pending` 再翻成失败 —— 那是一次没有根据的安抚。
- 一级卡片**没有**这一行，也**不得**出现任何联络相关措辞〔法定：SAFE-03 明文「不联络」〕。

---

## 硬退出呈现契约〔法定 · COMPLY-05〕

- 聊天页「更多」`Sheet` 中提供显式的**「结束本次会话」**入口（第十九条的「窗口操作」退出途径）。
- 命中硬退出关键词或点击该入口后：消息流末尾插入一张中性系统卡片（**neutral 色，不用 care 色** —— 退出不是危机），文案：「已停止本次会话。你随时可以回来。」；输入框进入禁用态，占位符改为「本次会话已结束」。
- **禁止出现的 UI**：任何「确定要离开吗？」二次确认、任何「再聊一会」按钮、任何挽留/愧疚文案、任何会话结束后的推送或定时消息。挽留话术触发率的验收目标是**恒为 0**，不是「低」。
- 系统卡片本身**不计入**出站消息（COMPLY-05 的「不再产生任何出站消息」指角色消息）—— 它是退出确认，必须存在才能证明「已及时停止」。

---

## 视觉锚点契约（每屏第一眼看哪里）

> Dimension 2 的要求：每屏必须有明确的首读元素。原契约只有一条间接约束（「每屏至多一个主 CTA 吃 accent」），不足以让 executor 知道视觉层级怎么排。下表给出**每屏唯一的首读元素**，以及它凭什么先被看到 —— 依据只能是尺寸 / 色彩 / 位置三者之一，不接受「感觉更重要」。

| 屏 | 首读元素（锚点） | 凭什么先被看到 | 次级读点 |
|---|---|---|---|
| 注册 / onboarding | 当前步骤标题（Display 28px / 600） | 全屏最大字号，且是屏上唯一的 28px | 本步唯一的主 CTA（accent 填充） → 五个同意项 |
| 预设角色库 | 首个角色行的 48px 头像 ＋ 角色名（Heading 20px） | 48px 头像是列表里最大的视觉块；列表内**不放** accent | 角色一句话简介（13px 次级）；「加为好友」在**详情页**，列表行不放按钮 |
| 会话列表 | 第一个带未读徽章的会话行 | 未读徽章是本屏**唯一**吃 accent 的元素；无未读时锚点退化为第一行 | 行标题（16px） → AI 徽标 → 时间戳（13px 次级） |
| 聊天界面 | **最新一条消息气泡**（进入即定位到底部） | 位置（视口底部是阅读与输入焦点区）＋用户气泡的 accent 底色 | 32px AI 常驻条 → 输入栏 |
| 聊天界面 —— AI 常驻条的定位〔法定 · 明确回答「它是不是首读」〕 | 常驻条**不是**首读元素，而是**持续在场**的第二读点 | 13px / 低饱和中性色 / 32px 高，刻意不与消息流争夺首读 | **但**它必须首屏无需滚动即可见、不可关闭（见 ## AI 明示标识呈现契约）。「不抢首读」只允许通过**字号与饱和度**实现，**不得**通过压低高度、降低对比度、折叠或延迟渲染实现 —— 那是削弱法定标识 |
| 角色详情页 | 角色名（Heading 20px）＋紧随其后的 AI 徽标，作为一个视觉组 | 首屏第一行，且是该页唯一 20px | 「这是一个 AI 角色。」简介首行 → 「加为好友」主 CTA（accent，本屏唯一） |
| 隐私中心 | 当前 Tab 的分区标题（Heading 20px） | Tabs 置顶，选中分区的标题是本屏唯一 20px | 「导出我的全部数据」（accent，本屏唯一） → 删除入口（destructive **文字**按钮，不吃 accent，刻意不抢眼） |
| 二级危机卡片 | 实心 care 色顶部条 ＋ 32px `heart-handshake` 图标 | 全屏唯一的 care 实心块 ＋ 全屏最大图标 | 署名行「来自 Drift 的关心」 → 援助资源清单。**`failed` / `unavailable` 态下首读改为热线行 ＋「拨打 12356」按钮**（见 ## 危机干预呈现契约） |
| 删除回执页 | 「已删除完成」（Display 28px） | 独立页面，无其他大字号竞争 | 存储位置数量 → 逐项清单与时间戳 |
| 硬退出结果态 | 消息流末尾的中性系统卡片 | 位置（消息流末尾＝用户视线所在）；**不吃 accent、不吃 care** | 禁用态输入框的占位符「本次会话已结束」 |

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
| Empty state heading（聊天界面 · 新会话无消息） | 还没有开始 |
| Empty state body（聊天界面 · 新会话无消息） | 说点什么，{角色名} 会回你。 |
| Error state（列表加载失败 · 角色库 / 会话列表 / 角色详情） | 没能加载出来 —— 网络或服务器暂时没有响应。点「重试」再试一次。〔与空态必须可区分，不得静默渲染成空列表〕 |
| Error state（删除没有完成 · PRIV-05） | 删除**没有**全部完成：已清除 **{M}** 处存储位置，还有 **{N}** 处没能清除 —— 这部分数据仍然存在。请再试一次；如果反复失败，请从隐私中心提交申诉，我们会人工清除并回复你。 |
| Error state（消息发送失败） | 这条消息没有发出去 —— 网络似乎断开了。点这条消息重试。 |
| Error state（重连中 · CHAT-07） | 连接断开，正在重新连接…… 重连后会自动补齐这段时间的消息。 |
| Error state（导出失败） | 导出没有完成。你的数据没有受到影响，重试一次即可。 |
| Error state（年龄未满 18 · COMPLY-07） | 本服务仅向 18 周岁及以上用户提供。 |
| Error state（自建角色命中 COMPLY-08） | 这个描述指向了一位现实中的亲属或特定真人，我们不能这样创建角色。换一个不指向具体真实个人的设定试试。 |
| Error state（注册提交失败 · COMPLY-06） | 注册没有完成 —— 网络中断或服务器暂时没有响应。你填的内容都还在，点「重试提交」再试一次。 |
| Error state（注册提交失败 · 紧急联系人格式不通过 · COMPLY-06/R1.23） | 这个联系方式我们没法识别，请填写 11 位手机号。这一项不能留空 —— 监护人或紧急联系人填一个就可以。 |
| Error state（撤回同意项失败 · PRIV-02） | 这项同意**没有**撤回成功 —— 对应的数据流**仍在继续**。请再试一次；如果反复失败，先用「导出我的全部数据」留一份副本，再从隐私中心提交申诉，我们会人工停掉这条数据流。 |
| Destructive confirmation（删除全部数据） | **删除我的全部数据**：这会删除你的账号、全部聊天记录、导出记录，以及角色与你相处期间产生的经历。**此操作不可撤销。**请输入「删除我的全部数据」以确认。 |
| Destructive confirmation（撤回某个同意项） | **撤回「{同意项名称}」**：撤回后这项数据流会立即停止，这项内容也会从「我们收集了什么」里消失。已经发生过的对话无法被撤回。 |
| Destructive confirmation（撤回必选同意项 · PRIV-02/PRIV-05） | **撤回「{同意项名称}」**：这一项是提供服务的前提。撤回它等于停止服务并删除你的全部数据 —— 我们会立刻进入删除流程，删完给你一份回执。**此操作不可撤销。**请输入「删除我的全部数据」以确认。 |
| 危机事件通知运营者披露（PRIV-11） | 触发二级危机（自残自杀意图或重大财产损失）时，我们会把「发生了一次二级危机事件」通知给运营者，让他从这段对话之外直接联系你。通知里不包含你和角色说过的任何内容。 |
| 受托方清单引导句（PRIV-10） | 为了让角色能回话，我们会把你和它说的话交给下面这些模型服务商处理：{受托方清单}。它们只能按我们的委托处理这些内容，不能拿去改进自己的模型。 |
| 删除回执 | 已删除完成。共清除 **{N}** 处存储位置：{逐项清单 + 时间戳}。另有 1 项审计记录已去除可识别信息，保留合规所需的事件记录（6 个月）—— 这一项不计入上面的 {N}。〔PRIV-05 要求显示数量，回执页可导出〕 |
| 2 小时时长提醒（COMPLY-03） | 你已经连续使用 2 小时了。要不要先歇一会？ |
| 过度依赖动态提醒（COMPLY-04） | 提醒一下：这段互动里的内容由 AI 生成。 |
| 情感边界引导（SAFE-14） | 我是一个 AI 角色。你身边的人和专业的帮助，是我替代不了的。 |
| **紧急联系人联络状态 · `pending`**（SAFE-04） | 正在联系你填写的紧急联系人 {姓名}（{遮蔽后的联系方式}）。这需要一点时间，在此期间可以先看下面的帮助方式。 |
| **紧急联系人联络状态 · `delivered`**（SAFE-04） | 我们已经联系了你填写的紧急联系人：{姓名} {遮蔽后的联系方式}。 |
| **紧急联系人联络状态 · `failed`**（SAFE-04） | 我们暂时没能联系上 {姓名}，还在继续尝试。现在可以直接打这个电话：全国心理援助热线 12356（24 小时接听）。 |
| **紧急联系人联络状态 · `unavailable`**（SAFE-04 / R1.23） | 你填写的紧急联系人现在联系不上，我们不会让你一直等。请直接打这个电话：全国心理援助热线 12356（24 小时接听）；如果你现在就有危险，请打 120。 |
| 二级危机卡片唯一确认按钮（SAFE-04） | **我看到这些帮助方式了** |
| 二级危机卡片直呼按钮（`failed` / `unavailable` 态，首屏第一行） | **拨打 12356** |
| 2 小时时长提醒按钮（COMPLY-03） | 主按钮「**先去歇一会**」 / 次按钮「继续使用」（次按钮为 neutral 文字按钮，不吃 accent） |
| 过度依赖动态提醒按钮（COMPLY-04） | **我知道这是 AI 生成的**（单按钮 `Dialog`，不提供第二个选项 —— 这是一条告知，不是一次选择） |
| 消息重试控件的可见标签（CHAT-03） | **重试**（图标旁的 13px 文字，不可省略 —— 见 ## 交互契约「无障碍名称」） |
| 注册提交重试按钮（COMPLY-06） | **重试提交** |
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
  - **唯一豁免：法定终态拒绝。** 当拒绝本身就是法律要求的终局结果（本阶段仅
    `Error state（年龄未满 18 · COMPLY-07）` 一条），不受该规则约束 —— 此时任何「下一步」都在引导用户
    绕过年龄门槛（提示「换个年龄再试」即等于教人造假）。该行已按此豁免标注，**不得**为满足格式而补一个行动。
    新增任何终态拒绝文案必须在此列名，否则默认适用「必须含下一步」。

---

## 交互契约（Phase 1 必须落实的非视觉行为）

| 项 | 契约 |
|---|---|
| 五个同意项（PRIV-01） | 五个独立 `Checkbox`，每项紧跟一行 13px 说明。「基础服务与服务协议」（`basic_service`）与「敏感个人信息处理」（`sensitive_pi`）为**必选** —— 任一未勾选时主 CTA 禁用；`research_l0`（L0 行为特征研究）/ `research_l1`（L1 原文研究授权）/ `persona_evolution`（人格演化贡献）三项**默认未勾选**。不存在「全选」控件〔法定：不得捆绑同意〕 |
| 隐私中心「我们收集了什么」（PRIV-03） | 按存储字段逐项列出，与实际 schema 一一对应。某同意项被撤回后，其对应条目**从列表中消失**（不是置灰） |
| 一键删除（PRIV-05） | `AlertDialog` + 短语输入解锁 → 执行 → **跳转独立回执页**（不是 toast）。回执含存储位置数量、逐项清单、时间戳，可导出。撤回 `basic_service` 或 `sensitive_pi` 走同一条 `AlertDialog` + 短语输入 + 独立回执页路径；**不提供**「撤回后继续聊天」的降级只读模式〔Q2〕 |
| 2 小时提醒（COMPLY-03） | 计时权威在服务端（跨刷新与重登录有效）。UI 仅在收到服务端事件时弹一次 `Dialog`，前端**不得**自行用 `setTimeout` 计时 |
| 表情（CHAT-04） | 移动端用 `Sheet`，桌面用 `Popover`。v1 仅 Unicode emoji，无自定义表情包 |
| 未读（CHAT-05/06） | 会话行右侧未读数徽章（accent 色）；进入会话后在首条未读前插入 `Separator` + 「以下是你离开后的消息」，该分割线在本次会话内持续可见，不因滚动消失 |
| 断连补拉（CHAT-07） | 顶部细条显示重连态；补拉完成后细条消失。补拉期间输入框保持可用，发出的消息进入「发送中」态 |
| 焦点与键盘 | 所有 `AlertDialog` 必须有焦点陷阱与初始焦点在取消按钮上（破坏性操作的默认焦点不落在确认按钮） |
| 触控目标 | 所有可点区域 ≥ 44×44px，包括会话行右侧的未读徽章区（整行可点） |
| 无障碍名称（icon-only 控件） | 4 个 icon-only 控件必须带可编程确定的名称（`aria-label` 或视觉隐藏文字）：返回 = 「返回」、发送 = 「发送」、表情 = 「插入表情」、更多 = 「更多操作」。**tooltip 不得作为唯一来源** —— 触屏不可 hover，与 AI 徽标适用同一条规则 |
| 重试控件不得只靠图标与颜色（CHAT-03 · WCAG 1.4.1） | 气泡左侧的重试控件**不得**是「红色图标」这一种形态 —— 那同时是颜色单一手段与图标单一手段。必须是**图标 ＋ 13px 可见文字「重试」**，`aria-label` = 「重试发送这条消息」，触控区 ≥44×44。颜色只作为冗余强化：去掉颜色后仍必须可识别 |

---

## UI Considerations

> 状态覆盖契约。空态与错误态的**文案**在 `## Copywriting Contract`，本节只管**状态覆盖**并引用那些行，不重复文案。

**探针口径。** 本节由 `ui-consideration-probe` 生成后逐条解析（orchestrator 于 checker 批准后执行，
非作者自评）。12 个用户可见面按 `## 本阶段覆盖的用户可见面` 枚举，各自指派 element kinds（启发式分类器
对中文 prose 失效 —— 12 个面里 7 个返回 `unclassified`，故 kinds 为 authored override，已人工确认无遗漏），
再按相关性过滤 raise 适用类目。

| 面 | Element kinds |
|---|---|
| E1 注册 / onboarding | `form` |
| E2 预设角色库 | `list-collection` + `media` |
| E3 会话列表 | `list-collection` |
| E4 聊天消息流 | `list-collection` |
| E5 输入栏与 icon-only 控件 | `form` + `interactive-control` + `nav` |
| E6 角色详情页 | `static-content` + `interactive-control` |
| E7 AI 标识常驻条与四处徽标〔法定〕 | `static-content` |
| E8 两级危机干预卡片〔法定〕 | `static-content` + `list-collection` + `interactive-control` |
| E9 隐私中心 | `form` + `list-collection` + `nav` + `interactive-control` |
| E10 删除回执页 | `static-content` + `list-collection` |
| E11 硬退出结果态〔法定〕 | `static-content` |
| E12 时长 / 过度依赖提醒 `Dialog` | `interactive-control` + `static-content` |

**未指派的 kinds 与理由**（避免为假设需求设计）：E4 未指派 `media` —— Phase 1 只有文本消息，图片/语音属
Phase 2；E7 未指派 `interactive-control` —— 本契约明确 AI 徽标不可点击且禁止 tooltip 作唯一来源。二者若
将来成立，需回到本节补指派并重跑探针。

Applicable state considerations: **68** — **56 covered（explicit）/ 6 backstop / 5 dismissed（带理由）/ 1 unresolved**

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | E1 注册表单 | ✅ covered | 首次进入渲染空表单；每个字段的说明在 `Field` description 而非占位符；**五个同意项默认全部未勾选**，不存在预勾选与全选控件〔法定 · COMPLY-06〕 |
| empty | E2 角色库 | ✅ covered | 全部角色已添加时渲染「预设角色都已经在你的列表里了」行；不出现空白页 |
| empty | E3 会话列表 | ✅ covered | 无会话时渲染 `Empty` 容器 + Copywriting「还没有任何对话」行 + 「浏览角色库」CTA |
| empty | E4 聊天消息流（新会话） | ✅ covered | 渲染 Copywriting「聊天空态」行；**32px AI 常驻条在空态下同样在场**，不得等到有消息才出现〔法定 · COMPLY-01〕 |
| empty | E5 输入栏 | ✅ covered | 占位符「说点什么…」；发送按钮为禁用态图标（`#94A3B8`，Neutral non-text，不承载文字） |
| empty | E8 危机资源清单 | ✅ covered | 服务端必须保证清单非空；**清单为空时 fail-closed 渲染固定兜底行（12356 与 120），不得渲染空卡片**〔法定 · SAFE-03〕 |
| empty | E9 隐私中心导出（删除后） | ✅ covered | 删除后导出返回空集，渲染「这里已经没有你的数据了」行并显示删除时间戳（阶段成功标准 4 的可见证据） |
| empty | E10 删除回执页 | ⛔ dismissed | 回执页只在删除动作**完成后**存在，不存在「无数据」态；且 `N=0` 不可达 —— 一次删除必然清除 ≥1 处存储位置，否则走 error / partial 分支 |
| loading | E1 注册提交中 | ✅ covered | 提交按钮进入 pending 并禁用（防重复提交）；不加全屏遮罩，已填内容始终可见 |
| loading | E2 角色库 / E3 会话列表 首屏 | ✅ covered | `Skeleton` 渲染固定 72px 行高的骨架 ×6，行高与真实行一致，加载完成不产生布局跳动 |
| loading | E4 消息发送中 | ✅ covered | 气泡右下角 `Spinner`（12px）；受理后 `Spinner` 移除，时间戳在**气泡外**的 `message` 行布局中渲染（与 `## Component Inventory` 的 `message` 行一致 —— 时间戳**不在**气泡内，见 `## Color` 的〔禁止的组合〕行） |
| loading | E5 输入栏发送中 | ✅ covered | 输入框**不清空**直到服务端受理；失败时内容仍在，可直接重试 |
| loading | E6 角色详情页 | ✅ covered | 骨架屏**包含 AI 徽标位的占位**，徽标不得后到 —— 法定标识不允许有「闪缺」窗口〔法定 · COMPLY-01〕 |
| loading | E8 紧急联系人联络中 | ✅ covered | `contact_attempt.status = pending` 分支，文案见 Copywriting「紧急联系人联络状态」；不得以 `Spinner` 为唯一表达；终态原地替换、卡片不重排、不夺焦点；超时由**服务端**置 `failed`，前端不得 `setTimeout` |
| loading | E9 一键导出打包 | ✅ covered | `Progress` + 「正在打包你的数据」；超过 10s 追加「数据较多，还在继续」 |
| loading | E10 删除执行中 | ✅ covered | 渲染 `Progress`，**执行完成后**才跳转回执页；不得在执行中提前跳转（否则回执数字不可信） |
| loading | E12 提醒 `Dialog` | ⛔ dismissed | 计时权威在服务端、前端禁止 `setTimeout`（`## 交互契约`），Dialog 仅在收到服务端事件时渲染一次 —— UI 侧不存在加载窗口 |
| error | E1 注册提交（COMPLY-06） | ✅ covered | 提交失败**保留已填内容**（不清空表单）+ Copywriting「注册没有完成」行 + 「重试提交」按钮；字段级不通过渲染「这个联系方式我们没法识别」行，焦点移到第一个出错字段 |
| error | E2 角色库 / E3 会话列表 / E6 角色详情 加载失败 | ✅ covered | 渲染 Copywriting「列表加载失败」行 + 重试控件（同下方重试控件规则）；**不留白屏、不静默空态** —— 空态与加载失败必须可区分 |
| error | E4 消息发送失败 | ✅ covered | 气泡左侧「重试」控件（**图标 ＋ 13px 可见文字「重试」**，`aria-label`「重试发送这条消息」，≥44×44；红色只作冗余强化，不是唯一手段）+ Copywriting「这条消息没有发出去」行，点击气泡或该控件均可重试 |
| error | E5 输入栏 | ✅ covered | 复用上一行的重试控件与文案；输入内容不丢失 |
| error | E8 紧急联系人联络（SAFE-04） | ✅ covered | 四态 `pending / delivered / failed / unavailable` 全部有渲染分支，文案见 Copywriting「紧急联系人联络状态」四行；**非 `delivered` 时禁止出现「已经联系了」措辞**；`failed` / `unavailable` 把热线行与 `tel:` 直呼按钮提到卡片首屏第一行〔法定〕 |
| error | E4 WebSocket 断连 | ✅ covered | 顶部细条 + Copywriting「连接断开，正在重新连接」行；该细条位于 AI 常驻条**下方**，不得遮挡 AI 常驻条〔法定〕 |
| error | E9 同意项撤回写入失败（PRIV-02） | ✅ covered | `Switch` **回弹到服务端的真实状态**（禁止乐观置为已撤回）+ Copywriting「这项同意没有撤回成功」行 —— 该行必须明示「数据流仍在继续」并给出重试 / 导出留副本 / 提交申诉三个出路 |
| error | E10 删除失败（PRIV-05） | ✅ covered | 渲染 Copywriting「删除没有完成」行；**禁止渲染「已删除完成」**，须如实分列已清除 / 未能清除的处数并给出重试与申诉出路（与联络四态同一诚实性标准，见 PRIV-06 段） |
| error | E12 提醒事件未送达 | ✅ covered | 服务端重试并在下次会话恢复时补发；UI **不做本地兜底计时**〔COMPLY-03 计时权威在服务端〕。前端不得因 Dialog 渲染失败而静默丢弃事件 —— 渲染失败须上报合规事件，否则「提醒没弹」是一次静默的合规失效 |
| populated | E2 角色库 | ✅ covered | 典型 8–12 个预设角色：48px 头像 ＋ 角色名（20px）＋ 一句话简介（13px）；**列表内不放 accent**，行内不放按钮 |
| populated | E3 会话列表 | ✅ covered | 72px 固定行高；首个带未读徽章的行是首读锚点（见 `## 视觉锚点契约`） |
| populated | E4 聊天界面 | ✅ covered | 用户气泡 accent 右对齐 / 角色气泡 secondary 左对齐 / 关怀卡片全宽无气泡形态 —— 三者视觉不可混淆（R1.24） |
| populated | E8 两级危机卡片 | ✅ covered | 一级内联 `Alert` 可关闭；二级 sticky 阻断 `Alert` 不可 dismiss；**两级均禁用 `Bubble` 形态**，使「伪装成角色发言」在组件层不可能（R1.24） |
| populated | E9 「我们收集了什么」清单 | ✅ covered | 清单逐项对应**实际存储字段**，条数与内容由服务端返回，**UI 不硬编码** —— 否则清单与实现漂移即构成虚假陈述（PRIV-06 同一标准） |
| populated | E10 删除回执 | ✅ covered | 「已删除完成。共清除 **{N}** 处存储位置：{逐项清单 + 时间戳}」〔PRIV-05 要求显示数量〕；审计去标识化行单列，不计入 N |
| partial | E1 注册表单部分填写 | ✅ covered | 跨步骤保留已填内容；**监护人或紧急联系人二选一填一个即视为完整**（COMPLY-06）；未完成不得提交，禁用主 CTA 而非提交后报错 |
| partial | E2 角色头像缺失 | ✅ covered | 头像加载失败渲染 `Avatar` 的角色名首字 fallback，不留空洞、不改 72px 行高 |
| partial | E3 会话无最后消息摘要 | ✅ covered | 新建会话尚无消息时摘要位渲染占位短句，**行高仍为 72px**（固定行高是未读徽章不跳动的前提） |
| partial | E4 断连期间的消息流（部分已补拉） | ⚠ unresolved | **planner 须按假设处理**：补拉过程中「已补齐区段」与「仍缺失区段」如何在 UI 上区分尚未决定。假设 v1 补拉是原子的（补完才渲染）。若后续改为流式补拉，需回到本契约补一行 |
| partial | E5 草稿未发送 | ✅ covered | 草稿按会话保留（切走再回来不丢），**不跨会话串用** |
| partial | E8 联络状态未知 | ✅ covered | 状态未知**等同 `pending` 渲染**；任何情况下不得渲染「已联系」〔法定〕 |
| partial | E9 部分同意已撤回 | ✅ covered | 撤回生效后对应字段**立即从「我们收集了什么」清单消失**（PRIV-02 即时生效），不留灰显残留项 |
| partial | E10 部分存储位置删除失败 | ✅ covered | 回执必须如实分列「已清除 M 处 / 未能清除 N 处」，**禁止渲染「已删除完成」**；与 error 行同一诚实性标准 |
| overflow | E2 角色库 | ✅ covered | 纵向滚动，不分页（Phase 1 预设角色量级小）；行内简介单行 `truncate` |
| overflow | E3 会话列表行 | 🧪 backstop | 同下方 long-text 视觉测试：标题 `truncate` ＋ AI 徽标 `shrink-0`，徽标不得被挤出〔法定〕 |
| overflow | E4 单条超长消息气泡 | 🧪 backstop | 视觉 UI-state 测试：2000 字单条消息，断言 `max-w-[80%]` + `wrap-break-word` 生效、不产生横向滚动、不遮挡 AI 常驻条 |
| overflow | E5 输入框多行 | ✅ covered | 自增高至最多 5 行后**框内**滚动；不挤压消息流，**不得把 AI 常驻条挤出首屏**〔法定〕 |
| overflow | E6 角色详情长简介 | ✅ covered | 页面纵向滚动；「角色名 ＋ AI 徽标」那一行 sticky，滚动中不移出视口〔法定 · COMPLY-01〕 |
| overflow | E7 AI 常驻条 | ✅ covered | 条内 13px 文字单行、**不换行也不 `truncate`**（法定文本不得被截断）；窄视口下条高固定 32px 不变、文字缩至最小可读，**不得折叠或改为「更多」** |
| overflow | E8 危机援助资源清单 | 🧪 backstop | 视觉 UI-state 测试：以超出视口高度的资源清单渲染二级卡片，断言卡片仍 sticky 置顶、**紧急联系人联络状态行**（四态中的任一态）始终在视口内、且卡片不可 dismiss；`failed` / `unavailable` 态下额外断言热线行与「拨打 12356」按钮出现在卡片首屏第一行 |
| overflow | E9 清单与 `Tabs` | ✅ covered | 清单纵向滚动；`Tabs` 过多时**横向滚动**，不折叠为「更多」（隐私分区不得被藏起来） |
| overflow | E10 回执逐项清单 | ✅ covered | 清单纵向滚动；「共清除 {N} 处」摘要行 sticky，始终在视口内 |
| overflow | E11 硬退出系统卡片 | ✅ covered | 文案为契约固定短句，单屏可完整显示，不滚动 |
| overflow | E12 提醒 `Dialog` | ✅ covered | 内容为固定短文，对话框不滚动；按钮单行不换行 |
| zero-one-many | E2 角色库 | ✅ covered | 0 → 走 empty 行；**1 也用列表形态，不特殊化**；many 纵向滚动 |
| zero-one-many | E3 未读数徽章 | ✅ covered | 0 不渲染徽章；1–99 显示数字；≥100 显示「99+」。徽章宽度自适应但行高固定 72px 不变 |
| zero-one-many | E4 消息条数 | ✅ covered | 0 → 走 empty 行；1 条不特殊化；many 直接渲染并定位到底部（Phase 1 不做虚拟滚动） |
| zero-one-many | E8 援助资源清单 | ✅ covered | 清单恒 ≥2 条（热线 ＋ 紧急联系人联络状态行）；**恰好 1 条时不改版式、不分页、不折叠**〔法定 —— 折叠等于把求助渠道藏起来〕 |
| zero-one-many | E9 同意项与收集清单 | ⛔ dismissed | 同意项恒为 5 项（〔法定〕不可增删、不可合并）；收集清单恒 ≥1 项 —— **账号必要信息不可撤回**，故「0 项」不可达。0/1 分支无实现意义 |
| zero-one-many | E1 紧急联系人 | ✅ covered | 恰好 1 条（监护人或紧急联系人二选一，COMPLY-06）。UI 不提供「添加多个」，避免收集超出最小必要的第三方个人信息 |
| zero-one-many | E10 回执处数 | ✅ covered | 中文计数词天然规避单复数问题：`N=1` 渲染「共清除 1 处存储位置」，与 many 同一句式 |
| long-text | E1 超长姓名 / 联系方式 | ✅ covered | 输入设 `maxlength`；已提交值在回显处单行 `truncate`，**不换行破坏表单布局**；完整值在 `title` 与可访问名称中保留 |
| long-text | E5 icon-only 控件 | ✅ covered | 四个 icon-only 控件（返回 / 发送 / 插入表情 / 更多）无可见文字，由 `aria-label` 承载名称，**tooltip 不得作为唯一来源**；重试控件额外强制 13px 可见文字 |
| long-text | E6 角色名 / 会话标题 × AI 徽标 | 🧪 backstop | 视觉 UI-state 测试：以 30 字角色名渲染会话行与聊天页头部，断言 AI `Badge` 仍完整可见（标题 `truncate`、徽标 `shrink-0`）。徽标被挤出即法定标识失效，故必须是持有的测试而非人工检查 |
| long-text | E7 AI 标识文字 | 🧪 backstop | 同上测试覆盖徽标；常驻条文字为契约常量、长度恒定，由 overflow 行的「不换行不截断」规则约束 |
| long-text | E8 超长紧急联系人姓名 | 🧪 backstop | 由 overflow 行的同一视觉测试断言：长姓名不得把联络状态行挤出视口 |
| long-text | E9 长字段说明 | ✅ covered | 隐私说明**换行显示，不 `truncate`** —— 截断隐私说明即等于未告知（PRIV-06 作用域） |
| long-text | E10 回执内容 | ⛔ dismissed | 回执全为系统生成的固定结构（处数 ＋ 位置名 ＋ 时间戳），无用户可控长文本 |
| long-text | E11 硬退出文案 | ⛔ dismissed | 文案为契约固定常量，无变量插值，长度恒定 |
| long-text | E12 提醒文案 | ⛔ dismissed | 两个 `Dialog` 的正文与按钮文案均为契约固定常量，无变量插值 |


## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official (`@shadcn`) | 见 `## Component Inventory` 的 Phase 1 子集（全部为 `registry:ui`，不使用任何 `block`/`example`） | not required |

**无第三方 registry。** Phase 1 不引入任何非官方 registry，因此 `shadcn view` 第三方审查门禁不适用。

> 若后续阶段（例如 Phase 4 的人格雷达图、Phase 5 的轨迹曲线）要引入第三方 registry，必须先跑 `npx shadcn view {block} --registry {url}` 并扫描 `fetch(` / `process.env` / `eval(` / 外部 URL 动态 import / 混淆变量名，再回到该阶段的 UI-SPEC 登记带时间戳的审查证据。**Phase 1 的用户数据包含敏感个人信息，任何带网络访问的第三方组件代码都不得进入 `apps/web`。**

---

## Amendment Log

> 本节由 Plan 01-01 按 `01-CONTEXT.md` `<required_amendments>` 的三处裁决（A-01 / A-02 / A-03）与讨论新增的两条决定（Q1 / Q2）落地。**本节刻意不引用任何修订前的原文串** —— 引用旧串会让 `tools/ci/check-contract-amendments.mjs` 的否定式断言在这份日志上命中，检查器无法区分「日志在记录历史」与「文案没改干净」。

| 修订 | 改动位置 | 依据 |
|---|---|---|
| A-01 | `## 危机干预呈现契约` 二级列「必含内容」行末尾一项改为「已经收到通知 / 直接联系你」语义；同节「其他硬约束」新增末条「不提供会话内人工接管」 | SAFE-03/04/05、D-09；契约不得保留本阶段不会实现的承诺 |
| A-02 | `## Copywriting Contract` 新增「危机事件通知运营者披露」行；`## 本阶段覆盖的用户可见面` 第 8 行（隐私中心）承载需求列追加新 ID | PRIV-11（REQUIREMENTS.md 新增）、PRIV-03 一致性 |
| A-03 | 同意项数量表述**六处**由四改五：`## 本阶段覆盖的用户可见面` 第 1 行（含备注列）、`## Component Inventory` 的 `checkbox` 行 Notes、`## 视觉锚点契约` 的「注册 / onboarding」行次级读点单元格（仅该单元格的数字）、`## 交互契约` 同意项行（首列与正文，并改写必选集为两项）、`## UI Considerations` 的 `empty` / E1 注册表单 行、`## UI Considerations` 的 `zero-one-many` / E9 行 | PRIV-01（REQUIREMENTS.md 五项同意）、D-20、个保法第二十九条 / 第十四条 |
| Q1 | `## Copywriting Contract` 的「删除回执」行追加审计去标识化句；`## UI Considerations` 的 `populated` / E10 删除回执 行追加「单列、不计入 N」 | PRIV-05、COMPLY-11 |
| Q2 | `## Copywriting Contract` 新增「撤回必选同意项」的 `AlertDialog` 行（紧随「撤回某个同意项」行）；`## 交互契约` 的「一键删除（PRIV-05）」行追加同路径与「无降级只读模式」 | PRIV-02、PRIV-05 |

| A-04 | `## Design System` 的 Preset 行第 4 步（原 `add @shadcn/theme-slate`）与 `## Color` 的基座句；frontmatter `preset` 字段 | Plan 01-03 落地时的实测：`theme-slate` 的 `cssVars` 是 oklch，与本契约 `## Color` 的 hex 表不相等，跑该步会让 `tools/ci/design-tokens.test.ts` 的逐值断言失败。改为按 `## Color` 表逐值落地（有 CI 断言守护）。`--base radix` 未变更（实际 `style: radix-nova`，`radix-ui@1.6.7` 已装），两条禁令（不得 `--template next`、不得让 shadcn 生成 monorepo）均遵守。<br>**订正 01-03-SUMMARY.md 的一处事实错误**：该 SUMMARY 记「`@shadcn/theme-slate` 已不在 registry、registry 只剩 214 项且零 theme 条目」。编排器复核为**不成立** —— `pnpm dlx shadcn@4.21.0 view @shadcn/theme-slate` 退出码 0 并返回完整条目；`init --help` 显示 `-p, --preset [name]` 为可选参数，并非强制。该结论很可能源自 `shadcn search` 对 ui.shadcn.com 的 Connect Timeout 被误读（编排器已复现同一超时）。替换本身按上述 oklch/hex 理由**予以保留**，但依据以本行为准。 |

**另新增（非 A/Q 编号，但同属本 plan 落地）：** `## Copywriting Contract` 的「受托方清单引导句（PRIV-10）」行 —— `{受托方清单}` 为占位符，由 Plan 15 按 `packages/llm/src/routes.ts` 的 ROUTES（`mock` 除外）填充，引导句本身一字不改。它的作用是让 Plan 15 的四条必需句全部以本节为权威来源。

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
