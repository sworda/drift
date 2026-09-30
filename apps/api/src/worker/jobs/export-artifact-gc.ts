// 导出产物的 7 天 TTL（D-17 / PRIV-04）—— boss.schedule 的日作业。
//
// 导出文件是「用户全部数据的完整副本」，留存风险最高的一处（RESEARCH §7.1 三处
// 最易漏之首）—— 7 天后自动清理是登记过的承诺，这个作业就是兑现它的机制。
//
// 删除级联（PRIV-05 的 export_artifact purge）按用户目录整删；本作业按文件 mtime
// 清理 —— 两条路径互补：账号删除时目录即消失，未删除的账号产物到期滚动清理。
//
// 零 env 依赖：目录与 now 从参数进来。

import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { PgBoss } from 'pg-boss';

/** pg-boss 队列名（同时是 schedule 名）。 */
export const EXPORT_ARTIFACT_GC_QUEUE = 'export-artifact-gc';

/** 日清理：05:00 UTC = 13:00 北京。PLAN 建议的 0 5 * * *。 */
export const EXPORT_ARTIFACT_GC_CRON = '0 5 * * *';

/**
 * 扫描导出目录，删除超过 TTL 的文件。
 *
 * @returns 删除的文件数。
 */
export async function runExportArtifactGc(dir: string, now: Date): Promise<number> {
  const ttlMs = 7 * 24 * 60 * 60 * 1000;
  let removed = 0;
  let userDirs: readonly string[];
  try {
    userDirs = await readdir(dir);
  } catch {
    return 0; // 目录不存在：没有产物，0 文件。
  }
  for (const userDir of userDirs) {
    const userPath = join(dir, userDir);
    let entries: readonly string[];
    try {
      entries = await readdir(userPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filePath = join(userPath, entry);
      try {
        const info = await stat(filePath);
        if (now.getTime() - info.mtimeMs >= ttlMs) {
          await rm(filePath, { force: true });
          removed += 1;
        }
      } catch {
        continue;
      }
    }
  }
  return removed;
}

export interface ExportArtifactGcDeps {
  readonly exportArtifactsDir: string;
  readonly onEvent?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
}

/** 建队列 + 注册 worker + 挂日 schedule。 */
export async function registerExportArtifactGc(boss: PgBoss, deps: ExportArtifactGcDeps): Promise<void> {
  await boss.createQueue(EXPORT_ARTIFACT_GC_QUEUE);
  await boss.work<null>(EXPORT_ARTIFACT_GC_QUEUE, async () => {
    const removed = await runExportArtifactGc(deps.exportArtifactsDir, new Date());
    deps.onEvent?.('export_artifact.gc_swept', { count: removed });
  });
  await boss.schedule(EXPORT_ARTIFACT_GC_QUEUE, EXPORT_ARTIFACT_GC_CRON, null, {
    tz: 'Asia/Shanghai',
    missed: 'skip',
  });
}
