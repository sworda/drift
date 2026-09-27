// COMPLY-10 的公开性状态门 —— 四条断言链（D-07 / D-08，RESEARCH §10.1）。
//
// 门禁守的是什么：《人工智能拟人化服务管理办法》第二条的适用范围抗辩由四个事实构成 ——
// 无公开注册入口 / 未上架应用商店 / 注册用户数 ≤ 10 / 无商业化。这四条任一破裂，整个
// 合规基线就变了；而它们破裂的方式几乎都是「顺手」的：加一个注册入口、发一个通用邀请
// 链接、上一次小程序、收一笔钱。**没有任何测试会因此变红。** 这四条断言把那件事变成
// 一次会失败的检查。
//
// ⚠️ **本脚本没有任何写入能力。** 更新 acknowledged_hash 必须是人工的一次提交：自动
// 更新会绕过 D-08 的签字机制，把整个门禁变成装饰 —— CI 自己把哈希改对了，于是「有人
// 重新逐条裁决过那六项吗」这个问题永远答不出来。publicness.test.ts 有一条断言守着这
// 一点（断言里列的就是那几个写入 API 的名字，这里刻意不重复写出来 —— 写出来会让那条
// 扫描被自己的注释命中）。
//
// ⚠️ **四条断言都有空真风险**，因此三个坏样例 fixture 与断言实现同等重要：
//   - HASH_MATCHES 在没人改状态时永远通过 → hash-stale.json 证明它能失败
//   - CHECKLIST_ADDED_ON_CHANGE 在状态没变时永远通过 → no-checklist.json 证明它能失败
//   - CHECKLIST_FULLY_CHECKED 在 checklist 全勾时永远通过 → checklist-unchecked.md 证明它能失败
//   - USERS_WITHIN_CAP 在用户数为 0 时永远通过 → --self-test 注入 11 证明它能失败

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const PUBLICNESS_DOC = 'compliance/publicness.json';
export const CHECKLIST_TEMPLATE = 'compliance/CHECKLIST-TEMPLATE.md';

/**
 * 四项状态字段，**按字典序**。
 *
 * 规范化序列化按这个顺序取值，所以哈希与 publicness.json 里键的书写顺序无关 ——
 * 否则一次纯格式改动就会要求一次人工签字，而无意义的红是这条检查最终被关掉的原因。
 */
export const STATE_FIELDS = Object.freeze([
  'app_store_listed',
  'monetized',
  'public_signup_entrance',
  'registered_users',
]);

/** 四条抗辩之一：注册用户数上限。超过即阻断发布。 */
export const USER_CAP = 10;

/** 稳定断言 id。顺序即 stdout 的输出顺序。 */
export const ASSERTION_IDS = Object.freeze([
  'HASH_MATCHES',
  'CHECKLIST_ADDED_ON_CHANGE',
  'CHECKLIST_FULLY_CHECKED',
  'USERS_WITHIN_CAP',
]);

/** 已签 checklist 里合法的裁决取值。 */
export const DISPOSITIONS = Object.freeze(['implemented', 'not_applicable']);

/** 可比对的 base ref 候选，按优先级。都解析不到 ⇒ 本次无基线（见 resolveBaseRef）。 */
const BASE_REF_CANDIDATES = Object.freeze([
  'origin/master',
  'origin/main',
  'upstream/master',
  'upstream/main',
]);

/**
 * 四项状态的规范化序列化：键按 STATE_FIELDS 顺序、无空白。
 *
 * @param {Record<string, unknown>} doc
 * @returns {string}
 */
export function canonicalState(doc) {
  /** @type {Record<string, unknown>} */
  const picked = {};
  for (const field of STATE_FIELDS) {
    if (!(field in doc)) {
      throw new Error(PUBLICNESS_DOC + ' 缺少状态字段 ' + field + ' —— 四项状态必须齐全');
    }
    picked[field] = doc[field];
  }
  return JSON.stringify(picked);
}

/**
 * @param {Record<string, unknown>} doc
 * @returns {string} sha256 前缀的十六进制摘要
 */
export function computeStateHash(doc) {
  return 'sha256:' + createHash('sha256').update(canonicalState(doc), 'utf8').digest('hex');
}

/**
 * @param {string} [docPath]
 * @returns {Record<string, unknown>}
 */
export function readPublicness(docPath = path.join(REPO_ROOT, PUBLICNESS_DOC)) {
  return JSON.parse(readFileSync(docPath, 'utf8'));
}

/**
 * 四条抗辩是否全部成立。
 *
 * 任一破裂后，已签 checklist 里的 not_applicable 裁决即不再合法 —— 这是
 * CHECKLIST_FULLY_CHECKED 的第三个条件，也是这份 checklist 的全部作用。
 *
 * @param {Record<string, unknown>} doc
 * @returns {boolean}
 */
export function defencesIntact(doc) {
  return (
    doc['public_signup_entrance'] !== true &&
    doc['app_store_listed'] !== true &&
    doc['monetized'] !== true &&
    Number(doc['registered_users']) <= USER_CAP
  );
}

/**
 * 解析 checklist / 模板：条目、勾选状态、逐条裁决与证据。
 *
 * @param {string} source
 * @returns {{ ids: string[], uncheckedCount: number, rows: Map<string, { disposition: string, evidence: string }> }}
 */
export function parseChecklist(source) {
  /** @type {string[]} */
  const ids = [];
  const itemPattern = /^- \[([ x])\] `([a-z_]+)`/gmu;
  let match = itemPattern.exec(source);
  while (match !== null) {
    ids.push(match[2]);
    match = itemPattern.exec(source);
  }

  // 未勾选项按全文的空方框计数（plan 的字面要求）。一份已签 checklist 里不该存在任何
  // 未勾选的方框，无论它是不是六条必需条目之一。
  const uncheckedCount = (source.match(/^- \[ \]/gmu) ?? []).length;

  /** @type {Map<string, { disposition: string, evidence: string }>} */
  const rows = new Map();
  const rowPattern = /^\|\s*`([a-z_]+)`\s*\|([^|\n]*)\|([^|\n]*)\|/gmu;
  let row = rowPattern.exec(source);
  while (row !== null) {
    rows.set(row[1], {
      disposition: row[2].replaceAll('`', '').trim(),
      evidence: row[3].trim(),
    });
    row = rowPattern.exec(source);
  }

  return { ids, uncheckedCount, rows };
}

/**
 * @param {readonly string[]} a
 * @param {readonly string[]} b
 * @returns {boolean}
 */
function sameSet(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

/**
 * 断言 1：重算四项状态的哈希并与 acknowledged_hash 比对。
 *
 * @param {Record<string, unknown>} doc
 * @returns {{ id: string, ok: boolean, message: string }}
 */
export function assertHashMatches(doc) {
  const actual = computeStateHash(doc);
  const declared = typeof doc['acknowledged_hash'] === 'string' ? doc['acknowledged_hash'] : '';
  if (declared.length === 0) {
    return {
      id: 'HASH_MATCHES',
      ok: false,
      message: PUBLICNESS_DOC + ' 缺少 acknowledged_hash —— 公开性状态与签字失去绑定',
    };
  }
  if (declared === actual) {
    return { id: 'HASH_MATCHES', ok: true, message: '四项状态与签字哈希一致：' + actual };
  }
  return {
    id: 'HASH_MATCHES',
    ok: false,
    message:
      '状态已变更但未同步签字 —— 请逐条裁决一份新的 compliance/CHECKLIST-<日期>.md 并人工更新 acknowledged_hash' +
      '\n  签字值：' +
      declared +
      '\n  实际值：' +
      actual,
  };
}

/**
 * 断言 2：四项状态在本次 diff 中有变化时，同一 diff 必须**新增**一份 CHECKLIST。
 *
 * before 为 null 表示 base ref 上还没有这个文件（首次登记）—— 那也是一次变化。
 * baseRef 为 null 表示没有可比对的 base ref，此时不作判定（见 CLI 的输出说明）。
 *
 * @param {{ before: Record<string, unknown> | null, after: Record<string, unknown>, addedChecklists: readonly string[], baseRef?: string | null }} input
 * @returns {{ id: string, ok: boolean, message: string }}
 */
export function assertChecklistAddedOnChange({
  before,
  after,
  addedChecklists,
  baseRef = 'injected',
}) {
  const id = 'CHECKLIST_ADDED_ON_CHANGE';
  if (baseRef === null) {
    return {
      id,
      ok: true,
      message:
        '本次未作判定：没有可比对的 base ref（' +
        BASE_REF_CANDIDATES.join(' / ') +
        ' 均不存在）。仓库尚未配置远端，已登记 SKIPPED_CHECKS.md 的 ci-workflows-never-executed',
    };
  }
  const afterCanonical = canonicalState(after);
  const beforeCanonical = before === null ? null : canonicalState(before);
  if (beforeCanonical === afterCanonical) {
    return {
      id,
      ok: true,
      message: '四项状态在 ' + baseRef + '...HEAD 中无变化，无需新增 checklist',
    };
  }
  if (addedChecklists.length > 0) {
    return {
      id,
      ok: true,
      message:
        '四项状态有变化，同一 diff 新增了 ' +
        addedChecklists.join(', ') +
        '\n  变化：' +
        (beforeCanonical ?? '<base ref 上无此文件>') +
        ' → ' +
        afterCanonical,
    };
  }
  return {
    id,
    ok: false,
    message:
      '四项状态在 ' +
      baseRef +
      '...HEAD 中发生了变化，但同一 diff 里没有新增任何 compliance/CHECKLIST-*.md —— 状态变更必须伴随一次逐条裁决的签字' +
      '\n  变化：' +
      (beforeCanonical ?? '<base ref 上无此文件>') +
      ' → ' +
      afterCanonical,
  };
}

/**
 * 断言 3：被引用的 checklist 条目集合与模板一致、未勾选项为 0、逐条裁决与证据非空；
 * 且四条抗辩任一破裂时不接受 not_applicable 裁决。
 *
 * @param {{ checklistSource: string, templateSource: string, doc: Record<string, unknown>, checklistPath?: string }} input
 * @returns {{ id: string, ok: boolean, message: string }}
 */
export function assertChecklistFullyChecked({
  checklistSource,
  templateSource,
  doc,
  checklistPath = '<注入>',
}) {
  const id = 'CHECKLIST_FULLY_CHECKED';
  const template = parseChecklist(templateSource);
  const checklist = parseChecklist(checklistSource);

  if (template.ids.length === 0) {
    return {
      id,
      ok: false,
      message:
        CHECKLIST_TEMPLATE + ' 解析不出任何必需条目 —— 模板即断言基准，它为空则本条恒通过',
    };
  }
  if (!sameSet(checklist.ids, template.ids)) {
    const missing = template.ids.filter((item) => !checklist.ids.includes(item));
    const extra = checklist.ids.filter((item) => !template.ids.includes(item));
    return {
      id,
      ok: false,
      message:
        checklistPath +
        ' 的必需条目集合与模板不一致 —— 删条目不会让门禁变松，只会让签字失效' +
        '\n  缺少：' +
        (missing.join(', ') || '（无）') +
        '\n  多出：' +
        (extra.join(', ') || '（无）'),
    };
  }
  if (checklist.uncheckedCount > 0) {
    return {
      id,
      ok: false,
      message:
        checklistPath +
        ' 还有 ' +
        String(checklist.uncheckedCount) +
        ' 条未勾选 —— 一份没答完的 checklist 不构成签字',
    };
  }

  const intact = defencesIntact(doc);
  for (const item of template.ids) {
    const row = checklist.rows.get(item);
    if (row === undefined || row.disposition.length === 0 || row.evidence.length === 0) {
      return {
        id,
        ok: false,
        message:
          checklistPath +
          ' 的条目 ' +
          item +
          ' 缺少裁决或证据 —— 勾选的语义是「已裁决且留证」，不是「已确认」',
      };
    }
    if (!DISPOSITIONS.includes(row.disposition)) {
      return {
        id,
        ok: false,
        message:
          checklistPath +
          ' 的条目 ' +
          item +
          ' 裁决取值非法：' +
          row.disposition +
          '（只允许 ' +
          DISPOSITIONS.join(' / ') +
          '）',
      };
    }
    if (!intact && row.disposition === 'not_applicable') {
      return {
        id,
        ok: false,
        message:
          checklistPath +
          ' 的条目 ' +
          item +
          ' 裁决为 not_applicable，但四条抗辩已有破裂 —— 此时该条必须已实装（implemented），不适用不再是合法裁决',
      };
    }
  }

  return {
    id,
    ok: true,
    message:
      checklistPath +
      ' 六条必需条目全部已勾选、裁决与证据齐全' +
      (intact ? '（四条抗辩成立，允许 not_applicable）' : '（四条抗辩已破裂，全部为 implemented）'),
  };
}

/**
 * 断言 4：注册用户数不超过上限。
 *
 * @param {Record<string, unknown>} doc
 * @returns {{ id: string, ok: boolean, message: string }}
 */
export function assertUsersWithinCap(doc) {
  const id = 'USERS_WITHIN_CAP';
  const users = doc['registered_users'];
  if (typeof users !== 'number' || !Number.isInteger(users) || users < 0) {
    return { id, ok: false, message: 'registered_users 不是一个非负整数：' + String(users) };
  }
  if (users <= USER_CAP) {
    return {
      id,
      ok: true,
      message: 'registered_users = ' + String(users) + '，未超过上限 ' + String(USER_CAP),
    };
  }
  return {
    id,
    ok: false,
    message:
      'registered_users = ' +
      String(users) +
      ' 超过上限 ' +
      String(USER_CAP) +
      ' —— 四条抗辩之一已破裂，发布被阻断直到六条必需条目逐条实装并重新签字',
  };
}

/** @param {readonly string[]} args */
function git(args) {
  const run = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

/**
 * 第一个能解析的 base ref；都解析不到返回 null。
 *
 * @returns {string | null}
 */
export function resolveBaseRef() {
  for (const candidate of BASE_REF_CANDIDATES) {
    if (git(['rev-parse', '--verify', '--quiet', candidate]).status === 0) return candidate;
  }
  return null;
}

/**
 * base ref 上的四项状态；base ref 上没有这个文件则返回 null。
 *
 * @param {string} baseRef
 * @returns {Record<string, unknown> | null}
 */
export function readBaselineState(baseRef) {
  const show = git(['show', baseRef + ':' + PUBLICNESS_DOC]);
  if (show.status !== 0) return null;
  return JSON.parse(show.stdout);
}

/**
 * 本次 diff 中**新增**的 CHECKLIST 文件（--diff-filter=A）。
 *
 * @param {string} baseRef
 * @returns {string[]}
 */
export function addedChecklistsSince(baseRef) {
  const diff = git([
    'diff',
    '--name-only',
    '--diff-filter=A',
    baseRef + '...HEAD',
    '--',
    'compliance/',
  ]);
  if (diff.status !== 0) return [];
  return diff.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^compliance\/CHECKLIST-\d{4}-\d{2}-\d{2}\.md$/u.test(line));
}

/**
 * 跑四条断言链。
 *
 * @returns {{ results: { id: string, ok: boolean, message: string }[], ok: boolean }}
 */
export function runCheck() {
  const doc = readPublicness();
  const templateSource = readFileSync(path.join(REPO_ROOT, CHECKLIST_TEMPLATE), 'utf8');

  const checklistRef = doc['acknowledged_checklist'];
  /** @type {{ id: string, ok: boolean, message: string }[]} */
  const results = [];

  results.push(assertHashMatches(doc));

  const baseRef = resolveBaseRef();
  results.push(
    assertChecklistAddedOnChange({
      before: baseRef === null ? null : readBaselineState(baseRef),
      after: doc,
      addedChecklists: baseRef === null ? [] : addedChecklistsSince(baseRef),
      baseRef,
    }),
  );

  if (typeof checklistRef !== 'string' || checklistRef.length === 0) {
    results.push({
      id: 'CHECKLIST_FULLY_CHECKED',
      ok: false,
      message: PUBLICNESS_DOC + ' 缺少 acknowledged_checklist —— 签字指向不存在',
    });
  } else if (!existsSync(path.join(REPO_ROOT, checklistRef))) {
    results.push({
      id: 'CHECKLIST_FULLY_CHECKED',
      ok: false,
      message: 'acknowledged_checklist 指向的文件不存在：' + checklistRef,
    });
  } else {
    results.push(
      assertChecklistFullyChecked({
        checklistSource: readFileSync(path.join(REPO_ROOT, checklistRef), 'utf8'),
        templateSource,
        doc,
        checklistPath: checklistRef,
      }),
    );
  }

  results.push(assertUsersWithinCap(doc));

  return { results, ok: results.every((result) => result.ok) };
}

/** 三个坏样例 fixture 的路径。 */
export const FIXTURES = Object.freeze({
  hashStale: 'tools/ci/fixtures/publicness/hash-stale.json',
  noChecklist: 'tools/ci/fixtures/publicness/no-checklist.json',
  checklistUnchecked: 'tools/ci/fixtures/publicness/checklist-unchecked.md',
});

/** @param {string} rel */
function fixture(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

/**
 * 用三个坏样例 + 一次注入证明四条断言各自能失败。
 *
 * 三条来自 fixture 文件，第四条（USERS_WITHIN_CAP）由注入 11 证明 —— 它没有 fixture
 * 文件是因为坏样例就是一个数字，写成文件只会多一层间接。
 *
 * @returns {{ cases: { id: string, source: string, failed: boolean, message: string }[], ok: boolean }}
 */
export function selfTest() {
  const templateSource = readFileSync(path.join(REPO_ROOT, CHECKLIST_TEMPLATE), 'utf8');
  const real = readPublicness();

  /** @type {{ id: string, source: string, failed: boolean, message: string }[]} */
  const cases = [];

  const stale = JSON.parse(fixture(FIXTURES.hashStale));
  const staleResult = assertHashMatches(stale);
  cases.push({
    id: 'HASH_MATCHES',
    source: FIXTURES.hashStale,
    failed: !staleResult.ok,
    message: staleResult.message,
  });

  const changed = JSON.parse(fixture(FIXTURES.noChecklist));
  const changedResult = assertChecklistAddedOnChange({
    before: real,
    after: changed,
    addedChecklists: [],
    baseRef: 'fixture-baseline',
  });
  cases.push({
    id: 'CHECKLIST_ADDED_ON_CHANGE',
    source: FIXTURES.noChecklist,
    failed: !changedResult.ok,
    message: changedResult.message,
  });

  const uncheckedResult = assertChecklistFullyChecked({
    checklistSource: fixture(FIXTURES.checklistUnchecked),
    templateSource,
    doc: real,
    checklistPath: FIXTURES.checklistUnchecked,
  });
  cases.push({
    id: 'CHECKLIST_FULLY_CHECKED',
    source: FIXTURES.checklistUnchecked,
    failed: !uncheckedResult.ok,
    message: uncheckedResult.message,
  });

  const overCapResult = assertUsersWithinCap({ ...real, registered_users: USER_CAP + 1 });
  cases.push({
    id: 'USERS_WITHIN_CAP',
    source: '注入 registered_users = ' + String(USER_CAP + 1),
    failed: !overCapResult.ok,
    message: overCapResult.message,
  });

  return { cases, ok: cases.every((item) => item.failed) };
}

/** @param {readonly string[]} argv */
function main(argv) {
  const flag = argv[0] ?? '--check';

  if (flag === '--self-test') {
    const { cases, ok } = selfTest();
    for (const item of cases) {
      const verdict = item.failed ? 'OK self-test' : 'FAIL self-test';
      process.stdout.write(
        verdict +
          ': ' +
          item.id +
          ' 被 ' +
          item.source +
          ' ' +
          (item.failed ? '正确判失败' : '**竟然判通过**') +
          '\n',
      );
      process.stdout.write('    ' + item.message.split('\n')[0] + '\n');
    }
    if (!ok) {
      process.stdout.write('FAIL self-test: publicness gate is vacuous\n');
      return 1;
    }
    process.stdout.write('OK self-test: 4 条断言各有一个坏样例证明它能失败\n');
    return 0;
  }

  if (flag !== '--check') {
    process.stderr.write('用法：node tools/ci/publicness.mjs [--check | --self-test]\n');
    return 2;
  }

  const { results, ok } = runCheck();
  for (const result of results) {
    if (result.ok) {
      process.stdout.write('OK ' + result.id + ': ' + result.message + '\n');
    } else {
      process.stderr.write('FAIL ' + result.id + ': ' + result.message + '\n');
    }
  }
  if (!ok) return 1;
  process.stdout.write('OK 4/4 publicness gate\n');
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
