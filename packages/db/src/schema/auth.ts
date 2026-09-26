// 身份域 —— better-auth 1.7.6 的四张核心表 + 紧急联系人。
//
// 四张核心表的**列名与类型按 better-auth 的期望形状建**（RESEARCH §6.1）：Plan 09
// 接入 better-auth 时直接指向它们，不做一次 schema 迁移。两个 additionalFields
// （birth_date / invite_code_id）在这里就建成 NOT NULL —— 18+ 与邀请码准入都是
// 注册的前置条件，允许它们为空就等于允许一个绕过两条准入的账号存在。
//
// ⚠️ **同意项不在这里**。它们另建 consent / consent_event 两张表，理由是撤回需要
// 时间线、披露需要 scope→字段的映射、而 scope 会随阶段增长（RESEARCH §6.1）。
// 把五项同意塞进 user.additionalFields 会让这三件事都做不了。

import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { idDefault, inValues } from '../sql-helpers.ts';
import { inviteCode } from './invite.ts';

/** 紧急联系人的两种角色。未满 18 的监护人与成年用户自填的紧急联系人不是同一件事。 */
export const EMERGENCY_CONTACT_KINDS = ['guardian', 'emergency'] as const;
export type EmergencyContactKind = (typeof EMERGENCY_CONTACT_KINDS)[number];

/**
 * 可达性。D-22：Phase 1 一律记为 `unconfirmed` —— 我们没有任何手段证明一个号码
 * 真的能打通，而写成 confirmed 就是陈述一件未发生的事。
 *
 * ⚠️ 语义澄清（RESEARCH §4.5）：`unconfirmed` 本身**不**导致 contact_attempt 进入
 * `unavailable`。Phase 1 有通道（运营者），只有 IM 告警投递失败才是 unavailable。
 */
export const CONTACT_REACHABILITY = ['unconfirmed', 'confirmed'] as const;
export type ContactReachability = (typeof CONTACT_REACHABILITY)[number];

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey().default(idDefault),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    /**
     * COMPLY-07 的判据载体。存出生日期而不是「是否成年」布尔值：布尔值会在用户
     * 生日那天变成错的，而没有任何东西会去更新它。
     */
    birthDate: date('birth_date').notNull(),
    /**
     * 消耗掉的邀请码。这是 user → invite_code 的**单向**外键。
     *
     * 反向（invite_code.used_by → user）故意**不建**外键：两个方向都建会形成表间
     * 循环引用，drizzle 需要跨文件循环 import 才能表达，而 ESM 循环在运行时是一个
     * 取到 undefined 的坑。D-19 也要求 used_by 可被置空（码本身是运营资产），
     * 一个 NOT NULL 的强约束放在这一侧更合适。
     */
    inviteCodeId: text('invite_code_id')
      .notNull()
      .references(() => inviteCode.code),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('user_email_unique').on(t.email)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey().default(idDefault),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    /** 凭证哈希。**永远不存明文** —— 写入方必须是 packages/db/src/onboarding.ts 的 scrypt 哈希。 */
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey().default(idDefault),
    /** 不透明随机串。路由的身份解析只认它 —— 不存在任何「请求里带 userId 就当成登录」的路径。 */
    token: text('token').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('session_token_unique').on(t.token), index('session_user_id_idx').on(t.userId)],
);

export const verification = pgTable('verification', {
  id: text('id').primaryKey().default(idDefault),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const emergencyContact = pgTable(
  'emergency_contact',
  {
    id: text('id').primaryKey().default(idDefault),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    kind: text('kind').$type<EmergencyContactKind>().notNull(),
    name: text('name').notNull(),
    /**
     * 加密后的联系方式引用。**这是第三方的个人信息** —— 它不是本账号的数据，
     * 界面上必须遮蔽（138****1234，UI-SPEC〔法定〕），存储上必须加密。
     * 加密实现是 Plan 09 的 packages/db/src/crypto.ts。
     */
    contactRefEncrypted: text('contact_ref_encrypted').notNull(),
    reachability: text('reachability')
      .$type<ContactReachability>()
      .notNull()
      .default('unconfirmed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('emergency_contact_user_id_idx').on(t.userId),
    check('emergency_contact_kind_allowed', inValues('kind', EMERGENCY_CONTACT_KINDS)),
    check(
      'emergency_contact_reachability_allowed',
      inValues('reachability', CONTACT_REACHABILITY),
    ),
  ],
);
