---
created: 2026-09-29T06:32:15.716Z
title: 桌面端会话侧栏布局（≥1024px，回到 UI-SPEC 桌面终态）
area: ui
severity: minor
files:
  - .planning/phases/01-compliance-safety-chat-skeleton/01-UI-SPEC.md:52
  - apps/web/src/features/chat/chat-client.tsx:327
  - apps/web/src/features/conversations/conversation-list.tsx
  - apps/web/src/features/chat/chat-view.tsx:196
  - apps/web/src/app/(app)/conversations/page.tsx:57
  - .codebuddy/chat-ui-layout-rootcause.md
---

## Problem

桌面端没有布局：全站只有一条居中单列，≥1024px 时两侧大块留白。`01-UI-SPEC.md` 第 52 行「目标视口」原本写明的桌面形态是**等宽居中单列（max-width 480px）+ 侧栏会话列表（≥1024px）**，Phase 1 只交付了单列，侧栏一直缺席。

2026-09-28 走查取证（1440 视口）：聊天列恒 480px、居中，两侧空 960px，用户在 PC 上看到的就是一条窄条。当天做了**缓解**而不是终态：

- 全站 10 处 `max-w-[480px]` 追加了两档断点 `md:max-w-[640px] lg:max-w-[720px]`（chat / conversations / characters ×2 / privacy ×2 / receipt ×2 / legal / error-boundary）；
- `01-UI-SPEC.md:52` 追加了「**2026-09-28 走查修正（列宽）**」登记，其中明文写下：**侧栏落地后本行应改回单一值并删除这两档断点**。

⚠️ 这条耦合是本 todo 的主要交付物之一 —— 做侧栏时漏掉它，全站列宽就会永久停在「两档断点」的临时态，而 SPEC 与代码再次静默分叉。

## Solution

1. **布局**：≥1024px 变「左侧会话列表 + 右侧当前会话」；会话列宽回到 SPEC 单一值（不再靠 md/lg 断点撑宽）。<1024px 保持现有单页导航不变。

\`\`\`mermaid
flowchart LR
    subgraph mobile["< 1024px（不变）"]
      A1["/conversations<br/>单列"] -->|进入会话| A2["/chat/:id<br/>单列"]
    end
    subgraph desktop["≥ 1024px（本 todo）"]
      B1["侧栏：会话列表"] --- B2["会话列（SPEC 单一列宽）"]
    end
\`\`\`

2. **复用而非重写**：会话列表直接用 `features/conversations/conversation-list` 的既有组件，保持它已被断言钉住的约束 —— 72px 固定行高、未读徽章 0 / 1-99 / 99+ 三态、30 字名 `truncate` 且 AI 徽标 `shrink-0` 不被挤出。
3. **交互**：当前会话高亮、进入即已读（沿用 `POST /conversations/:id/read`）、空态与错误态与单列版一致。
4. **法定面不得回退**：AI 常驻条（32px、不可关闭、COMPLY-01）与 AI 徽标在桌面形态下仍常驻可见，`tools/ci/disclosure-surfaces.test.ts` 与 `ui-state-visual` 的 backstop 断言不能变红。
5. **收尾**：删除 `01-UI-SPEC.md:52` 的走查修正段；移除全站 10 处的 `md:max-w-[640px] lg:max-w-[720px]`，回到单一列宽。

### 验收标准

- 1440 视口：列表与会话同屏、会话列宽等于 SPEC 值、`documentElement.scrollWidth == clientWidth`（无横向滚动）。
- <1024px：与当前单列**视觉零差异**（回归）。
- `pnpm run typecheck` / `lint` / `vitest --project unit --project contract` 全绿；相关 backstop 断言按新布局**更新**，不得为了变绿而删除。
