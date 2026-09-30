// RES-02 的负向 fixture（V.0 #7）—— 一个假的 l0 表 + 一条 layer 为 l0、列为
// halfvec(1024) 的注册表条目。
//
// 为什么必须存在：Phase 1 没有任何 l0 层的表，assertInventoryInvariants 的第四条断言
// （l0 禁向量列）因此**空真** —— 这份 fixture 是它唯一的活性证据。喂进去必须抛错，
// 否则那条断言已经在某个 refactor 里悄悄死掉了，而 Phase 7 接研究管道的那一天没人
// 会发现。
//
// halfvec 用 customType 构造：dataType() 的返回值就是 getSQLType() 的输出，于是这条
// 断言走的是与真实 schema 完全相同的代码路径（getTableColumns → column.getSQLType()），
// 而不是一个为了让测试通过而写的假钩子。

import { customType, pgTable } from 'drizzle-orm/pg-core';

/** halfvec(1024) —— STACK §1 定的向量列类型。这里只造类型字符串，不依赖 pgvector。 */
const halfvec = (dimension: number) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => `halfvec(${String(dimension)})`,
  })(`embedding`, { dimension });

/**
 * 假的 l0 表：真实 schema 里不存在它，因此测试**不能**把它混进真 schema 模块 ——
 * 那会顺带触发别的断言。它只作为独立的 schema 模块喂给 assertInventoryInvariants，
 * 与一条只引用它的 inventory 一起证明第四条断言会红。表里**只有** embedding 一列 ——
 * 多任何一列都会让第 1 条断言（未登记列）先红，第四条就轮不到被证明。
 */
export const fakeL0Table = pgTable('fake_research_l0', {
  embedding: halfvec(1024),
});

/** 配套的假 inventory：一条 layer 为 l0 的向量列条目（带上必需字段的最小形状）。 */
export const fakeL0Inventory = [
  {
    table: 'fake_research_l0',
    column: 'embedding',
    humanLabel: 'L0 行为特征（fixture）',
    purpose: '负向 fixture：证明 l0 禁向量断言活着',
    consentScope: 'research_l0',
    containsPersonalInfo: true,
    isSensitive: false,
    layer: 'l0',
    retention: { kind: 'fixed', days: 730 },
  },
] as const;

/** 只含 l0 表的假 schema 模块 —— 第 1 条断言在它身上成立（该表仅有的列就是 embedding）。 */
export const fakeL0Schema = { fake_research_l0: fakeL0Table };
