// contact_attempt 的 10 分钟服务端超时（D-11 / UI-SPEC：前端不得自行 setTimeout）。
//
// ── 计时权威在服务端 ───────────────────────────────────────────────────────
// 前端 setTimeout 会产生「界面说失败了但服务端还在 pending」的分叉，而这两个说法里
// 只有一个会被运营者看到。与 COMPLY-03 的 2 小时提醒同一条原则。
//
// ── 为什么是条件更新 ───────────────────────────────────────────────────────
// pg-boss 是 **at-least-once** 投递：同一个作业被跑两次是正常情况，不是故障。
//   update contact_attempt set status = 'failed' where id = $1 and status = 'pending'
// 第二次执行影响 0 行且不报错 —— 幂等由 WHERE 子句保证，而不是由「我们应该不会重复
// 投递」这个假设保证。反过来写（先 select 判断再 update）在两次投递交错时会把一个已经
// 被运营者置成 delivered 的行改回 failed，而那是一次虚假陈述的反向版本。
//
// ── pg-boss 12.34.0 的延迟投递 API（从 .d.ts 实读，Q5：不照抄任何文档）─────────
//   send(name: string, data?: object | null, options?: SendOptions): Promise<string | null>
//     其中 SendOptions = JobOptions & QueueOptions & ConnectionOptions，
//     而 JobOptions.startAfter?: number | string | Date; JobOptions.singletonKey?: string
//   sendAfter(name, data, options, date: Date | dateString: string | seconds: number)
//     ⚠️ 第 2、3 个参数**不是可选的**（可传 null 但必须传）。
//   findJobs<T>(name: string, options?: FindJobsOptions): Promise<JobWithMetadata<T>[]>
//     FindJobsOptions = { id?, key?, data?, queued? } & ConnectionOptions
//     JobWithMetadata.startAfter: Date（getJobById 已标记 @deprecated）
// 这里用 send(name, data, { startAfter: 秒数, singletonKey }) —— 单参数形态比
// sendAfter 的四参数形态少一个「忘了传 null」的失手位置。

import type { PgBoss } from 'pg-boss';

import { and, eq, sql } from 'drizzle-orm';

import { contactAttempt, type Executor } from '@drift/db';

/** pg-boss 队列名。 */
export const CONTACT_ATTEMPT_TIMEOUT_QUEUE = 'contact-attempt-timeout';

/** D-11：10 分钟。运营者被叫醒并完成一次通话的现实下限，对危机中的用户等待仍可接受。 */
export const CONTACT_ATTEMPT_TIMEOUT_SECONDS = 600;

/**
 * 队列策略 —— **不是默认值**，而且这一点是本 plan 实测纠正的一处。
 *
 * RESEARCH §4.5 写的是「singletonKey 保证不重复排」。在 pg-boss 12.34.0 的**默认**
 * `standard` 策略下这句话是**错的**：singletonKey 在 standard 下不去重（去重要么靠
 * singletonSeconds 的时间窗，要么靠队列策略），实测同一个 key 连排两次会得到两个
 * queued 作业。
 *
 * `short` 的 .d.ts 原文是「only allows 1 job to be queued, unlimited active. Can be
 * extended with singletonKey」—— 即「每个 singletonKey 最多一个 queued 作业」，正是
 * 这里要的语义。
 *
 * 即便去重失效也不会产生错误状态（作业体是条件更新，第二次影响 0 行），所以这条策略
 * 是**减少噪声**而不是正确性的前提 —— 正确性由幂等保证，不由去重保证。
 */
export const CONTACT_ATTEMPT_TIMEOUT_QUEUE_POLICY = 'short';

export interface ContactAttemptTimeoutPayload {
  readonly attemptId: string;
}

/**
 * 排定一个超时作业。
 *
 * singletonKey 取 attemptId：同一次联络尝试只会有一个待执行的超时作业，即便调用方
 * 因为重试而排了两次。
 */
export async function sendContactAttemptTimeout(
  boss: PgBoss,
  attemptId: string,
): Promise<string | null> {
  return boss.send(
    CONTACT_ATTEMPT_TIMEOUT_QUEUE,
    { attemptId } satisfies ContactAttemptTimeoutPayload,
    { startAfter: CONTACT_ATTEMPT_TIMEOUT_SECONDS, singletonKey: attemptId },
  );
}

/**
 * 超时作业的作业体：**条件更新**，幂等。
 *
 * @returns 实际被改动的行数。非 pending 时返回 0 且不报错。
 */
export async function expireContactAttempt(
  executor: Executor,
  attemptId: string,
): Promise<number> {
  const rows = await executor
    .update(contactAttempt)
    .set({ status: 'failed', updatedAt: sql`now()` })
    .where(and(eq(contactAttempt.id, attemptId), eq(contactAttempt.status, 'pending')))
    .returning({ id: contactAttempt.id });
  return rows.length;
}

/** 排定器端口。contact.ts 只认这个函数形状，不认 PgBoss 实例。 */
export type ContactAttemptTimeoutScheduler = (attemptId: string) => Promise<void>;

/**
 * 进程级排定器。
 *
 * ⚠️ 为什么需要它：排定动作发生在 HTTP 请求链路里（turn.ts），而 PgBoss 实例由
 * startWorker() 持有。把实例透传到 turn.ts 要穿过四层签名，而那四层里没有一层对
 * 「任务队列」有任何别的用途。
 *
 * ⚠️ 未注册时 `requireContactAttemptTimeoutScheduler()` **抛错**而不是静默 no-op：
 * 一个排不上超时作业的 pending 是**无界**的，而 UI-SPEC 明文 pending 必须有界。
 * 静默 no-op 的后果是二级卡片永远停在「正在联系」——没有任何断言会发现这件事。
 * 抛错让 contact.ts 走 unavailable 分支（有出路的那一个），并留下一条错误日志。
 */
let scheduler: ContactAttemptTimeoutScheduler | null = null;

export function setContactAttemptTimeoutScheduler(
  next: ContactAttemptTimeoutScheduler | null,
): void {
  scheduler = next;
}

export function requireContactAttemptTimeoutScheduler(): ContactAttemptTimeoutScheduler {
  if (scheduler === null) {
    throw new Error(
      'contact-attempt-timeout 的排定器未注册（startWorker 未运行）。拒绝进入 pending —— 排不上超时作业的 pending 是无界的。',
    );
  }
  return scheduler;
}

/**
 * 建队列。**全仓唯一**的建队列点 —— 策略写在两处会分叉，而分叉之后去重只在一处生效。
 *
 * 队列必须显式建：pg-boss 12 的 send() 对不存在的队列会失败（manager.js 里的
 * `Queue ${name} does not exist`），它不再像旧版那样隐式建队列。
 */
export async function createContactAttemptTimeoutQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(CONTACT_ATTEMPT_TIMEOUT_QUEUE, {
    policy: CONTACT_ATTEMPT_TIMEOUT_QUEUE_POLICY,
  });
}

/** 在 worker 上注册队列、作业处理器与进程级排定器。 */
export async function registerContactAttemptTimeout(
  boss: PgBoss,
  deps: {
    readonly executor: Executor;
    readonly onExpired?: (attemptId: string, affected: number) => void;
  },
): Promise<void> {
  await createContactAttemptTimeoutQueue(boss);
  await boss.work<ContactAttemptTimeoutPayload>(
    CONTACT_ATTEMPT_TIMEOUT_QUEUE,
    async (jobs) => {
      for (const job of jobs) {
        const affected = await expireContactAttempt(deps.executor, job.data.attemptId);
        deps.onExpired?.(job.data.attemptId, affected);
      }
    },
  );
  setContactAttemptTimeoutScheduler(async (attemptId) => {
    await sendContactAttemptTimeout(boss, attemptId);
  });
}
