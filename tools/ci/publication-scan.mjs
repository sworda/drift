// RES-03：研究库 publication 的静态扫描 —— 第一次复制发生前唯一的防线（RESEARCH §11.1）。
//
// 为什么是静态扫描：研究管道在 Phase 7，Phase 1 没有研究库，所以动态检查（查
// pg_publication_tables）此刻没有被测对象。但 RES-03 的理由正是「必须在第一次复制发生
// 前生效」—— 一条等到 Phase 7 再写的检查，等于把防线推迟到它要防的事情已经发生之后。
// 做法是把 publication DDL 变成 git 里的静态被测对象：db/publication/research_publication.sql
// 是 publication 的唯一真相源，本脚本扫它。
//
// 三条断言：
//   NO_BARE_TABLE     —— 任何没有显式列清单的表名即失败（含 FOR ALL TABLES 与
//                        TABLES IN SCHEMA 这两种连表名都不必写的形态）。白名单必须是
//                        显式的列级白名单，不是表级默认放行。
//   NO_VECTOR_COLUMN  —— 对每个列出的 (表, 列) 反查 drizzle 的 getSQLType()，匹配
//                        vector / halfvec / sparsevec 即失败（RES-02：嵌入反演是成熟
//                        攻击面）。**解析不出类型的列同样失败** —— 无法证明它不是向量列
//                        就不能放行，这是唯一的 fail-closed 方向。
//   L0_NO_VECTOR      —— DATA_INVENTORY 里 layer 为 l0 的列不得是向量类型（与 Plan 10
//                        的第四条断言同源，此处做一次交叉复核）。
//
// ⚠️ 三条都有空真风险：当前仓库的 publication 是显式空集、22 张表 186 列里没有任何
// 向量列、DATA_INVENTORY 还不存在（Plan 10）。因此 --self-test 与两个假 SQL 与断言实现
// 同等重要 —— 没有它们，一个恒返回 ok 的扫描器在 CI 里与真实实现表现完全一致。

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** publication 的唯一真相源。 */
export const PUBLICATION_SQL = 'db/publication/research_publication.sql';

/** 研究库 publication 名。动态检查按它查 pg_publication_tables。 */
export const RESEARCH_PUBLICATION = 'research_pub';

/** 向量类型判据。与 packages/db 侧 RES-02 的断言用同一个正则形态。 */
export const VECTOR_TYPE_PATTERN = /^(vector|halfvec|sparsevec)/iu;

/** 稳定断言 id。顺序即 stdout 的输出顺序。 */
export const ASSERTION_IDS = Object.freeze(['NO_BARE_TABLE', 'NO_VECTOR_COLUMN', 'L0_NO_VECTOR']);

/** 动态检查的 skip id。SKIPPED_CHECKS.md 里必须有这一行，且解除条件非空。 */
export const DYNAMIC_SKIP_ID = 'DYNAMIC_PUBLICATION_CHECK';

/** DATA_INVENTORY 的定义处（Plan 10 落地）。不存在时 L0_NO_VECTOR 按空清单判定并如实说明。 */
export const INVENTORY_MODULE = 'packages/db/src/inventory.ts';

/** 两个负向 fixture 与配套的假 schema。 */
export const FIXTURES = Object.freeze({
  bareTable: 'tools/ci/fixtures/publication/bare-table.sql',
  vectorColumn: 'tools/ci/fixtures/publication/vector-column.sql',
  fakeSchema: 'tools/ci/fixtures/publication/fake-vector-schema.ts',
});

/**
 * 去掉 SQL 注释（行注释与块注释），保留字符串字面量内部的内容。
 *
 * 必须先做这一步：research_publication.sql 的文件头注释里写着 ADD TABLE 的形态示例，
 * 直接正则扫原文会把那段注释解析成一条真实语句 —— 一条永远红的检查与一条永远绿的
 * 检查一样，最后都会被关掉。
 *
 * @param {string} sql
 * @returns {string}
 */
export function stripSqlComments(sql) {
  let out = '';
  let state = 'code';
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    const pair = sql.slice(index, index + 2);
    if (state === 'code') {
      if (pair === '--') {
        state = 'line';
        index += 2;
        continue;
      }
      if (pair === '/*') {
        state = 'block';
        index += 2;
        continue;
      }
      if (char === "'" || char === '"') {
        state = char === "'" ? 'single' : 'double';
        out += char;
        index += 1;
        continue;
      }
      out += char;
      index += 1;
      continue;
    }
    if (state === 'line') {
      if (char === '\n') {
        state = 'code';
        out += '\n';
      }
      index += 1;
      continue;
    }
    if (state === 'block') {
      if (pair === '*/') {
        state = 'code';
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    out += char;
    if ((state === 'single' && char === "'") || (state === 'double' && char === '"')) {
      state = 'code';
    }
    index += 1;
  }
  return out;
}

/**
 * 按顶层逗号切分表清单（括号内的逗号是列清单的一部分，不能切）。
 *
 * @param {string} list
 * @returns {string[]}
 */
function splitTopLevel(list) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * 一个 publication 成员项。columns 为 null 表示**裸表名**（没有显式列清单）。
 *
 * @typedef {{ publication: string, table: string, columns: string[] | null, form: string, statement: string }} PublicationEntry
 */

/**
 * @param {string} item
 * @returns {{ table: string, columns: string[] | null }}
 */
function parseTableItem(item) {
  const nameMatch = /^([\w$."]+)/u.exec(item);
  const name = nameMatch === null ? item : nameMatch[1];
  const table = name.replaceAll('"', '');
  const rest = item.slice(nameMatch === null ? 0 : name.length).trim();
  const columnsMatch = /^\(([^)]*)\)/u.exec(rest);
  if (columnsMatch === null) return { table, columns: null };
  const columns = columnsMatch[1]
    .split(',')
    .map((column) => column.trim().replaceAll('"', ''))
    .filter((column) => column.length > 0);
  return { table, columns: columns.length === 0 ? null : columns };
}

/**
 * 解析出全部 publication 成员项。
 *
 * 覆盖四种加表形态，而不只是 ALTER ... ADD TABLE：CREATE ... FOR TABLE 是同一件事的
 * 另一种写法，FOR ALL TABLES 与 TABLES IN SCHEMA 连表名都不必写 —— 只认 ADD TABLE 的
 * 扫描器会把这三种写法当成「没有加过任何表」而放行。
 *
 * @param {string} sql
 * @returns {PublicationEntry[]}
 */
export function parsePublicationEntries(sql) {
  const stripped = stripSqlComments(sql);
  /** @type {PublicationEntry[]} */
  const entries = [];

  for (const raw of stripped.split(';')) {
    const statement = raw.replace(/\s+/gu, ' ').trim();
    if (statement.length === 0) continue;

    const create = /^CREATE\s+PUBLICATION\s+([\w$]+)\s*(.*)$/iu.exec(statement);
    const alter = /^ALTER\s+PUBLICATION\s+([\w$]+)\s+(ADD|SET|DROP)\s+(.*)$/iu.exec(statement);

    /** @type {{ publication: string, tail: string } | null} */
    let target = null;
    if (create !== null) {
      target = { publication: create[1], tail: create[2].replace(/^FOR\s+/iu, '') };
    } else if (alter !== null && alter[2].toUpperCase() !== 'DROP') {
      // DROP 是把表移出 publication —— 只会让复制范围变小，不构成泄漏路径。
      target = { publication: alter[1], tail: alter[3] };
    }
    if (target === null) continue;

    const tail = target.tail.trim();
    if (tail.length === 0) continue;

    if (/^ALL\s+TABLES/iu.test(tail)) {
      entries.push({
        publication: target.publication,
        table: '<ALL TABLES>',
        columns: null,
        form: 'ALL TABLES',
        statement,
      });
      continue;
    }
    if (/^TABLES\s+IN\s+SCHEMA/iu.test(tail)) {
      entries.push({
        publication: target.publication,
        table: '<TABLES IN SCHEMA ' + tail.replace(/^TABLES\s+IN\s+SCHEMA\s*/iu, '') + '>',
        columns: null,
        form: 'TABLES IN SCHEMA',
        statement,
      });
      continue;
    }
    const tableList = /^TABLE\s+(.+)$/iu.exec(tail);
    if (tableList === null) continue;

    for (const item of splitTopLevel(tableList[1])) {
      const parsed = parseTableItem(item);
      entries.push({
        publication: target.publication,
        table: parsed.table,
        columns: parsed.columns,
        form: 'TABLE',
        statement,
      });
    }
  }

  return entries;
}

/**
 * 从 drizzle schema 模块建「表.列 → SQL 类型」的映射。
 *
 * 刻意不 import @drift/db 的包入口：那里会读 DATABASE_URL 并构造连接池，于是本脚本
 * 在不带任何环境变量的 fast job 里根本加载不起来。schema 目录本身是纯定义。
 *
 * @param {readonly Record<string, unknown>[]} [modules]
 * @returns {Promise<Map<string, string>>}
 */
export async function loadColumnTypes(modules) {
  const drizzle = await import('drizzle-orm');
  const pgCore = await import('drizzle-orm/pg-core');
  const resolved = modules ?? [await import('../../packages/db/src/schema/index.ts')];

  /** @type {Map<string, string>} */
  const map = new Map();
  for (const mod of resolved) {
    for (const value of Object.values(mod)) {
      if (!drizzle.is(value, pgCore.PgTable)) continue;
      const config = pgCore.getTableConfig(value);
      for (const column of Object.values(drizzle.getTableColumns(value))) {
        map.set(config.name + '.' + column.name, column.getSQLType());
      }
    }
  }
  return map;
}

/**
 * DATA_INVENTORY —— 不存在（Plan 10 之前）时返回空清单并如实标注来源为 null。
 *
 * @returns {Promise<{ entries: readonly Record<string, unknown>[], source: string | null }>}
 */
export async function loadInventory() {
  const absolute = path.join(REPO_ROOT, INVENTORY_MODULE);
  if (!existsSync(absolute)) return { entries: [], source: null };
  const mod = await import(pathToFileURL(absolute).href);
  const entries = mod['DATA_INVENTORY'];
  if (!Array.isArray(entries)) return { entries: [], source: null };
  return { entries, source: INVENTORY_MODULE };
}

/**
 * 断言 1：没有裸表名。
 *
 * @param {readonly PublicationEntry[]} entries
 * @returns {{ id: string, ok: boolean, message: string }}
 */
export function assertNoBareTable(entries) {
  const id = 'NO_BARE_TABLE';
  const bare = entries.filter((entry) => entry.columns === null);
  if (bare.length === 0) {
    return {
      id,
      ok: true,
      message:
        entries.length === 0
          ? '没有任何成员项（显式空 publication）'
          : String(entries.length) + ' 个成员项全部带显式列清单',
    };
  }
  return {
    id,
    ok: false,
    message:
      '出现了没有显式列清单的成员项 —— 表级默认放行会在 Phase 7 把新增的列（含向量列）一并复制进研究库：\n' +
      bare
        .map((entry) => '    ' + entry.table + '（形态 ' + entry.form + '）：' + entry.statement)
        .join('\n'),
  };
}

/**
 * 断言 2：列出的列里没有向量类型，且每一列的类型都解析得出来。
 *
 * @param {readonly PublicationEntry[]} entries
 * @param {Map<string, string>} columnTypes
 * @returns {{ id: string, ok: boolean, message: string }}
 */
export function assertNoVectorColumn(entries, columnTypes) {
  const id = 'NO_VECTOR_COLUMN';
  /** @type {string[]} */
  const problems = [];
  let checked = 0;

  for (const entry of entries) {
    if (entry.columns === null) continue;
    for (const column of entry.columns) {
      const key = entry.table + '.' + column;
      const sqlType = columnTypes.get(key);
      checked += 1;
      if (sqlType === undefined) {
        problems.push(
          '    ' + key + '：在 drizzle schema 里解析不出类型 —— 无法证明它不是向量列（fail-closed）',
        );
        continue;
      }
      if (VECTOR_TYPE_PATTERN.test(sqlType)) {
        problems.push('    ' + key + '：' + sqlType + ' 是向量类型（RES-02：嵌入反演）');
      }
    }
  }

  if (problems.length === 0) {
    return {
      id,
      ok: true,
      message:
        checked === 0
          ? entries.length === 0
            ? '没有列出任何列（显式空 publication），因此没有向量列'
            : '没有任何显式列清单可查 —— 那些成员项是裸表名，已由 NO_BARE_TABLE 判失败'
          : String(checked) + ' 个列出的列全部非向量类型且类型均可解析',
    };
  }
  return {
    id,
    ok: false,
    message: '列清单里出现了不得复制的列：\n' + problems.join('\n'),
  };
}

/**
 * 断言 3：DATA_INVENTORY 里 layer 为 l0 的列不得是向量类型（RES-02 的交叉复核）。
 *
 * @param {readonly Record<string, unknown>[]} inventory
 * @param {Map<string, string>} columnTypes
 * @param {string | null} [source]
 * @returns {{ id: string, ok: boolean, message: string }}
 */
export function assertL0NoVector(inventory, columnTypes, source = null) {
  const id = 'L0_NO_VECTOR';
  const l0 = inventory.filter((entry) => entry['layer'] === 'l0');
  /** @type {string[]} */
  const problems = [];

  for (const entry of l0) {
    const key = String(entry['table']) + '.' + String(entry['column']);
    const sqlType = columnTypes.get(key);
    if (sqlType === undefined) {
      problems.push('    ' + key + '：DATA_INVENTORY 引用了一个在 drizzle schema 里不存在的列');
      continue;
    }
    if (VECTOR_TYPE_PATTERN.test(sqlType)) {
      problems.push('    ' + key + '：' + sqlType + ' —— L0 绝不存储原文嵌入（RES-02）');
    }
  }

  if (problems.length === 0) {
    if (source === null) {
      return {
        id,
        ok: true,
        message:
          '空清单：' +
          INVENTORY_MODULE +
          ' 尚不存在（DATA_INVENTORY 由 Plan 10 落地），本条此刻是空真的 —— 非空真由 --self-test 的注入用例证明',
      };
    }
    return {
      id,
      ok: true,
      message: source + ' 中 ' + String(l0.length) + ' 个 l0 列全部非向量类型',
    };
  }
  return { id, ok: false, message: 'l0 层出现向量列：\n' + problems.join('\n') };
}

/** @param {string} rel */
function read(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

/**
 * 三条静态断言。
 *
 * @param {{ file?: string }} [options]
 * @returns {Promise<{ results: { id: string, ok: boolean, message: string }[], ok: boolean, entries: PublicationEntry[] }>}
 */
export async function runStaticScan({ file = PUBLICATION_SQL } = {}) {
  const entries = parsePublicationEntries(read(file));
  const columnTypes = await loadColumnTypes();
  const inventory = await loadInventory();
  const results = [
    assertNoBareTable(entries),
    assertNoVectorColumn(entries, columnTypes),
    assertL0NoVector(inventory.entries, columnTypes, inventory.source),
  ];
  return { results, ok: results.every((result) => result.ok), entries };
}

/**
 * 动态检查：查 pg_publication_tables，断言列出的列都不是向量类型。
 *
 * 库里不存在 research_pub 时**明确 skip 并打印**，不静默跳过 —— 一个静默 skip 掉的检查
 * 与一条不存在的防线没有区别，而 Phase 7 正是第一次复制发生的时刻。
 *
 * @returns {Promise<{ id: string, state: 'ok' | 'fail' | 'skip', message: string }>}
 */
export async function runDynamicScan() {
  const id = DYNAMIC_SKIP_ID;
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    return {
      id,
      state: 'skip',
      message:
        'not connected（DATABASE_URL 未设置）—— Phase 1 无研究库，已登记 SKIPPED_CHECKS.md 的 ' +
        id,
    };
  }

  const { default: postgres } = await import('postgres');
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const publications = await sql`select pubname from pg_publication where pubname = ${RESEARCH_PUBLICATION}`;
    if (publications.length === 0) {
      return {
        id,
        state: 'skip',
        message:
          'no research publication in database —— 库里没有名为 ' +
          RESEARCH_PUBLICATION +
          ' 的 publication，已登记 SKIPPED_CHECKS.md 的 ' +
          id,
      };
    }
    const rows = await sql`
      select t.tablename, c.column_name, c.udt_name
        from pg_publication_tables t
        join information_schema.columns c
          on c.table_schema = t.schemaname and c.table_name = t.tablename
       where t.pubname = ${RESEARCH_PUBLICATION}
         and c.column_name = any(t.attnames)
    `;
    const bad = rows.filter((row) => VECTOR_TYPE_PATTERN.test(String(row['udt_name'])));
    if (bad.length > 0) {
      return {
        id,
        state: 'fail',
        message:
          '库内 publication 含向量列：' +
          bad
            .map(
              (row) =>
                String(row['tablename']) +
                '.' +
                String(row['column_name']) +
                ' (' +
                String(row['udt_name']) +
                ')',
            )
            .join(', '),
      };
    }
    return {
      id,
      state: 'ok',
      message: '库内 publication 的 ' + String(rows.length) + ' 个列全部非向量类型',
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * 两个假 SQL + 一次注入，证明三条断言各自能失败。
 *
 * @returns {Promise<{ cases: { id: string, source: string, failed: boolean, message: string }[], ok: boolean }>}
 */
export async function selfTest() {
  const realSchema = await import('../../packages/db/src/schema/index.ts');
  const fakeSchema = await import('./fixtures/publication/fake-vector-schema.ts');
  const columnTypes = await loadColumnTypes([realSchema, fakeSchema]);

  /** @type {{ id: string, source: string, failed: boolean, message: string }[]} */
  const cases = [];

  const bare = assertNoBareTable(parsePublicationEntries(read(FIXTURES.bareTable)));
  cases.push({
    id: 'NO_BARE_TABLE',
    source: FIXTURES.bareTable,
    failed: !bare.ok,
    message: bare.message,
  });

  const vectorEntries = parsePublicationEntries(read(FIXTURES.vectorColumn));
  // 先证明这份 fixture 绕过了第一条 —— 否则它测的其实还是 NO_BARE_TABLE。
  const vectorBare = assertNoBareTable(vectorEntries);
  const vector = assertNoVectorColumn(vectorEntries, columnTypes);
  cases.push({
    id: 'NO_VECTOR_COLUMN',
    source: FIXTURES.vectorColumn + '（+ ' + FIXTURES.fakeSchema + '，且已先通过 NO_BARE_TABLE）',
    failed: !vector.ok && vectorBare.ok,
    message: vector.message,
  });

  const l0 = assertL0NoVector(
    [{ table: 'memory', column: 'embedding', layer: 'l0' }],
    columnTypes,
    'injected',
  );
  cases.push({
    id: 'L0_NO_VECTOR',
    source: '注入一条 layer 为 l0 且列类型为 halfvec 的 DATA_INVENTORY 条目',
    failed: !l0.ok,
    message: l0.message,
  });

  return { cases, ok: cases.every((item) => item.failed) };
}

/** @param {readonly string[]} argv */
async function main(argv) {
  const flag = argv[0] ?? '--check';

  if (flag === '--self-test') {
    const { cases, ok } = await selfTest();
    for (const item of cases) {
      process.stdout.write(
        (item.failed ? 'OK self-test' : 'FAIL self-test') +
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
      process.stdout.write('FAIL self-test: publication scan is vacuous\n');
      return 1;
    }
    process.stdout.write('OK self-test: 3 条断言各有一个坏样例证明它能失败\n');
    return 0;
  }

  if (flag === '--dynamic') {
    const dynamic = await runDynamicScan();
    if (dynamic.state === 'fail') {
      process.stderr.write('FAIL ' + dynamic.id + ': ' + dynamic.message + '\n');
      return 1;
    }
    process.stdout.write(
      (dynamic.state === 'skip' ? 'SKIP ' : 'OK ') + dynamic.id + ': ' + dynamic.message + '\n',
    );
    return 0;
  }

  /** @type {string | undefined} */
  let file;
  if (flag === '--file') {
    file = argv[1];
    if (file === undefined) {
      process.stderr.write('用法：node tools/ci/publication-scan.mjs --file <path>\n');
      return 2;
    }
  } else if (flag !== '--check') {
    process.stderr.write(
      '用法：node tools/ci/publication-scan.mjs [--check | --file <path> | --dynamic | --self-test]\n',
    );
    return 2;
  }

  const { results, ok } = await runStaticScan(file === undefined ? {} : { file });
  for (const result of results) {
    if (result.ok) {
      process.stdout.write('OK ' + result.id + ': ' + result.message + '\n');
    } else {
      process.stderr.write('FAIL ' + result.id + ': ' + result.message + '\n');
    }
  }
  if (!ok) return 1;
  process.stdout.write('OK 3/3 publication scan\n');

  // 动态检查在这里**明确打印一条判定**（skip 也是判定）。静默跳过等于没有这条防线。
  const dynamic = await runDynamicScan();
  if (dynamic.state === 'fail') {
    process.stderr.write('FAIL ' + dynamic.id + ': ' + dynamic.message + '\n');
    return 1;
  }
  process.stdout.write(
    (dynamic.state === 'skip' ? 'SKIP ' : 'OK ') + dynamic.id + ': ' + dynamic.message + '\n',
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
