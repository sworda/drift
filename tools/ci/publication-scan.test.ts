import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as fakeSchema from './fixtures/publication/fake-vector-schema.ts';
import {
  ASSERTION_IDS,
  DYNAMIC_SKIP_ID,
  FIXTURES,
  PUBLICATION_SQL,
  RESEARCH_PUBLICATION,
  VECTOR_TYPE_PATTERN,
  assertL0NoVector,
  assertNoBareTable,
  assertNoVectorColumn,
  loadColumnTypes,
  parsePublicationEntries,
  runStaticScan,
  selfTest,
} from './publication-scan.mjs';

/**
 * RES-03 的静态扫描契约断言（L4）。
 *
 * 三条断言在当前仓库上全部是空真的：publication 是显式空集、真实 schema 里没有向量列、
 * DATA_INVENTORY 还不存在。所以这一层测的不是「当前仓库合规」，而是**扫描器在不合规的
 * 输入上会失败** —— 两个假 SQL 与一次注入各自负责一条。
 *
 * 另加一条 Q3 第三项成立条件的机械化：动态检查的 skip 必须已登记且解除条件非空。
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function runCli(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, ['tools/ci/publication-scan.mjs', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    // DATABASE_URL 刻意不传：fast job 不连任何数据库，动态检查必须走 SKIP 分支。
    env: { ...process.env, DATABASE_URL: '' },
  });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

describe('三条静态断言对当前仓库成立', () => {
  it('runStaticScan 三条全通过，id 与顺序稳定', async () => {
    const { results, ok, entries } = await runStaticScan();
    expect(results.map((result) => result.id)).toEqual([...ASSERTION_IDS]);
    expect(
      ok,
      results
        .filter((result) => !result.ok)
        .map((result) => `FAIL ${result.id}: ${result.message}`)
        .join('\n'),
    ).toBe(true);
    // Phase 1 的 publication 是**显式空集**：创建了 publication 但不 ADD 任何表。
    expect(entries).toEqual([]);
  });

  it('CLI 打印 OK 3/3 publication scan 与一条明确的动态检查判定', () => {
    const run = runCli([]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('OK 3/3 publication scan');
    // skip 也是一条判定 —— 静默跳过与没有这条防线没有区别。
    expect(run.stdout).toContain(`SKIP ${DYNAMIC_SKIP_ID}`);
    expect(run.stderr.split('\n').filter((line) => line.startsWith('FAIL '))).toEqual([]);
  });

  it('真相源文件的头注释写明了「任何 ADD TABLE 都必须带显式列清单」', () => {
    const sql = read(PUBLICATION_SQL);
    expect(sql).toContain('任何 ADD TABLE 都必须带显式列清单');
    expect(sql).toContain(`CREATE PUBLICATION ${RESEARCH_PUBLICATION};`);
  });

  it('注释里的形态示例不会被解析成真实语句（否则这条检查永远红）', () => {
    const sql = read(PUBLICATION_SQL);
    // 文件头注释里确实写着一条带列清单的 ADD TABLE 示例。
    expect(sql).toContain('ADD TABLE\n-- l0_message_shape (id, conversation_id');
    expect(parsePublicationEntries(sql)).toEqual([]);
  });
});

describe('两个假 SQL + 一次注入：三条断言各自能失败（V.0 #1）', () => {
  it('--self-test 退出 0，三条断言各被一个坏样例判失败', async () => {
    const run = runCli(['--self-test']);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).not.toContain('FAIL self-test: publication scan is vacuous');
    for (const id of ASSERTION_IDS) {
      expect(run.stdout, `self-test 没有覆盖 ${id}`).toContain(`OK self-test: ${id} 被 `);
    }
    const { cases, ok } = await selfTest();
    expect(cases.map((item) => item.id)).toEqual([...ASSERTION_IDS]);
    expect(ok, cases.filter((item) => !item.failed).map((item) => item.id).join(', ')).toBe(true);
  });

  it('bare-table.sql：裸表名 ⇒ NO_BARE_TABLE 失败并点名该表', () => {
    const entries = parsePublicationEntries(read(FIXTURES.bareTable));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.columns).toBeNull();
    const result = assertNoBareTable(entries);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('message');
    expect(result.message).toContain('没有显式列清单');
  });

  it('vector-column.sql：先通过 NO_BARE_TABLE，再被 NO_VECTOR_COLUMN 抓住', async () => {
    const entries = parsePublicationEntries(read(FIXTURES.vectorColumn));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.columns).toEqual(['id', 'embedding']);
    // 关键：它必须先过第一条，否则这份 fixture 测的其实还是裸表名。
    expect(assertNoBareTable(entries).ok).toBe(true);

    const columnTypes = await loadColumnTypes([fakeSchema]);
    expect(columnTypes.get('memory.embedding')).toBe('halfvec(1024)');
    const result = assertNoVectorColumn(entries, columnTypes);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('memory.embedding');
    expect(result.message).toContain('halfvec');
  });

  it('注入一条 layer 为 l0 的向量列 ⇒ L0_NO_VECTOR 失败（RES-02 的交叉复核）', async () => {
    const columnTypes = await loadColumnTypes([fakeSchema]);
    const bad = assertL0NoVector(
      [{ table: 'memory', column: 'embedding', layer: 'l0' }],
      columnTypes,
      'injected',
    );
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('L0 绝不存储原文嵌入');

    // 同一条注入换成非向量列必须通过 —— 否则这条断言是恒失败的，同样没有信息量。
    const good = assertL0NoVector(
      [{ table: 'memory', column: 'id', layer: 'l0' }],
      columnTypes,
      'injected',
    );
    expect(good.ok, good.message).toBe(true);
  });

  it('l0 引用了一个不存在的列 ⇒ 同样失败（改名不同步不得静默通过）', async () => {
    const columnTypes = await loadColumnTypes([fakeSchema]);
    const result = assertL0NoVector(
      [{ table: 'memory', column: 'embedding_v2', layer: 'l0' }],
      columnTypes,
      'injected',
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('不存在的列');
  });
});

describe('绕过 ADD TABLE 的三种写法同样被抓（只认 ADD TABLE 的扫描器会放行它们）', () => {
  it('CREATE PUBLICATION ... FOR ALL TABLES ⇒ 裸表名的最严重形态', () => {
    const entries = parsePublicationEntries('CREATE PUBLICATION research_pub FOR ALL TABLES;');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.form).toBe('ALL TABLES');
    expect(assertNoBareTable(entries).ok).toBe(false);
  });

  it('CREATE PUBLICATION ... FOR TABLE <裸表名> ⇒ 与 ALTER ADD TABLE 同等对待', () => {
    const entries = parsePublicationEntries('CREATE PUBLICATION research_pub FOR TABLE message;');
    expect(entries.map((entry) => entry.table)).toEqual(['message']);
    expect(assertNoBareTable(entries).ok).toBe(false);
  });

  it('ALTER PUBLICATION ... ADD TABLES IN SCHEMA ⇒ 裸表名', () => {
    const entries = parsePublicationEntries(
      'ALTER PUBLICATION research_pub ADD TABLES IN SCHEMA public;',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.form).toBe('TABLES IN SCHEMA');
    expect(assertNoBareTable(entries).ok).toBe(false);
  });

  it('DROP TABLE 不构成成员项（把表移出只会让复制范围变小）', () => {
    const entries = parsePublicationEntries('ALTER PUBLICATION research_pub DROP TABLE message;');
    expect(entries).toEqual([]);
  });

  it('多张表一条语句时按顶层逗号切分，括号内的逗号不切', () => {
    const entries = parsePublicationEntries(
      'ALTER PUBLICATION research_pub ADD TABLE a (x, y), b (z);',
    );
    expect(entries.map((entry) => entry.table)).toEqual(['a', 'b']);
    expect(entries[0]?.columns).toEqual(['x', 'y']);
    expect(entries[1]?.columns).toEqual(['z']);
  });
});

describe('解析不出类型的列必须失败（fail-closed）', () => {
  it('列清单里出现一个 schema 里没有的列 ⇒ NO_VECTOR_COLUMN 失败', async () => {
    const entries = parsePublicationEntries(
      'ALTER PUBLICATION research_pub ADD TABLE message (id, mystery_column);',
    );
    const columnTypes = await loadColumnTypes();
    const result = assertNoVectorColumn(entries, columnTypes);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('mystery_column');
    expect(result.message).toContain('无法证明它不是向量列');
  });

  it('真实 schema 里确实一个向量列都没有（所以本条在当前仓库是空真的）', async () => {
    const columnTypes = await loadColumnTypes();
    const vectors = [...columnTypes.entries()].filter(([, type]) =>
      VECTOR_TYPE_PATTERN.test(type),
    );
    expect(vectors).toEqual([]);
    // 顺带证明解析器真的看得见列 —— 否则上面那条会因为映射表为空而空真通过。
    expect(columnTypes.size).toBeGreaterThan(100);
    expect(columnTypes.get('message.id')).toBeDefined();
  });
});

describe('动态检查的 skip 已登记且带解除条件（Q3 第三项成立条件的机械化）', () => {
  it(`SKIPPED_CHECKS.md 有 ${DYNAMIC_SKIP_ID} 一行，解除条件非空且含「Phase 7」与「删除本行」`, () => {
    const rows = read('SKIPPED_CHECKS.md')
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .map((line) => line.split('|').map((cell) => cell.trim()));
    const row = rows.find((cells) => cells[1] === DYNAMIC_SKIP_ID);
    expect(row, `SKIPPED_CHECKS.md 里没有 ${DYNAMIC_SKIP_ID} —— 未登记的 skip 会在 Phase 7 无人察觉地继续 skip`).toBeDefined();
    const why = row?.[2] ?? '';
    const condition = row?.[3] ?? '';
    const registered = row?.[4] ?? '';
    expect(why.length).toBeGreaterThan(0);
    expect(condition.length, '解除条件为空 —— 等于写成「以后再说」').toBeGreaterThan(0);
    expect(condition).toContain('Phase 7');
    expect(condition).toContain('删除本行');
    expect(registered).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it('被 skip 的只是动态复核 —— 三条静态断言没有被 skip', () => {
    const rows = read('SKIPPED_CHECKS.md')
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .map((line) => line.split('|').map((cell) => cell.trim()));
    for (const id of ASSERTION_IDS) {
      expect(
        rows.some((cells) => cells[1] === id),
        `${id} 竟然被登记成了 skip —— 静态断言必须每个 PR 都跑`,
      ).toBe(false);
    }
  });

  it('fast.yml 里这条扫描恰好出现一次', () => {
    const workflow = read('.github/workflows/fast.yml');
    expect(workflow.match(/tools\/ci\/publication-scan\.mjs/gu) ?? []).toHaveLength(1);
  });
});
