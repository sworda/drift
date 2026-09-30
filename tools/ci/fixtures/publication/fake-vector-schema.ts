// 假 schema：给坏样例 2 提供一张带向量列的表。
//
// 为什么不是一个手写的类型映射表：扫描器查的是 drizzle 的 getSQLType()，用假映射表
// 喂它就绕过了真正的解析路径 —— 那样 self-test 证明的是「映射表里写了 halfvec 会被
// 抓到」，而不是「drizzle 里声明成 halfvec 会被抓到」。customType 走的是同一条路径。
//
// Phase 1 的真实 schema 里没有任何向量列（22 张表 186 列全是 text / timestamp /
// integer / boolean / jsonb / real / date），所以 NO_VECTOR_COLUMN 在当前仓库上是
// 空真的 —— 这份 fixture 就是它的非空真证明。

import { customType, pgTable, text } from 'drizzle-orm/pg-core';

/** pgvector 的半精度向量类型。这里只需要它的 SQL 类型名，不需要 driver 侧行为。 */
const halfvec = customType<{ data: number[] }>({
  dataType() {
    return 'halfvec(1024)';
  },
});

export const memory = pgTable('memory', {
  id: text('id').primaryKey(),
  /** 原文嵌入 —— RES-02 明令不得进研究库。 */
  embedding: halfvec('embedding'),
});
