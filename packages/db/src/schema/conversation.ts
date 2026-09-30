// 会话与好友关系域（CHAT-01/02/03 · COMPLY-01）。
//
// counterpart_kind 是**界面级持续标识的驱动源**（RESEARCH §8.1）：它回答「对手方是不是
// AI」，据此决定常驻条与徽标的显隐。它**不**回答「标识说什么」—— 文案是
// packages/contract 里的常量，不由服务端下发。这条分工是 COMPLY-01 的执行结构：
// 下发字段可以被置空或被配置改写，常量不能。

import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { inValues, newId } from '../sql-helpers.ts';
import { user } from './auth.ts';
import { character } from './character.ts';

/** v1 只有 AI 角色一种对手方。为 Phase 6 的角色间互动留了取值位置，但现在只有一个值。 */
export const COUNTERPART_KINDS = ['ai_character'] as const;
export type CounterpartKind = (typeof COUNTERPART_KINDS)[number];

/** `ended` 是**硬退出**的终态（COMPLY-05）：进入后当前会话零出站，网关 fail-closed 读它。 */
export const CONVERSATION_STATUSES = ['active', 'ended'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** Phase 1 只有陌生人关系。疏远机制在 Phase 5。 */
export const RELATIONSHIPS = ['stranger'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const conversation = pgTable(
  'conversation',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    characterId: text('character_id')
      .notNull()
      .references(() => character.id),
    counterpartKind: text('counterpart_kind')
      .$type<CounterpartKind>()
      .notNull()
      .default('ai_character'),
    status: text('status').$type<ConversationStatus>().notNull().default('active'),
    /**
     * **per-conversation 的取号器**（CHAT-07）。取号方式是同一事务内
     *   update conversation set next_seq = next_seq + 1 where id = $1 returning next_seq - 1
     * 而不是全局 sequence 或时间戳。
     *
     * ⚠️ 全局 sequence 会产生空洞（其他会话消耗掉的号），于是「断连后补拉是否完整」
     * 就变成一个**无法断言**的问题 —— 收到 3 条还是 5 条都可以解释成正常。
     * 时间戳更糟：同毫秒内两条消息的先后不可判定。
     */
    nextSeq: integer('next_seq').notNull().default(1),
    unreadCount: integer('unread_count').notNull().default(0),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('conversation_user_id_idx').on(t.userId),
    check('conversation_counterpart_kind_allowed', inValues('counterpart_kind', COUNTERPART_KINDS)),
    check('conversation_status_allowed', inValues('status', CONVERSATION_STATUSES)),
    // next_seq 从 1 起单调递增，永不回退。一个 <1 的值意味着取号器被手工改过。
    check('conversation_next_seq_positive', sql.raw('"next_seq" >= 1')),
  ],
);

export const friendship = pgTable(
  'friendship',
  {
    /** 代理主键。语义上的键是 (user_id, character_id) —— 理由同 consent.id 的注释。 */
    id: text('id').primaryKey().$defaultFn(newId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    characterId: text('character_id')
      .notNull()
      .references(() => character.id),
    relationship: text('relationship').$type<Relationship>().notNull().default('stranger'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('friendship_user_character_unique').on(t.userId, t.characterId),
    check('friendship_relationship_allowed', inValues('relationship', RELATIONSHIPS)),
  ],
);
