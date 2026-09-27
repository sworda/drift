// 同意域 —— 五项可独立开关、互不捆绑的同意（PRIV-01，个保法第十四条）。
//
// 五个 scope 的**取值与顺序与 REQUIREMENTS.md 的 PRIV-01 逐字一致**，这不是巧合：
// 注册页的五个 Checkbox、隐私中心的五个开关、consent_event 的留证、以及导出物里
// 的「同意的当前状态与变更历史」全部由这一个数组派生。改这个数组就是改法定披露口径，
// 必须同步改 PRIV-01 与隐私政策（tools/ci/check-contract-amendments.mjs 盯着这件事）。
//
// ⚠️ 表里**没有**「全选」的任何痕迹，这是结构性的：主键是 (user_id, scope)，
// 一行只能表达一个 scope 的意思。没有任何一行能表达「全部同意」。

import { boolean, check, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { CONSENT_SCOPES, type ConsentScope } from '@drift/contract';

import { inValues, newId } from '../sql-helpers.ts';
import { user } from './auth.ts';

/**
 * PRIV-01 的五项。**定义在 @drift/contract**（连同界面文案与必选性），这里只再导出。
 *
 * 为什么不在这个文件里定义：注册页的五个 Checkbox、注册事务的逐项写入、以及下面
 * 这条 CHECK 的取值域是同一份法定披露口径。写两份就是两份口径，而分叉的那一天不会
 * 有任何检查变红（Plan 09）。
 */
export { CONSENT_SCOPES, type ConsentScope };

export const consent = pgTable(
  'consent',
  {
    /**
     * 代理主键。
     *
     * ⚠️ 语义上的键是 (user_id, scope)，由下面那条唯一索引保证 —— PRIMARY KEY 与
     * UNIQUE + NOT NULL 的约束强度相同。之所以不直接用复合主键：drizzle-kit 0.31
     * introspect 回来的复合主键与它自己生成的形态不等价，于是每次 `drizzle-kit push`
     * 都会为它产出一对 DROP CONSTRAINT / ADD CONSTRAINT —— 一个永远非空的 diff，
     * 而「无漂移」这条检查一旦只能靠白名单通过就等于不存在。代理主键顺带也让
     * RES-08 的列级白名单 publication 有一个稳定的复制身份。
     */
    id: text('id').primaryKey().$defaultFn(newId),
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
    uniqueIndex('consent_user_scope_unique').on(t.userId, t.scope),
    check('consent_scope_allowed', inValues('scope', CONSENT_SCOPES)),
  ],
);
