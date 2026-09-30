#!/usr/bin/env node
// tools/ci/check-contract-amendments.mjs
//
// 把 Plan 01-01 落地的三处契约修订（A-01 / A-02 / A-03）与两条讨论决定（Q1 / Q2）
// 变成 13 条机械断言，看守「仍在生效的五份权威文档」。
//
// 零依赖：只 import node:fs，路径全部由 import.meta.url 派生 —— 因此在还没有
// node_modules 的仓库里（Plan 02 之前）也能直接 node 运行。
//
// 作用域是一份封闭白名单（五个文件），不做目录遍历，因此不可能误伤
// .planning/research/**、01-RESEARCH.md 与 01-DISCUSSION-LOG.md 这些历史研究记录。

import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);

/** 五份仍在生效的权威文档 —— 封闭白名单 */
export const LIVE_DOCS = {
  requirements: '.planning/REQUIREMENTS.md',
  roadmap: '.planning/ROADMAP.md',
  projectMd: '.planning/PROJECT.md',
  claudeMd: '.claude/CLAUDE.md',
  uiSpec: '.planning/phases/01-compliance-safety-chat-skeleton/01-UI-SPEC.md',
};

export const SEGMENTS = Object.keys(LIVE_DOCS);

// 「修订前的同意项数量表述」模式。JS 正则形态用 [^。\n]，grep 形态写 [^。]，
// 只允许这两种书写形态（见 01-01-PLAN.md Task 3）。
//
// 上界 {0,20}：REQUIREMENTS.md 的旧串是「四个 + 15 字加粗插入语 + 的同意项」，
// {0,8} 对它完全失明 —— 会出现「13/13 全绿而唯一的编号权威仍写旧数量」。
//
// 字符类只能是 [个项]，绝不能加「条」：PRIV-01 必须保留「个保法第十四条禁止
// 捆绑同意」的引注，带「条」的模式会让本断言对一份正确修订过的仓库恒为 false。
export const STALE_CONSENT_RE = /四[个项][^。\n]{0,20}同意/;
export const STALE_CONSENT_LITERAL = '同意项恒为 4 项';

/** 逐行扫一段文本，返回命中的 { line, text } 列表 */
function findStale(text) {
  const hits = [];
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (STALE_CONSENT_RE.test(line) || line.includes(STALE_CONSENT_LITERAL)) {
      hits.push({ line: i + 1, text: line.trim().slice(0, 80) });
    }
  }
  return hits;
}

function lineContainingAll(text, anchor, needles) {
  for (const line of String(text ?? '').split('\n')) {
    if (!line.includes(anchor)) continue;
    if (needles.every((n) => line.includes(n))) return line;
  }
  return null;
}

function hasNegatedSelectAll(text) {
  return String(text ?? '')
    .split('\n')
    .some((l) => l.includes('全选') && (l.includes('不存在') || l.includes('不得')));
}

/**
 * @param {{requirements:string, roadmap:string, projectMd:string, claudeMd:string, uiSpec:string}} files
 * @returns {{id:string, ok:boolean, detail:string}[]}
 */
export function checkAmendments(files) {
  const requirements = String(files?.requirements ?? '');
  const roadmap = String(files?.roadmap ?? '');
  const projectMd = String(files?.projectMd ?? '');
  const claudeMd = String(files?.claudeMd ?? '');
  const uiSpec = String(files?.uiSpec ?? '');

  const results = [];
  const push = (id, ok, detail) => results.push({ id, ok, detail });

  // ---- A-01 危机干预文案 ----
  {
    const stale = uiSpec.includes('极端情况下会有真人介入');
    push(
      'A01_NO_HUMAN_TAKEOVER_COPY',
      !stale,
      stale
        ? 'uiSpec 仍含会话内真人介入的承诺 —— 本阶段不实现该能力，留着即虚假陈述（D-09 / A-01）'
        : 'uiSpec 不含会话内真人介入的承诺文案',
    );
  }
  {
    const ok = uiSpec.includes('已经收到通知') && uiSpec.includes('直接联系你');
    push(
      'A01_NEW_COPY_PRESENT',
      ok,
      ok
        ? 'uiSpec 含「已经收到通知」与「直接联系你」'
        : 'uiSpec 缺 A-01 的替代文案：需同时含「已经收到通知」与「直接联系你」',
    );
  }

  // ---- A-02 PRIV-11 ----
  {
    // 复选框状态必须两态都认（同 A-03 / SAFE-16 的 94ca966 与 c7d75f5）：PRIV-11 被
    // requirements.mark-complete 标成 [x] 后，条目仍然在场，只是完成了 —— 只认未勾选态
    // 会让本条在正常生命周期事件上恒红。这是同一类坑的第三次出现（A-03 → SAFE-16 → 此处）。
    const ok = /^- \[[ xX]\] \*\*PRIV-11\*\*/m.test(requirements);
    push(
      'A02_PRIV11_IN_REQUIREMENTS',
      ok,
      ok ? 'requirements 含 PRIV-11 条目' : 'requirements 缺「- [ ] **PRIV-11**:」条目（编号格式须与相邻条目一致，勾选/未勾选两态都算在场）',
    );
  }
  {
    const hasId = uiSpec.includes('PRIV-11');
    const hasCopy = uiSpec.includes('不包含你和角色说过的任何内容');
    push(
      'A02_PRIV11_IN_UISPEC',
      hasId && hasCopy,
      hasId && hasCopy
        ? 'uiSpec 含 PRIV-11 与「不包含你和角色说过的任何内容」关键句'
        : 'uiSpec 的 PRIV-11 披露不完整：需同时含 ID 与关键句「不包含你和角色说过的任何内容」（只出现 ID 不算 —— T-01-03）',
    );
  }

  // ---- A-03 五项同意 ----
  const SCOPES = ['basic_service', 'sensitive_pi', 'research_l0', 'research_l1', 'persona_evolution'];
  {
    // 复选框状态必须两态都认（`[ ]` 与 `[x]`）。只认未勾选态时，PRIV-01 一旦按正常
    // 生命周期被 requirements.mark-complete 标成 [x]，本条就会报「找不到条目行」而恒红
    // —— 断言在一个预期内的事件上崩掉，而不是在真实违反上变红。self-test 第 5 条钉住两态。
    const priv01 = (requirements.match(/^- \[[ xX]\] \*\*PRIV-01\*\*.*$/m) || [''])[0];
    const missing = SCOPES.filter((s) => !priv01.includes(s));
    push(
      'A03_FIVE_CONSENTS_REQUIREMENTS',
      priv01 !== '' && missing.length === 0,
      priv01 === ''
        ? 'requirements 找不到 PRIV-01 条目行'
        : missing.length === 0
          ? 'requirements 的 PRIV-01 段含全部五个 scope 标识'
          : 'requirements 的 PRIV-01 段缺 scope 标识：' + missing.join(', '),
    );
  }
  {
    const hasFive = uiSpec.includes('五个独立同意项');
    const staleStrings = ['四个独立同意项', '四个同意项', STALE_CONSENT_LITERAL].filter((s) => uiSpec.includes(s));
    push(
      'A03_FIVE_CONSENTS_UISPEC',
      hasFive && staleStrings.length === 0,
      !hasFive
        ? 'uiSpec 缺「五个独立同意项」（## 本阶段覆盖的用户可见面 与 ## Component Inventory 两处应各有一次）'
        : staleStrings.length === 0
          ? 'uiSpec 含「五个独立同意项」且无旧数量串残留'
          : 'uiSpec 仍残留旧数量串：' + staleStrings.join(' / '),
    );
  }
  {
    const okUi = hasNegatedSelectAll(uiSpec);
    const okReq = hasNegatedSelectAll(requirements);
    push(
      'A03_NO_SELECT_ALL',
      okUi && okReq,
      okUi && okReq
        ? 'uiSpec 与 requirements 各自保留「全选」的否定表述'
        : '禁止捆绑同意的约束被削弱：' +
            [okUi ? null : 'uiSpec 无「不存在/不得 … 全选」表述', okReq ? null : 'requirements 无「不存在/不得 … 全选」表述']
              .filter(Boolean)
              .join('；'),
    );
  }

  // ---- SAFE-16 ----
  {
    // 复选框状态必须两态都认（同 94ca966 对 PRIV-01 的修复）：SAFE-16 由 Plan 07/08
    // 按正常生命周期标记完成后是 - [x]，只认未勾选态会让本条在预期内事件上恒红。
    // self-test 第 6 条钉住两态。
    const ok = /^- \[[ xX]\] \*\*SAFE-16\*\*/m.test(requirements);
    push(
      'SAFE16_IN_REQUIREMENTS',
      ok,
      ok ? 'requirements 含 SAFE-16 条目' : 'requirements 缺「- [ ] / - [x] **SAFE-16**:」条目',
    );
  }

  // ---- Q1 审计去标识化 ----
  {
    const line = lineContainingAll(uiSpec, '删除回执', ['去除可识别信息', '不计入']);
    push(
      'Q1_AUDIT_DEIDENTIFIED_COPY',
      line !== null,
      line !== null
        ? 'uiSpec 的删除回执文案含「去除可识别信息」与「不计入」'
        : 'uiSpec 的删除回执文案缺 Q1 的去标识化句：同一行需同时含「去除可识别信息」与「不计入」',
    );
  }

  // ---- Q2 撤回必选同意项 ----
  {
    const ok = uiSpec.includes('等于停止服务并删除你的全部数据');
    push(
      'Q2_REVOKE_REQUIRED_COPY',
      ok,
      ok
        ? 'uiSpec 含「等于停止服务并删除你的全部数据」'
        : 'uiSpec 缺撤回必选同意项的整句：「撤回它等于停止服务并删除你的全部数据」',
    );
  }

  // ---- ROADMAP 同步 ----
  {
    const reqLine = (roadmap.match(/^\*\*Requirements\*\*:.*$/m) || [''])[0];
    const ok = reqLine.includes('PRIV-11') && reqLine.includes('SAFE-16');
    push(
      'ROADMAP_IDS_SYNCED',
      ok,
      ok
        ? 'roadmap 的 Phase 1 Requirements 行含 PRIV-11 与 SAFE-16'
        : 'roadmap 的 Phase 1 Requirements 行未同步两个新 ID（需同时含 PRIV-11 与 SAFE-16）',
    );
  }
  {
    const phase1 = /\|\s*Phase 1\s*\|\s*46\s*\|/.test(roadmap);
    const total = /\|\s*\*\*合计\*\*\s*\|\s*\*\*119 \/ 119/.test(roadmap);
    push(
      'ROADMAP_COVERAGE_SYNCED',
      phase1 && total,
      phase1 && total
        ? 'roadmap Coverage 表 Phase 1 = 46、合计 = 119 / 119'
        : 'roadmap Coverage 表未同步：' +
            [phase1 ? null : 'Phase 1 行不是 46', total ? null : '合计行不是 119 / 119'].filter(Boolean).join('；'),
    );
  }

  // ---- 五段入参逐一否定式扫描 ----
  {
    const segs = { requirements, roadmap, projectMd, claudeMd, uiSpec };
    const hits = [];
    for (const name of SEGMENTS) {
      for (const h of findStale(segs[name])) hits.push(name + ':' + h.line + ' 「' + h.text + '」');
    }
    push(
      'NO_FOUR_CONSENTS_IN_LIVE_DOCS',
      hits.length === 0,
      hits.length === 0
        ? '五段入参均无修订前的同意项数量表述'
        : '仍在生效的权威文档残留旧同意项数量表述：' + hits.join(' | '),
    );
  }

  return results;
}

// ------------------------------- CLI -------------------------------

function readLive() {
  const files = {};
  for (const [key, rel] of Object.entries(LIVE_DOCS)) {
    files[key] = readFileSync(new URL(rel, ROOT), 'utf8');
  }
  return files;
}

function pick(results, id) {
  return results.find((r) => r.id === id);
}

function runMain() {
  const results = checkAmendments(readLive());
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    for (const r of failed) console.error('FAIL ' + r.id + ': ' + r.detail);
    process.exit(1);
  }
  console.log('OK ' + results.length + '/' + results.length + ' contract amendments');
}

function runSelfTest() {
  const live = readLive();
  const bail = (msg) => {
    console.log(msg);
    process.exit(1);
  };

  // 1) 负向：uiSpec 顶替为只含旧文案的 fixture
  const fixture = readFileSync(new URL('tools/ci/fixtures/contract-amendments/stale-uispec.md', ROOT), 'utf8');
  const r1 = checkAmendments({ ...live, uiSpec: fixture });
  const mustFail = ['A01_NO_HUMAN_TAKEOVER_COPY', 'A03_FIVE_CONSENTS_UISPEC', 'NO_FOUR_CONSENTS_IN_LIVE_DOCS'];
  for (const id of mustFail) {
    const r = pick(r1, id);
    if (!r || r.ok) bail('FAIL self-test: checker is vacuous（uiSpec fixture 未被 ' + id + ' 判失败）');
  }

  // 2) 负向：claudeMd 段顶替为旧串 —— 证明第 13 条不是只扫 uiSpec
  const r2 = checkAmendments({ ...live, claudeMd: '- 隐私（硬约束）：四个可独立开关的同意项（不得捆绑）\n' });
  const c2 = pick(r2, 'NO_FOUR_CONSENTS_IN_LIVE_DOCS');
  if (!c2 || c2.ok !== false) {
    bail('FAIL self-test: checker is vacuous（claudeMd 段的旧串未被 NO_FOUR_CONSENTS_IN_LIVE_DOCS 判失败）');
  }

  // 3) 负向：requirements 段顶替为旧串（「四个」与「同意」之间 15 字的加粗插入语）。
  //    这条同时把「模式上界必须覆盖 15 字插入语」钉成机械可检 —— {0,8} 下必然失败。
  const r3 = checkAmendments({
    ...live,
    requirements: '- [ ] **PRIV-01**: 用户在注册时看到四个**可独立开关、互不捆绑**的同意项\n',
  });
  const c3 = pick(r3, 'NO_FOUR_CONSENTS_IN_LIVE_DOCS');
  if (!c3 || c3.ok !== false) bail('FAIL self-test: requirements segment not scanned');

  // 4) 正向：requirements 段只含法条引注 —— 模式不得命中它，否则主命令恒红
  const r4 = checkAmendments({ ...live, requirements: '个保法第十四条禁止捆绑同意\n' });
  const c4 = pick(r4, 'NO_FOUR_CONSENTS_IN_LIVE_DOCS');
  if (!c4 || c4.ok !== true) bail('FAIL self-test: pattern hits legal citation');

  // 6) 两态：SAFE-16 被标记完成（`- [x]`）后仍必须被找到 —— 与第 5 条同一次失效模式
  //（SAFE-16 在 01-08 的 update_requirements 之后触发了同一类恒红）。
  const safe16Body = ': acute（crisis 级）事件须在有界时间内投递到运营者告警通道。\n';
  for (const box of ['[ ]', '[x]']) {
    const rBox = checkAmendments({ ...live, requirements: '- ' + box + ' **SAFE-16**' + safe16Body });
    const cBox = pick(rBox, 'SAFE16_IN_REQUIREMENTS');
    if (!cBox || cBox.ok !== true) {
      bail('FAIL self-test: SAFE-16 条目行在复选框状态 ' + box + ' 下未被识别（提取式只认单一状态）');
    }
  }

  // 5) 两态：PRIV-01 被标记完成（`- [x]`）后仍必须被找到。未勾选态同样必须被找到。
  //    这条存在的理由是一次真实回归：提取式原本只认 `- [ ]`，Plan 09 标记 PRIV-01 完成后
  //    A03_FIVE_CONSENTS_REQUIREMENTS 立刻报「找不到条目行」。
  const priv01Body =
    ': 用户在注册时看到五个**可独立开关、互不捆绑**的同意项：`basic_service`、`sensitive_pi`、`research_l0`、`research_l1`、`persona_evolution`\n';
  for (const box of ['[ ]', '[x]']) {
    const rBox = checkAmendments({ ...live, requirements: '- ' + box + ' **PRIV-01**' + priv01Body });
    const cBox = pick(rBox, 'A03_FIVE_CONSENTS_REQUIREMENTS');
    if (!cBox || cBox.ok !== true) {
      bail('FAIL self-test: PRIV-01 条目行在复选框状态 ' + box + ' 下未被识别（提取式只认单一状态）');
    }
  }
  // 反向：两态都认，但缺 scope 标识时仍必须判失败 —— 否则上面放宽的是「找不到就算了」。
  const rMissing = checkAmendments({
    ...live,
    requirements: '- [x] **PRIV-01**: 用户在注册时看到五个同意项：`basic_service`\n',
  });
  const cMissing = pick(rMissing, 'A03_FIVE_CONSENTS_REQUIREMENTS');
  if (!cMissing || cMissing.ok !== false) bail('FAIL self-test: 缺 scope 标识时 A03 未判失败');

  // 7) 两态：PRIV-11 被标记完成（`- [x]`）后仍必须被找到 —— 同类坑的第三次出现
  //（A-03 PRIV-01 → SAFE-16 → 此处；Plan 10 的 update_requirements 之后触发）。
  //    反向：缺 PRIV-11 条目行时仍必须判失败，否则放宽成了「找不到就算了」。
  const priv11Body = ': 隐私中心「我们收集了什么」须如实列明运营者通知披露\n';
  for (const box of ['[ ]', '[x]']) {
    const rBox = checkAmendments({ ...live, requirements: '- ' + box + ' **PRIV-11**' + priv11Body });
    const cBox = pick(rBox, 'A02_PRIV11_IN_REQUIREMENTS');
    if (!cBox || cBox.ok !== true) {
      bail('FAIL self-test: PRIV-11 条目行在复选框状态 ' + box + ' 下未被识别（提取式只认单一状态）');
    }
  }
  const rNoPriv11 = checkAmendments({ ...live, requirements: '- [x] **PRIV-01**: 别的条目\n' });
  const cNoPriv11 = pick(rNoPriv11, 'A02_PRIV11_IN_REQUIREMENTS');
  if (!cNoPriv11 || cNoPriv11.ok !== false) bail('FAIL self-test: 缺 PRIV-11 条目行时 A02 未判失败');

  console.log('self-test OK —— 负向输入被正确判失败的断言 id：');
  console.log('  uiSpec fixture     -> ' + mustFail.join(', ') + '（三条全部 ok:false）');
  console.log('  claudeMd 旧串      -> NO_FOUR_CONSENTS_IN_LIVE_DOCS ok:false');
  console.log('  requirements 旧串  -> NO_FOUR_CONSENTS_IN_LIVE_DOCS ok:false（覆盖 15 字加粗插入语）');
  console.log('正向样本：requirements 只含「个保法第十四条禁止捆绑同意」-> NO_FOUR_CONSENTS_IN_LIVE_DOCS ok:true');
}

if (process.argv.includes('--self-test')) runSelfTest();
else runMain();
