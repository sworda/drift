// @drift/db —— drizzle schema / 迁移 / 连接 / 消息落库的唯一定义处。
//
// 包边界（不可协商）：DATA_INVENTORY 与 STORAGE_LOCATIONS 只能在本包定义（Plan 10/11）。
//
// ⚠️ import 本模块会读 DATABASE_URL 并构造连接池（postgres.js 在首次查询前不开
// socket，所以只是构造）。缺变量即抛错，这是故意的 —— 见 client.ts 的说明。
// 只需要 schema 类型的地方请直接 import `@drift/db` 的 schema 子路径对应文件。

export * from './schema/index.ts';
export * from './client.ts';
export * from './seed/characters.ts';
