---
phase: 01-compliance-safety-chat-skeleton
plan: 13
subsystem: compliance
tags: [publicness-gate, pia, dpa, publication-scan, pgvector, reconcile, wecom-webhook, ci-gate]

requires:
  - phase: 01-05
    provides: packages/llm/src/routes.ts 的 ROUTES（provider 集合的来源）与 pinnability 表
  - phase: 01-06
    provides: EGRESS_POINTS 注册表、egress-hash.mjs 的哈希实现、compliance/no-unlabeled-output.md
  - phase: 01-04
    provides: packages/db/src/schema/ 的 22 张表（publication 扫描反查 getSQLType 的对象）与 invite_code
  - phase: 01-03
    provides: fast/nightly 两条 workflow 与 nightly 里的对账占位分支
provides:
  - COMPLY-10 公开性状态门：四项状态真相源 + 状态哈希双写 + CHECKLIST 签字 + 用户数上限，四条断言链各有一个坏样例证明非空真
  - CHECKLIST 的裁决制语义（implemented / not_applicable），四条抗辩任一破裂时 not_applicable 即非法
  - RES-03 publication DDL 静态扫描：裸表名（含 FOR ALL TABLES / TABLES IN SCHEMA）即失败、向量列即失败、类型解析不出即失败
  - DYNAMIC_PUBLICATION_CHECK 的显式 SKIP 与带解除条件的登记，另加一条断言守着那条登记存在
  - PRIV-09 compliance/PIA-2026.md：五个必需章节 + 留存期 3 年 + 两项不确定性登记
  - PRIV-10 compliance/dpa/ 四份委托处理留档 + 路由表集合断言 + 孤儿文件反向断言 + 含 openai 的假路由表负向 fixture
  - D-23 registered_users 日对账：判定与投递唯一实现，只告警不写回，nightly 直接调用
  - 第五条出站出口 reconcile.publicnessWebhook 的登记与 egress_hash 同步
affects: [01-08 危机探针集, 01-10 隐私中心与 DATA_INVENTORY, 01-11 导出与删除, Phase 7 研究管道]

actuals:
  tokens: 41000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "合规产出物入 git + 机械断言：真相源在版本库，检查脚本零写入能力，更新只能是人工提交"
    - "裁决制 checklist：勾选 = 已裁决且留证；裁决取值的合法性由外部状态（四条抗辩）决定"
    - "fail-closed 的类型解析：publication 列清单里解析不出 SQL 类型的列一律判失败"
    - "载荷类型内不存在文本字段 + 编译期字段集合断言：告警出口靠类型而不是靠自觉不泄漏"

key-files:
  created:
    - compliance/publicness.json
    - compliance/CHECKLIST-TEMPLATE.md
    - compliance/CHECKLIST-2026-09-27.md
    - compliance/PIA-2026.md
    - compliance/dpa/volcengine-ark.md
    - compliance/dpa/zhipu.md
    - compliance/dpa/aliyun-dashscope.md
    - compliance/dpa/anthropic.md
    - db/publication/research_publication.sql
    - tools/ci/publicness.mjs
    - tools/ci/publicness.test.ts
    - tools/ci/publication-scan.mjs
    - tools/ci/publication-scan.test.ts
    - tools/ci/compliance-docs.test.ts
    - tools/ci/publicness-reconcile.mjs
    - tools/ci/fixtures/publicness/hash-stale.json
    - tools/ci/fixtures/publicness/no-checklist.json
    - tools/ci/fixtures/publicness/checklist-unchecked.md
    - tools/ci/fixtures/publication/bare-table.sql
    - tools/ci/fixtures/publication/vector-column.sql
    - tools/ci/fixtures/publication/fake-vector-schema.ts
    - apps/api/src/worker/jobs/publicness-reconcile.ts
  modified:
    - .github/workflows/fast.yml
    - .github/workflows/nightly.yml
    - SKIPPED_CHECKS.md
    - packages/safety/src/egress.ts
    - compliance/no-unlabeled-output.md
    - tools/ci/egress-registry.test.ts
    - tools/ci/ci-workflow-guard.test.ts

key-decisions:
  - "CHECKLIST 的勾选语义是「已裁决且留证」而非「已做完」；裁决只有 implemented 与 not_applicable，后者仅当四条抗辩全部成立时合法"
  - "DPA 按路由表全部四个 provider 各一份，「必须已签」的判据绑在 enabled 上；两家已启用 provider 的未签缺口如实登记 SKIPPED_CHECKS 而不是编造 signed_at"
  - "对账告警登记为第五条 EGRESS_POINTS 出口，刻意不复用 notifyOperator 也不抽接受 string 的投递函数"
  - "publication 扫描覆盖四种加表形态，解析不出类型的列 fail-closed"
  - "日对账不挂 pg-boss schedule：api 镜像不 COPY compliance/，执行点是 nightly workflow"

patterns-established:
  - "负向 fixture 与检查脚本同等重要：三个脚本各带 --self-test，四条/三条断言各有一个坏样例或一次注入证明它能失败，全部通过时打印 <gate> is vacuous 并非零退出"
  - "破坏验证写成测试内注入而不是临时改文件：改坏配置会红这件事每个 PR 都跑"
  - "检查脚本不含任何写入能力，并由一条 grep 断言守着这一点（自动更新会绕过人工签字/复核动作）"

requirements-completed: [COMPLY-10, COMPLY-11, PRIV-09, PRIV-10, RES-03]

coverage:
  - id: D1
    description: "COMPLY-10 公开性状态门：四项状态哈希双写 + CHECKLIST 签字 + 条目集合一致 + 用户数上限，四条断言链"
    requirement: COMPLY-10
    verification:
      - kind: unit
        ref: "tools/ci/publicness.test.ts#四条断言链对当前仓库成立"
        status: pass
      - kind: other
        ref: "node tools/ci/publicness.mjs（stdout: OK 4/4 publicness gate，exit 0）"
        status: pass
    human_judgment: false
  - id: D2
    description: "三个坏样例 fixture + 一次注入证明四条断言各自能失败（门禁非空真）"
    requirement: COMPLY-10
    verification:
      - kind: unit
        ref: "tools/ci/publicness.test.ts#三个坏样例各让一条断言失败（V.0 #1）"
        status: pass
      - kind: other
        ref: "node tools/ci/publicness.mjs --self-test（exit 0，四条 id 各被点名）"
        status: pass
    human_judgment: false
  - id: D3
    description: "CHECKLIST 模板六条必需条目 + 基线首签（裁决与证据齐全、未勾选项 0）；四条抗辩破裂后 not_applicable 即非法"
    requirement: COMPLY-10
    verification:
      - kind: unit
        ref: "tools/ci/publicness.test.ts#模板即断言基准（删条目不会让门禁变松）"
        status: pass
      - kind: unit
        ref: "tools/ci/publicness.test.ts#四条抗辩破裂后 not_applicable 不再是合法裁决"
        status: pass
    human_judgment: true
    rationale: "六条条目的裁决内容（当前全部 not_applicable，依据四条抗辩成立）是一次人工合规判断。机械断言只能保证「有裁决、有证据、取值合法、抗辩破裂时不接受不适用」，不能保证裁决本身正确 —— 那正是这份 checklist 需要人签字的理由。"
  - id: D4
    description: "RES-03 publication DDL 静态扫描三条断言（裸表名 / 向量列 / l0 交叉复核），覆盖四种加表形态且类型解析失败即判失败"
    requirement: RES-03
    verification:
      - kind: unit
        ref: "tools/ci/publication-scan.test.ts#绕过 ADD TABLE 的三种写法同样被抓"
        status: pass
      - kind: other
        ref: "node tools/ci/publication-scan.mjs（stdout: OK 3/3 publication scan，exit 0）"
        status: pass
    human_judgment: false
  - id: D5
    description: "两个假 SQL + 一次注入证明三条 publication 断言各自能失败"
    requirement: RES-03
    verification:
      - kind: unit
        ref: "tools/ci/publication-scan.test.ts#两个假 SQL + 一次注入：三条断言各自能失败（V.0 #1）"
        status: pass
      - kind: other
        ref: "node tools/ci/publication-scan.mjs --self-test（exit 0）"
        status: pass
    human_judgment: false
  - id: D6
    description: "动态检查以显式 SKIP 存在，且该 skip 已登记 SKIPPED_CHECKS.md 并带含「Phase 7」与「删除本行」的解除条件"
    requirement: RES-03
    verification:
      - kind: unit
        ref: "tools/ci/publication-scan.test.ts#动态检查的 skip 已登记且带解除条件（Q3 第三项成立条件的机械化）"
        status: pass
    human_judgment: false
  - id: D7
    description: "PRIV-09 PIA 入 repo：五个必需章节、留存期不少于 3 年、两项不确定性登记（GB 45438-2025 隐式标识形态、人格演化是否构成模型训练）"
    requirement: PRIV-09
    verification:
      - kind: unit
        ref: "tools/ci/compliance-docs.test.ts#(a) PRIV-09：PIA 入 repo 且必需章节齐全"
        status: pass
    human_judgment: true
    rationale: "章节齐全、留存期标注、两项不确定性存在与否是机械可判的；但评估内容本身（风险清单是否完整、缓解措施是否与风险相适应、两项不确定性的处置是否恰当）是一次法律与产品判断，无法由测试断言。个保法第五十五条要求的是一次真实的评估，不是一份通过格式检查的文件。"
  - id: D8
    description: "PRIV-10 路由表 provider 集合与 compliance/dpa/ 的双向集合断言 + 已启用未签署必须登记 + 含 openai 的假路由表负向 fixture"
    requirement: PRIV-10
    verification:
      - kind: unit
        ref: "tools/ci/compliance-docs.test.ts#(b) PRIV-10：路由表 provider 集合与 compliance/dpa/ 的集合断言"
        status: pass
      - kind: unit
        ref: "tools/ci/compliance-docs.test.ts#(c) 负向 fixture：假路由表里的未登记 provider 必须让检查抛错"
        status: pass
    human_judgment: true
    rationale: "断言保证的是「每个 provider 都有一份留档、留档含要求状态与证据章节、已启用而未签署的缺口有登记」。协议是否真的签了、控制台开关是否真的关了、证据是否真的捕获了，机器看不到 —— 当前状态是两家已启用 provider 均为 pending_signature，已登记 dpa-unsigned-for-enabled-providers。人必须看这一条。"
  - id: D9
    description: "COMPLY-11 交叉复核：compliance/no-unlabeled-output.md 的 egress_hash 与当前 EGRESS_POINTS（含新增的第五条出口）一致，且登记逐条覆盖该出口"
    requirement: COMPLY-11
    verification:
      - kind: unit
        ref: "tools/ci/compliance-docs.test.ts#(d) COMPLY-11 交叉复核：登记文件的 egress_hash 与当前出口集合一致"
        status: pass
      - kind: other
        ref: "node tools/ci/egress-hash.mjs --check（exit 0）"
        status: pass
    human_judgment: false
  - id: D10
    description: "D-23 registered_users 日对账：判定与投递唯一实现、只告警不写回、载荷只含两个计数与两个布尔、nightly 直接调用"
    requirement: COMPLY-10
    verification:
      - kind: unit
        ref: "tools/ci/compliance-docs.test.ts#对账的两处常量与载荷（D-23 / T-13-09）"
        status: pass
      - kind: unit
        ref: "tools/ci/ci-workflow-guard.test.ts#nightly 直接调用已落地的 publicness-reconcile，且不留占位分支"
        status: pass
      - kind: other
        ref: "node tools/ci/publicness-reconcile.mjs --dry-run（OK registered_users reconciled）与 --actual 4 / --actual 11（MISMATCH / OVER_CAP，exit 1）"
        status: pass
    human_judgment: true
    rationale: "真实对账需要连库（nightly 带 DATABASE_URL），本地 --dry-run 在无库时如实退回声明值并声明「本次不构成真实对账」。三条 CI workflow 从未真实执行过（已登记 ci-workflows-never-executed），因此「nightly 会不会真的跑起来并把告警发出去」仍需人确认。"

duration: 38 min
completed: 2026-09-27
status: complete
---

# Phase 01 Plan 13: 公开性状态门 + publication 静态扫描 + PIA/DPA 产出物 Summary

**四项公开性状态的哈希双写门（四条断言链，脚本零写入能力）、publication DDL 的四形态裸表名与向量列静态扫描（动态检查显式 SKIP 并带解除条件登记）、PIA 与四份 provider 委托处理留档及其双向集合断言，加 registered_users 只告警不写回的日对账 —— 六个负向输入证明这些门禁都不是空真的。**

## Performance

- **Duration:** 38 min
- **Started:** 2026-09-27T05:12:00Z
- **Completed:** 2026-09-27T05:50:00Z
- **Tasks:** 3
- **Files created/modified:** 29（22 新建 + 7 修改）

## Accomplishments

- **COMPLY-10 的门禁是机械的而不是约定的**：`compliance/publicness.json` 的四项状态经规范化 sha256 与 `acknowledged_hash` 双写，`tools/ci/publicness.mjs` 的四条断言链（`HASH_MATCHES` / `CHECKLIST_ADDED_ON_CHANGE` / `CHECKLIST_FULLY_CHECKED` / `USERS_WITHIN_CAP`）进了 fast.yml，脚本**没有任何写入能力**（一条 grep 断言守着）。
- **CHECKLIST 改成裁决制，于是基线首签不必撒谎**：勾选 = 「已裁决且留证」，裁决只有 `implemented` 与 `not_applicable`，后者**仅当四条抗辩全部成立时合法**。六条必需条目在 Phase 1 一条都没实装，所以基线首签如实记为六条 `not_applicable`；`monetized` 一旦变 `true`，同一份 checklist 立刻不够用。
- **RES-03 的扫描覆盖四种加表形态**：`ALTER ... ADD TABLE`、`CREATE ... FOR TABLE`、`FOR ALL TABLES`、`ADD TABLES IN SCHEMA`。只认第一种的扫描器会把后三种当成「没加过表」而放行。列清单里**解析不出 SQL 类型的列一律判失败** —— 无法证明它不是向量列就不放行。
- **动态检查不静默 skip**：库里没有 `research_pub` 时明确打印 `SKIP DYNAMIC_PUBLICATION_CHECK`，该 skip 登记进 `SKIPPED_CHECKS.md` 且解除条件含「Phase 7」与「删除本行」，另有一条 L4 断言守着那条登记存在、解除条件非空、且三条静态断言**没有**被 skip。
- **PIA 与四份 DPA 入 repo，未实装与未签署一律如实标注**：PIA 五章齐全、留存期注明不少于 3 年、两项不确定性各带解除条件（其中 GB 45438-2025 文本类隐式标识形态是**公开前的阻断项**）。DPA 按路由表四个 provider 各一份，双向集合断言 + 含 `openai` 的假路由表负向 fixture。
- **日对账只告警不写回**：判定与投递只有一份实现（`apps/api/src/worker/jobs/publicness-reconcile.ts`），CI 入口 import 它；载荷类型只有两个计数与两个布尔，编译期字段集合断言挡住「以后加个字段方便排查」。nightly 的占位分支改为直接调用，`nightly-publicness-reconcile` 因此解除。

## Task Commits

1. **Task 1: 公开性状态门 —— 哈希双写 + CHECKLIST 签字 + 四条断言链 + 三个坏样例** - `21c4c4d` (feat)
2. **Task 2: RES-03 publication DDL 静态扫描 + 两个假 SQL + 动态检查 skip 登记** - `be96784` (feat)
3. **Task 3: PIA 与 DPA 产出物 + 路由表集合断言 + registered_users 日对账** - `2df7ef5` (feat)

## Files Created/Modified

### 合规产出物
- `compliance/publicness.json` - COMPLY-10 四项状态真相源 + `acknowledged_hash` + `acknowledged_checklist`
- `compliance/CHECKLIST-TEMPLATE.md` - 六条必需条目的模板（集合一致性断言的比对基准）+ 裁决语义说明
- `compliance/CHECKLIST-2026-09-27.md` - 基线首签：四条抗辩的当前事实 + 六条逐条裁决与证据
- `compliance/PIA-2026.md` - 个人信息保护影响评估（223 行，五章 + 22 张表的处理目的清单 + 两项不确定性）
- `compliance/dpa/{volcengine-ark,zhipu,aliyun-dashscope,anthropic}.md` - 四份委托处理留档
- `compliance/no-unlabeled-output.md` - 新增第 5 条出口的逐条核实，`egress_hash` 同步为 `sha256:64cce2d3…`

### 检查脚本与被测对象
- `db/publication/research_publication.sql` - publication 唯一真相源（Phase 1 为显式空 publication）
- `tools/ci/publicness.mjs` - 四条断言链 + `--self-test`，零写入能力
- `tools/ci/publication-scan.mjs` - 三条静态断言 + `--file` / `--dynamic` / `--self-test`，SQL 注释先剥离
- `tools/ci/publicness-reconcile.mjs` - 日对账 CI 入口（`--dry-run` / `--actual N`），零写入能力
- `tools/ci/{publicness,publication-scan,compliance-docs}.test.ts` - 57 条 L4 契约断言
- `tools/ci/fixtures/publicness/*`、`tools/ci/fixtures/publication/*` - 五个负向 fixture（含 halfvec 假 schema）
- `apps/api/src/worker/jobs/publicness-reconcile.ts` - 对账逻辑、载荷类型与第五条出口（零 env 依赖）

### 接线与登记
- `.github/workflows/fast.yml` - 新增公开性门禁与 publication 扫描两步（各一次）
- `.github/workflows/nightly.yml` - 对账占位分支改为直接调用 + job summary
- `SKIPPED_CHECKS.md` - 解除 `nightly-publicness-reconcile`；新增 `DYNAMIC_PUBLICATION_CHECK` 与 `dpa-unsigned-for-enabled-providers`
- `packages/safety/src/egress.ts`、`tools/ci/egress-registry.test.ts`、`tools/ci/ci-workflow-guard.test.ts` - 第五条出口的登记与两条守卫测试的同步

## Decisions Made

见 frontmatter `key-decisions` 五条，已写入 STATE.md 的 Accumulated Context。最要紧的两条：

1. **裁决制 checklist** —— 让「如实签字」与「门禁通过」不再冲突，且抗辩破裂时门禁自动变严。
2. **DPA 的「必须已签」判据绑在 `enabled` 上** —— PLAT-05 不允许路由表留空洞，所以表里必然有尚未启用的 provider；委托处理在真实调用发生时才发生。未签缺口用 `SKIPPED_CHECKS.md` 登记，不用编造的 `signed_at` 掩盖。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - 正确性] 基线 CHECKLIST 改用真实日期，且六条条目改为裁决制而非「全部已勾选」**
- **Found during:** Task 1
- **Issue:** PLAN 指定 `compliance/CHECKLIST-2026-10-08.md` 且要求「必需条目全部已勾选」。两处都会产生虚假记录：签字日期在未来（今天是 2026-09-27）；而六条必需条目（安全评估 / 算法备案 / 未成年人模式 / 危机干预 / 2 小时提醒 / 申诉渠道）在 Phase 1 **一条都没实装**，勾选它们等于谎称已完成 —— 与在隐私文案里写「匿名」是同一性质的虚假陈述。
- **Fix:** 文件名用真实日期 `CHECKLIST-2026-09-27.md`；把勾选语义定义为「已裁决且留证」，裁决取值 `implemented` / `not_applicable`，并把「四条抗辩任一破裂时 `not_applicable` 非法」做成 `CHECKLIST_FULLY_CHECKED` 的第三个条件。基线首签如实记为六条 `not_applicable` 并逐条给出抗辩依据。
- **Files modified:** compliance/CHECKLIST-TEMPLATE.md, compliance/CHECKLIST-2026-09-27.md, compliance/publicness.json, tools/ci/publicness.mjs
- **Verification:** `tools/ci/publicness.test.ts` 的「四条抗辩破裂后 not_applicable 不再是合法裁决」两条用例；`publicness.mjs` 的断言不再依赖硬编码文件名而是读 `acknowledged_checklist`
- **Committed in:** `21c4c4d`

**2. [Rule 2 - 缺失关键] publication 扫描覆盖四种加表形态，而不只是 ALTER ... ADD TABLE**
- **Found during:** Task 2
- **Issue:** PLAN 只要求解析 `ALTER PUBLICATION ... ADD TABLE`。`CREATE PUBLICATION ... FOR TABLE` 是同一件事的另一种写法；`FOR ALL TABLES` 与 `ADD TABLES IN SCHEMA` 连表名都不必写。只认第一种的扫描器会把后三种当成「没有加过任何表」而完全放行 —— 那是比裸表名更彻底的绕过。
- **Fix:** 四种形态统一解析为成员项，后三种记为 `columns: null`（即裸表名）。另外先剥离 SQL 注释 —— 否则 `research_publication.sql` 文件头注释里的形态示例会被当成真实语句而让检查永远红。
- **Files modified:** tools/ci/publication-scan.mjs, tools/ci/publication-scan.test.ts
- **Verification:** 「绕过 ADD TABLE 的三种写法同样被抓」四条用例 + 「注释里的形态示例不会被解析成真实语句」
- **Committed in:** `be96784`

**3. [Rule 3 - 阻断] `L0_NO_VECTOR` 的输入源 `packages/db/src/inventory.ts` 尚不存在（DATA_INVENTORY 在 Plan 10）**
- **Found during:** Task 2
- **Issue:** PLAN 的 read_first 指向 `packages/db/src/inventory.ts`，但该文件不存在 —— `DATA_INVENTORY` 的包边界注释明确它由 Plan 10/11 落地。断言无输入源，会直接抛错。
- **Fix:** `loadInventory()` 在文件不存在时返回空清单并把 `source` 标为 `null`；断言在该情形下**如实打印「本条此刻是空真的」**而不是伪装成一次成功检查，非空真由 `--self-test` 的注入用例（`layer: 'l0'` + `halfvec(1024)`）与 `assertL0NoVector` 的两条注入测试证明。Plan 10 落地 `DATA_INVENTORY` 后无需改扫描器即自动接上。
- **Files modified:** tools/ci/publication-scan.mjs, tools/ci/publication-scan.test.ts, tools/ci/fixtures/publication/fake-vector-schema.ts
- **Verification:** `node tools/ci/publication-scan.mjs` 的 `L0_NO_VECTOR` 输出含「空清单」与「非空真由 --self-test 的注入用例证明」；注入向量列与注入不存在列两条用例均失败，注入非向量列通过
- **Committed in:** `be96784`

**4. [Rule 2 - 缺失关键] DPA 四份而非两份，且「必须已签」的判据绑在 `enabled` 上；两家已启用 provider 的未签缺口如实登记**
- **Found during:** Task 3
- **Issue:** PLAN 预期「两个 LLM provider」两份 DPA，但 `ROUTES` 里有四个（volcengine / zhipu / aliyun / anthropic）。按字面只写两份，集合断言必然红；而给未签的 aliyun / anthropic 写上 `data_used_for_training: false` + `signed_at` 会是编造法律事实。实际状态更进一步：两家**已启用**的 provider（volcengine / zhipu）也尚未签署协议、尚未捕获控制台配置证据。
- **Fix:** 四个 provider 各一份留档，front-matter 的 `data_used_for_training: false` 定义为**本项目对受托方的要求状态**（不是观测），观测结果放在 `status` 与 `evidence_captured_at`。集合断言分两级：所有 provider 必须有留档并含要求状态与证据章节（硬）；**已启用**且未签署的 provider 必须在 `SKIPPED_CHECKS.md` 有一条带解除条件的登记（硬）。新增 `dpa-unsigned-for-enabled-providers` 一行，解除条件含「首次以 `LLM_PROVIDER_MODE=live` 发起真实调用之前」与「删除本行」。
- **Files modified:** compliance/dpa/{volcengine-ark,zhipu,aliyun-dashscope,anthropic}.md, tools/ci/compliance-docs.test.ts, SKIPPED_CHECKS.md, compliance/PIA-2026.md
- **Verification:** 「已启用但未签署的 provider 必须在 SKIPPED_CHECKS.md 有一条带解除条件的登记」；「已启用、未签署、且登记被删掉 ⇒ 抛错」；四份留档的 `grep -c 'data_used_for_training: false'` 均非 0
- **Committed in:** `2df7ef5`

**5. [Rule 2 - 缺失关键] 对账告警登记为第五条 EGRESS_POINTS 出口并同步 egress_hash**
- **Found during:** Task 3
- **Issue:** PLAN 要求对账告警「走 notifyOperator 的同一 seam」。`notifyOperator(alert: AcuteAlert, …)` 的 `riskLevel` 恒为 `'crisis'`，拿它发对账告警要么谎报一次危机，要么把 `AcuteAlert` 放宽成能装任何东西的类型（后者直接废掉「载荷里不存在文本字段」这条编译期保证）。而新写一个投递函数就是**生产源码里一条新的出站网络路径** —— 不登记正是 `EGRESS_POINTS` 要防的失效模式。
- **Fix:** 新增 `deliverReconcileAlert(report, transport)`，载荷类型 `ReconcileReport` 只有两个计数与两个布尔，配 `RECONCILE_REPORT_FIELDS_MATCH_TYPE` 编译期字段集合断言。按 handoff #29 的流程登记为第五条出口（`carriesUserText: false`）：改 `egress.ts`、同步 `egress-registry.test.ts` 的两条快照断言、在 `compliance/no-unlabeled-output.md` 逐条核实并用 `egress-hash.mjs --print` 更新 `egress_hash`，全部在同一 commit。**刻意不抽 `postWecomText(content: string, …)`** —— 一个接受任意字符串的导出投递函数正是 GatedText 方案要堵的缺口（AST 扫描看不见 `string`）。
- **Files modified:** packages/safety/src/egress.ts, tools/ci/egress-registry.test.ts, compliance/no-unlabeled-output.md, apps/api/src/worker/jobs/publicness-reconcile.ts
- **Verification:** `node tools/ci/egress-hash.mjs --check` 退出 0（更新前它正确地以「未重新复核」失败）；`egress-registry.test.ts` 20 条全绿；`compliance-docs.test.ts` 的 (d) 交叉复核通过
- **Committed in:** `2df7ef5`

**6. [Rule 4 相邻 - 已在 SUMMARY 显式上报] 日对账不挂进 pg-boss schedule**
- **Found during:** Task 3
- **Issue:** PLAN 列出 `apps/api/src/worker/jobs/publicness-reconcile.ts` 作为「日作业」。但 `apps/api/Dockerfile` 只 COPY `packages/` 与 `apps/api/`，**不含 `compliance/`** —— 运行中的进程读不到 git 声明的 `registered_users`。注册 schedule 只有两种收场：给它一个编造的声明值（对账拿运行时计数与自己比，永远相等，正是本 plan 明令禁止的装饰性门禁），或者让作业每天失败一次。
- **Fix:** job 模块提供唯一一份判定、渲染与投递实现（CI 入口 import 它），并导出 `registerPublicnessReconcile(boss, deps)` 与 `PUBLICNESS_RECONCILE_QUEUE` / `PUBLICNESS_RECONCILE_CRON`（签名按 `node_modules/pg-boss` 的 `.d.ts` 实读），但**不在 `startWorker()` 里调用**；Phase 1 的执行点是 nightly workflow（它有完整工作树）。理由写在文件头注释里。
- **Files modified:** apps/api/src/worker/jobs/publicness-reconcile.ts, .github/workflows/nightly.yml
- **Verification:** `node tools/ci/publicness-reconcile.mjs --dry-run` 做出明确判定；`--actual 4` 与 `--actual 11` 分别产出 MISMATCH 与 OVER_CAP 并非零退出；`ci-workflow-guard.test.ts` 断言 nightly 已无占位分支
- **Committed in:** `2df7ef5`

**7. [Rule 1 - 正确性] PIA 中对被禁抗辩表述的引述改为不逐字写出**
- **Found during:** Task 3
- **Issue:** PIA 里为声明「这类抗辩不得使用」而逐字引述了那句话，于是 `compliance-docs.test.ts` 的禁用词扫描被 PIA 自己的说明命中（与 `egress-hash.mjs` 注释刻意不写出写入 API 名字是同一类问题）。
- **Fix:** 改写为「把『研究性质』当成适用范围抗辩的说法……被禁的是那句话本身，所以这里刻意不把它写出来」。
- **Files modified:** compliance/PIA-2026.md
- **Verification:** 「不含『…所以不适用』及其同义表述」用例通过
- **Committed in:** `2df7ef5`

---

**Total deviations:** 7 auto-fixed（2 条 Rule 1 正确性 / 3 条 Rule 2 缺失关键 / 1 条 Rule 3 阻断 / 1 条 Rule 4 相邻并已显式上报）
**Impact on plan:** 全部落在「让断言更强、让记录更诚实」这一个方向上，没有削弱任何一条 PLAN 要求的检查。两处需要编排器/人注意：① 两家已启用 provider 的 DPA 实际未签、证据未捕获（`dpa-unsigned-for-enabled-providers`，首次 live 调用前必须解除）；② 日对账目前只由 nightly 执行，运行时 schedule 待后续 plan 接线。

## Issues Encountered

- **`@drift/llm` 的包入口在 L4 层加载不起来**：它 `export * from './router.ts'`，后者拖进 `@drift/db`，而 `@drift/db` 在模块加载时读 `DATABASE_URL` 并构造连接池。`compliance-docs.test.ts` 因此改为按路径 import `packages/llm/src/routes.ts`（纯配置）。同一原因决定了 `publication-scan.mjs` 只 import `packages/db/src/schema/index.ts` 而不是 `@drift/db`。
- **五次「临时破坏再还原」中有一次改成了测试内注入**：「给 ROUTES 加一个 provider 名为 `openai` 的条目」在类型层不可表达 —— `ROUTES` 是 `Readonly<Record<SemanticRole, RouteConfig>>`，加第七个键会先撞 typecheck 而不是撞 DPA 集合断言。按 01-05 定下的做法（破坏验证写成测试内注入），改为给 `checkDpaCoverage` 喂一个含 `openai` 的假路由表，断言抛错且信息点名 `openai` 与「第二十一条」—— 于是这件事每个 PR 都在跑。另外四次（`monetized` 改 true 不改哈希 / `registered_users` 改 11 / publication 加裸表名 / 删掉 `DYNAMIC_PUBLICATION_CHECK` 登记行）都做了真实的临时改文件并逐一确认还原（`git diff --stat` 为空）。

## Authentication Gates

None - 本 plan 不触碰任何需要凭据的外部服务（`--dry-run` 与静态扫描都不连库、不发网络请求）。

## User Setup Required

PLAN frontmatter 无 `user_setup`，因此未生成 USER-SETUP.md。但有**两项必须由人完成的合规动作**，已登记在 `SKIPPED_CHECKS.md` 与 PIA 里，不是本执行器能代做的：

1. 与火山引擎、智谱签署数据处理协议，关闭两家控制台的「数据用于模型改进」开关，把截图与协议文本存入 `compliance/evidence/`，把两份 DPA 的 `status` 改为 `signed` —— **必须在首次以 `LLM_PROVIDER_MODE=live` 发起真实调用之前完成**（`dpa-unsigned-for-enabled-providers`）。
2. 向 GB 45438-2025 标准原文复核文本类隐式标识的载体要求 —— **公开前的阻断项**（PIA 不确定性 ①）。

## Self-Check: PASSED

| 检查 | 结果 |
|---|---|
| `pnpm run ci:fast` | exit 0；10 个 contract 文件 163 条断言 + 4 个 unit 文件 52 条断言全绿 |
| `node tools/ci/publicness.mjs` | exit 0，stdout 含 `OK 4/4 publicness gate` |
| `node tools/ci/publicness.mjs --self-test` | exit 0，四条断言 id 各被一个坏样例点名 |
| `node tools/ci/publication-scan.mjs` | exit 0，stdout 含 `OK 3/3 publication scan` 与 `SKIP DYNAMIC_PUBLICATION_CHECK` |
| `node tools/ci/publication-scan.mjs --self-test` | exit 0，三条断言 id 各被一个坏样例点名 |
| `pnpm -w exec vitest run tools/ci/compliance-docs.test.ts` | 18 passed |
| `node tools/ci/publicness-reconcile.mjs --dry-run` | exit 0，`OK registered_users reconciled`（并如实标注未连库） |
| 破坏验证 1：`monetized` 改 true 不改哈希 | `FAIL HASH_MATCHES` + `FAIL CHECKLIST_FULLY_CHECKED`，exit 1；已还原 |
| 破坏验证 2：`registered_users` 改 11 | `FAIL USERS_WITHIN_CAP`，exit 1；已还原 |
| 破坏验证 3：publication 加一行裸表名 | `FAIL NO_BARE_TABLE` 并点名 `message`，exit 1；已还原 |
| 破坏验证 4：ROUTES 加 `openai`（测试内注入） | `checkDpaCoverage` 抛错，信息含 `openai` 与「第二十一条」|
| 破坏验证 5：删掉 `DYNAMIC_PUBLICATION_CHECK` 登记行 | `publication-scan.test.ts` 1 failed；已还原（`git diff --stat` 为空）|
| `grep -c 'writeFile' tools/ci/publicness.mjs` | 0 |
| `grep -c 'git commit\|writeFile' tools/ci/publicness-reconcile.mjs` | 0 |
| `grep -c 'data_used_for_training: false' compliance/dpa/{volcengine-ark,zhipu}.md` | 各 2（非 0）|
| key-files.created 逐个 `[ -f ]` | 22/22 存在 |
| `git log --oneline --grep='01-13'` | 3 条 task commit |
| `node tools/ci/egress-hash.mjs --check` | exit 0（第五条出口登记后同步）|

## Next Phase Readiness

**Ready for 01-07**（Phase 01 还有 15-6=9 个 plan 未完成；本 plan 是 wave 9，`depends_on: [01-05]` 已满足）。

给后续 plan 的四条：

1. **Plan 10（DATA_INVENTORY）**：`packages/db/src/inventory.ts` 落地后 `L0_NO_VECTOR` 会自动从「空清单」切到真实清单，扫描器无需改动；但 PIA 第 1 节的逐表清单必须按 `DATA_INVENTORY` 重新导出并复核（两份不一致时以被 CI 断言守着的那一份为准）。
2. **Plan 07 / 之后**：`registerPublicnessReconcile(boss, deps)` 已备好（签名按 pg-boss `.d.ts` 实读），接线需要先把 git 声明的 `registered_users` 带进运行时 —— 要么在 `apps/api/Dockerfile` 加一行 COPY `compliance/publicness.json`，要么经配置注入。
3. **任何新增 provider 的 plan**：先加 `compliance/dpa/<provider>.md`（front-matter 四键 + 配置证据章节），再改 `routes.ts`；把 `enabled` 改成 `true` 而协议 `status` 不是 `signed` 且没有登记 ⇒ ci:fast 变红。
4. **任何新增出站网络路径的 plan**：按 handoff #29 的三步走（逐条核实 → `egress-hash.mjs --print` → 同一 commit），并注意 `egress-registry.test.ts` 里有一条硬编码 id 顺序的快照断言需要同步。`egress_hash` 当前值 `sha256:64cce2d35c35482f61df8ff06fc1a8a7589a65b4fd187d62b840533d7db0a70c`。

---
*Phase: 01-compliance-safety-chat-skeleton*
*Completed: 2026-09-27*
