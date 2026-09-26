// 邀请码域 —— 一次性准入凭证（D-22/D-23）。
//
// 码是**运营资产**：用完不删行、只置 used_by/used_at（D-19 要求一键删除时把
// used_by 置空而不是删掉码本身）。
//
// ⚠️ 一次性语义的执行点不在这张表的结构里，而在消耗它的那条 SQL：
//   update invite_code set used_by = $2, used_at = now()
//    where code = $1 and used_by is null and revoked_at is null returning code
// 「先 select 判断再 update」在并发下两个请求都会读到 used_by is null（T-04-03）。
// 条件更新 + RETURNING 让「恰好一个成功」由数据库的行锁保证。

import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const inviteCode = pgTable('invite_code', {
  /** 码本身就是主键 —— 不需要第二个 id，也让并发消耗的条件更新落在主键上。 */
  code: text('code').primaryKey(),
  /** 运营者标识（自由文本，不是 user.id：发码的人不一定是平台用户）。 */
  createdBy: text('created_by').notNull(),
  /**
   * 消耗者。**故意不建外键**（见 auth.ts 的 user.inviteCodeId 注释）：
   * 反向外键会形成表间循环。权威关联是 user.invite_code_id 那一侧。
   */
  usedBy: text('used_by'),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
