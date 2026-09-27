// 导出作业的进程级 boss 注册（setAccountDeletionScheduler 的同一手法）。
//
// 独立小模块而不是塞进 export-build.ts：export-build 零 env 依赖（contract 层测试
// import 它不触发 DATABASE_URL），而 boss 注册是进程装配的事 —— 混在一起会让
// 「零 env 依赖」的边界取决于谁 import 了它。

import type { PgBoss } from 'pg-boss';

let exportBoss: PgBoss | null = null;

export function setExportBoss(boss: PgBoss | null): void {
  exportBoss = boss;
}

export function requireExportBoss(): PgBoss {
  if (exportBoss === null) {
    throw new Error('export-build 的 boss 未注册（startWorker 未运行）—— 导出作业无法入队，这必须是显式失败。');
  }
  return exportBoss;
}
