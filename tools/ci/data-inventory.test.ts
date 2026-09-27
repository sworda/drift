// DATA_INVENTORY 的四条双向断言 + RES-02 负向 fixture + 视图构造（PRIV-03 / RES-02）。
//
// 本文件属 contract 层（L4）：不连数据库、不连 LLM —— schema 与注册表都是纯 TS 对象，
// drizzle 的 getTableColumns 枚举的是 schema 定义而不是活库（「schema 定义 vs 注册表」
// 的双向一致；「注册表 vs 活库」由 schema-drift.test.ts 的另一条链守）。
//
// 非空真策略（V.0 #7）：四条断言里第四条（l0 禁向量）在 Phase 1 没有被测对象，因此
// 每条断言都配一个**注入式**负向输入 —— 把坏数据喂给同一个纯函数，证明它真的会红，
// 而不是只在执行者手里改坏过一次源码（handoff 惯例：破坏验证写成测试内注入）。

import { getTableColumns, is } from 'drizzle-orm';
import { pgTable, PgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

// 相对路径 import（同 legal-required-sentences.test.ts 的先例）：@drift/db 的包入口
// 会拉进 client.ts —— 模块加载即读 DATABASE_URL 并构造连接池，ci:fast 不能依赖它。
import type { ConsentScope } from '@drift/contract';
import { CONSENT_SCOPES } from '@drift/contract';

import {
  assertInventoryInvariants,
  buildCollectedView,
  countEntriesPerScope,
  type InventoryEntry,
  type NonPersonalColumn,
  DATA_INVENTORY,
  NON_PERSONAL_COLUMNS,
} from '../../packages/db/src/inventory.ts';
import * as schema from '../../packages/db/src/schema/index.ts';
import { fakeL0Inventory, fakeL0Schema } from './fixtures/inventory-l0-vector.ts';

/** 真实 schema 里的表数（Plan 04 的 22 张）—— 第 1 条断言的非空真下界。 */
const EXPECTED_TABLE_COUNT = 22;

/** 「我们收集了什么」的 12 类条目 —— 与 privacy.md「我们收集什么」表逐字一致（Task 2 对齐）。 */
const EXPECTED_HUMAN_LABELS = [
  '账号',
  '登录凭证',
  '紧急联系人',
  '聊天原文',
  '会话与好友关系',
  '使用时长',
  '危机相关记录',
  '退出意图与依赖信号',
  '模型调用记录',
  '同意记录',
  '隐私操作记录',
  '前端错误',
] as const;

const ALL_GRANTED: Record<ConsentScope, boolean> = {
  basic_service: true,
  sensitive_pi: true,
  research_l0: true,
  research_l1: true,
  persona_evolution: true,
};

describe('四条双向断言（真实 schema × 真实注册表）', () => {
  it('第 1–4 条全部通过：22 张表的每一列都被覆盖，且每条引用都真实存在', () => {
    // 第 1 条不抛错即证明 Plan 04 全部表的每一列都在 DATA_INVENTORY 或豁免清单里。
    expect(() => assertInventoryInvariants(schema, DATA_INVENTORY, NON_PERSONAL_COLUMNS)).not.toThrow();
  });

  it('schema 的表数恰为 22、注册表覆盖 100+ 列 —— 断言的非空真下界', () => {
    // 若 schema/index.ts 有一天悄悄导不出任何表（例如 re-export 全被删），第 1 条会
    // 退化为空真。这个下界让那种退化先在这里红。判据与 assertInventoryInvariants
    // 相同（is(x, PgTable) + getTableColumns）。
    const tables = Object.values(schema).filter((value) => is(value, PgTable));
    expect(tables).toHaveLength(EXPECTED_TABLE_COUNT);
    const columnCount = tables.reduce(
      (sum, table) => sum + Object.keys(getTableColumns(table)).length,
      0,
    );
    expect(columnCount).toBeGreaterThan(100);
  });

  it('豁免清单每一条都有非空理由', () => {
    for (const entry of NON_PERSONAL_COLUMNS) {
      expect(entry.justification.trim().length, `${entry.table}.${entry.column} 缺豁免理由`).toBeGreaterThan(0);
    }
  });
});

describe('注入式负向输入（每条断言的非空真证明）', () => {
  it('第 1 条：某表多出一列而未登记 ⇒ 抛错并点名该列', () => {
    const ghostTable = pgTable('ghost_table', { ghostColumn: text('ghost_column') });
    expect(() => assertInventoryInvariants({ ghostTable }, [], [])).toThrow(/ghost_table\.ghost_column/u);
    expect(() => assertInventoryInvariants({ ghostTable }, [], [])).toThrow(/未登记/u);
  });

  it('第 2 条：注册表引用了不存在的列 ⇒ 抛错并点名表与列', () => {
    const badEntry = {
      ...DATA_INVENTORY[0] as InventoryEntry,
      column: 'does_not_exist',
    } as InventoryEntry;
    expect(() =>
      assertInventoryInvariants(schema, [...DATA_INVENTORY, badEntry], NON_PERSONAL_COLUMNS),
    ).toThrow(/user.*does_not_exist/u);
  });

  it('第 3 条：retention 形态不合法 ⇒ 抛错（PRIV-08 的前置）', () => {
    const badEntry = {
      ...(DATA_INVENTORY[0] as InventoryEntry),
      retention: { kind: 'fixed', days: 0 },
    } as InventoryEntry;
    expect(() =>
      assertInventoryInvariants(schema, [...DATA_INVENTORY, badEntry], NON_PERSONAL_COLUMNS),
    ).toThrow(/fixed/u);
  });

  it('第 4 条（RES-02 负向 fixture）：l0 层出现 halfvec 列 ⇒ 抛错，信息含列名与 halfvec', () => {
    // Phase 1 没有 l0 表，这条断言对真实 schema 是空真的 —— fixture 是它唯一的活性证据。
    expect(() => assertInventoryInvariants(fakeL0Schema, [...fakeL0Inventory], [])).toThrow(/embedding/u);
    expect(() => assertInventoryInvariants(fakeL0Schema, [...fakeL0Inventory], [])).toThrow(/halfvec/u);
    expect(() => assertInventoryInvariants(fakeL0Schema, [...fakeL0Inventory], [])).toThrow(/RES-02/u);
  });

  it('豁免清单引用不存在的列 ⇒ 同样抛错（豁免不是免检）', () => {
    const badExemption: NonPersonalColumn = {
      table: 'user',
      column: 'no_such_column',
      containsPersonalInfo: false,
      justification: '理由存在但列不存在',
    };
    expect(() => assertInventoryInvariants(schema, DATA_INVENTORY, [...NON_PERSONAL_COLUMNS, badExemption])).toThrow(
      /no_such_column/u,
    );
  });
});

describe('「我们收集了什么」视图构造（RESEARCH §6.5）', () => {
  it('Phase 1 现实：三个研究 scope 条目数为 0，其余 scope 有真实条目', () => {
    const counts = countEntriesPerScope(DATA_INVENTORY);
    expect(counts['research_l0']).toBe(0);
    expect(counts['research_l1']).toBe(0);
    expect(counts['persona_evolution']).toBe(0);
    expect(counts['basic_service']).toBeGreaterThan(0);
    expect(counts['sensitive_pi']).toBeGreaterThan(0);
    expect(counts['none']).toBeGreaterThan(100);
  });

  it('全授权视图：collected 恰为 none + 两个有数据流的 scope，12 类条目齐', () => {
    const view = buildCollectedView(DATA_INVENTORY, ALL_GRANTED);
    expect(view.collected.map((group) => group.scope)).toEqual(['none', 'basic_service', 'sensitive_pi']);
    const labels = new Set(view.collected.flatMap((group) => group.items.map((item) => item.humanLabel)));
    expect([...labels].sort()).toEqual([...EXPECTED_HUMAN_LABELS].sort());
  });

  it('第三态来源：已授权但无数据流的 scope 恰为三个研究项（由注册表推出，不是字面量清单）', () => {
    const view = buildCollectedView(DATA_INVENTORY, ALL_GRANTED);
    expect(view.authorizedButNotCollecting).toEqual(['research_l0', 'research_l1', 'persona_evolution']);
  });

  it('撤回 sensitive_pi ⇒ 对应分组整组消失（不是置灰）', () => {
    const view = buildCollectedView(DATA_INVENTORY, { ...ALL_GRANTED, sensitive_pi: false });
    expect(view.collected.map((group) => group.scope)).toEqual(['none', 'basic_service']);
    const labels = view.collected.flatMap((group) => group.items.map((item) => item.humanLabel));
    expect(labels).not.toContain('紧急联系人');
    expect(labels).not.toContain('危机相关记录');
  });

  it('注入式翻转证明：给注册表加一条 research_l0 条目 ⇒ 第三态名单与 collected 同时翻转', () => {
    // 「临时给 DATA_INVENTORY 加 research_l0 条目会让 (a) 变红」的可执行形态：Phase 7
    // 研究管道落地时，这两个方向都会自动提醒改文案与清单。
    const injected = [...DATA_INVENTORY, ...(fakeL0Inventory as unknown as readonly InventoryEntry[])];
    const view = buildCollectedView(injected, ALL_GRANTED);
    expect(view.authorizedButNotCollecting).toEqual(['research_l1', 'persona_evolution']);
    expect(view.collected.map((group) => group.scope)).toContain('research_l0');
    // 未授权时第三态也不出现 —— 「已授权」是第三态的前半句，不是装饰。
    const ungranted = buildCollectedView(injected, { ...ALL_GRANTED, research_l0: false });
    expect(ungranted.authorizedButNotCollecting).toEqual(['research_l1', 'persona_evolution']);
    expect(ungranted.collected.map((group) => group.scope)).not.toContain('research_l0');
  });

  it('全授权时 CONSENT_SCOPES 的五项在 collected ∪ 第三态名单里恰好各出现一次', () => {
    const view = buildCollectedView(DATA_INVENTORY, ALL_GRANTED);
    const occurrences = new Map<string, number>();
    for (const group of view.collected) {
      if (group.scope !== 'none') occurrences.set(group.scope, (occurrences.get(group.scope) ?? 0) + 1);
    }
    for (const scope of view.authorizedButNotCollecting) {
      occurrences.set(scope, (occurrences.get(scope) ?? 0) + 1);
    }
    for (const scope of CONSENT_SCOPES) {
      expect(occurrences.get(scope), `scope ${scope} 应恰出现一次`).toBe(1);
    }
  });
});
