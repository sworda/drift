// usage-reminder 的 pg-boss 接线（COMPLY-03 / Plan 12 Task 1）。
//
// 排定动作发生在 HTTP 请求链路里（chat/turn.ts 的 touch 之后），而 PgBoss 实例
// 由 startWorker() 持有 —— 与 contact-attempt-timeout 同一条「进程级排定器」
// 形态（那一份的注释里有完整的理由，这里不重复）。
//
// 与 contact-attempt-timeout 的一点不同：排定器未注册时 turn 侧**不抛错**，只记
// 一条 warn。理由是义务的方向 —— 联络超时排不上会留下无界的 pending（必须挡），
// 而提醒排不上只会缺「只读不发」这一条补充路径，消息驱动的提醒照常发生；让整条
// 消息链路因它失败，是把补充义务摆在主义务前面。

import type { PgBoss } from 'pg-boss';

import type { Executor } from '@drift/db';

import { logEvent } from '../../obs/logger.ts';
import {
  runUsageReminder,
  USAGE_REMINDER_QUEUE,
  USAGE_REMINDER_QUEUE_POLICY,
} from '../../modules/usage/segment.ts';

export interface UsageReminderPayload {
  readonly segmentId: string;
}

/** 排定器端口。turn.ts 只认这个函数形状，不认 PgBoss 实例。 */
export type UsageReminderScheduler = (segmentId: string, startAfterSeconds: number) => Promise<void>;

let scheduler: UsageReminderScheduler | null = null;

export function setUsageReminderScheduler(next: UsageReminderScheduler | null): void {
  scheduler = next;
}

/**
 * 未注册时返回 null（调用方记 warn 后跳过），不抛错 —— 见文件头与
 * contact-attempt-timeout 的差异说明。
 */
export function getUsageReminderScheduler(): UsageReminderScheduler | null {
  return scheduler;
}

/** 排定一个到点提醒。singletonKey = segmentId：一个段最多一个待执行作业（short 策略）。 */
export async function sendUsageReminder(
  boss: PgBoss,
  segmentId: string,
  startAfterSeconds: number,
): Promise<string | null> {
  return boss.send(
    USAGE_REMINDER_QUEUE,
    { segmentId } satisfies UsageReminderPayload,
    { startAfter: startAfterSeconds, singletonKey: segmentId },
  );
}

/** 建队列。pg-boss 12 的 send() 对不存在的队列直接失败，不再隐式建。 */
export async function createUsageReminderQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(USAGE_REMINDER_QUEUE, { policy: USAGE_REMINDER_QUEUE_POLICY });
}

export interface UsageReminderDeps {
  readonly executor: Executor;
  readonly now?: () => Date;
  readonly onReminded?: (segmentId: string, delivered: number) => void;
}

/** 在 worker 上注册队列、作业处理器与进程级排定器。 */
export async function registerUsageReminder(boss: PgBoss, deps: UsageReminderDeps): Promise<void> {
  await createUsageReminderQueue(boss);
  await boss.work<UsageReminderPayload>(USAGE_REMINDER_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const now = (deps.now ?? (() => new Date()))();
      const delivered = await runUsageReminder(deps.executor, job.data.segmentId, now);
      deps.onReminded?.(job.data.segmentId, delivered);
    }
  });
  setUsageReminderScheduler(async (segmentId, startAfterSeconds) => {
    await sendUsageReminder(boss, segmentId, startAfterSeconds);
  });
  logEvent('usage.reminder_registered', { jobName: USAGE_REMINDER_QUEUE });
}
