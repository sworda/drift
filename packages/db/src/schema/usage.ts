// 使用时长域（COMPLY-03 + D-14）。
//
// 计时权威在**服务端**（UI-SPEC〔法定〕：计时在服务端，UI 只渲染）。前端不得自行
// setTimeout 计时 —— 一个后台标签页或一次刷新就会让前端计时器说谎。
//
// 段的定义：15 分钟无消息收发算本段结束并清零累计；多角色会话时长**合并**计入同一
// 计时器（R1.03 明文「累计计时、跨角色合并」）—— 所以这张表按 user_id 归集，
// 不按 conversation_id。
//
// reminded_count 而不是 reminded 布尔：「每超过 2 小时」是**重复**的，不是一次性的。
// 一个布尔值会让 4 小时只提醒一次，而那不是 COMPLY-03 说的。

import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { newId } from '../sql-helpers.ts';
import { user } from './auth.ts';

export const usageSegment = pgTable(
  'usage_segment',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
    accumulatedSeconds: integer('accumulated_seconds').notNull().default(0),
    remindedCount: integer('reminded_count').notNull().default(0),
    /** null = 本段仍在进行中。按 user_id 最多一个 open 段。 */
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [index('usage_segment_user_open_idx').on(t.userId, t.closedAt)],
);
