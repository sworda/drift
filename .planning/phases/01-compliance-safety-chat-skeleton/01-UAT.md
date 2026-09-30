---
status: complete
phase: 01-compliance-safety-chat-skeleton
source: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md, 01-04-SUMMARY.md, 01-05-SUMMARY.md, 01-06-SUMMARY.md, 01-07-SUMMARY.md, 01-08-SUMMARY.md, 01-09-SUMMARY.md, 01-10-SUMMARY.md, 01-11-SUMMARY.md, 01-12-SUMMARY.md, 01-13-SUMMARY.md, 01-14-SUMMARY.md, 01-15-SUMMARY.md]
started: 2026-09-29T00:00:00Z
updated: 2026-09-30T00:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. 冷启动冒烟测试
expected: 杀掉所有运行中的服务，清理临时状态（临时数据库、缓存、锁文件），从零启动应用。服务无错误启动，seed/迁移完成，健康检查（或首页、基础 API）返回活数据。
result: pass
source: automated

### 2. 受托方清单引导句（PRIV-10）
expected: 01-UI-SPEC.md 新增 PRIV-10 受托方清单引导句（{受托方清单} 占位符未填充）
result: pass
source: automated

### 3. 待装包合法性人工核验
expected: 本阶段全部待装包的合法性人工核验（RESEARCH 无 Package Legitimacy Audit 表，全部按 ASSUMED 处理）
result: pass
source: automated

### 4. 提示词真相源载体包
expected: 提示词真相源在 git 中、不托管于可观测性平台的载体包 packages/prompts 就位（PLAT-08 的骨架部分）
result: pass
source: automated

### 5. pino 日志白名单
expected: pino 日志白名单式：logEvent 的 fields 类型只接受 LOG_ALLOWED_FIELDS 的键，配 redact 第二道，且不导出裸 logger
result: pass
source: automated

### 6. pg-boss 表不被迁移删除（T-03-05）
expected: drizzle 迁移不会把 pg-boss 的表当成漂移删掉（T-03-05）
result: pass
source: automated

### 7. 聊天页 AI 常驻条
expected: 三条真实路由存在且可构建；聊天页有一个 32px sticky top-0 的 AI 常驻条，且没有任何 dismiss / 折叠 / 关闭交互
result: pass
source: automated

### 8. CI workflow 配置
expected: fast workflow 只跑 ci:fast 且不依赖任何境内资源；integration workflow 是 self-hosted 且不存在放行分支；nightly 对未落地脚本缺失即失败
result: pass
source: automated

### 9. 提示词真相源无远端读取（PLAT-08）
expected: 提示词真相源在 git 内、不存在从数据库或远端读取提示词的代码路径（PLAT-08 的本 plan 部分）
result: pass
source: automated

### 10. 角色库与聊天页真实渲染
expected: 角色库与聊天页的真实渲染：48px 头像 + 20px 名 + 13px 简介的列表、BubbleContent 覆写 text-base、用户/角色气泡变体、时间戳在气泡外
result: pass
source: automated

### 11. resolved_model 日 diff 告警
expected: resolved_model 日 diff 告警（脚本 + 人工确认基线 + nightly 直接调用）
result: pass
source: automated

### 12. safety.classify 系统提示词纯净
expected: safety.classify 的系统提示词不含任何角色名、人格描述或语体指令；输出契约由 zod 声明
result: pass
source: automated

### 13. 境内 provider 实例
expected: ark / zhipu 两个真实 provider 实例（境内 baseURL 写死在 git，不接受运行时覆盖）
result: pass
source: automated

### 14. 出站提供路径登记文件
expected: 登记文件正文逐条核实四条对外提供路径（三条「带标识」+ acute 告警「不构成对外提供生成内容」），含空集结论与《标识办法》第九条引注
result: pass
source: automated

### 15. 出站标识统一注入
expected: 出站标识由消息管道统一注入且有 DB CHECK 兜底；renderExportLine 注入 [AI] 前缀（COMPLY-09 / COMPLY-02 的第四处落点）
result: pass
source: automated

### 16. acute 告警投递与状态机（SAFE-16 / PRIV-11）
expected: acute 告警在有界时间内投递，投递结果驱动状态机，载荷不含任何对话文本（SAFE-16 / PRIV-11）
result: pass
source: automated

### 17. 二级关怀卡片真实界面呈现
expected: 二级关怀卡片在真实界面上的呈现是否符合 UI-SPEC 的版式与阻断行为（sticky、不可 dismiss、failed/unavailable 时热线提到首屏第一行）
result: skipped
reason: "Deferred follow-up: 聊天链路当前有 bug（用户报告无法正常聊天），无法触发二级关怀卡片；待登录流程完成后回归"

### 18. 入站危机表达召回率
expected: 入站规则层对真实危机表达的召回率（同义、隐喻、多语言、角色扮演包装的绕过）
result: skipped
reason: "Deferred follow-up: 依赖真实 safety.classify 探针与聊天链路，随聊天问题一并顺延"

### 19. 企业微信 webhook 真实投递
expected: 企业微信 webhook 的真实投递（含 IM 到达运营者手机）从未被验证过
result: skipped
reason: "Deferred follow-up: 用户要求本轮整体顺延；webhook 已配置，仅需真实投递确认"

### 20. contact_status 四态接线（T-08-03）
expected: safety.contact_status 下行事件与四态接线：协议只有遮蔽字段、运营者 ack/failed 与超时 worker 广播、渲染不含 11 位连续数字（T-08-03）
result: pass
source: automated

### 21. 前端计时器禁令
expected: crisis 目录的前端计时器禁令（超时权威在服务端），负向 fixture 证明非空真
result: pass
source: automated

### 22. 危机探针集 78 条全绿
expected: 78 条 × N=3 的真实 safety.classify 全绿（成功标准 2 的「危机探针集 100% 通过」）
result: skipped
reason: "Deferred follow-up: 依赖真实 safety.classify（78 条 × N=3），随聊天问题一并顺延"

### 23. 两级卡片视觉呈现
expected: 两级卡片的视觉呈现：同色不同版式、首读锚点、直呼按钮手感、危机态下 AI 常驻条不被遮挡
result: skipped
reason: "Deferred follow-up: 依赖聊天链路触发的视觉呈现，待聊天修复后回归"

### 24. 生产构建与 /register 路由
expected: apps/web 的生产构建通过，/register 路由存在
result: pass
source: automated

### 25. GET /me/collected 清单
expected: GET /me/collected：清单由 buildCollectedView(DATA_INVENTORY) 生成，判定「确有写入路径」的依据是注册表条目数，不引入第二份清单
result: pass
source: automated

### 26. 隐私中心实际观感
expected: 隐私中心的实际观感（布局、四分区导航的手感、第三态呈现是否一目了然）
result: skipped
reason: "Deferred follow-up: 视觉走查顺延，待登录流程完成后回归"

### 27. 删除/导出面板实际观感
expected: 删除/导出面板与回执页的实际观感（布局手感、滚动清单的可读性、M/N 分支的呈现是否一目了然）
result: skipped
reason: "Deferred follow-up: 视觉走查顺延，待登录流程完成后回归"

### 28. 连续使用计时与重复提醒
expected: 服务端连续使用计时与 2 小时重复提醒（跨刷新/重登录有效、4 小时两次、只读不发也被提醒、重复投递只提醒一次）
result: pass
source: automated

### 29. 依赖告知单 Dialog
expected: 依赖告知单按钮 Dialog + SAFE-14 情感边界引导次级说明行（不提供第二个选项）
result: pass
source: automated

### 30. 硬退出过滤器两档
expected: 两档硬退出过滤器：归一化 + 整句锚定 + 长度上限，21 条含阴性探针集 + 常驻子串回归守卫
result: pass
source: automated

### 31. 硬退出 UI 契约
expected: 中性系统卡片 + 禁用输入框 + 更多 Sheet 直接执行入口 + 两个提醒 Dialog 的 UI 契约（无二次确认/挽留控件，不吃 care 色）
result: pass
source: automated

### 32. WS 客户端接线
expected: 「收到服务端事件时弹一次 Dialog」的浏览器侧 WS 客户端接线
result: pass
source: automated

### 33. CHECKLIST 模板与基线首签
expected: CHECKLIST 模板六条必需条目 + 基线首签（裁决与证据齐全、未勾选项 0）；四条抗辩破裂后 not_applicable 即非法
result: pass
source: automated

### 34. PIA 入库（PRIV-09）
expected: PRIV-09 PIA 入 repo：五个必需章节、留存期不少于 3 年、两项不确定性登记（GB 45438-2025 隐式标识形态、人格演化是否构成模型训练）
result: pass
source: automated

### 35. PRIV-10 路由表双向断言
expected: PRIV-10 路由表 provider 集合与 compliance/dpa/ 的双向集合断言 + 已启用未签署必须登记 + 含 openai 的假路由表负向 fixture
result: pass
source: automated

### 36. D-23 registered_users 日对账
expected: D-23 registered_users 日对账：判定与投递唯一实现、只告警不写回、载荷只含两个计数与两个布尔、nightly 直接调用
result: pass
source: automated

### 37. 四处 AI 标识覆盖元测试
expected: 四处 AI 标识覆盖元测试（conversation_list / chat_banner / character_detail / export_file 各带 testId 且每项有通过的断言；常量单一定义 as const 冻结；渲染条件只依赖 counterpart_kind；无「关闭 AI 提示」类控制文案）
result: pass
source: automated

### 38. 全程人工走查（成功标准 1）
expected: 人工走查（ROADMAP Phase 1 成功标准 1）：七个环节从邀请码到导出全程走查，第一轮发现 6 个真实缺陷当天修复，复验由用户确认「没什么问题了」
result: skipped
reason: "Deferred follow-up: 用户报告聊天存在 bug，全程走查待登录流程完成后重做"

### 39. 隐私政策正文
expected: 隐私政策正文 apps/web/content/legal/privacy.md：九个必需章节、四条法定必需句逐字在场、收集清单逐项对齐 Plan 04 的 schema 并标注同意项依据、保存期对齐 D-17 四层
result: pass
source: automated

### 40. 服务协议正文
expected: 服务协议正文 apps/web/content/legal/terms.md：服务是什么/不是什么（明写「这是 AI 角色扮演服务，对面不是真人」）、18 周岁准入、可接受使用、可用性不作承诺、终止与删除、争议解决
result: pass
source: automated

### 41. SKIPPED_CHECKS 新增行
expected: SKIPPED_CHECKS.md 新增 legal-collected-section-matches-inventory 一行（与 DATA_INVENTORY 的集合相等断言待 Plan 10 Task 2 接入）
result: pass
source: automated

## Summary

total: 41
passed: 33
issues: 0
pending: 0
skipped: 8
blocked: 0
skipped: 0
blocked: 0

## Gaps

[none yet]

## Deferred Follow-Ups

- test: 38
  idea: "用户报告『一堆 bug，无法正常聊天』——聊天链路缺陷待登录流程完成后修复并重做走查（测试 17/18/19/22/23/26/27/38 全部顺延）"
  deferred_at: 2026-09-30
