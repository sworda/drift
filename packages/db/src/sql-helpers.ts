// drizzle 里反复用到的两个 SQL 片段构造器。
//
// 存在理由只有一条：**值域的单一真相源**。像 message.audience 这种「TS 联合类型 +
// DB CHECK 约束」双写的列，一旦两处分叉，编译期允许的值与数据库允许的值就不再是
// 同一个集合 —— 而那种分叉不会有任何报错，只会在某个新取值第一次落库时炸在运行时。
// 这里让 CHECK 约束**由同一个 as const 数组生成**，分叉在结构上不可能。

import { sql, type SQL } from 'drizzle-orm';

/**
 * 生成 `<column> in ('a', 'b')` 形式的 CHECK 表达式。
 *
 * 用 sql.raw 而不是参数化：CHECK 约束是 DDL，参数占位符在 DDL 里不可用。
 * 入参全部来自本仓库的模块级 as const 常量（不是用户输入），因此拼接是安全的；
 * 下面那条断言把「有人把一个带引号的值塞进值域」变成一次启动期失败而不是一条
 * 语法错误的迁移。
 */
export function inValues(column: string, values: readonly string[]): SQL {
  for (const value of values) {
    // 允许点号：PLAT-05 的语义角色是 `chat.reply` 这种点分名字。
    if (!/^[a-z0-9_.]+$/.test(value)) {
      throw new Error(`inValues(${column}) 的取值必须是 [a-z0-9_.]+，收到：${value}`);
    }
  }
  return sql.raw(`"${column}" in (${values.map((v) => `'${v}'`).join(', ')})`);
}

/** 主键与外键统一用的 id 默认值。PG 13+ 内置 gen_random_uuid()，不需要 pgcrypto。 */
export const idDefault: SQL = sql`gen_random_uuid()::text`;
