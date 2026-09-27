
// 审计表族的去标识化（Q1 裁决 / PRIV-05 / COMPLY-11）—— 删 user_id 与可识别字段，
// 保留事件计数与时间戳，行**不删**。
//
// ── 为什么是去标识化而不是删行 ─────────────────────────────────────────────
// COMPLY-11 / D-17 要求审计日志留存 6 个月，而 PRIV-05 要求删除级联到全部个人信息。
// Q1 的裁决把这对张力落在这里：一键删除时，七张 append-only 审计表（D-06）的行
// 不删，改为把 user_id 与全部可识别字段（conversation_id / message_id / 载荷里的
// userId 键）置 NULL —— 保留的只有事件形状（等级、规则、时间戳），那正是合规
// 留存所需要的全部。去标识化不等于匿名化（PRIV-06）：被处理的行仍是个人信息
// 「曾经存在过」的痕迹，所以回执必须如实披露「这一项没有被清除」（countsAsCleared:
// false，STORAGE_LOCATIONS），而不是把它四舍五入进「已清除 N 处」。
//
// ── 权限 ────────────────────────────────────────────────────────────────────
// 七张表对 app_role 是 REVOKE UPDATE 的（0001 迁移，append-only）。本函数因此
// **只能**以 purge_role 连接执行（packages/db 的 purgeDb / 该连接的事务）——
// 0004 迁移为此把 UPDATE 授给了 purge_role。用 app_role 执行会在权限层失败，
// 这是一条被 tests/integration/deletion.test.ts 断言钉住的事实。
//
// ── 幂等 ─────────────────────────────────────────────────────────────────────
// 全部 UPDATE 的 WHERE 都以 user_id = $1 为条件：行一旦去标识化（user_id 为 NULL），
// 第二次执行影响 0 行且不报错 —— 重复投递的删除作业因此是无害的（D-19）。
//
// ⚠️ 本文件保持纯：Executor 以参数传入（type-only import），不读盘不连库 ——
// tools/ci 的 A 腿对账（contract 层）以相对路径 import 它而不触发 DATABASE_URL。

import { eq, sql } from 'drizzle-orm';

import type { Executor } from './client.ts';
import { clientError, consentEvent, dependencySignal, exitIntent, llmCall, privacyAction, safetyEvent } from './schema/index.ts';

/** 七张 append-only 审计表（D-06）。去标识化的全部对象。 */
export const AUDIT_TABLES = [
  'safety_event',
  'consent_event',
  'privacy_action',
  'llm_call',
  'client_error',
  'exit_intent',
  'dependency_signal',
] as const;

export type AuditTable = (typeof AUDIT_TABLES)[number];

/**
 * 对七张审计表（或其子集）执行去标识化。
 *
 * 每张表移除的列 = 该表全部「可回链到某个用户 / 某场会话」的标识列；保留的列 =
 * 事件形状（等级 / 规则 / 计数 / 时间戳）。逐表说明：
 *
 *   safety_event       user_id、conversation_id、message_id → NULL
 *                      （candidate_reply_hash 本身不可逆，保留 —— 它回答「当时判的是
 *                       哪段文本」而回答不了「是谁的文本」）
 *   consent_event      user_id → NULL（scope / action / policy_version / 时间保留）
 *   privacy_action     user_id → NULL，且 payload 里的 userId 键被移除
 *                      （回执行本身 —— 逐项清单只含表名、行数与时间 —— 不是个人信息）
 *   llm_call           user_id、conversation_id → NULL（模型与 token 维度保留）
 *   client_error       user_id → NULL（error_name / route / 状态码保留）
 *   exit_intent        user_id、conversation_id → NULL
 *   dependency_signal  user_id → NULL（rule_id / observed_at / evidence 保留 —— evidence
 *                      是聚合统计，不含个人标识）
 *
 * @param tables 只处理这批表。STORAGE_LOCATIONS 的七个去标识化项各自传单元素
 *               子集；不传默认全部七张（整体函数形态，供诊断与测试直调）。
 * @returns 实际被去标识化的行数（幂等：已处理过的行不再命中）。
 */
export async function deidentifyAuditRows(
  tx: Executor,
  userId: string,
  tables: readonly AuditTable[] = AUDIT_TABLES,
): Promise<number> {
  let total = 0;

  if (tables.includes('safety_event')) {
    const rows = await tx
      .update(safetyEvent)
      .set({ userId: null, conversationId: null, messageId: null })
      .where(eq(safetyEvent.userId, userId))
      .returning({ id: safetyEvent.id });
    total += rows.length;
  }

  if (tables.includes('consent_event')) {
    const rows = await tx
      .update(consentEvent)
      .set({ userId: null })
      .where(eq(consentEvent.userId, userId))
      .returning({ id: consentEvent.id });
    total += rows.length;
  }

  if (tables.includes('privacy_action')) {
    // payload - 'userId'：jsonb 减键。privacy_action 的 payload 可能带 userId 键
    //（删除/导出动作的 pending 行用它携带目标用户）—— 去标识化把它一并移走。
    const rows = await tx
      .update(privacyAction)
      .set({ userId: null, payload: sql`${privacyAction.payload} - 'userId'` })
      .where(eq(privacyAction.userId, userId))
      .returning({ id: privacyAction.id });
    total += rows.length;
  }

  if (tables.includes('llm_call')) {
    const rows = await tx
      .update(llmCall)
      .set({ userId: null, conversationId: null })
      .where(eq(llmCall.userId, userId))
      .returning({ id: llmCall.id });
    total += rows.length;
  }

  if (tables.includes('client_error')) {
    const rows = await tx
      .update(clientError)
      .set({ userId: null })
      .where(eq(clientError.userId, userId))
      .returning({ id: clientError.id });
    total += rows.length;
  }

  if (tables.includes('exit_intent')) {
    const rows = await tx
      .update(exitIntent)
      .set({ userId: null, conversationId: null })
      .where(eq(exitIntent.userId, userId))
      .returning({ id: exitIntent.id });
    total += rows.length;
  }

  if (tables.includes('dependency_signal')) {
    const rows = await tx
      .update(dependencySignal)
      .set({ userId: null })
      .where(eq(dependencySignal.userId, userId))
      .returning({ id: dependencySignal.id });
    total += rows.length;
  }

  return total;
}
