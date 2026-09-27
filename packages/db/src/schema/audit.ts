// 审计表族（D-06）—— 七张表分类型、同库、**append-only**。
//
// 「分开建」不可逆：合表需要数据迁移，且会破坏已经写好的断言。现在分对了就一直对。
//
// append-only 的执行手段是 **PG 权限**，不是「我们代码里不写 UPDATE」：
//   REVOKE UPDATE, DELETE ON <七张表> FROM app_role;   -- 0001 迁移
// 这比代码约定强得多，且是一条可断言的 DB 事实（tools/ci/schema-drift.test.ts 断言
// app_role 的 UPDATE 真的抛权限错误）。删除 worker 用独立的 purge_role。
//
// 七张表：safety_event（在 safety.ts）· consent_event · privacy_action · llm_call ·
// client_error · exit_intent · dependency_signal

import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';

import { inValues, newId } from '../sql-helpers.ts';
import { user } from './auth.ts';
import { CONSENT_SCOPES, type ConsentScope } from './consent.ts';
import { conversation } from './conversation.ts';

export const CONSENT_ACTIONS = ['grant', 'revoke'] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

export const PRIVACY_ACTION_KINDS = ['export', 'delete', 'revoke'] as const;
export type PrivacyActionKind = (typeof PRIVACY_ACTION_KINDS)[number];

/**
 * PLAT-05 的语义角色，同时是 llm_call.purpose 的取值域。
 *
 * ⚠️ `purpose` 与 `turn_id` 是本阶段**最高杠杆的两个字段**：它们把「危机判定发生在
 * 人格渲染之后」与「安全层用的是另一个模型」这两条架构约束，从代码审查题变成 SQL
 * 查询题（RESEARCH §4.1 的两条断言）。两列都 NOT NULL。
 */
export const LLM_PURPOSES = [
  'chat.reply',
  'chat.reply.frontier',
  'persona.reflect',
  'persona.probe',
  'memory.extract',
  'safety.classify',
] as const;
export type LlmPurpose = (typeof LLM_PURPOSES)[number];

/** COMPLY-04 / SAFE-14 的三条硬阈值（D-13）。阈值本身是配置常量，这里只是 rule_id 的域。 */
export const DEPENDENCY_RULE_IDS = [
  'daily_usage_over_3h',
  'seven_consecutive_days',
  'late_night_share_over_40pct',
] as const;
export type DependencyRuleId = (typeof DEPENDENCY_RULE_IDS)[number];

export const consentEvent = pgTable(
  'consent_event',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    // 0004 起可空：一键删除的去标识化（Q1）把 user_id 置 NULL —— 审计行保留
    // 事件形状（6 个月，COMPLY-11），不再指向任何用户。
    userId: text('user_id').references(() => user.id),
    scope: text('scope').$type<ConsentScope>().notNull(),
    action: text('action').$type<ConsentAction>().notNull(),
    policyVersion: text('policy_version').notNull(),
    /** 'registration' | 'privacy_center' | … 变更是在哪个界面发生的。 */
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('consent_event_user_id_idx').on(t.userId),
    check('consent_event_scope_allowed', inValues('scope', CONSENT_SCOPES)),
    check('consent_event_action_allowed', inValues('action', CONSENT_ACTIONS)),
  ],
);

export const privacyAction = pgTable(
  'privacy_action',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    // 0004 起可空（同上，Q1 去标识化）。
    userId: text('user_id').references(() => user.id),
    kind: text('kind').$type<PrivacyActionKind>().notNull(),
    /** 回执的逐项清单（PRIV-05：数量 = purge 成功执行的项数，清单带每项行数）。 */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('privacy_action_user_id_idx').on(t.userId),
    check('privacy_action_kind_allowed', inValues('kind', PRIVACY_ACTION_KINDS)),
  ],
);

export const llmCall = pgTable(
  'llm_call',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    /** 同一次用户消息引发的全部调用共享一个 turn_id。RESEARCH §4.1 的两条断言按它 JOIN。 */
    turnId: text('turn_id').notNull(),
    purpose: text('purpose').$type<LlmPurpose>().notNull(),
    provider: text('provider').notNull(),
    /** 调用方**要求**的模型标识。 */
    requestedModel: text('requested_model').notNull(),
    /** 路由表解析出的快照标识。SAFE-02 的模型分离断言比的是这一列。 */
    modelSnapshot: text('model_snapshot').notNull(),
    /**
     * provider 回传的实际模型。与 requested_model 不一致即「别名被解析」，
     * 本身是一个应告警事件（STACK §15.9 第 3 条）。
     */
    resolvedModel: text('resolved_model'),
    providerRequestId: text('provider_request_id'),
    /** 提示词内容哈希（PLAT-08）。 */
    promptVersion: text('prompt_version').notNull(),
    /**
     * 输入的内容哈希。
     * ⚠️ 这一列是「不存 prompt 正文」这条取舍的替代品：归因需要的是「当时喂进去的
     * 是不是同一段输入」，哈希就能回答；存正文等于把全部对话原文再存一份，
     * 一键删除的面积翻倍。全表**不得**出现 prompt_text / input_text / messages 之类的列。
     */
    inputHash: text('input_hash').notNull(),
    personaVersionId: text('persona_version_id'),
    thinkingMode: text('thinking_mode'),
    temperature: real('temperature'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    cachedTokens: integer('cached_tokens'),
    /**
     * 计价档位。火山方舟与智谱**分段计费**（doubao-seed-character 的输出价在 32k
     * 上下文处 ¥2→¥6）—— 不记档位算不出真实成本，而成本是 Phase 2 才会有人去看的
     * 东西，那时补不了历史行。
     */
    priceTier: text('price_tier'),
    latencyMs: integer('latency_ms').notNull(),
    /** 带 user_id ⇒ 本表是个人信息 ⇒ 必须进 DATA_INVENTORY 与 STORAGE_LOCATIONS。 */
    userId: text('user_id').references(() => user.id),
    conversationId: text('conversation_id').references(() => conversation.id),
    /**
     * Phase 3 的记忆检索留痕。**现在建列**（已裁决）：llm_call 是 append-only 表，
     * 事后加列不痛，但现在建可以让 Phase 3 不必改表。Phase 1 恒为 null。
     */
    retrievedMemoryIds: jsonb('retrieved_memory_ids').$type<readonly string[]>(),
    recallScores: jsonb('recall_scores').$type<readonly number[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('llm_call_turn_id_idx').on(t.turnId),
    index('llm_call_user_id_idx').on(t.userId),
    check('llm_call_purpose_allowed', inValues('purpose', LLM_PURPOSES)),
  ],
);

export const clientError = pgTable(
  'client_error',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    /** 可空：/telemetry/error 是弱认证端点，未登录的错误同样需要被看见（D-28）。 */
    userId: text('user_id').references(() => user.id),
    /**
     * ⚠️ 只有枚举/标识类字段，**没有 message / stack / breadcrumb**。
     * 这与 apps/api 的 pino 白名单是同一条理由：这张表是个人信息存储位置，
     * 而 error message 里就可能带消息正文。载荷白名单在 apps/api/src/http/app.ts。
     */
    errorName: text('error_name').notNull(),
    errorCode: text('error_code'),
    route: text('route'),
    statusCode: integer('status_code'),
    appVersion: text('app_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('client_error_created_at_idx').on(t.createdAt)],
);

export const exitIntent = pgTable(
  'exit_intent',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    // 0004 起可空（Q1 去标识化：删除时 user_id 与 conversation_id 一并置 NULL）。
    userId: text('user_id').references(() => user.id),
    conversationId: text('conversation_id').references(() => conversation.id),
    /** 1 = 第一档（硬退出）；2 = 第二档（只落痕、不动作，D-12 的「不想聊」陷阱）。 */
    tier: integer('tier').notNull(),
    matchedRule: text('matched_rule').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('exit_intent_user_id_idx').on(t.userId),
    check('exit_intent_tier_allowed', sql.raw('"tier" in (1, 2)')),
  ],
);

export const dependencySignal = pgTable(
  'dependency_signal',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    // 0004 起可空（同上，Q1 去标识化）。
    userId: text('user_id').references(() => user.id),
    ruleId: text('rule_id').$type<DependencyRuleId>().notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    /** 命中依据（时长序列片段、日期列表、夜间占比）。用于事后复核阈值是否误报。 */
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('dependency_signal_user_rule_idx').on(t.userId, t.ruleId),
    check('dependency_signal_rule_id_allowed', inValues('rule_id', DEPENDENCY_RULE_IDS)),
  ],
);
