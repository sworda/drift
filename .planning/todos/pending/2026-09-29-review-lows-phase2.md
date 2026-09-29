---
id: review-lows-phase2
created: 2026-09-29
resolves_phase: 2
source: 01-REVIEW.md
---

# Phase 1 code review 遗留的 4 条 low（Phase 2 处理）

来源：`.planning/phases/01-compliance-safety-chat-skeleton/01-REVIEW.md` Findings #3-#6。
critical（#1 WS 鉴权）与 medium 的恒时比较/Caddy query 日志（#2）已在 Phase 1 修复
（2318e90 / 1070978）；#2 剩余半条（Caddy 访问日志作为非表存储位置的登记）与以下四条一并处理。

1. **maskContact 双实现**：`packages/db/crypto.ts` 与 `packages/safety/care-cards.ts` 各一份且语义分叉，后者无生产调用方（死代码）—— 删或收敛到唯一权威。
2. **.md 导出静默跳过 system 消息**：`renderExportMarkdown` 无 system 分支，硬退出系统卡片在 .md 缺失（.json 有）—— 补分支或写明刻意缺失的理由。
3. **告警文案指引不存在的能力**：acute 告警「请在后台按会话 id 查看详情」，后台无按会话查看入口 —— 改文案或 D-09 落地时补入口。
4. **注册路由 catch-all 把 5xx 类故障折成 409**：`register.ts` 的错误分支过宽 —— 收窄到 InviteCodeUnavailableError 才 409。
5. **（#2 剩余）Caddy 访问日志登记**：作为非表存储位置写进 DATA_INVENTORY 的 nonTableStorage（含「不含个人信息」的成立条件：不记 body + 凭证键被 delete）。

解除条件：以上五项全部落地或显式裁决不做（裁决记录回 01-REVIEW.md）。
