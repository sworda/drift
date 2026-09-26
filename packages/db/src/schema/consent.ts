// 同意域 —— 五项可独立开关、互不捆绑的同意（PRIV-01，个保法第十四条）。
//
// 五个 scope 的**取值与顺序与 REQUIREMENTS.md 的 PRIV-01 逐字一致**，这不是巧合：
// 注册页的五个 Checkbox、隐私中心的五个开关、consent_event 的留证、以及导出物里
// 的「同意的当前状态与变更历史」全部由这一个数组派生。改这个数组就是改法定披露口径，
// 必须同步改 PRIV-01 与隐私政策（tools/ci/check-contract-amendments.mjs 盯着这件事）。
//
// ⚠️ 表里**没有**「全选」的任何痕迹，这是结构性的：主键是 (user_id, scope)，
// 一行只能表达一个 scope 的意思。没有任何一行能表达「全部同意」。

import { boolean, pgTable, primaryKey, text, timestamp, check } from 'drizzle-orm/pg-core';

import { inValues } from '../sql-helpers.ts';
import { user } from './auth.ts';

/** PRIV-01 的五项。前两项必选（合同履行必要 + 个保法第二十九条单独同意）。 */
export const CONSENT_SCOPES = [
  'basic_service',
  'sensitive_pi',
  'research_l0',
  'research_l1',
  'persona_evolution',
] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

/** 必选项。撤回它们等同于停止服务并进入删除流程（PRIV-02，Q2 裁决）。 */
export const REQUIRED_CONSENT_SCOPES = ['basic_service', 'sensitive_pi'] as const;

export const consent = pgTable(
  'consent',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    scope: text('scope').$type<ConsentScope>().notNull(),
    granted: boolean('granted').notNull(),
    /**
     * 用户当时同意的是哪一版政策。**不可省**（ARCHITECTURE §8.2 第 10 条）：
     * 取 apps/web/content/legal/privacy.md 的内容哈希，于是「政策改了但用户同意的是
     * 旧版」这件事可被一条 SQL 查出来，而不是靠人记得。
     */
    policyVersion: text('policy_version').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'consent_pkey', columns: [t.userId, t.scope] }),
    check('consent_scope_allowed', inValues('scope', CONSENT_SCOPES)),
  ],
);
