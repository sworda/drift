// schema 的聚合出口。
//
// ⚠️ **本文件里不允许有任何表定义。** 表按域拆在同目录的 9 个文件里，理由是并行写
// 冲突：后续每个 plan 只改自己域的那一个文件，而一个巨型 schema.ts 会让 Plan 05-15
// 的每一次改动都落在同一个文件上。
//
// drizzle.config.ts 的 `schema: './src/schema'` 指向本目录，drizzle-kit 会遍历
// 目录下所有文件 —— 所以漏掉一个 re-export 不会让表消失，只会让 TS 侧拿不到它。

export * from './auth.ts';
export * from './invite.ts';
export * from './consent.ts';
export * from './character.ts';
export * from './conversation.ts';
export * from './message.ts';
export * from './safety.ts';
export * from './audit.ts';
export * from './usage.ts';
