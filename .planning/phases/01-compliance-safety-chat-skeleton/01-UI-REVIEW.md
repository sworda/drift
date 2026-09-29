# Phase 1 — UI Review（6 支柱对抗式审计）

**Audited:** 2026-09-29
**Baseline:** 01-UI-SPEC.md（2026-09-28 修订版，status: approved）
**Screenshots:** 未捕获 —— dev server 已探测到（docker 栈 drift-web-1 → http://127.0.0.1:53000，title=Drift 确认为本应用），但宿主机 chromium 无法启动（缺 libatk-bridge-2.0 / libgbm.so.1 / libatspi.so.0 系统库且无 root），降级为纯代码审计。截图目录 .planning/ui-reviews/ 已建 .gitignore 门禁。

**审计口径**：对抗式 —— 默认每个支柱都有失败，直到代码证据证明否则。所有发现均带 file:line。

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | 契约文案逐字绑定 + CI 运行时比对极强；但「撤回必选同意项」确认文案为内联组合、非契约逐字 |
| 2. Visuals | 4/4 | 视觉锚点契约 10 屏全部落实且带 RTL backstop 测试；icon-only 四控件 aria 齐全 |
| 3. Color | 3/4 | 法定语义色独立 token + CI 逐值断言到位；但 2 处文字链接吃 accent、2 个清单外元素吃 accent 填充 |
| 4. Typography | 2/4 | tokens.css 4 档/2 字重定义正确，但 ui 原语默认值（12px/14px/18px/500）未被重排，系统性偏离 |
| 5. Spacing | 3/4 | B 组固定尺寸与断点全对；A 组「会话行水平内边距 12px」错位成 16px |
| 6. Experience Design | 3/4 | 状态覆盖极佳（四态/回滚/边界/焦点）；发送中缺契约要求的 12px Spinner，以文字行代替 |

**Overall: 18/24**

---

## Top 3 Priority Fixes

1. **ui 原语字号/字重未契约化（Typography 主因）** —— 每条消息的时间戳以 12px/500 渲染（message.tsx:63,76 的 MessageHeader/Footer 默认 text-xs font-medium，chat-view.tsx 调用处未覆写），契约规定时间戳为 Label 13px/400；所有未覆写按钮 14px/500（button.tsx:7）、提醒 Dialog 标题 18px/500（dialog.tsx:78）、桌面输入框 14px（input.tsx:10 的 md:text-sm）。修复：把 4 个原语的基础 class 重排为项目 token（footer/header → text-label + font-normal；button 基座 → text-label/text-body + 400/600；DialogTitle → text-heading font-semibold；input 去掉 md:text-sm），并清掉 feature 层 9 处 font-medium（consent-switches.tsx:83,113,153、collected-list.tsx:38、receipt.tsx:102,131、delete-dialog.tsx:124,177）。这是「类微信 16px 正文」目标下最显眼的系统性偏差。
2. **accent 闭合清单违规（Color）** —— chat-view.tsx:142 与 empty-or-error.tsx:27 的重试文字链接用 text-primary：契约明文「文字链接一律 neutral token」；composer.tsx:110 发送按钮 bg-primary 与 care-card.tsx:186 二级确认按钮（Button default → bg-primary）不在 accent 4 项闭合清单内。修复：两处链接改 text-text-secondary underline（重试控件本就另有 13px 可见文字）；发送按钮与 care 确认按钮要么改 neutral/destructive 系，要么先回 UI-SPEC 把这两项正式登记进闭合清单（决策项，不应由实现层默认扩张）。
3. **会话行水平内边距 16px → 12px（Spacing A 组）** —— 契约 A 组把 12px（md-tight）的用途登记为「气泡水平内边距、会话行水平内边距」，但 conversation-list.tsx:60 及两处骨架（conversations/page.tsx、characters/page.tsx）行容器均为 px-md（16px）。修复：统一 px-md-tight。同批顺带：AI 徽标内边距对齐登记值（上下 4px·左右 8px；当前 ai-badge.tsx:23 仅 px-xs 横向 4px、无纵向），composer textarea 的 px-3（12px 外溢到输入框，composer.tsx:98）改 px-md。

---

## Detailed Findings

### Pillar 1: Copywriting（3/4）

**到位（证据）：**
- 全部契约文案集中在 5 个 copy.ts，且 tools/ci/*-ui-contract.test.ts 在运行时从 UI-SPEC 逐行提取与常量逐字比对（privacy/copy.ts:5-8、onboarding/copy.ts:5-7、chat/copy.ts:5-9 注释与测试存在性核实）。这把「抄错/UI-SPEC 改行」从 code review 问题变成红灯。
- 禁用词三规则全净：「匿名/anonymous/无法关联到你」仅出现在代码注释（解释为什么不能写）中，无用户可见串；挽留语义 7 词零命中（仅注释引述禁令）；「关闭 AI 提示/隐藏 AI 标识/不再显示」零命中。
- 法定常量同源核验：AI_BADGE_TEXT=「AI」、AI_BANNER_TEXT=「你正在与 AI 角色互动，内容由 AI 生成」、EXIT_SYSTEM_CARD_COPY=「已停止本次会话。你随时可以回来。」（packages/contract/src/disclosure.ts:12-15、exit.ts:8），导出文件头三行 Drift / 本文件全部角色消息由 AI 生成 / 导出时间 + 角色消息行 [AI] 前缀、用户消息无前缀（apps/api/src/modules/export/render.ts:19-50）—— COMPLY-02 的导出存活标识完整。
- 空态/错误态逐字核对通过：会话列表、角色库已全部添加、聊天空态、年龄拒绝（无任何出口按钮，age-gate.tsx:90-97）、注册失败、撤回失败、删除部分失败、导出失败均与契约一致。

**偏差：**
- 〔WARNING〕撤回必选同意项的确认文案非契约逐字 —— 契约登记的破坏性确认全文（撤回「{同意项名称}」：这一项是提供服务的前提……此操作不可撤销。请输入「删除我的全部数据」以确认。）在 consent-switches.tsx:134-140 被替换为内联组合：标题「撤回必选项会删除全部数据」+ description = CONSENT_SCOPE_SPECS[scope].description 拼接「这一操作不可撤销 —— 确认请逐字输入…」。语义要素（不可撤销、短语解锁）在，但「这一项是提供服务的前提」「立刻进入删除流程、删完给回执」两个告知缺失，且这段文案不受 privacy-ui-contract 逐字断言保护（它只盯 copy.ts 常量）。修复：移入 privacy/copy.ts 并按契约原文逐字登记、纳入 CI 断言。
- 〔MINOR〕privacy/copy.ts 的 EXPORT_PENDING_NOTE / DELETE_PENDING_NOTE（「导出功能还在建设中…人工导给你」）已无任何组件引用 —— Plan 11 落地了完整导出/删除流后成为死文案。建议删除，避免未来误接线后退回「建设中」口径。
- 〔MINOR〕character-detail.tsx:117 内联加好友失败文案（语气符合「错误含下一步」基线，但违反本项目自设的「文案不得内联」约定，且契约无此行登记）。

### Pillar 2: Visuals（4/4）

- 视觉锚点契约 10 屏逐条核对全部落实：注册（STEP_TITLE_CLASS 常量化的全屏唯一 28px，steps.tsx:73）、角色库（48px 头像 + 20px 名，列表内无 accent 无行内按钮）、会话列表（未读徽章为唯一 accent，无未读退化为首行）、聊天（贴底 + 最新气泡，chat-view.tsx:74-79）、角色详情（角色名+徽标 sticky 视觉组，character-detail.tsx:87-91）、隐私中心（当前 Tab 标题 20px，privacy/page.tsx:111-131）、二级危机卡片（care 实心顶条 + 32px 图标，care-card.tsx:184-187）、回执（28px + sticky 摘要行，receipt.tsx:100-106）、硬退出（中性卡片 + 禁用输入占位）、时长/依赖提醒 Dialog。
- icon-only 四控件 aria 齐全：返回（chat-client.tsx:331）、更多操作（:360）、发送（composer.tsx:105）、插入表情（emoji-picker.tsx:19）；tooltip 未作为任何名称来源。
- 法定标识三处徽标 + 32px 常驻条全部在场；ai-badge.tsx 无 text/children props（标识文案不可改写在类型层封死）；徽标 shrink-0 + 标题 truncate 由 RTL backstop 测试钉住（ui-state-visual.test.tsx backstop 1-4：30 字角色名、2000 字消息、超屏资源清单、20 字联系人姓名）。
- 头像 fallback 用名字首字（手写 48px span）；骨架屏与真实行同构（含徽标位占位，character-detail.tsx:57-62 —— 法定标识无「闪缺」窗口）。
- 说明：Component Inventory 里的 avatar/badge/empty/skeleton/tabs/sonner 等未按 registry 拉取，而是本地手写等价原语（dialog.tsx:5-8 注明理由）。视觉与行为等价，但 inventory 应在下一轮修订时登记为「本地实现」。

### Pillar 3: Color（3/4）

**到位：**
- tokens.css 逐值落地全部契约色；--ai-label-* 与 --care-* 为字面 hex、不引用 Border/Neutral（tokens.css:20-42），tools/ci/design-tokens.test.ts 机械断言。shadcn 语义桥接正确且规避了 --accent 命名陷阱（tokens.css:66-83）。
- tsx 内零硬编码 hex/rgb（唯一命中是 composer.tsx:10 的注释）。
- accent 合规使用：注册主 CTA、角色详情「加为好友」、未读徽章（99+ 分档正确）、勾选 Checkbox/开启 Switch 轨道、空态「浏览角色库」CTA —— 全部在闭合清单内。
- #94A3B8 仅用于禁用态图标（composer 发送钮禁用态 text-neutral-nontext 作用于 aria-hidden SVG），未承载文字。

**偏差：**
- 〔WARNING〕chat-view.tsx:142、empty-or-error.tsx:27：text-primary underline 文字链接 —— 契约「次级按钮、文字链接、图标、描边、选中态列表行一律使用 neutral token」。见 Top 3 #2。
- 〔WARNING〕composer.tsx:110：发送按钮启用态 bg-primary —— 发送是 icon 控件，不在闭合清单 4 项内；聊天屏因此出现「用户气泡 + 发送钮」双 accent。需决策：改 neutral，或修订 UI-SPEC 把发送钮登记为第 5 项。
- 〔MINOR〕care-card.tsx:186：二级卡片唯一确认按钮用 Button default（bg-primary）—— care 面上出现紫色填充按钮。契约未禁止（可辩护为该卡片的主 CTA），但值得一次显式决策。
- 〔MINOR〕empty-or-error.tsx:44：error 态的重试按钮也吃 bg-primary —— 与重试文字链接两种形态并存，建议统一为 neutral 描边按钮（同 receipt.tsx:131 的重试样式）。

### Pillar 4: Typography（2/4）

tokens.css 正确定义恰好 4 档（13/16/20/28）与 2 字重（400/600），feature 层主力文本（气泡正文 text-base 覆写 chat-view.tsx:198 ✓、标题 text-heading、次级 text-label）基本合规。但 ui 原语的 shadcn 默认值没有被重排进契约档位，形成系统性偏离：

| 位置 | 实际渲染 | 契约要求 |
|---|---|---|
| message.tsx:63,76 MessageHeader/Footer（时间戳，聊天页每条消息） | text-xs(12px) font-medium(500) | Label 13px / 400 |
| button.tsx:7 所有未覆写按钮 | text-sm(14px) font-medium(500) | 4 档内 + 仅 400/600 |
| dialog.tsx:78 DialogTitle（两个提醒 Dialog） | text-lg(18px) font-medium | Heading 20px / 600 |
| input.tsx:10 桌面输入框 | md:text-sm(14px) | Body 16px（「正文不下探 14px」明文） |
| field.tsx:33,123,136 FieldLabel/描述默认 | text-sm(14px) font-medium | Label 13px / 400（调用点多已覆写 13px ✓） |
| bubble.tsx:76,85 基座 | text-sm | 正文调用点已覆写 text-base ✓ |
| feature 层 font-medium ×9 | 500 字重 | 契约「不引入 500」 |

另：steps.tsx:73 用 text-[28px] leading-[1.2] 内联复刻 Display 档而非 text-display（数值相等，但绕开了 token 单一来源）。

修复建议见 Top 3 #1。评分 2：这不是个别瑕疵 —— 时间戳、按钮、对话框标题三类高频元素全部落在契约档位外。

### Pillar 5: Spacing（3/4）

**到位：**
- tokens.css:100-120 全 scale 逐值落地 + globals.css:51-63 桥接进 --spacing-*（注释明确 Tailwind 4 静默失效的坑）；--spacing-touch(44px)、--spacing-conversation-row(72px)、--spacing-ai-bar(32px) 三个 B 组尺寸桥接完整，用法遍布全仓。
- 裸键 w/min-w/max-w 禁令有 tools/ci/ui-size-scale.test.ts 机械扫描（globals.css:71-89 记录了成因与实测）。
- 全部任意值逐个核对均有正当来源：max-w-[480px] md:max-w-[640px] lg:max-w-[720px] 恰好 10 处（契约 2026-09-28 修正登记的 10 处单列页面，逐处吻合）；max-h-[140px]（5 行输入封顶）、max-h-[360px]（回执清单）、min-w-[22px]/leading-[18px]（徽章）、max-w-[420px]（对话框）、top-[20%]（对话框定位）。

**偏差：**
- 〔WARNING〕会话行水平内边距 16px，契约 A 组登记为 12px —— conversation-list.tsx:60 px-md；同型还有 conversations/page.tsx 与 characters/page.tsx 的骨架行。md-tight 的作用域声明（气泡 + 会话行水平内边距）恰恰在这两处没有生效，反而 gap-md-tight（头像与文字间隙）用对了。见 Top 3 #3。
- 〔MINOR〕composer.tsx:98 textarea px-3（12px）—— 12px 作用域外溢到输入框（输入框应 16px）。
- 〔MINOR〕ai-badge.tsx:23 徽标仅 px-xs（左右 4px、无纵向）—— 契约登记「内边距 4px 上下 · 8px 左右」。
- 〔MINOR〕ui 原语内残留 shadcn 默认非档位值：button.tsx:23,25 px-2.5(10px)/px-2、bubble.tsx:85 px-1.5 py-0.5、input.tsx px-2.5 py-1。registry 原语默认未逐值重排，量级小，建议随 Typography 修复一并 token 化。

### Pillar 6: Experience Design（3/4）

**到位（覆盖核对）：**
- 三态可区分全线落实：两列表页骨架 72px ×6（不跳动）、error 带「重试」、empty 带 CTA（conversations/page.tsx:63-90、characters/page.tsx:74-105）；聊天首载失败 ≠ 空态（chat-view.tsx:139-152）。
- 危机四态联络行完整且带双闸门（contact-status-row.tsx:73-76：claimsContacted 服务端断言 + 状态一致性；未知→pending；failed/unavailable 热线行上移 + 44×44 tel:）；一级卡片类型层无联络字段（care-card.tsx:273 编译期断言）。
- 资源清单 fail-closed 兜底 12356/120（resource-list.tsx:24-28）；Switch 回弹（受控组件，乐观翻转结构上写不出，consent-switches.tsx:8-12）；删除执行完才跳回执 + 独立回执页（delete-dialog.tsx:84-91）；partial 回执禁止渲染「已删除完成」（receipt.tsx:73-86）。
- 两个提醒 Dialog 带 ComplianceRenderBoundary（渲染失败上报而非静默丢弃，usage-reminder-dialog.tsx:37-57）—— E12 的合规失效防护做到了。
- 破坏性 AlertDialog ×2 初始焦点都在取消（autoFocus，delete-dialog.tsx:170、consent-switches.tsx:149）；表单错误焦点移到第一个出错字段（steps.tsx:150-158）；18 岁终态页无任何出口（RTL 断言 button/link = 0）。
- 前端计时器禁令：chat/** 无 setTimeout（eslint + 负向 fixture）；导出面板的 10s 慢速提示是 E9 明文要求的唯一例外（export-panel.tsx:6-8 注释划清边界）。
- 语义化 aria 全面：role=status/alert/note/separator、aria-live=polite、aria-busy、tel 链接 aria-label、徽标「99+ 条未读消息」。

**偏差：**
- 〔WARNING〕消息发送中缺 12px Spinner —— 契约 loading E4：「气泡右下角 Spinner（12px）；受理后移除」。实现以 MessageFooter 文字「发送中」代替（chat-view.tsx:209），全仓无 spinner 原语。状态本身可见（用户不困惑），但契约指定的形态未实现。修复：补 12px spinner 放气泡右下角（文字行可保留作冗余），或在 UI-SPEC 登记形态变更。
- 〔MINOR〕导出完成后提供 .md/.json 双格式下载按钮，「下载 .md」「下载 .json」为自创文案（语义无害，UI-SPEC 未登记）。

---

## Registry Safety

apps/web/components.json 存在（shadcn 已 init）。UI-SPEC Registry Safety 表仅登记 @shadcn official、明确「无第三方 registry」。**Registry audit: 0 third-party blocks checked, no flags.** 附注：dialog/alert 等原语为本地实现而非 registry 拉取（避免未核验依赖，dialog.tsx:5-8）—— 与契约「不得引入带网络访问的第三方组件代码」方向一致。

## Screenshots

- Dev server：http://127.0.0.1:53000（drift-web-1 容器，healthy）已探测确认。
- 截图未捕获：宿主 chromium 启动失败（缺 libatk-bridge-2.0.so.0 / libgbm.so.1 / libatspi.so.0，无 root 安装权限）。本次为纯代码审计；建议在容器内跑一次 playwright 截图补齐视觉验收。
- .planning/ui-reviews/.gitignore 门禁已建（*.png 等二进制不入库）。

## Files Audited

- 设计契约与计划：01-UI-SPEC.md（全文 556 行）、各 01-*-SUMMARY.md 标题层
- tokens 与全局：src/styles/tokens.css、app/globals.css、app/layout.tsx
- 法定标识：components/ai-badge.tsx、ai-banner.tsx、packages/contract/src/disclosure.ts、exit.ts
- 聊天域：chat-client.tsx、chat-view.tsx、composer.tsx、message-retry.tsx、exit-system-card.tsx、more-sheet.tsx、unread-separator.tsx、reconnect-bar.tsx、usage-reminder-dialog.tsx、dependency-notice-dialog.tsx、emoji-picker.tsx、chat/copy.ts
- 会话/角色：conversation-list.tsx、unread-badge.tsx、character-detail.tsx、character-list.tsx、conversations/page.tsx、characters/page.tsx、conversations/copy.ts
- 危机：care-card.tsx、contact-status-row.tsx、resource-list.tsx、crisis/copy.ts
- 注册：steps.tsx、age-gate.tsx、consent-checkboxes.tsx、onboarding/copy.ts、(auth)/register/page.tsx
- 隐私：delete-dialog.tsx、consent-switches.tsx、receipt.tsx、collected-list.tsx、export-panel.tsx、privacy/copy.ts、(app)/privacy/page.tsx、tabs.tsx
- ui 原语：bubble.tsx、message.tsx、button.tsx、dialog.tsx、alert.tsx、input.tsx、field.tsx、label.tsx、checkbox.tsx
- 通用：empty-or-error.tsx、error-boundary.tsx、ui-state-visual.test.tsx
- 导出管道（COMPLY-02 抽查）：apps/api/src/modules/export/render.ts、apps/api/src/worker/jobs/export-build.ts
