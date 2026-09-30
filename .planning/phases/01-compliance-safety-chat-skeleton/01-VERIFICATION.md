---
status: passed
score: 0.92
phase: 01-compliance-safety-chat-skeleton
verified: 2026-09-29
verifier: gsd-verify-01
gaps: []
pending_external:
  - probes-real-classify-not-run（SKIPPED_CHECKS.md 在册：78 条探针的真实分类需 ZHIPU_API_KEY；离线部分——计数守卫 / 非空真证明 / fail-closed 接线——已由 01-08 交付并由本次验证实跑确认）
  - dpa-unsigned-for-enabled-providers（volcengine / zhipu DPA 未签，首次 live 调用前必须完成，compliance-docs.test.ts 守卫该登记不消失）
  - ci-workflows-never-executed（仓库无 remote，三条 workflow 未真跑）
  - 走查诚实性（01-PLAYTEST.md：走查者为开发者本人，缺陷与修复真实（commit 为证），但「无偏样本独立完成」的字面判据未经无偏样本验证；建议公开上线前补首轮使用者）
---

# Phase 1 阶段验证（01-VERIFICATION）

## 验证方法与环境

- 验证日期：2026-09-29，HEAD = `540e332`（master），工作区干净（仅未跟踪的 `.codebuddy/`、`ft_local/`）
- 机器断言**全部实际重跑**（引用本次运行输出，非转述 SUMMARY）：
  - `pnpm run ci:fast`（typecheck + lint + unit + contract）→ **exit 0，Test Files 30 passed，Tests 414 passed (414)**
  - `DATABASE_URL='postgres://drift:drift_dev_pw@127.0.0.1:55432/drift' pnpm run test:integration` → **exit 0，Test Files 18 passed，Tests 149 passed (149)**
  - `DATABASE_URL=… pnpm run test:probes` → **exit 0，Tests 33 passed | 1 skipped (34)**（该 skip 即在册的 probes-real-classify-not-run）
  - `node tools/ci/check-contract-amendments.mjs` → **OK 13/13 contract amendments**
  - `pnpm drizzle-kit check`（packages/db，指向 compose 实例）→ **Everything's fine（零漂移）**
- 人工试玩类（SC1）以 01-PLAYTEST.md 记录 + commit 修复轨迹为证据，附诚实性备注（见下）
- 逐 REQ-ID 核对 REQUIREMENTS.md 追溯状态；must_haves 抽查关键契约源码在场

## Success Criteria 逐条核验

### SC1【人工试玩】新用户全流程（注册→角色库→加好友→10 轮对话→三处 AI 标识→导出含标识）

**判定：达成（附登记在册的诚实性备注）。**

- 01-PLAYTEST.md 记录 2026-09-28 走查：七个环节（邀请码 / 注册含生日+紧急联系人+五同意项 / 角色库 / 加好友 / 10 轮对话 / 三处 AI 标识 / 导出含标识）最终全部「独立完成」，用户确认「没什么问题了」
- 第一轮发现的 6 个真实缺陷全部当天修复并有 commit 留证（36feb2d / 64ebf27 / 2998456 / cadf9b2 / 66c091f / 13e8dc4 / 6663c6b / ae53171，见 01-PLAYTEST.md 修复轨迹）
- 四处标识（会话列表 / 聊天界面 / 角色详情页 / 导出文件）的机器侧覆盖由 `tools/ci/disclosure-surfaces.test.ts`（本次 ci:fast 414 内全绿）承担
- **诚实性备注（在册，非 gap）**：走查者为开发者本人（边走边修），非字面要求的「没见过这个产品的人」；建议公开上线前（非 Phase 1 出场门）由真正的首次使用者补走一轮 —— 已登记于 01-PLAYTEST.md 与 01-14-SUMMARY D10，并入下方 human_verification 清单

### SC2【机器断言】危机探针集、网关不可绕过、判定顺序与独立模型、SAFE-16 状态机

**判定：机器可断言部分全部达成并本次实跑全绿；78 条探针的真实分类为在册外部挂起（probes-real-classify-not-run）。**

- 极端情绪只安抚不联络 / 自残自杀与重大财产损失触发援助+联络+safety_event / 分类器故障 fail-closed 升 elevated 而非 crisis：`tests/probes/crisis.test.ts`（离线可证部分，33 passed）+ `tests/integration/{crisis-order,fail-closed,contact-attempt}.test.ts`（149 内全绿）；探针 YAML 实数 78 条（16+16+8+20+15+3，本次清点）
- 非空真证明实跑通过：「永远返回 crisis」的桩 ⇒ 15 条阴性对照全部失败（探针集不是空真的）；三类分类器故障注入 ⇒ 全部 fail-closed 到 elevated（真实管道）
- 不存在绕过出站网关的生成路径：`tools/ci/egress-registry.test.ts`（20 tests，含未登记出口负向 fixture 与 any 通道 eslint 负向 fixture，本次 ci:fast 全绿）；源码抽查确认全仓仅两处受控 `as GatedText`（packages/safety/src/gateway.ts:297 唯一产出点；packages/safety/src/stored-gated.ts:36 恢复点，disclosure 非 ai_generated 即抛错）
- 危机判定在人格渲染之后、由不同模型执行：`tests/integration/crisis-order.test.ts` 全绿（149 内）；safety.classify 路由独立于 chat.reply（`tools/ci/llm-router-contract.test.ts` 32 tests 全绿）
- SAFE-16：投递成功进 pending、投递失败直接 unavailable 不经 pending —— `tests/integration/contact-attempt.test.ts` 全绿；源码抽查 risk.ts:79-84 确认 fail-closed 恒 elevated 且封顶
- **挂起（在册）**：78 条 × N=3 的**真实**分类（glm-4.7-flash）需 ZHIPU_API_KEY，SKIPPED_CHECKS.md `probes-real-classify-not-run` 行在册，解除条件可判定；补偿防线（无 key 显式抛错不回落 mock、条数守卫、非空真证明）本次全部实跑确认

### SC3【机器断言】三条静默失效防线

**判定：达成（本次 ci:fast 414 内全绿）。**

- RES-03：`tools/ci/publication-scan.test.ts`（19 tests）—— 三条静态断言（NO_BARE_TABLE / NO_VECTOR_COLUMN / L0_NO_VECTOR）每个 PR 都跑且各有坏样例证明非空真；动态检查 skip 在册（DYNAMIC_PUBLICATION_CHECK，Phase 7 有被测对象时解除）
- PLAT-06：ESLint 禁止 `model: "provider/name"` 字符串写法 —— `tools/ci/fixtures/bad-model-literal.ts` 负向 fixture + eslint-config-meta.test.ts（23 tests）全绿
- PRIV-06：`tools/ci/legal-required-sentences.test.ts`（正句逐字在场）+ `banned-terms.test.ts` + `privacy-ui-contract.test.ts`（否定式「匿名」检查 + 渲染层）全绿

### SC4 隐私中心一致性、撤回、删除回执

**判定：达成（本次 ci:fast + integration 全绿）。**

- 「我们收集了什么」与实际存储字段逐项一致：`packages/db/src/inventory.ts` DATA_INVENTORY 单一真相源（源码在场）+ `tools/ci/data-inventory.test.ts` 四条双向不变式（drizzle 枚举列 ↔ 注册表双向相等）全绿；隐私中心清单由 buildCollectedView(DATA_INVENTORY) 生成，无第二份清单
- 撤回任一同意项数据流立即停止：`tests/integration/consent-ticket.test.ts` + ConsentTicket branded type 守卫（requireConsent 唯一产出点）；撤回必选项等同进入删除流程（Q2 裁决，无降级只读模式）
- 一键删除回执显示已删除存储位置数量、此后导出空集：`tests/integration/{deletion,export}.test.ts` 全绿；STORAGE_LOCATIONS 注册表（packages/db/src/storage-locations.ts:107，24 项 FK 删除顺序）两条腿 CI 对账（storage-registry.test.ts / storage-registry-db.test.ts）全绿；审计日志去标识化不计入回执 N 口径（Q1 裁决）有断言

### SC5【机器断言】硬退出零出站、2 小时计时、公开性门

**判定：达成（本次实跑全绿）。**

- 硬退出后零出站（含定时与推送）：`tests/integration/hard-exit.test.ts`（9 tests，含「排定延迟作业后硬退出 ⇒ 0 条出站、会话级作业显式取消」「硬退出后 usage-reminder 不发出」）全绿；零出站为双处执行（取消 + 每个 worker 发送前重读会话状态）；挽留触发率恒 0 由词表测试集与网关判定顺序（会话状态→风险→挽留）承担
- 2 小时计时跨刷新与重登录有效：`tests/integration/usage-timer.test.ts`（7 tests，含断开重连累计不变、跨会话累计、pg-boss 到点作业路径、重复执行幂等）全绿（服务端 usage_segment 计时）
- 公开性门：`tools/ci/publicness.test.ts`（哈希双写 + CHECKLIST 签字 + 四条断言链 + 三个坏样例）+ `compliance/publicness.json` + registered_users 日对账（publicness-reconcile）全绿

## REQ-ID 追溯核对（46 / 46 全部 accounted for）

REQUIREMENTS.md 中本阶段 46 条需求全部标记 `[x]`（Complete），且每条都有至少一个 PLAN 的 requirements 声明覆盖（映射核对无遗漏）：

| 组 | IDs | 状态 | 覆盖 PLAN |
|---|---|---|---|
| COMPLY-01..11 | 11 条 | 全 Complete | 01-01/04/06/08/09/11/12/13/14 |
| SAFE-01..05, 14, 16 | 7 条 | 全 Complete | 01-01/05/06/07/08/12 |
| PRIV-01..11 | 11 条 | 全 Complete | 01-01/09/10/11/13/15 |
| CHAT-01..07 | 7 条 | 全 Complete | 01-04/14 |
| PLAT-01..03, 05..08 | 7 条 | 全 Complete | 01-02/03/04/05 |
| IFC-08 | 1 条 | Complete | 01-04/14 |
| RES-02, RES-03 | 2 条 | Complete | 01-10/13 |

注：PRIV-10 的「协议已签署」强度由 SKIPPED_CHECKS `dpa-unsigned-for-enabled-providers` 在册承担（断言存在性每个 PR 都跑，Phase 1 未发生任何真实 provider 调用，委托处理尚未发生）；SAFE-02 的快照 pin 强度由 `model-pinnability-glm-flash` 在册承担。两条均为**强度降级的显式登记**，不是需求缺失。

## must_haves 抽查（关键契约源码在场）

| 契约 | 源码位置（本次核验） | 结论 |
|---|---|---|
| GatedText 唯一产出点 | packages/safety/src/gateway.ts:297（全仓仅两处受控 `as GatedText`） | ✅ 在场 |
| 历史消息恢复点（非产出） | packages/safety/src/stored-gated.ts:36（disclosure 非 ai_generated 即抛错） | ✅ 在场 |
| EGRESS_POINTS 注册表 | packages/safety/src/egress.ts:53 + tools/ci/egress-registry.test.ts 集合相等断言 + 两个负向 fixture | ✅ 在场 |
| DATA_INVENTORY 单一真相源 | packages/db/src/inventory.ts:241 + 四条双向不变式断言 | ✅ 在场 |
| STORAGE_LOCATIONS 注册表 | packages/db/src/storage-locations.ts:107（24 项，FK 删除顺序） | ✅ 在场 |
| fail-closed 语义 | packages/safety/src/risk.ts:79-84（failed ⇒ 恒 elevated 且封顶；failed 分支无 level 字段的 discriminated union） | ✅ 在场 |
| WS 握手鉴权（REVIEW #1 修复） | apps/api/src/ws/server.ts（token → authorizeConnection → 归属校验 → 4400；DB 故障 fail-closed）+ tests/integration/ws-auth.test.ts（149 内全绿） | ✅ 在场 |
| 五同意项无全选 | packages/contract/src/consent.ts:19-23 + apps/web/src/features/onboarding/consent-checkboxes.tsx（onToggle 只吃单 scope，全选在结构上写不出） | ✅ 在场 |

## Code Review 闭环状态

- critical #1（WS 无鉴权）：已修复（2318e90），源码 + 集成断言（ws-auth.test.ts：无 token 0 帧 / 无归属 0 帧 / 合法连接照常）本次复跑全绿
- medium #2（恒时比较 + Caddy query 日志）：已修复（1070978，timingSafeEqual + log format filter 脱敏 URI），复验记录在 01-REVIEW.md
- #2 剩余半条（Caddy 日志作为非表存储位置登记）+ 4 条 low（#3-#6）挂账 `.planning/todos/pending/2026-09-29-review-lows-phase2.md`（resolves_phase: 2，解除条件可判定）—— 属 Phase 2 工作量切分，非本阶段 gap

## 在册挂起与外部依赖（如实记录，不判为 gap）

| 项 | 性质 | 解除条件 |
|---|---|---|
| probes-real-classify-not-run | 外部依赖（ZHIPU_API_KEY） | 带 key 环境跑 `pnpm run test:probes` 78×N=3 全绿后删行 |
| dpa-unsigned-for-enabled-providers | 外部行动（签约） | 两家 DPA 签署 + 控制台截图留证 + status 改 signed，**首次 live 调用前必须** |
| ci-workflows-never-executed | 外部依赖（git remote） | 接上远端后三条 workflow 各真跑一次 + required check 配置 |
| 走查诚实性 | 人工复核 | 公开上线前由真正的首次使用者补走一轮 |
| L2-type-aware-on-ts6 / model-pinnability-glm-flash / DYNAMIC_PUBLICATION_CHECK / inventory-l0-assert-vacuous-in-phase-1 / pino-log-not-row-deletable | 在册 skip（各有可判定解除条件与补偿防线） | 见 SKIPPED_CHECKS.md 逐行 |

## human_verification（供 UAT 复核的 human_judgment 项全集）

以下为 15 份 SUMMARY 中全部 `human_judgment: true` 交付判定（35 项），按当前状态分组：

**仍需人工/外部复核（UAT 建议覆盖）**
1. 01-14 D10 / SC1 走查诚实性 —— 走查者为开发者本人；公开上线前补无偏样本首轮走查
2. 01-08 D6 —— 78×N=3 真实分类全绿（依赖 ZHIPU_API_KEY，与 probes-real-classify-not-run 同一件事）
3. 01-07 D11 —— 企业微信 webhook 真实投递（含 IM 到达运营者手机）从未被验证过（集成测试为桩）
4. 01-07 D10 —— 入站规则层对真实危机表达的召回率（同义 / 隐喻 / 多语言 / 角色扮演包装绕过）
5. 01-08 D7 / 01-07 D9 —— 两级关怀卡片视觉呈现（同色不同版式、sticky、不可 dismiss、热线直呼手感）
6. 01-10 D7 / 01-11 D7 —— 隐私中心 / 删除导出面板与回执页实际观感（布局手感、第三态与 M/N 分支一目了然）
7. 01-09 D13 —— apps/web 生产构建（后由 01-14 构建链修复与部署验证补强，仍建议 UAT 时目视 /register）
8. 01-12 D7 —— 浏览器侧「收到服务端事件弹一次 Dialog」的实际接线手感（集成测试覆盖事件到达，弹窗手感属人工）
9. 01-03 D9 —— AI 常驻条 sticky、无 dismiss 交互（有元测试断言，视觉终验属人工）
10. 01-05 D10 —— ark / zhipu 真实 provider 实例（baseURL 写死 git；真实调用依赖 DPA 签署，与挂起项 2 绑定）
11. 01-13 D3 / D7 / D8 / D10 —— CHECKLIST 首签裁决、PIA 不确定性两项、DPA 双向断言、registered_users 日对账的运营侧实操
12. 01-15 D1 / D2 —— 隐私政策与服务协议正文的法务终读（必需句与章节有机器断言，语义终审属人工）
13. 01-01 D5 / 01-06 D6 —— 受托方清单引导句与「对外提供路径」登记文件的逐条人工核实
14. 01-02 D0 —— 待装包合法性人工核验（已有 npm registry 元数据 25/25 批量核验留证）

**已由后续机器证据补强（列出备查）**
- 01-02 D12 / 01-03 D13（提示词真相源在 git）—— 后续 llm-router-contract / prompt-version 断言落地
- 01-10 D5（collected 清单单一来源）—— data-inventory.test.ts 双向断言落地
- 01-15 D4（legal-collected-section skip 行）—— Plan 10 Task 2 接入后该行已从 SKIPPED_CHECKS.md 删除（本次确认不在册）
- 01-03 D4 / D6 / D12（pino 白名单 / pg-boss 排除 / workflow 静态守卫）—— pino-no-pii、schema-drift、ci-workflow-guard 均在本次 414 内全绿

## 结论

Phase 1 目标（五条 Success Criteria）**达成**：机器断言部分本次全部实跑全绿（414 + 149 + 33+1skip + 13/13 + 零漂移），46 条阶段需求全部 Complete 且追溯闭环，关键结构性契约源码抽查全部在场，code review 的 critical 与 medium 已修复并有独立复跑证据。遗留项全部为**显式登记**的外部依赖 / 强度降级 / Phase 2 工作量切分（4 low + 半条 medium），无未登记 gap。判定 **passed**；上方 human_verification 清单供 UAT 使用。
