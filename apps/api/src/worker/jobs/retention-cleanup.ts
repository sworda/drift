// 保存期清理（PRIV-08 / D-17）—— 规则由 DATA_INVENTORY 的 retention 派生。
//
// ⚠️ 本文件**没有第二份期限清单**：四层保存期（聊天原文 24 个月硬上限 / L0 24 个月 /
// 导出文件 7 天 / 审计日志 6 个月）的唯一依据是 packages/db/src/inventory.ts 的
// retention 字段。在那里改保存期，这里的清理规则跟着变；在这里另写一张表，两份
// 期限分叉的那天不会有任何检查变红 —— 那是 PRIV-08 的静默失效形态。
//
//   导出文件（7 天）委托给 export-artifact-gc（文件系统的 TTL 判定在那一侧）。
//   L0 24 个月：Phase 1 无 l0 表 —— 注册表没有条目就没有规则；Phase 7 加 l0
//   条目时本作业自动获得它的规则（派生的意义正在于此）。
//
// 清理动作本身是 DELETE：审计表族对 app_role REVOKE DELETE，所以执行器必须是
// purgeDb（与删除 worker 同一权限面）。
//
// 零 env 依赖：执行器与 now 从参数进来。

import type { PgBoss } from 'pg-boss';

import { DATA_INVENTORY, type Executor, type InventoryEntry, type Retention } from '@drift/db';

/** pg-boss 队列名（同时是 schedule 名）。 */
export const RETENTION_CLEANUP_QUEUE = 'retention-cleanup';

/** 日清理：18:45 UTC = 次日 02:45 北京，错开 consent-reconcile（18:15）与 publicness（18:30）。 */
export const RETENTION_CLEANUP_CRON = '45 18 * * *';

/** 一条派生出的清理规则。 */
export interface RetentionRule {
  readonly table: string;
  readonly kind: 'fixed_days' | 'hard_cap_months';
  readonly value: number;
}

/**
 * 从 DATA_INVENTORY 派生全部清理规则（纯函数）。
 *
 * 聚合到表级：一张表取其条目中最严格的 retention —— fixed 天数取最小（最短保存
 * 期限优先），account_life + hardCapMonths 进 24 个月滚动清理。account_life 无硬
 * 上限的表（账号必要信息）**不产生规则**：账号存续期间保留是它们的承诺。
 */
export function buildRetentionRules(inventory: readonly InventoryEntry[]): readonly RetentionRule[] {
  const byTable = new Map<string, Retention[]>();
  for (const entry of inventory) {
    const list = byTable.get(entry.table) ?? [];
    list.push(entry.retention);
    byTable.set(entry.table, list);
  }
  const rules: RetentionRule[] = [];
  for (const [table, retentions] of byTable) {
    let fixedDays: number | null = null;
    let hardCap: 24 | null = null;
    for (const retention of retentions) {
      if (retention.kind === 'fixed') {
        fixedDays = fixedDays === null ? retention.days : Math.min(fixedDays, retention.days);
      } else if (retention.hardCapMonths !== undefined) {
        hardCap = retention.hardCapMonths;
      }
    }
    // 混合形态（同表既有 fixed 又有 hardCap —— Phase 1 不存在）：fixed 优先（更短）。
    if (fixedDays !== null) {
      rules.push({ table, kind: 'fixed_days', value: fixedDays });
    } else if (hardCap !== null) {
      rules.push({ table, kind: 'hard_cap_months', value: hardCap });
    }
  }
  return rules;
}

/** 执行一次清理。幂等：删除条件以时间窗口为界，重复执行影响 0 行。 */
export async function runRetentionCleanup(
  executor: Executor,
  rules: readonly RetentionRule[],
  now: Date,
): Promise<readonly { table: string; removed: number }[]> {
  const results: { table: string; removed: number }[] = [];
  const { sql } = await import('drizzle-orm');
  for (const rule of rules) {
    const cutoff = new Date(now);
    if (rule.kind === 'fixed_days') {
      cutoff.setDate(cutoff.getDate() - rule.value);
    } else {
      cutoff.setMonth(cutoff.getMonth() - rule.value);
    }
    const rows = (await executor.execute(
      sql`delete from ${sql.identifier(rule.table)} where created_at < ${cutoff.toISOString()} returning 1`,
    )) as unknown[];
    results.push({ table: rule.table, removed: rows.length });
  }
  return results;
}

export interface RetentionCleanupDeps {
  /** 必须是 purgeDb：审计表族的 DELETE 权限只在 purge_role 身上。 */
  readonly executor: Executor;
  readonly now?: () => Date;
  readonly onEvent?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
}

/** 建队列 + 注册 worker + 挂日 schedule。 */
export async function registerRetentionCleanup(boss: PgBoss, deps: RetentionCleanupDeps): Promise<void> {
  await boss.createQueue(RETENTION_CLEANUP_QUEUE);
  await boss.work<null>(RETENTION_CLEANUP_QUEUE, async () => {
    const now = (deps.now ?? (() => new Date()))();
    const results = await runRetentionCleanup(deps.executor, buildRetentionRules(DATA_INVENTORY), now);
    deps.onEvent?.('retention.cleanup_swept', {
      count: results.reduce((sum, item) => sum + item.removed, 0),
    });
  });
  await boss.schedule(RETENTION_CLEANUP_QUEUE, RETENTION_CLEANUP_CRON, null, {
    tz: 'Asia/Shanghai',
    missed: 'skip',
  });
}
