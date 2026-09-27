---
phase: 01-compliance-safety-chat-skeleton
plan: 15
subsystem: compliance
tags: [privacy-policy, terms-of-service, priv-06, priv-07, priv-10, priv-11, vitest, negative-fixture]

# Dependency graph
requires:
  - phase: 01-01
    provides: UI-SPEC ## Copywriting Contract 里新增的 PRIV-11 运营者通知披露行与 PRIV-10 受托方清单引导句 —— 本 plan 四条必需句的权威来源
  - phase: 01-05
    provides: packages/llm/src/routes.ts 的 ROUTES —— PRIV-10 受托方清单的 provider 集合来源
  - phase: 01-04
    provides: packages/db/src/schema/*.ts 的 22 张表 —— privacy.md「我们收集什么」章节逐项对齐的对象
provides:
  - apps/web/content/legal/privacy.md（隐私政策正文，Plan 09 的 policy_version 内容哈希唯一来源）
  - apps/web/content/legal/terms.md（服务协议正文，basic_service 同意项指向的对象）
  - checkRequiredSentences 纯函数与四层正向存在性断言（文件非空 → 字符数 → 章节 → 四条必需句）
  - tools/ci/fixtures/legal-missing-sentence.md（V.0 #8 后一半的缺句负向 fixture）
  - SKIPPED_CHECKS.md 的 legal-collected-section-matches-inventory 登记行
affects: [01-09 注册与 policy_version, 01-10 隐私中心与禁用词三重扫描, 01-11 导出与删除]

actuals:
  tokens: 4157
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "契约文本的权威来源是 01-UI-SPEC.md，断言在运行时从它提取，不把文本抄进测试常量"
    - "「改坏它会变红」写成测试内注入（每个 PR 都跑），不是执行者手上的一次临时改文件"

key-files:
  created:
    - apps/web/content/legal/privacy.md
    - apps/web/content/legal/terms.md
    - tools/ci/legal-required-sentences.test.ts
    - tools/ci/fixtures/legal-missing-sentence.md
  modified:
    - SKIPPED_CHECKS.md

key-decisions:
  - "四条必需句由测试在运行时从 01-UI-SPEC.md ## Copywriting Contract 逐行提取，不抄进测试常量；提取不到对应行即抛错"
  - "PRIV-10 引导句一个字不改，{受托方清单} 填入 ROUTES 全部四家；清单的精度由紧随其后的一段正文承担"
  - "破坏验证（清空正文 / 删掉 PRIV-11 必需句）写成测试内注入，privacy.md 的 spec 相应改为惰性函数"
  - "三个尚无数据流的同意项按「你已经授权，我们目前还没有开始收集这项数据」写，不写成正在收集"

patterns-established:
  - "正向存在性断言分四层递进：statSync().size > 0 → 字符数下限 → 必需章节 → 必需句逐字在场。缺任一层，上一层就是空真的"
  - "纯函数 + spec 参数化：同一个 checkRequiredSentences 既吃真实正文（严 spec）也吃负向 fixture（宽 spec），两个方向各自可断言"
  - "断言的失败信息必须点名缺的是哪一条句子/哪一个章节 —— 说不出缺了什么的断言在变红时无法指导修复"

requirements-completed: [PRIV-06, PRIV-07, PRIV-10, PRIV-11]

coverage:
  - id: D1
    description: "隐私政策正文 apps/web/content/legal/privacy.md：九个必需章节、四条法定必需句逐字在场、收集清单逐项对齐 Plan 04 的 schema 并标注同意项依据、保存期对齐 D-17 四层"
    requirement: "PRIV-06"
    verification:
      - kind: other
        ref: "tools/ci/legal-required-sentences.test.ts#(a) 两份法务正文存在且非空 / (b) 字符数下限 / (c)(d) privacy.md 的章节与四条必需句"
        status: pass
      - kind: other
        ref: "tools/ci/legal-required-sentences.test.ts#(f) 最小自查：两份正文不含规则 1 的禁用词"
        status: pass
    human_judgment: true
    rationale: "D-16 明文规定正文由 Claude 起草、**由用户审定**，公开上线前另取专业法律意见。机器能证明章节与必需句在场、不含禁用词、收集清单与 schema 对得上；不能证明「这份告知对一个真实用户是充分的」。这是这份交付物的核心价值所在，必须由人判断。"
  - id: D2
    description: "服务协议正文 apps/web/content/legal/terms.md：服务是什么/不是什么（明写「这是 AI 角色扮演服务，对面不是真人」）、18 周岁准入、可接受使用、可用性不作承诺、终止与删除、争议解决"
    verification:
      - kind: other
        ref: "tools/ci/legal-required-sentences.test.ts#(a)(b)(f) 对 terms.md 的三条断言"
        status: pass
    human_judgment: true
    rationale: "同 D1：条款的实质合适性（尤其是责任限制与争议解决两节）需要用户审定与公开上线前的法律意见，不是字符数与词表能判的事。"
  - id: D3
    description: "PRIV-06 的正向存在性断言链与缺句负向 fixture：checkRequiredSentences 纯函数 + 四层递进断言 + 受托方集合相等 + 两条测试内注入的破坏验证"
    requirement: "PRIV-06"
    verification:
      - kind: unit
        ref: "tools/ci/legal-required-sentences.test.ts（12 tests，pnpm -w exec vitest run）"
        status: pass
      - kind: unit
        ref: "tools/ci/legal-required-sentences.test.ts#(e) 负向 fixture：缺一条必需句必须判失败"
        status: pass
      - kind: other
        ref: "pnpm run ci:fast（typecheck + lint + unit 52 + contract 175，退出 0）"
        status: pass
    human_judgment: false
  - id: D4
    description: "SKIPPED_CHECKS.md 新增 legal-collected-section-matches-inventory 一行（与 DATA_INVENTORY 的集合相等断言待 Plan 10 Task 2 接入）"
    verification:
      - kind: other
        ref: "grep -c 'legal-collected-section-matches-inventory' SKIPPED_CHECKS.md → 1；表列数校验 awk -F'|' 全表恒为 6"
        status: pass
    human_judgment: true
    rationale: "grep 只证明这一行在场。「解除条件是否真的可判定」这一条是登记规则的实质要求，需要人读一遍那句话 —— 一条写成「以后再说」的解除条件同样能通过 grep。"

duration: 21 min
completed: 2026-09-27
status: complete
---

# Phase 01 Plan 15: 法务正文与 PRIV-06 正向存在性断言 Summary

**隐私政策与服务协议正文落地（四条必需句在运行时从 UI-SPEC 提取、PRIV-10 受托方清单按 ROUTES 填充），并配一条四层递进的正向存在性断言与缺句负向 fixture —— Plan 09 的 policy_version 从此有了真实、非空、内容正确的哈希来源。**

## Performance

- **Duration:** 21 min
- **Started:** 2026-09-27T05:54:00Z
- **Completed:** 2026-09-27T06:16:00Z
- **Tasks:** 2
- **Files modified:** 5（新建 4，修改 1）

## Accomplishments

- **两份法务正文就位且非空。** privacy.md 4761 字符 / 124 行，九个必需章节齐全；terms.md 1972 字符 / 73 行。两份都不用通用模板起头，不含感叹号与 emoji，不含「匿名 / anonymous / 无法关联到你」，正文里没有任何 TODO / 待补 / 待定 / Lorem 一类占位串。
- **四条法定必需句与 UI-SPEC 逐字绑定，且绑定方式是机械的。** 测试在运行时从 `01-UI-SPEC.md` 的 `## Copywriting Contract` 表里逐行提取 L0 说明句、PRIV-07 人格派生物披露句、PRIV-11 运营者通知句、PRIV-10 受托方清单引导句；句子没有第二处定义，UI-SPEC 改了这条断言就红。
- **PRIV-10 受托方清单来自已落地的路由表而不是记忆。** 清单里的 provider 集合由一条集合相等断言钉在 `ROUTES` 中 mock 之外的四家上（`aliyun` / `anthropic` / `volcengine` / `zhipu`），并额外断言逐项计数相等与正文不残留 `{受托方清单}` 占位符。
- **PRIV-06 最严重的静默失效被双向证明。** 正向：`statSync().size > 0` → 字符数下限 → 九个必需章节 → 四条必需句逐字在场，四层递进。负向：缺 PRIV-11 那一条的 fixture 喂给同一个纯函数必须判失败且 `missing` 长度恰为 1。另加两条测试内注入的破坏验证，把「改坏它会变红」从一次性人工动作变成每个 PR 都跑的断言。
- **与 DATA_INVENTORY 的集合相等断言如实登记为待接入项**，解除条件指向 Plan 10 Task 2 的具体断言原文，而不是「以后再说」。

## Task Commits

1. **Task 1: 起草 privacy.md 与 terms.md 正文** - `2c409a2` (feat)
2. **Task 2: 正向存在性断言 + 缺句负向 fixture + SKIPPED_CHECKS 登记** - `6357586` (test)

**Plan metadata:** 见本次 docs 提交。

## Files Created/Modified

- `apps/web/content/legal/privacy.md` - 隐私政策正文。九章：我们是谁与适用范围 / 我们收集什么 / 为什么收集 / 保存多久 / 我们会把它给谁 / 危机情况下会通知谁 / 人格是怎么来的 / 你可以做什么 / 怎么联系我们与申诉。是 Plan 09 `policy_version` 内容哈希的唯一来源。
- `apps/web/content/legal/terms.md` - 服务协议正文。明写「这是 AI 角色扮演服务，对面不是真人」、18 周岁准入、可用性不作承诺、不挽留是写进产品的硬约束而非客服话术。
- `tools/ci/legal-required-sentences.test.ts` - 导出纯函数 `checkRequiredSentences(text, spec)` 与 `normalizeCopy(text)`；12 条断言覆盖 (a)-(f) 与两条注入式破坏验证。
- `tools/ci/fixtures/legal-missing-sentence.md` - 含三条必需句、故意缺 PRIV-11 那一条的最小片段（V.0 #8 的后一半）。
- `SKIPPED_CHECKS.md` - 新增 `legal-collected-section-matches-inventory` 一行（第 6 行）。

## Decisions Made

1. **四条必需句由测试在运行时从 UI-SPEC 提取，不抄进测试常量。** 抄进测试等于制造第二处定义 —— 改 UI-SPEC 时测试不会变红，而「绑定到过时契约的断言在测试全绿时不会被任何人发现」正是 Plan 01 要消灭的失效模式。手法与 `design-tokens.test.ts` 一致（该文件已有先例：tools/ci 测试读 `.planning/` 下的 UI-SPEC）。提取不到对应行即抛错并点名那一行的 label。

2. **PRIV-10 引导句一个字不改，清单填入路由表全部四家，精度由相邻正文承担。** 验收要求清单集合等于 `ROUTES` 中 mock 之外的 provider 集合，而引导句字面说的是「会把你和它说的话交给下面这些模型服务商处理」—— 对尚未启用的 `aliyun` 与只接收合成文本的 `anthropic` 而言，那句话此刻并不准确。三条路里：改写引导句会让政策与界面文案分叉（T-15-03 要防的就是这个）；只列已启用的两家会让集合相等断言变成永远可被「先不启用」绕过的检查；因此选第三条 —— 引导句逐字不动，紧接一段正文如实写明「目前真正在处理你的话的只有两家」、`aliyun` 还没有收到过任何内容、`anthropic` 在境外且在代码的类型层面就传不进真实原文，并明写「你和角色说的话不出境」。

3. **破坏验证写成测试内注入，spec 相应改为惰性函数。** 临时改文件只证明了执行那一刻（handoff #28 的同类处置）。改成注入后每个 PR 都证明一次。惰性求值是必要的：写成模块级常量时，0 字节的 privacy.md 会让 `requiredSentencesFor` 在**收集阶段**抛错，(a) 的「size 大于 0」永远没机会跑，报错信息就成了「找不到引导句前半截」而不是真正的原因 —— 这一点是实测发现的，第一版就是这个形态。

4. **三个尚无数据流的同意项写成「你已经授权，我们目前还没有开始收集这项数据」。** `research_l0` / `research_l1` / `persona_evolution` 在 Phase 1 都没有对应的写入路径，写成「正在收集」是一次虚假陈述（与 T-15-04 同源）。

5. **「我们收集什么」按 Plan 04 已落地的 22 张表逐项写，每一行标注依据。** 依据只有两类：五个同意项中的某一项，或「合同履行必要」。后者显式说明「不随同意项撤回而停止，但随账号删除一起删除」。`llm_call` 与 `client_error` 两行特意写明「这张表里没有正文，只有哈希 / 只有枚举」—— 这两条是 Plan 04/05 刻意设计的取舍，写进政策才算真的告知。

## Deviations from Plan

None - plan executed exactly as written.

其中有两处需要说明的**判断**（不是偏离，但把裁决过程记下来）：

- PLAN 的 must_haves 要求「PRIV-10 的受托方清单逐个列出 ROUTES 里出现的 provider 名（mock 除外）」，验收又要求集合相等。这与引导句字面语义在 `aliyun` / `anthropic` 两家上存在张力（见 Decisions #2）。处理方式是完整满足验收断言，同时用紧随其后的正文消除不准确，而不是修改引导句或裁剪清单。
- PLAN 的 Task 2 列了断言 (a)-(f) 六条。实际交付 12 条 test（(a)(b)(f) 各按两份文件拆成两条，(c)(d) 拆成章节句子 / 占位符残留 / 受托方集合相等三条，(e) 加两条注入式破坏验证）。这是同一批断言的更细粒度拆分，没有超出 (a)-(f) 的范围；拆细的理由是失败时能直接指出是哪一份文件的哪一层出了问题。

## Issues Encountered

1. **第一版把 privacy.md 的 spec 写成模块级常量，导致 0 字节破坏验证的报错指错了原因。** 清空 privacy.md 后测试确实变红，但红在收集阶段的 `trusteeListIn` 抛错（「找不到 PRIV-10 引导句的前半截」），而 (a) 的「size 大于 0」这条本该第一个报账的断言根本没跑。改为惰性函数后，同一次破坏产出 6 条失败，第一条就是「privacy.md 是 0 字节 —— 这正是 PRIV-06 最严重的静默失效」。这个改动本身写进了代码注释，因为下一个人很容易把它改回常量。
2. **起草时把「我们收集了哪些东西」误写成「我们到哪些东西」**，在字数与断言核验环节读出来并修掉。这类错字不在任何断言的覆盖范围内 —— 法务正文的语言质量最终仍依赖人读（D-16 的「由用户审定」）。

## Authentication Gates

None - 本 plan 零外部服务调用、零新增依赖。

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Plan 09（wave 6）可以直接算 `policy_version`。** `apps/web/content/legal/privacy.md` 存在、12573 字节、内容正确，fail-loud 分支（文件缺失即抛错）不会落在它必须自证的 happy path 上，不需要占位文件、不需要 setup 期写 fixture、也不需要在 SKIPPED_CHECKS.md 登记「policy_version 依赖未来的 plan」。
- **Plan 10（wave 7）的三件事已备好左侧。** ① 两份正文是 `scanBannedTerms` 的被测对象（本 plan 只做了规则 1 的最小自查，规则 2/3/4、渲染层与归一化扫描仍属 Plan 10）；② 「我们收集什么」章节是与 `DATA_INVENTORY` 集合相等断言的左侧，登记行的解除条件写明了断言原文；③ `normalizeCopy` 与 `checkRequiredSentences` 两个导出纯函数可直接复用，不必另写一份归一化。
- **要点提醒给 Plan 10：** `DATA_INVENTORY` 必须建在 `packages/db/src/inventory.ts`（handoff #39），且 `legal/[doc]/page.tsx` 渲染页与它的渲染层禁用词断言属 Plan 10 Task 2 —— 本 plan 刻意没建渲染页，wave 5 的前端路由骨架还不具备渲染目标。
- **SKIPPED_CHECKS.md 现有 7 行**（新增 1 行，未解除任何现有行）。本 plan 没有解除既有登记项，也没有改动任何 `.github/workflows/*.yml`。
- **PRIV-06 / PRIV-07 / PRIV-11 三项仍标 Pending**：它们同时被 01-10-PLAN.md 声明，按共享 ID 门禁（#2388）要等 01-10 出 SUMMARY 后才能置 Complete。本 plan 只把 **PRIV-10** 置为 Complete（01-13 已完成，本 plan 是最后一个声明者）。

## Self-Check: PASSED

| 检查 | 结果 |
|---|---|
| `key-files.created` 四个文件在磁盘上存在 | PASS（`test -f` 四个全 true） |
| `git log --oneline --all --grep="01-15"` ≥ 1 commit | PASS（2 个任务提交） |
| Task 1 全部 `<verify>` 重跑 | PASS：`BOTH_NONEMPTY`；`grep -c 去标识化` = 1；`grep -c 不包含你和角色说过的任何内容` = 1；`grep -c '{受托方清单}'` = 0；禁用词计数 = 0 |
| Task 1 全部 `<acceptance_criteria>` | PASS：privacy 4761 ≥ 3000 字符、terms 1972 ≥ 1500 字符、九章齐全、四句逐字一致（由测试从 UI-SPEC 提取后比对）、收集清单逐行标注依据且三个可选 scope 写「尚未开始收集」、四层保存期与 D-17 逐项一致、受托方集合 = ROUTES 减 mock、无感叹号与 emoji、无占位串 |
| Task 2 断言 (a)-(f) | PASS（12 tests passed） |
| 破坏验证：privacy.md 清空为 0 字节 | PASS（6 条失败，首条点名「是 0 字节」）；已用 /tmp 备份还原，`git diff --quiet` 干净 |
| 破坏验证：删掉 PRIV-11 必需句 | PASS（2 条失败，报错含「缺少必需句：触发二级危机…」全句）；已还原，`git diff --quiet` 干净 |
| `checkRequiredSentences` 不读盘不连库 | PASS（函数体只做字符串运算，fixture 直接喂输入） |
| 缺句 fixture 让 (e) 判失败且 `missing` 长度恰为 1 | PASS（`toEqual([\`缺少必需句：${OPERATOR_SENTENCE}\`])`） |
| SKIPPED_CHECKS 新增行四列齐全 | PASS（`awk -F'|'` 全表列数恒为 6；解除条件引用 Plan 10 Task 2 的断言原文） |
| 未改动任何 `.github/workflows/*.yml` | PASS（`git diff HEAD~2 --stat` 无 workflow 文件） |
| plan 级 `<verification>` 第 3 条 | PASS（`statSync().size` = 12573 > 0） |
| plan 级 `<verification>` 第 4 条 | PASS（`pnpm run ci:fast` 退出 0；unit 52 passed、contract 175 passed） |

---
*Phase: 01-compliance-safety-chat-skeleton*
*Completed: 2026-09-27*
