// pg-boss worker —— 三个入口里的第三个。
//
// PLAT-02：任务队列与 OLTP 同库。决定性理由是**同事务性**（STACK §6）：夜间反思要在
// 一个事务里读全量增量 → 调 LLM → 写 persona_snapshots → 更新 characters.state →
// 推进水位。人格是全局共享的，半更新会污染所有用户。
//
// ⚠️ pg-boss 自己建表、自己跑自己的迁移。因此它必须住在**独立 schema**（下面的
// PGBOSS_SCHEMA），而 packages/db/drizzle.config.ts 的 schemaFilter 必须把它排除 ——
// 否则 drizzle 会把 pg-boss 的表当成漂移要删（RESEARCH §2.2 三个已核实兼容性坑之二）。
//
// ── 以下四条是从 node_modules/pg-boss/dist/{index,types}.d.ts 实读确认的（Q5：不照抄
//    任何文档形态）。四条里有三条与流传最广的文档写法不同：
//
//  1. 导出形态：`export declare class PgBoss`，**没有 default export**（整个 index.d.ts
//     里 `export default` 零命中）。因此只能 `import { PgBoss } from 'pg-boss'`；
//     文档里常见的 `import PgBoss from 'pg-boss'` 在 v12 下取到的是 undefined。
//  2. schema 选项：`ConstructorOptions extends DatabaseOptions`，而
//     `DatabaseOptions.schema?: string` —— 与 connectionString 同级，不是嵌套对象。
//  3. 延迟投递有两种形态，签名不可互换：
//       send(name: string, data?: object | null, options?: SendOptions)
//         其中 SendOptions = JobOptions & QueueOptions & ConnectionOptions，
//         而 JobOptions.startAfter?: number | string | Date
//       sendAfter(name: string, data: object | null, options: SendOptions | null, date: Date)
//       sendAfter(name: string, data: object | null, options: SendOptions | null, dateString: string)
//       sendAfter(name: string, data: object | null, options: SendOptions | null, seconds: number)
//     注意 sendAfter 的第 2、3 个参数**不是可选的**（可以传 null 但必须传）——
//     三参数写法 sendAfter(name, data, seconds) 不通过类型检查。
//     「拟真回复延迟」用这两者之一；本 plan 不注册任何队列，Plan 07 的状态机接入。
//  4. stop 选项：`StopOptions { close?: boolean; graceful?: boolean; timeout?: number }`
//     —— **没有 `wait` 字段**。cron 用 `schedule(name, cron, data?, options?)`，
//     ScheduleOptions = SendOptions & { tz?, key?, missed?: 'skip' | 'once' }。

import { PgBoss } from 'pg-boss';

import { db, ownerSql, purgeDb } from '@drift/db';

import { env } from '../config/env.ts';
import { logError, logEvent } from '../obs/logger.ts';
import { publishContactStatusEvent } from '../modules/safety/contact-status-event.ts';
import {
  CONSENT_RECONCILE_QUEUE,
  registerConsentReconcile,
} from './jobs/consent-reconcile.ts';
import {
  CONTACT_ATTEMPT_TIMEOUT_QUEUE,
  registerContactAttemptTimeout,
  setContactAttemptTimeoutScheduler,
} from './jobs/contact-attempt-timeout.ts';
import {
  ACCOUNT_DELETION_QUEUE,
  ensurePgbossGrants,
  registerAccountDeletion,
  setAccountDeletionScheduler,
} from './jobs/account-deletion.ts';

/** pg-boss 的专属 schema。drizzle 的 schemaFilter 必须排除它。 */
export const PGBOSS_SCHEMA = 'pgboss';

export interface WorkerHandle {
  readonly boss: PgBoss;
  readonly stop: () => Promise<void>;
}

export async function startWorker(): Promise<WorkerHandle> {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: PGBOSS_SCHEMA,
    application_name: 'drift-api-worker',
    max: 4,
  });

  // pg-boss 的 error 事件是 unhandled 时会打挂进程的那一类。必须挂。
  boss.on('error', (error: Error) => {
    logError('pgboss.error', error);
  });
  boss.on('warning', () => {
    // Warning 的载荷里可能带 SQL 片段，不进日志字段，只计数。
    logEvent('pgboss.warning', {}, 'warn');
  });

  // start() 会在 PGBOSS_SCHEMA 里建表并跑 pg-boss 自己的迁移。
  // /healthz 的 pgboss 字段就是查这个 schema 里有没有表 —— 所以启动顺序是
  // worker 先起，HTTP 后起，否则第一次 healthcheck 必然是 503。
  await boss.start();

  // contact_attempt 的 10 分钟超时（D-11）。注册的是队列 + 作业体 + 进程级排定器：
  // 排定动作发生在 HTTP 请求链路里（chat/turn.ts），而 PgBoss 实例由本函数持有。
  // ⚠️ 排定器未注册时 startContactAttempt 会走 unavailable 分支而不是留一个无界的
  // pending —— 所以这一步必须在 HTTP 开始服务之前完成，而 apps/api/src/index.ts 的
  // 启动顺序（worker 先起、HTTP 后起）本来就是这样。
  await registerContactAttemptTimeout(boss, {
    executor: db,
    onExpired: (attemptId, affected) => {
      logEvent('contact_attempt.timeout_swept', {
        jobName: CONTACT_ATTEMPT_TIMEOUT_QUEUE,
        count: affected,
        contactAttemptStatus: affected > 0 ? 'failed' : 'pending',
      });
      // 真的推进了（affected > 0）才广播：影响 0 行的重复投递不是状态变化。
      // 超时置 failed 是用户看得到的转态 —— 没有这条事件，界面上的「正在联系」
      // 会一直挂到刷新为止（Plan 08 Task 2 的接线点）。
      if (affected > 0) {
        void publishContactStatusEvent(db, attemptId);
      }
    },
  });

  // 残缺账号的日对账（T-09-02）。与 publicness-reconcile 不同，它只需要数据库，
  // 镜像里读得到自己需要的一切，因此可以真的挂上 schedule 而不是留给 nightly。
  // pgboss 表的跨角色授权（必须在 boss.start() 之后 —— 表是 start 建出来的）。
  // app_role：撤回事务里的 boss.send 需要 pgboss.job 的 INSERT；purge_role：队列
  // 载荷的删除级联需要 pgboss.job / archive 的 DELETE。见 account-deletion.ts。
  await ensurePgbossGrants(ownerSql);

  // 账号删除（PRIV-05 / D-19）。执行器是 purgeDb —— 审计表族的去标识化只有
  // purge_role 有 UPDATE 权限（0001 的 REVOKE + 0004 的列级 GRANT）。
  // boss 实例同时注册进入程级调度器：HTTP 链路（POST /me/delete 与撤回必选项）
  // 在事务里入队要经过它。
  setAccountDeletionScheduler(boss);
  await registerAccountDeletion(boss, {
    executor: purgeDb,
    exportArtifactsDir: env.EXPORT_ARTIFACTS_DIR,
    onEvent: (event, fields) => {
      logEvent(event, { jobName: ACCOUNT_DELETION_QUEUE, ...fields }, event.endsWith('partial') ? 'warn' : 'info');
    },
  });

  await registerConsentReconcile(boss, {
    executor: db,
    onReport: (report) => {
      logEvent(
        'consent.reconcile',
        {
          count: report.users,
          expectedCount: report.expected,
          actualCount: report.consents,
          jobName: CONSENT_RECONCILE_QUEUE,
        },
        report.matches ? 'info' : 'error',
      );
    },
  });

  logEvent('worker.started', { phase: PGBOSS_SCHEMA });

  return {
    boss,
    stop: async (): Promise<void> => {
      // 先摘掉排定器：boss 停掉之后再有人排定超时作业，会得到一个「排不上」的错误
      // 而不是一个静默丢掉的作业 —— 前者让 contact.ts 走 unavailable（有出路的那一
      // 支），后者会留一个无界的 pending。
      setContactAttemptTimeoutScheduler(null);
      // graceful: 让在执行中的任务跑完；timeout 是上限。close 默认关连接池。
      await boss.stop({ graceful: true, timeout: 10_000 });
      logEvent('worker.stopped');
    },
  };
}
