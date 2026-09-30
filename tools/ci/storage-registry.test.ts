// STORAGE_LOCATIONS 的 A 腿对账（PRIV-05 / D-19 / RESEARCH §7.2）。
//
// 本文件属 contract 层（L4）：不连数据库 —— schema 与注册表都是纯 TS 对象。
// 「注册表 vs 活库」的 B 腿在 tools/ci/storage-registry-db.test.ts（integration 层），
// 两条腿抓的漏登记集合不同，缺一条就是半个防线。
//
// 非空真策略：每条断言都配**注入式**负向输入 —— 把坏数据喂给同一个纯函数，证明
// 断言真的会红（A 腿的失效模式是「集合比较退化成恒等」，注入是唯一能暴露它的形态）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// 相对路径 import（data-inventory.test.ts 的先例）：@drift/db 的包入口会拉进
// client.ts —— 模块加载即读 DATABASE_URL 并构造连接池，ci:fast 不能依赖它。
import { DATA_INVENTORY } from '../../packages/db/src/inventory.ts';
import * as schema from '../../packages/db/src/schema/index.ts';
import { getTableName, is } from 'drizzle-orm';
import { pgTable, PgTable, text } from 'drizzle-orm/pg-core';

import {
  assertStorageRegistryInvariants,
  STORAGE_EXEMPT_TABLES,
  STORAGE_LOCATIONS,
} from '../../packages/db/src/storage-locations.ts';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../../packages/db/src/storage-locations.ts', import.meta.url)),
  'utf8',
);

/** DATA_INVENTORY 里含个人信息的表集合（A 腿交叉核对的输入）。 */
const INVENTORY_TABLES = [...new Set(DATA_INVENTORY.map((entry) => entry.table))].sort();

/** countsAsCleared=false 的项（Q1：去标识化不等于清除）—— 两个 describe 共用。 */
const DEIDENTIFIED = STORAGE_LOCATIONS.filter((l) => l.countsAsCleared === false);

describe('A 腿：drizzle schema ↔ STORAGE_LOCATIONS 集合相等', () => {
  it('真实 schema + 真实注册表 + 真实清单：五条不变式全部通过', () => {
    expect(() =>
      assertStorageRegistryInvariants(schema, STORAGE_LOCATIONS, INVENTORY_TABLES),
    ).not.toThrow();
  });

  it('注册表项数不少于 19（RESEARCH §7.1 的 ≈19 处下界）', () => {
    expect(STORAGE_LOCATIONS.length).toBeGreaterThanOrEqual(19);
  });

  it('含四项非表位置：export_artifact 文件、pgboss.job、pgboss.archive、pino 日志', () => {
    const ids = new Set(STORAGE_LOCATIONS.map((l) => l.id));
    for (const id of ['export_artifact', 'pgboss.job', 'pgboss.archive', 'pino.log']) {
      expect(ids.has(id), `非表位置 ${id} 未登记`).toBe(true);
    }
  });

  it('负向：假 schema 多一张表（裸建的新表）→ 抛错且点名', () => {
    const ghost = { ghost: pgTable('ghost_table', { id: text('id') }) };
    expect(() =>
      assertStorageRegistryInvariants({ ...schema, ...ghost }, STORAGE_LOCATIONS, INVENTORY_TABLES),
    ).toThrow(/ghost_table/);
  });

  it('负向：注册表漏掉一张含个人信息的表 → 抛错且点名', () => {
    const shrunk = STORAGE_LOCATIONS.filter((l) => l.id !== 'emergency_contact');
    expect(() => assertStorageRegistryInvariants(schema, shrunk, INVENTORY_TABLES)).toThrow(
      /emergency_contact/,
    );
  });

  it('负向：DATA_INVENTORY 新登记一张含个人信息的表而注册表没跟上 → 抛错', () => {
    expect(() =>
      assertStorageRegistryInvariants(schema, STORAGE_LOCATIONS, [...INVENTORY_TABLES, 'future_pii_table']),
    ).toThrow(/future_pii_table/);
  });

  it('负向：豁免清单被静默清空 → 抓（character / persona_version 必须显式豁免）', () => {
    expect(() =>
      assertStorageRegistryInvariants(schema, STORAGE_LOCATIONS, INVENTORY_TABLES, []),
    ).toThrow(/character/);
  });
});

describe('A 腿：countsAsCleared 的口径（Q1 裁决）', () => {
  it('countsAsCleared=false 的项恰好是七张 append-only 审计表', () => {
    expect(DEIDENTIFIED.map((l) => l.id).sort()).toEqual([
      'audit.client_error',
      'audit.consent_event',
      'audit.dependency_signal',
      'audit.exit_intent',
      'audit.llm_call',
      'audit.privacy_action',
      'audit.safety_event',
    ]);
  });

  it('去标识化项也有 purge（不清除 ≠ 不处理）且 label 声明「已去除可识别信息」', () => {
    for (const item of DEIDENTIFIED) {
      expect(typeof item.purge, `${item.id} 没有 purge —— 去标识化必须被执行，只是不计入已清除`).toBe('function');
      expect(item.label).toContain('已去除可识别信息');
    }
  });

  it('pino 日志是唯一 containsPersonalInfo=false 的项，且刻意没有 purge', () => {
    const nonPersonal = STORAGE_LOCATIONS.filter((l) => !l.containsPersonalInfo);
    expect(nonPersonal.map((l) => l.id)).toEqual(['pino.log']);
    expect(nonPersonal[0]?.purge).toBeUndefined();
    expect((nonPersonal[0]?.justification ?? '').length).toBeGreaterThan(0);
  });
});

describe('A 腿：执行顺序与 invite_code 的置空语义', () => {
  it('去标识化项排在所有 DELETE 之前（message / conversation / user 的 FK 前提）', () => {
    const order = (id: string): number => {
      const index = STORAGE_LOCATIONS.findIndex((l) => l.id === id);
      expect(index, `找不到 ${id}`).toBeGreaterThanOrEqual(0);
      return index;
    };
    for (const audit of DEIDENTIFIED) {
      expect(order(audit.id)).toBeLessThan(order('message'));
      expect(order(audit.id)).toBeLessThan(order('conversation'));
      expect(order(audit.id)).toBeLessThan(order('user'));
    }
    expect(order('message')).toBeLessThan(order('conversation'));
    expect(order('conversation')).toBeLessThan(order('user'));
  });

  it('user 是注册表的最后一项（其余表全部引用它）', () => {
    expect(STORAGE_LOCATIONS[STORAGE_LOCATIONS.length - 1]?.id).toBe('user');
  });

  it('invite_code 的处置是 UPDATE 置空 used_by，不是 DELETE（D-19：码是运营资产）', () => {
    // 源码形态断言（legal-required-sentences 的先例）：purge 的实现体里
    // .update(inviteCode) 在场、.delete(inviteCode) 不在场。
    const start = SOURCE.indexOf("id: 'invite_code'");
    const end = SOURCE.indexOf('},', start);
    const segment = SOURCE.slice(start, end);
    expect(segment).toContain('.update(inviteCode)');
    expect(segment).not.toContain('.delete(inviteCode)');
  });

  it('每个表级项的表都真实存在（防改名漂移的独立于纯函数的复核）', () => {
    const schemaTableNames = new Set<string>();
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      schemaTableNames.add(getTableName(value));
    }
    for (const location of STORAGE_LOCATIONS) {
      if (location.table === undefined) continue;
      expect(schemaTableNames.has(location.table), `${location.id} 指向不存在的表 ${location.table}`).toBe(true);
    }
    expect(STORAGE_EXEMPT_TABLES).toEqual(['character', 'persona_version']);
  });
});
