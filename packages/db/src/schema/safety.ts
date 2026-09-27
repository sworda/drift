// 安全域 —— 会话级风险状态机 + 安全事件留证 + 联络尝试四态。
//
// ⚠️ 三张表里只有 session_risk_state 与 contact_attempt 允许 UPDATE。
// **safety_event 属审计表族**（0001 迁移对 app_role REVOKE UPDATE, DELETE）。

import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { inValues, newId } from '../sql-helpers.ts';
import { user } from './auth.ts';
import { conversation } from './conversation.ts';
import { message } from './message.ts';

/**
 * R1.21：风险等级是会话/用户级**持久状态**，不是单条消息的瞬时判定。
 * `crisis` 不因下一条消息看起来正常而清零 —— 需要显式冷静期 + 人工确认。
 */
export const RISK_LEVELS = ['none', 'watch', 'elevated', 'crisis'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** SAFE-05：分类器失败一律 fail-closed 到 elevated，**不是** crisis。 */
export const CLASSIFIER_STATUSES = ['ok', 'failed'] as const;
export type ClassifierStatus = (typeof CLASSIFIER_STATUSES)[number];

/**
 * D-10 的四态。判据（RESEARCH §4.5）：
 *   pending     —— IM 告警投递成功（webhook 2xx）后，由系统置
 *   delivered   —— 运营者在后台确认「已与该联系人通话」，**人工**推进；
 *                  短信 API 返回 200 **不是** delivered 的判据
 *   failed      —— pending 超时 10 分钟（服务端计时）或运营者标记联系不上
 *   unavailable —— 无可用联络通道（无联系人 / 号码无效 / **IM 告警投递本身失败**），
 *                  由系统立即置，不经 pending
 */
export const CONTACT_ATTEMPT_STATUSES = ['pending', 'delivered', 'failed', 'unavailable'] as const;
export type ContactAttemptStatus = (typeof CONTACT_ATTEMPT_STATUSES)[number];

export const sessionRiskState = pgTable(
  'session_risk_state',
  {
    conversationId: text('conversation_id')
      .primaryKey()
      .references(() => conversation.id),
    level: text('level').$type<RiskLevel>().notNull().default('none'),
    enteredAt: timestamp('entered_at', { withTimezone: true }).notNull().defaultNow(),
    /** 冷静期终点。null = 不自动衰减（crisis 必须人工清除）。 */
    decayAfter: timestamp('decay_after', { withTimezone: true }),
    /** 运营者标识。清除风险态是一次人工动作，必须留名。 */
    clearedBy: text('cleared_by'),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
  },
  () => [check('session_risk_state_level_allowed', inValues('level', RISK_LEVELS))],
);

export const safetyEvent = pgTable(
  'safety_event',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversation.id),
    /** 触发事件的那条消息。可空：入站规则层在角色消息落库之前就可能抬升风险态。 */
    messageId: text('message_id').references(() => message.id),
    /**
     * risk 轨迹的起点（R1.25「留存 risk_level 轨迹」）。
     *
     * ⚠️ 单独一列而不是塞进 rule_hits：只存终值的话，「这一轮是从哪一档跳上来的」
     * 事后答不出来，而办法第二十三条的安全评估问的正是「用户极端情境的识别、应急
     * 处置、干预管理情况」。default 'none' 让这一列可以后补到已有行上而不需要回填。
     */
    previousLevel: text('previous_level').$type<RiskLevel>().notNull().default('none'),
    level: text('level').$type<RiskLevel>().notNull(),
    ruleHits: jsonb('rule_hits').$type<readonly string[]>().notNull(),
    classifierStatus: text('classifier_status').$type<ClassifierStatus>().notNull(),
    classifierModelSnapshot: text('classifier_model_snapshot'),
    /**
     * 候选回复的**哈希与长度**，不是正文。
     *
     * ⚠️ 不加正文列是一个已裁决的取舍：正文是个人信息，存进这里等于把对话原文再存
     * 一份，一键删除（PRIV-05）的面积随之翻倍，而留证需要的「当时判的是哪段文本」
     * 靠哈希就能回答。
     */
    candidateReplyHash: text('candidate_reply_hash').notNull(),
    candidateReplyLen: integer('candidate_reply_len').notNull(),
    overrideApplied: boolean('override_applied').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('safety_event_user_id_idx').on(t.userId),
    index('safety_event_conversation_id_idx').on(t.conversationId),
    check('safety_event_level_allowed', inValues('level', RISK_LEVELS)),
    check('safety_event_previous_level_allowed', inValues('previous_level', RISK_LEVELS)),
    check('safety_event_classifier_status_allowed', inValues('classifier_status', CLASSIFIER_STATUSES)),
  ],
);

/**
 * ⚠️ **contact_attempt 不属审计表族。** 它是一台状态机，status 必须可 UPDATE
 * （pending → delivered / failed）。0001 迁移里对它显式 GRANT UPDATE 并注明这一点 ——
 * 否则下一个读这份 schema 的人会把它一起 REVOKE，然后四态实现静默退化成两态。
 */
export const contactAttempt = pgTable(
  'contact_attempt',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    safetyEventId: text('safety_event_id')
      .notNull()
      .references(() => safetyEvent.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    /**
     * 加密后的联系方式引用（第三方个人信息）。
     *
     * 可空，且**只有 unavailable 一态允许为空**（见下方
     * contact_attempt_contact_ref_required）。「无联系人记录」正是 unavailable 的三个
     * 成因之一，给它塞一个 '(none)' 之类的哨兵值会让「这一行到底有没有联系方式」
     * 变成一次字符串比较。
     */
    contactRef: text('contact_ref'),
    status: text('status').$type<ContactAttemptStatus>().notNull(),
    alertSentAt: timestamp('alert_sent_at', { withTimezone: true }),
    operatorAckAt: timestamp('operator_ack_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('contact_attempt_user_id_idx').on(t.userId),
    check('contact_attempt_status_allowed', inValues('status', CONTACT_ATTEMPT_STATUSES)),
    /**
     * D-10：`delivered` 的唯一判据是**真人确认已通话**，由 ackDelivered 置入。
     * 这条约束让「填了 delivered_at 但 status 不是 delivered」在数据库层失败 ——
     * 而那正是「在非 delivered 态渲染『已经联系了』」这次虚假陈述的数据形态。
     * 状态**迁移**的合法性由应用层（contact.ts 的条件更新）保证，DB 只兜住终局的
     * 自相矛盾。
     */
    check(
      'contact_attempt_delivered_at_consistency',
      sql.raw(`"delivered_at" is null or "status" = 'delivered'`),
    ),
    /**
     * SAFE-16：`pending` 只能在 IM 告警**投递成功**之后进入。没有 alert_sent_at 的
     * pending 意味着「我们在等一件从未开始的事」，而 UI 会照样渲染「正在联系」。
     */
    check(
      'contact_attempt_pending_requires_alert',
      sql.raw(`"status" <> 'pending' or "alert_sent_at" is not null`),
    ),
    /** 只有 unavailable 允许没有联系方式引用（无联系人记录 / 号码无效）。 */
    check(
      'contact_attempt_contact_ref_required',
      sql.raw(`"contact_ref" is not null or "status" = 'unavailable'`),
    ),
  ],
);
