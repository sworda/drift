// drizzle 里反复用到的两个构造器。
//
// 存在理由只有一条：**值域与 id 生成方式的单一真相源**。像 message.audience 这种
// 「TS 联合类型 + DB CHECK 约束」双写的列，一旦两处分叉，编译期允许的值与数据库
// 允许的值就不再是同一个集合 —— 而那种分叉不会有任何报错，只会在某个新取值第一次
// 落库时炸在运行时。这里让 CHECK 约束**由同一个 as const 数组生成**，分叉在结构上
// 不可能。

import { randomUUID } from 'node:crypto';

import { sql, type SQL } from 'drizzle-orm';

/**
 * 生成 `<column> in ('a', 'b')` 形式的 CHECK 表达式。
 *
 * 用 sql.raw 而不是参数化：CHECK 约束是 DDL，参数占位符在 DDL 里不可用。
 * 入参全部来自本仓库的模块级 as const 常量（不是用户输入），因此拼接是安全的；
 * 下面那条断言把「有人把一个带引号的值塞进值域」变成一次启动期失败，而不是一条
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

/**
 * 主键默认值 —— **客户端生成**，不是 `DEFAULT gen_random_uuid()::text`。
 *
 * ⚠️ 这不是风格选择，是为了让「schema 与实际库无漂移」成为一条能真正变绿的断言。
 * drizzle-kit 0.31 introspect 回来的表达式默认值与它自己生成的写法不是同一个
 * 字面量，于是每次 `drizzle-kit push` 都会为每张带表达式默认值的表产出一条
 * `ALTER COLUMN ... SET DEFAULT` —— 一个永远非空的 diff。那种状态下「无漂移」这条
 * 检查只能靠维护一份「已知可忽略的 diff」白名单来通过，而那与没有这条检查等价。
 *
 * 代价：裸 SQL 的 INSERT 必须自带 id。这是可接受的 —— 业务写入一律走 drizzle，
 * 而 better-auth 本来也在应用侧生成 id。
 */
export function newId(): string {
  return randomUUID();
}
