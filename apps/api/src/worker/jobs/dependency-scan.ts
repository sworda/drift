// dependency-scan 的 pg-boss 接线（COMPLY-04 / Plan 12 Task 2）。
//
// 日扫（凌晨 4 点，北京时间）：对每个用户取近 7 天的 usage_segment，调
// thresholds.ts 的纯函数判定，命中则留证 + 告知（72h 去重）。

import type { PgBoss } from 'pg-boss';

import type { Executor } from '@drift/db';

import { logEvent } from '../../obs/logger.ts';
import { runDependencyScan } from '../../modules/usage/dependency.ts';

/** pg-boss 队列名（同时是 schedule 名）。 */
export const DEPENDENCY_SCAN_QUEUE = 'dependency-scan';

/** 日扫：04:00 北京时间（错开 usage 侧作业）。 */
export const DEPENDENCY_SCAN_CRON = '0 4 * * *';

export interface DependencyScanDeps {
  readonly executor: Executor;
  readonly now?: () => Date;
  readonly onEvent?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
}

/** 建队列 + 注册 worker + 挂日 schedule。 */
export async function registerDependencyScan(boss: PgBoss, deps: DependencyScanDeps): Promise<void> {
  await boss.createQueue(DEPENDENCY_SCAN_QUEUE);
  await boss.work<null>(DEPENDENCY_SCAN_QUEUE, async () => {
    const now = (deps.now ?? (() => new Date()))();
    const report = await runDependencyScan(deps.executor, now);
    deps.onEvent?.('dependency.scan_swept', {
      count: report.signalsInserted,
      actualCount: report.scannedUsers,
      expectedCount: report.dedupedUsers,
    });
  });
  await boss.schedule(DEPENDENCY_SCAN_QUEUE, DEPENDENCY_SCAN_CRON, null, {
    tz: 'Asia/Shanghai',
    missed: 'skip',
  });
  logEvent('dependency.scan_registered', { jobName: DEPENDENCY_SCAN_QUEUE });
}
