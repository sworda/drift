// 消息域 —— COMPLY-09 最强的一条检查与 IFC-08 的两项列级预留都在这张表上。
//
// ⚠️ 这张表里有三个**事后补不了**的设计（D-26，one-way）：
//
//   1. `provenance jsonb NOT NULL` —— IFC-08 的不可后补性完全来自「事后无法为历史
//      消息补溯源」。现在不建，Phase 6/9 就再也补不齐已有消息的来源。NOT NULL 是
//      关键：可空列会在半年后装满 null，那时它与不存在没有区别。
//   2. `audience` —— Phase 1 恒为 'user'，为 Phase 6 的角色间互动预留 'other_character'。
//   3. `(conversation_id, seq)` 唯一 —— 补拉完整性的可断言性建立在它上面。
//
// 而 `disclosure` 那条 CHECK 约束（0000 迁移里生成，0001 迁移里断言其存在）是
// COMPLY-09 的兜底：任何插入角色消息而未注入标识的路径 —— **包括将来新增的、绕过
// insertCharacterMessage 的路径** —— 在数据库层失败。这比任何 lint 或测试都强。

import type { Disclosure } from '@drift/contract';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { inValues, newId } from '../sql-helpers.ts';
import { conversation } from './conversation.ts';

export const SENDER_KINDS = ['user', 'character', 'system'] as const;
export type SenderKind = (typeof SENDER_KINDS)[number];

/** IFC-08 第二项。Phase 1 恒为 'user'。 */
export const MESSAGE_AUDIENCES = ['user', 'other_character'] as const;
export type MessageAudience = (typeof MESSAGE_AUDIENCES)[number];

/** 获取方式。Phase 1 只有 'direct'（用户直接发/角色直接回）。 */
export const ACQUIRED_VIA = ['direct', 'relay', 'system'] as const;
export type AcquiredVia = (typeof ACQUIRED_VIA)[number];

/** IFC-08 第一项：来源用户 / 来源会话 / 获取方式。 */
export interface MessageProvenance {
  readonly sourceUserId: string | null;
  readonly sourceConversationId: string | null;
  readonly acquiredVia: AcquiredVia;
}

/**
 * 内容级 AI 明示标识（COMPLY-09）的列类型。
 *
 * 类型本体在 @drift/contract —— 跨端唯一真相源。**只存事实、不存文案**：
 * 文案是那个包里的 as const 常量，存进每一行会让「改一次配置就静默改掉一处法定
 * 标识」重新变成可能，而且会让同一段法定文字在库里有成千上万份副本。
 *
 * Phase 1 的消费点只有导出管道（气泡流不做逐条脚注，UI-SPEC 明文）。
 */
export type MessageDisclosure = Disclosure;

export const message = pgTable(
  'message',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversation.id),
    /** per-conversation 单调，无空洞无重复。取号见 conversation.nextSeq 的注释。 */
    seq: integer('seq').notNull(),
    senderKind: text('sender_kind').$type<SenderKind>().notNull(),
    text: text('text').notNull(),
    disclosure: jsonb('disclosure').$type<Disclosure>(),
    provenance: jsonb('provenance').$type<MessageProvenance>().notNull(),
    audience: text('audience').$type<MessageAudience>().notNull().default('user'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('message_conversation_seq_unique').on(t.conversationId, t.seq),
    index('message_conversation_created_idx').on(t.conversationId, t.createdAt),
    check('message_sender_kind_allowed', inValues('sender_kind', SENDER_KINDS)),
    check('message_audience_allowed', inValues('audience', MESSAGE_AUDIENCES)),
    /**
     * COMPLY-09 的 DB 兜底。**不要把它改成应用层校验**：应用层校验只覆盖今天存在的
     * 写入路径，而这条约束覆盖所有路径，包括明年某个人新写的那一条。
     */
    check(
      'message_disclosure_required',
      sql.raw(`"sender_kind" <> 'character' or "disclosure" is not null`),
    ),
    check('message_seq_positive', sql.raw('"seq" >= 1')),
  ],
);
