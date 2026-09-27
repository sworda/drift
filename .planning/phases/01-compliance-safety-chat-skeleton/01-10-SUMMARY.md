---
phase: 01-compliance-safety-chat-skeleton
plan: 10
subsystem: privacy
tags: [data-inventory, privacy-center, banned-terms, rtl, drizzle, consent, priv-06, res-02]

# Dependency graph
requires:
  - phase: 01-09
    provides: 五项同意的撤回语义与 /me/consents 路由、CONSENT_SCOPES 唯一定义（@drift/contract）、better-auth 注册链路
  - phase: 01-15
    provides: apps/web/content/legal/privacy.md 与 terms.md 正文、checkRequiredSentences/normalizeCopy 纯函数、四条必需句的运行时提取断言
  - phase: 01-04
    provides: 22 张表的 drizzle schema（注册表的对账对象）
provides:
  - packages/db/src/inventory.ts —— DATA_INVENTORY（165 条个人信息列条目 + 显式豁免清单）、assertInventoryInvariants 四条双向断言、buildCollectedView 视图构造（全部纯函数）
  - @drift/db 的 ./inventory 纯子路径导出（apps/web 不加载连接池即可共享这一份注册表）
  - packages/safety/src/banned-terms.ts —— 规则 1–4 词表 + scanBannedTerms（一份定义、两个消费者：tools/ci 源码层 + apps/web 渲染层）
  - privacy.md「我们收集什么」与 humanLabel 集合的**双向集合相等**断言（解除了 legal-collected-section-matches-inventory 登记）
  - legal/[doc]/page.tsx —— 手写最小 markdown 渲染（零新依赖、只读本地文件、不 truncate）
  - 隐私中心：四个分区 Tabs、服务端驱动的「我们收集了什么」清单、第三态「已授权 · 尚未开始收集」、五个逐项撤回开关（受控回弹）
  - GET /me/collected（由 DATA_INVENTORY 生成，无第二份清单）
affects: [01-11 导出与删除, 01-12 网关 conversationStatus 内移, 01-14 遥测]

actuals:
  tokens: 32000
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "注册表 + 纯函数断言：DATA_INVENTORY 的四条双向断言全部接受注入输入，每条都有测试内负向证明（handoff #28 的手法）"
    - "一份定义、两个消费者：禁用词表住 packages/safety（源码层与渲染层共享）；视图构造住 packages/db/inventory（服务端与 RTL 共享）"
    - "受控 Switch：checked 只由服务端状态驱动，乐观翻转在结构上写不出来（T-10-06）"
    - "第三态方向由真实注册表派生 + 注入式翻转证明 —— Phase 7 接研究管道时断言自动提醒改文案"

key-files:
  created:
    - packages/db/src/inventory.ts
    - packages/safety/src/banned-terms.ts
    - tools/ci/data-inventory.test.ts
    - tools/ci/banned-terms.test.ts
    - tools/ci/privacy-ui-contract.test.ts
    - tools/ci/fixtures/inventory-l0-vector.ts
    - tools/ci/fixtures/legal-with-anonymous.md
    - apps/web/src/app/(app)/legal/[doc]/page.tsx
    - apps/web/src/app/(app)/privacy/page.tsx
    - apps/web/src/features/privacy/collected-list.tsx
    - apps/web/src/features/privacy/consent-switches.tsx
    - apps/web/src/features/privacy/tabs.tsx
    - apps/web/src/features/privacy/copy.ts
    - apps/web/src/features/privacy/banned-render.test.tsx
    - apps/web/src/features/privacy/privacy-render.test.tsx
    - apps/web/src/components/ui/switch.tsx
    - apps/api/src/modules/privacy/inventory-routes.ts
  modified:
    - packages/db/src/index.ts（+ inventory 导出）
    - packages/db/package.json（+ ./inventory 子路径导出）
    - packages/safety/src/index.ts（+ banned-terms 导出）
    - apps/web/content/legal/privacy.md（「我们收集什么」与注册表对齐）
    - apps/web/content/legal/terms.md（移除规则 2 的字面命中）
    - apps/api/src/http/app.ts（挂载 privacy 路由）
    - tools/ci/check-contract-amendments.mjs（A-02 两态修复）
    - SKIPPED_CHECKS.md

key-decisions:
  - "DATA_INVENTORY 落在 packages/db/src/inventory.ts（handoff #39 的指定位置），四条断言与视图构造做成纯函数；@drift/db 以 ./inventory 纯子路径导出给 apps/web —— 包入口「加载即读 DATABASE_URL」的边界保持不动，动的是可达性不是约束"
  - "privacy.md「我们收集什么」表只列当前真实收集的 12 类，与 humanLabel 集合双向相等；三个尚无数据流的同意项移到表后的如实披露段 —— 把 5 项同意渲染成 5 组「我们收集了…」等于披露尚未发生的收集（T-10-03）"
  - "禁用词扫描核心定义在 packages/safety 而非 tools/ci 的测试文件：渲染层断言在 apps/web、源码层在 tools/ci，两个消费者必须共享同一张词表，而 import 另一个 .test 文件会让 vitest 重复执行被引文件的用例"

patterns-established:
  - "纯子路径导出破「包入口拉连接池」的局：packages/db 的 schema/inventory 等纯模块经显式子路径暴露，消费方按需选择不加载 client.ts"
  - "「断言方向由注册表派生 + 注入式翻转证明」：第三态断言读真实 DATA_INVENTORY，同时用一个注入的 research_l0 条目证明方向真的会翻转（Phase 7 的自动提醒机制）"
  - "受控开关的回弹：撤回失败不是把 Switch 置灰，而是它从未离开服务端值"

requirements-completed: [PRIV-03, PRIV-06, PRIV-07, PRIV-11, RES-02]

coverage:
  - id: D1
    description: "DATA_INVENTORY 注册表覆盖 Plan 04 全部 22 张表的每一列（个人信息 165 条 + 显式豁免），四条双向断言对真实 schema 通过且各有注入式负向证明"
    requirement: "PRIV-03"
    verification:
      - kind: unit
        ref: "tools/ci/data-inventory.test.ts（16 tests：真实 schema 四条断言 + 5 个注入式负向 + 视图构造 7 条）"
        status: pass
    human_judgment: false
  - id: D2
    description: "RES-02：layer 为 l0 的条目禁向量列的断言在 Phase 1 空真，由负向 fixture（假 l0 表 + halfvec(1024)）证明活着；SKIPPED_CHECKS 登记空真状态与可判定解除条件"
    requirement: "RES-02"
    verification:
      - kind: unit
        ref: "tools/ci/data-inventory.test.ts#第 4 条（RES-02 负向 fixture）：l0 层出现 halfvec 列 ⇒ 抛错，信息含列名与 halfvec"
        status: pass
      - kind: other
        ref: "grep -c halfvec tools/ci/fixtures/inventory-l0-vector.ts → 6"
        status: pass
    human_judgment: false
  - id: D3
    description: "privacy.md「我们收集什么」与 DATA_INVENTORY 的 humanLabel 集合双向相等（漏列与多列都失败且各自点名）"
    requirement: "PRIV-03"
    verification:
      - kind: unit
        ref: "tools/ci/data-inventory.test.ts#privacy.md「我们收集什么」与 DATA_INVENTORY 的集合相等（两个方向的差集都为空 + 注入式非空真）"
        status: pass
      - kind: unit
        ref: "tools/ci/legal-required-sentences.test.ts（12 tests，本 plan 改写正文后复跑全绿 —— 必需句未被动）"
        status: pass
    human_judgment: false
  - id: D4
    description: "PRIV-06 的否定式与渲染层：源码层扫描 apps/web 四类文案来源（去注释、归一化），渲染层对两份政策页与隐私中心页的 textContent 跑同一张词表；含「匿名」的负向 fixture、拆空格与全角字符的归一化反例"
    requirement: "PRIV-06"
    verification:
      - kind: unit
        ref: "tools/ci/banned-terms.test.ts（10 tests）"
        status: pass
      - kind: automated_ui
        ref: "apps/web/src/features/privacy/banned-render.test.tsx（5 tests：两份政策页 + 隐私中心页三个渲染目标 + 注入式非空真 + 不截断）"
        status: pass
      - kind: other
        ref: "破坏验证：privacy.md 清空为 0 字节 → legal-required-sentences 6 条失败 → 还原后 12/12（「文件缺失或为空时 grep 通过」守卫）"
        status: pass
    human_judgment: false
  - id: D5
    description: "GET /me/collected：清单由 buildCollectedView(DATA_INVENTORY) 生成，判定「确有写入路径」的依据是注册表条目数，不引入第二份清单"
    requirement: "PRIV-03"
    verification:
      - kind: unit
        ref: "tools/ci/data-inventory.test.ts#视图构造（7 条：第三态来源、撤回消失、注入翻转、五项各出现一次）"
        status: pass
      - kind: other
        ref: "tools/ci/privacy-ui-contract.test.ts#GET /me/collected 已挂载且由 DATA_INVENTORY 生成（源码形态断言）"
        status: pass
    human_judgment: true
    rationale: "路由本身没有独立的 integration 测试（本 plan 的 verify 未要求）：currentUserId + db select 的包装沿用了 /me/consents 的既有模式，纯函数侧已穷举；「带真实登录态打这条路由返回正确清单」需要 L5 集成用例补上，属后续验证面。"
  - id: D6
    description: "隐私中心 UI：(a) 第三态方向由真实 DATA_INVENTORY 派生且注入翻转证明；(b) 撤回后条目从 DOM 消失且无 aria-disabled 残留；(c) 撤回失败 Switch 回弹 + 「仍在继续」文案；(d) 每分区恰一个 20px、导出分区恰一个 accent、删除入口不吃 accent；(e) 无 truncate 类"
    requirement: "PRIV-03"
    verification:
      - kind: automated_ui
        ref: "apps/web/src/features/privacy/privacy-render.test.tsx（7 tests，(a)–(e) 全覆盖）"
        status: pass
      - kind: unit
        ref: "tools/ci/privacy-ui-contract.test.ts（9 tests：文案与 UI-SPEC 逐字绑定、无 humanLabel 字面量、清单视图类型单一来源）"
        status: pass
    human_judgment: false
  - id: D7
    description: "隐私中心的实际观感（布局、四分区导航的手感、第三态呈现是否一目了然）"
    verification: []
    human_judgment: true
    rationale: "RTL 断言证明结构契约（20px 恰一、accent 恰一、无截断），不证明「这个界面看起来对」—— 需要人在容器里打开 /privacy 走一遍四个分区。"

duration: 1h 35m
completed: 2026-09-27
status: complete
---

# Phase 01 Plan 10: 数据清单注册表 + 禁用词三重检查 + 隐私中心 Summary

**DATA_INVENTORY 以表×列粒度登记了 22 张表的全部 165 个个人信息列（另有显式豁免清单），四条双向断言让「新增列不登记」「改名不同步」「l0 存向量」都在构建期失败；privacy.md 的「我们收集什么」与注册表双向集合相等，三个尚无数据流的同意项在政策与界面上都以第三态如实呈现 —— 披露与实现漂移这件事从此由机器守着。**

## Performance

- **Duration:** 1h 35m
- **Started:** 2026-09-27T11:25:00Z
- **Completed:** 2026-09-27T13:00:00Z
- **Tasks:** 3
- **Files created/modified:** 21（6 次提交合计）

## Accomplishments

- **注册表与四条双向断言。** packages/db/src/inventory.ts 用表×列粒度覆盖 Plan 04 全部 22 张表：165 个含个人信息的列进 DATA_INVENTORY（12 个 humanLabel、逐列的 purpose / consentScope / retention / isSensitive / layer），22 个非个人信息列与 3 处非表存储（pino 日志 / 导出目录 / pgboss 载荷）进 NON_PERSONAL_COLUMNS 且逐条带理由。四条断言（schema→注册表、注册表→schema、retention 合法形态、l0 禁向量）是**纯函数**，每条都有测试内注入的负向证明 —— 不是执行者手上跑过一次的临时改文件。
- **空真断言的活性证据。** RES-02 的 l0 禁向量断言在 Phase 1 没有被测对象，tools/ci/fixtures/inventory-l0-vector.ts 用 customType 造出一个 getSQLType() 真的返回 halfvec(1024) 的假表喂给同一个纯函数 —— 走的是与真实 schema 完全相同的代码路径。空真状态登记进 SKIPPED_CHECKS，解除条件写成可判定事实（注册表出现第一条 l0 条目时，「Phase 1 现实」断言自己会红）。
- **政策正文与注册表对齐。** privacy.md「我们收集什么」表删掉了三行「尚未开始收集」的同意项（它们与写「匿名」同性质：披露尚未发生的收集），改为表后一段如实说明；留下的 12 行与 humanLabel 集合**双向相等**且被 CI 断言。四条必需句与九个章节一个字未动（Plan 15 的断言复跑 12/12）。
- **禁用词三重检查。** 源码层（apps/web 四类扩展名、去注释、归一化）+ 渲染层（两份政策页与隐私中心页的 textContent 跑同一张词表）+ 负向 fixture。归一化反例（「匿 名」「ａnonymous」「别 走」）证明拆空格与全角绕不过。规则 2 的词表从 RETENTION_PHRASES import —— 一份定义、两个消费者（运行时出站断言与 CI 扫描）。
- **隐私中心。** 四分区 Tabs（横向滚动不折叠、激活态不吃 accent）、服务端驱动的清单（UI 层零 humanLabel 字面量，静态断言 + 注入式非空真）、第三态、五个受控撤回开关（失败回弹 + 「仍在继续」文案、必选项 AlertDialog 初始焦点在取消）。第三态的方向由**真实注册表**经 buildCollectedView 派生 —— Phase 7 研究管道落地时断言自动翻转方向，注入式翻转证明它真的在读注册表。

## Task Commits

1. **Task 1: DATA_INVENTORY 单一真相源 + 四条双向断言 + RES-02 负向 fixture** — 36a3eca (feat)
2. **Task 2: 正文与注册表对齐 + 政策页渲染 + PRIV-06 否定式与渲染层检查** — 1333a8a (feat)
3. **Task 3: 隐私中心清单 + 第三态 + 逐项撤回开关** — db6f7fd (feat)
4. **修复：legal-with-anonymous.md 负向 fixture 内容串写** — 63fda9c (fix)
5. **修复：A-02 PRIV-11 提取式两态都认（同类坑第三次）** — dbdc9f0 (fix，记在 01-01 名下)

**Plan metadata:** 见本次 docs 提交。

## Files Created/Modified

见 frontmatter 的 key-files。值得点名的三个：

- packages/db/src/inventory.ts — 注册表本体。Retention 把 D-17 的四层保存期（account_life 可带 24 个月硬上限 / fixed 天数）落成类型；审计表族统一 fixed 180 天。
- packages/safety/src/banned-terms.ts — 规则 1–4 词表 + scanBannedTerms，归一化直接复用 normalizeForRetentionMatch（又消灭了一份潜在的第二定义）。
- apps/web/src/app/(app)/legal/[doc]/page.tsx — 手写最小 markdown 渲染（标题/段落/引用/表格/列表/加粗/行内代码），React 元素输出而非 innerHTML，零新依赖。

## Decisions Made

见 frontmatter key-decisions（3 条，均已写入 STATE.md 的 Accumulated Context）。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 扫描核心搬进 packages/safety，PLAN 原定住在 tools/ci/banned-terms.test.ts**
- **Found during:** Task 2
- **Issue:** PLAN 要求 scanBannedTerms/BANNED_TERMS/normalizeForScan 定义在测试文件里，但渲染层断言必须住在 apps/web（react 只装在 apps/web —— 01-09 先例）且要与源码层跑**同一张词表**。import 另一个 .test 文件会让 vitest 把被引文件的用例在本项目里再跑一遍，词表也不能复制第二份。
- **Fix:** 核心落 packages/safety/src/banned-terms.ts（与 retention-words.ts 同一族），tools/ci 与 apps/web 两个消费者 import 同一处。
- **Verification:** banned-terms.test.ts + banned-render.test.tsx 全绿；grep RETENTION_PHRASES 在测试文件在场（规则 2 词表来自 import）。
- **Committed in:** 1333a8a

**2. [Rule 3 - Blocking] RTL 断言拆到 apps/web 两个测试文件**
- **Found during:** Task 2/3
- **Issue:** PLAN 把渲染层断言写在 tools/ci/banned-terms.test.ts 与 privacy-ui-contract.test.ts 里，但 tools/ci 解析不到 react。01-08/01-09 已确立先例（crisis/register 的做法）。
- **Fix:** 渲染断言进 apps/web/src/features/privacy/ 下 banned-render.test.tsx 与 privacy-render.test.tsx（jsdom docblock），静态断言留在 tools/ci。三个渲染目标（隐私中心 + 两份政策页）全部覆盖。
- **Committed in:** 1333a8a / db6f7fd

**3. [Rule 3 - Blocking] @drift/db 新增 ./inventory 纯子路径导出**
- **Found during:** Task 1
- **Issue:** apps/web 的 RTL (a) 需要读真实 DATA_INVENTORY，但 @drift/db 的包入口拉 client.ts（加载即读 DATABASE_URL），而「apps/web 不能 import @drift/db」的边界约束的正是这件事。
- **Fix:** packages/db/package.json 增加显式 ./inventory 子路径导出（纯模块），边界本身不动 —— 动的是可达性，不是约束。lockfile 不变，零安装。
- **Verification:** typecheck（tsc --build）通过；RTL 测试经该子路径 import 成功；Docker 构建 /legal/[doc] SSG 成功。
- **Committed in:** 36a3eca

**4. [Rule 1 - Bug] legal-with-anonymous.md 负向 fixture 被串写成 banned-terms.ts 的源码**
- **Found during:** 收尾 self-check
- **Issue:** Task 2 提交里 fixture 文件装的是词表模块的 TS 源码（3798 字节）。负向测试**碰巧**仍然通过 —— TS 词表字面量本身就含禁用词，等于用定义证明定义，非空真证明完全失效。
- **Fix:** 恢复原本的 693 字节 Markdown fixture；测试现在为正确的理由通过。
- **Verification:** banned-terms.test.ts 10/10；文件首行审计（本 plan 全部新文件逐一核对内容归属）。
- **Committed in:** 63fda9c

**5. [Rule 1 - Bug] terms.md 引用了规则 2 的禁用词字面量**
- **Found during:** Task 2（扫描摸底）
- **Issue:** 「不会发「再聊一会」这类消息」—— 语义是承诺不挽留，但机械扫描无法区分引用与使用，规则 2 扫描对全文生效。
- **Fix:** 同义重述（「不会用任何想让你留下的消息打断你」），语义零损失。
- **Committed in:** 1333a8a

**6. [Rule 1 - Bug] check-contract-amendments 的 A-02 提取式只认未勾选态**
- **Found during:** Task 3 收尾（requirements.mark-complete 之后复跑，handoff #61 的清单项）
- **Issue:** PRIV-11 标成 [x] 后 A02_PRIV11_IN_REQUIREMENTS 恒红 —— 同一类坑的第三次出现（A-03 PRIV-01 → SAFE-16 → 此处），handoff #65 明确预告过。
- **Fix:** 提取式改两态都认 + self-test 第 7 条钉住（两态正向 + 缺行反向）。
- **Verification:** 主检查 OK 13/13；--self-test 退出 0。
- **Committed in:** dbdc9f0

---

**Total deviations:** 6（3 条 Rule 3 结构性 + 3 条 Rule 1 修复）
**Impact on plan:** 全部朝「约束更强、定义唯一」的方向；无范围蔓延。PLAN 的文件清单上多了 5 个文件（banned-terms.ts、banned-render.test.tsx、privacy-render.test.tsx、switch.tsx、子路径导出），每一个都是 PLAN 目标在已知仓库约束下的必要落位。

## Issues Encountered

1. **legal-with-anonymous.md 串写**（见偏离 4）—— 最值得警惕的一条：测试绿不等于对，非空真证明也会被「定义含被禁词」这种巧合短路。靠文件首行审计抓出。
2. **vitest 的 cwd 是调用目录**（根 vitest.config 下是仓库根），RTL 测试读文件不能假设 cwd = apps/web —— 改为向上探测 pnpm-workspace.yaml 定位仓库根。
3. **jsdom 下 import.meta.url 不是 file: URL**（01-09 已知）—— legal/[doc]/page.tsx 的读文件代码只在 default export 内部执行，模块顶层保持纯净，RTL 才能 import LegalDocPage。
4. **REVOKE_FAILED_COPY 的赋值跨行**导致字面量子串断言失配 —— 测试改为用正则提取常量值再比对，顺带剥离两侧的 ** 加粗标记。
5. **humanLabel 硬编码检查的子串误报**（「删除账号」含「账号」）—— 改为按带引号的字面量匹配，并把「为什么带引号」写进测试注释。

## SKIPPED_CHECKS 变更

| 动作 | check id | 说明 |
|---|---|---|
| **新增** | inventory-l0-assert-vacuous-in-phase-1 | 第 4 条断言（l0 禁向量）在 Phase 1 无被测对象；由负向 fixture 证明活着。解除条件：注册表出现第一条 layer 为 l0 的条目时「Phase 1 现实」断言自动变红提醒删行 |
| **删除** | legal-collected-section-matches-inventory | 解除条件满足：集合相等断言已在 tools/ci/data-inventory.test.ts 落地，双向都断 |

## Authentication Gates

无 —— 本 plan 零外部服务调用、零新增依赖（T-10-SC：markdown 渲染手写，Radix Switch/AlertDialog 来自已装的统一包 radix-ui）。

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **PRIV-03 / PRIV-06 / PRIV-07 / PRIV-11 / RES-02 五项需求已标 Complete**，check-contract-amendments 复跑 OK 13/13。
- **Plan 11（导出与删除）的地基已就位**：DATA_INVENTORY 是 STORAGE_LOCATIONS 的交叉输入（非表存储的 pino / 导出目录 / pgboss 载荷已带理由登记在豁免清单里）；privacy.md 的「保存多久」与回执文案与 D-17 一致；导出/删除两个分区的视觉锚点（accent CTA、destructive 文字按钮）已按 UI-SPEC 落位，替换实现即可。
- **Phase 7 接研究管道时**：向 DATA_INVENTORY 登记 l0 条目的那一刻，tools/ci/data-inventory.test.ts 的「Phase 1 现实」断言与 privacy-render 的第三态断言会同时变红 —— 那是设计好的提醒（改清单、删 SKIPPED 行、复核政策），不是回归。
- **一处已知的验证缺口**：GET /me/collected 的路由层没有独立集成用例（纯函数侧已穷举，路由沿用 /me/consents 模式）—— D5 已按 human_judgment 登记。

## Self-Check: PASSED

| 检查 | 结果 |
|---|---|
| key-files.created 全部文件在磁盘上存在 | PASS（17 个逐一 test -f） |
| git log --oneline --all --grep="01-10" ≥ 1 commit | PASS（3 个任务提交 + 1 个 fixture 修复） |
| Task 1 verify：vitest data-inventory / tsc --build（handoff #1 的 tsc --build，非空真的 --noEmit -p）/ grep halfvec=6 / grep containsPersonalInfo: false=3 | PASS |
| Task 1 acceptance_criteria | PASS：22 表全覆盖（第 1 条不抛错）、RES-02 fixture 抛错且信息含列名与 halfvec、两个注入式负向、豁免理由逐条非空、retention 四类与 D-17 逐项一致、纯函数、SKIPPED 登记行在场且解除条件非空 |
| Task 2 verify：banned-terms / legal-required-sentences / grep 匿名=0 / grep 去标识化=1 / RETENTION_PHRASES 在测试文件在场 | PASS |
| Task 2 acceptance_criteria | PASS：负向 fixture 被抓住、privacy.md 0 字节 → 6 条失败 → 还原后全绿、SKIPPED 行已删、集合相等断言在场且注入变红、三个渲染目标覆盖、四类扩展名 + 边界断言、归一化反例（匿 名 / ａnonymous）、无感叹号与 emoji |
| Task 3 verify：privacy-ui-contract / next build（容器内 docker build，EXIT=0，/privacy 静态、/legal/[doc] SSG）/ grep humanLabel 无生产字面量 / ci:fast EXIT=0（unit 164 + contract 283） | PASS |
| Task 3 acceptance_criteria | PASS：(a)–(e) 全过；注入式翻转证明（research_l0 条目 → 第三态变清单）；Phase 1 现实渲染（三研究 scope 第三态、sensitive_pi/basic_service 真实条目）；撤回消失且无 aria-disabled 残留；回弹断言 checked=服务端值；UI 层零清单常量；删除入口不吃 accent |
| PLAN 级 verification 六条 | PASS：ci:fast 退出 0；四个「临时破坏」以注入式形态在测试里常驻（privacy.md 清空、research_l0 条目、未登记列、halfvec fixture），前两条另做了手动破坏验证后还原 |
| requirements.mark-complete 后复跑 check-contract-amendments | 修复 A-02 后 OK 13/13（handoff #61 清单项） |
| 本 plan 全部新文件首行内容审计（防再次串写） | PASS（17/17 归属正确） |

---
*Phase: 01-compliance-safety-chat-skeleton*
*Completed: 2026-09-27*
