import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ASSERTION_IDS,
  CHECKLIST_TEMPLATE,
  DISPOSITIONS,
  FIXTURES,
  USER_CAP,
  assertChecklistAddedOnChange,
  assertChecklistFullyChecked,
  assertHashMatches,
  assertUsersWithinCap,
  computeStateHash,
  canonicalState,
  parseChecklist,
  readPublicness,
  runCheck,
  selfTest,
} from './publicness.mjs';

/**
 * COMPLY-10 公开性状态门的契约断言（L4）。
 *
 * 这一层存在的理由：publicness.mjs 的四条断言各自都会在「状态没变」时永远通过。一个
 * 恒返回 ok 的实现在 fast.yml 里与真实实现表现完全一致，所以门禁是否非空真只能由这里
 * 回答 —— 三个坏样例 fixture 各让一条断言失败，两次测试内注入各让剩下两条失败。
 *
 * 破坏验证写成**测试内注入**而不是临时改仓库文件：这样「改了状态不签字会红」这件事
 * 每个 PR 都在跑，而不是只在某个执行器手里跑过一次（01-05 定下的做法）。
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 六条必需条目的 id —— 与 PITFALLS-COMPLIANCE §1.6 开放问题 3 的清单逐条对应。 */
const REQUIRED_ITEMS = [
  'security_assessment',
  'algorithm_filing',
  'minor_mode',
  'crisis_intervention',
  'two_hour_reminder',
  'appeal_channel',
];

function runCli(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, ['tools/ci/publicness.mjs', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

/** 读一份 fixture JSON。经 unknown 收窄，避免把 any 直接喂进断言函数。 */
function readJson(rel: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(read(rel));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${rel} 不是一个 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

const templateSource = read(CHECKLIST_TEMPLATE);
const doc = readPublicness();

describe('四条断言链对当前仓库成立', () => {
  it('runCheck 四条全通过，且 id 与顺序稳定', () => {
    const { results, ok } = runCheck();
    expect(results.map((result) => result.id)).toEqual([...ASSERTION_IDS]);
    expect(
      ok,
      results
        .filter((result) => !result.ok)
        .map((result) => `FAIL ${result.id}: ${result.message}`)
        .join('\n'),
    ).toBe(true);
  });

  it('CLI 退出 0 并打印 OK 4/4 publicness gate', () => {
    const run = runCli([]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('OK 4/4 publicness gate');
    // 一行 FAIL 都不该有 —— 主命令的失败信号是 stderr 上以 FAIL 开头的行。
    expect(run.stderr.split('\n').filter((line) => line.startsWith('FAIL '))).toEqual([]);
  });
});

describe('三个坏样例各让一条断言失败（V.0 #1：空真断言必须带负向 fixture）', () => {
  it('--self-test 退出 0，四条断言各被一个坏样例判失败', () => {
    const run = runCli(['--self-test']);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).not.toContain('FAIL self-test: publicness gate is vacuous');
    for (const id of ASSERTION_IDS) {
      expect(run.stdout, `self-test 没有覆盖 ${id}`).toContain(`OK self-test: ${id} 被 `);
    }
  });

  it('selfTest() 的四个用例全部是「被判失败」', () => {
    const { cases, ok } = selfTest();
    expect(cases.map((item) => item.id)).toEqual([...ASSERTION_IDS]);
    expect(ok, cases.filter((item) => !item.failed).map((item) => item.id).join(', ')).toBe(true);
  });

  it('hash-stale.json：状态变而哈希未变 ⇒ HASH_MATCHES 失败并要求重新签字', () => {
    const stale = readJson(FIXTURES.hashStale);
    const result = assertHashMatches(stale);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('状态已变更但未同步签字');
    // 坏样例必须真的只坏在哈希上：四项状态本身是合法的。
    expect(canonicalState(stale)).toContain('"monetized":true');
  });

  it('no-checklist.json：状态变、哈希也改对了、但没新增 CHECKLIST ⇒ 第二条失败', () => {
    const changed = readJson(FIXTURES.noChecklist);
    // 先证明它绕过了第一条 —— 否则这个 fixture 测的其实还是 HASH_MATCHES。
    expect(assertHashMatches(changed).ok).toBe(true);
    const result = assertChecklistAddedOnChange({
      before: doc,
      after: changed,
      addedChecklists: [],
      baseRef: 'fixture-baseline',
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('没有新增任何 compliance/CHECKLIST-*.md');
  });

  it('同一次变化带上一份新增 CHECKLIST ⇒ 第二条通过（证明它不是恒失败）', () => {
    const changed = readJson(FIXTURES.noChecklist);
    const result = assertChecklistAddedOnChange({
      before: doc,
      after: changed,
      addedChecklists: ['compliance/CHECKLIST-2026-10-08.md'],
      baseRef: 'fixture-baseline',
    });
    expect(result.ok, result.message).toBe(true);
  });

  it('checklist-unchecked.md：有未勾选项 ⇒ 第三条失败', () => {
    const result = assertChecklistFullyChecked({
      checklistSource: read(FIXTURES.checklistUnchecked),
      templateSource,
      doc,
      checklistPath: FIXTURES.checklistUnchecked,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('未勾选');
  });
});

describe('两次测试内注入：剩下两条断言也能失败', () => {
  it('monetized 改 true 而不改哈希 ⇒ HASH_MATCHES 失败（不需要临时改仓库文件）', () => {
    const result = assertHashMatches({ ...doc, monetized: true });
    expect(result.ok).toBe(false);
    expect(result.id).toBe('HASH_MATCHES');
    expect(result.message).toContain('acknowledged_hash');
  });

  it(`registered_users 改 ${String(USER_CAP + 1)} ⇒ USERS_WITHIN_CAP 失败`, () => {
    const result = assertUsersWithinCap({ ...doc, registered_users: USER_CAP + 1 });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('超过上限');
    // 恰好等于上限必须通过 —— 否则这条断言的边界是错的。
    expect(assertUsersWithinCap({ ...doc, registered_users: USER_CAP }).ok).toBe(true);
  });
});

describe('模板即断言基准（删条目不会让门禁变松）', () => {
  it('模板的必需条目恰好六条，且与 PITFALLS §1.6 的清单逐条对应', () => {
    const template = parseChecklist(templateSource);
    expect(template.ids).toHaveLength(6);
    expect(new Set(template.ids)).toEqual(new Set(REQUIRED_ITEMS));
  });

  it('已签 checklist 的条目集合与模板一致且未勾选项为 0', () => {
    const checklistRef = doc['acknowledged_checklist'];
    expect(typeof checklistRef).toBe('string');
    const signed = parseChecklist(read(String(checklistRef)));
    expect(new Set(signed.ids)).toEqual(new Set(REQUIRED_ITEMS));
    expect(signed.uncheckedCount).toBe(0);
    for (const item of REQUIRED_ITEMS) {
      const row = signed.rows.get(item);
      expect(row, `已签 checklist 缺少 ${item} 的裁决行`).toBeDefined();
      expect(DISPOSITIONS).toContain(row?.disposition);
      expect((row?.evidence ?? '').length).toBeGreaterThan(0);
    }
  });

  it('从模板删掉一条条目 ⇒ 已签 checklist 与模板失配而失败（注入）', () => {
    const trimmed = templateSource
      .split('\n')
      .filter((line) => !line.includes(`${'`'}appeal_channel${'`'}`))
      .join('\n');
    const result = assertChecklistFullyChecked({
      checklistSource: read(String(doc['acknowledged_checklist'])),
      templateSource: trimmed,
      doc,
      checklistPath: 'injected',
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('与模板不一致');
    expect(result.message).toContain('appeal_channel');
  });

  it('模板被清空 ⇒ 第三条明确失败，而不是「没有必需条目所以全部满足」', () => {
    const result = assertChecklistFullyChecked({
      checklistSource: read(String(doc['acknowledged_checklist'])),
      templateSource: '# 空模板\n',
      doc,
      checklistPath: 'injected',
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('模板即断言基准');
  });
});

describe('四条抗辩破裂后 not_applicable 不再是合法裁决', () => {
  it('monetized 变 true 时，现有那份全 not_applicable 的 checklist 立刻不够用', () => {
    const result = assertChecklistFullyChecked({
      checklistSource: read(String(doc['acknowledged_checklist'])),
      templateSource,
      doc: { ...doc, monetized: true },
      checklistPath: 'injected',
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not_applicable');
    expect(result.message).toContain('implemented');
  });

  it('用户数超上限时同样不接受 not_applicable', () => {
    const result = assertChecklistFullyChecked({
      checklistSource: read(String(doc['acknowledged_checklist'])),
      templateSource,
      doc: { ...doc, registered_users: USER_CAP + 1 },
      checklistPath: 'injected',
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not_applicable');
  });
});

describe('签字机制不得被脚本自己绕过（T-13-03）', () => {
  it('publicness.mjs 不含任何写文件或自动提交能力', () => {
    const source = read('tools/ci/publicness.mjs');
    for (const forbidden of ['writeFile', 'writeFileSync', 'appendFile', 'commit']) {
      expect(
        source.includes(forbidden),
        `publicness.mjs 出现了 ${forbidden} —— 自动更新哈希会绕过 D-08 的签字机制，把门禁变成装饰`,
      ).toBe(false);
    }
  });

  it('哈希是四项状态的函数，与键的书写顺序无关', () => {
    const reordered: Record<string, unknown> = {
      registered_users: doc['registered_users'],
      monetized: doc['monetized'],
      app_store_listed: doc['app_store_listed'],
      public_signup_entrance: doc['public_signup_entrance'],
    };
    expect(computeStateHash(reordered)).toBe(computeStateHash(doc));
    expect(computeStateHash(doc)).toBe(doc['acknowledged_hash']);
  });

  it('acknowledged_hash / acknowledged_checklist 不参与哈希（否则哈希不可能自洽）', () => {
    expect(canonicalState(doc)).not.toContain('acknowledged_hash');
    expect(canonicalState(doc)).not.toContain('acknowledged_checklist');
  });
});

describe('fast.yml 真的会跑这条门禁', () => {
  it('publicness 检查恰好出现一次', () => {
    const workflow = read('.github/workflows/fast.yml');
    const hits = workflow.match(/tools\/ci\/publicness\.mjs/gu) ?? [];
    expect(hits).toHaveLength(1);
  });
});
