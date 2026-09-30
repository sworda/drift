// Q5 —— pg-boss 12.34.0 延迟投递 API 形态的**锁定测试**。
//
// RESEARCH §4.5 明确要求：延迟投递的调用形态以 node_modules/pg-boss 的 .d.ts 为准，
// 不照抄任何文档（历史版本有 sendAfter()，当前文档用 send(..., { startAfter })，两者
// 签名不可互换）。这条测试把「我们读到的形态」钉成一条会失败的检查：厂商改签名、
// 或有人照文档改写调用，都会在这里红。
//
// ── 从 .d.ts 实读的三条签名（原文抄录）────────────────────────────────────────
//   send(name: string, data?: object | null, options?: types.SendOptions): Promise<string | null>
//   sendAfter(name: string, data: object | null, options: types.SendOptions | null, seconds: number): Promise<string | null>
//   findJobs<T>(name: string, options?: types.FindJobsOptions): Promise<types.JobWithMetadata<T>[]>
// 其中 SendOptions = JobOptions & QueueOptions & ConnectionOptions，
//     JobOptions.startAfter?: number | string | Date; JobOptions.singletonKey?: string
//     JobWithMetadata.startAfter: Date
//     getJobById() 在 12.34.0 已标记 @deprecated（"Use findJobs() instead"）。
//
// ⚠️ 本文件住在 tools/ci/ 但属 **integration** 层：它需要真实 PostgreSQL。
// vitest.config.ts 的 contract 项目把它排除掉了 —— 与 schema-drift.test.ts 同一处理，
// 理由也一样：fast workflow 的第一条约束是不依赖任何数据库。

import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONTACT_ATTEMPT_TIMEOUT_QUEUE,
  CONTACT_ATTEMPT_TIMEOUT_QUEUE_POLICY,
  CONTACT_ATTEMPT_TIMEOUT_SECONDS,
  createContactAttemptTimeoutQueue,
  sendContactAttemptTimeout,
} from '../../apps/api/src/worker/jobs/contact-attempt-timeout.ts';

/** 独立 schema：与 contact-attempt.test.ts 的 boss 并发跑时不互相迁移同一套表。 */
const SCHEMA = 'pgboss_delay_api';

/** 窗口容差。600 秒的排定值与读回值之间只隔一次往返，5 秒是宽裕但不空洞的上限。 */
const WINDOW_SECONDS = 5;

/**
 * 断言排定后的 startAfter 落在 expected ± WINDOW_SECONDS 内。
 *
 * 抽成函数是为了让「把延迟值改成 60 会变红」这件事成为一条**常驻**断言而不是一次
 * 手工破坏验证（下面第二条用例就是它的负向 fixture）。
 */
export function assertDelayWithinWindow(
  startAfter: Date,
  sentAt: Date,
  expectedSeconds: number,
): void {
  const actualSeconds = (startAfter.getTime() - sentAt.getTime()) / 1000;
  const low = expectedSeconds - WINDOW_SECONDS;
  const high = expectedSeconds + WINDOW_SECONDS;
  if (actualSeconds < low || actualSeconds > high) {
    throw new Error(
      `排定延迟 ${actualSeconds.toFixed(2)}s 不在 ${String(expectedSeconds)}±${String(WINDOW_SECONDS)}s 窗口内`,
    );
  }
}

let boss: PgBoss;

beforeAll(async () => {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined) throw new Error('DATABASE_URL 未设置（globalSetup 应已指向测试库）');
  boss = new PgBoss({ connectionString, schema: SCHEMA, application_name: 'pgboss-delay-api-test' });
  boss.on('error', () => {
    // 连接层错误由断言本身暴露；挂一个空 handler 只是为了不让 EventEmitter 打挂进程。
  });
  await boss.start();
  // pg-boss 12 的 send() 对不存在的队列直接失败（manager.js: "Queue X does not exist"）——
  // 它不再隐式建队列。用生产那一个建队列函数，而不是在这里另写一份策略。
  await createContactAttemptTimeoutQueue(boss);
}, 120_000);

afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5_000 });
});

describe('Q5：pg-boss 延迟投递的 API 形态', () => {
  it('send(name, data, { startAfter, singletonKey }) 排定后的 startAfter 落在 600±5 秒窗口内', async () => {
    const attemptId = `delay-${Date.now().toString(36)}`;
    const sentAt = new Date();
    const jobId = await sendContactAttemptTimeout(boss, attemptId);
    expect(jobId, 'send 应返回 job id —— 返回 null 意味着被 singleton 策略去重了').not.toBeNull();

    const jobs = await boss.findJobs<{ attemptId: string }>(CONTACT_ATTEMPT_TIMEOUT_QUEUE, {
      id: jobId ?? '',
    });
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job?.data.attemptId).toBe(attemptId);
    expect(job?.singletonKey).toBe(attemptId);
    // JobWithMetadata.startAfter 的静态类型是 Date；这里顺手确认运行时也是 Date，
    // 否则下面的窗口计算会静默变成 NaN 比较（NaN 的比较恒 false ⇒ 断言恒通过）。
    expect(job?.startAfter).toBeInstanceOf(Date);
    if (job === undefined) return;
    assertDelayWithinWindow(job.startAfter, sentAt, CONTACT_ATTEMPT_TIMEOUT_SECONDS);
  });

  it('非空真证明：把期望延迟改成 60 秒后，同一条窗口断言抛错', async () => {
    const attemptId = `delay-neg-${Date.now().toString(36)}`;
    const sentAt = new Date();
    const jobId = await sendContactAttemptTimeout(boss, attemptId);
    const jobs = await boss.findJobs<{ attemptId: string }>(CONTACT_ATTEMPT_TIMEOUT_QUEUE, {
      id: jobId ?? '',
    });
    const job = jobs[0];
    expect(job).toBeDefined();
    if (job === undefined) return;
    // 600 通过、60 失败 —— 于是「窗口断言真的在比对延迟值」这件事每个 PR 都被证明一次，
    // 而不是靠执行者临时把常量改成 60 再改回来。
    expect(() => {
      assertDelayWithinWindow(job.startAfter, sentAt, CONTACT_ATTEMPT_TIMEOUT_SECONDS);
    }).not.toThrow();
    expect(() => {
      assertDelayWithinWindow(job.startAfter, sentAt, 60);
    }).toThrow(/窗口内/u);
  });

  it('CONTACT_ATTEMPT_TIMEOUT_SECONDS 就是 D-11 的 10 分钟', () => {
    expect(CONTACT_ATTEMPT_TIMEOUT_SECONDS).toBe(600);
  });

  it('队列策略是 short 而不是默认的 standard（RESEARCH §4.5 的一处纠正）', () => {
    // standard 下 singletonKey **不去重**（本 plan 实测：同一个 key 连排两次得到两个
    // queued 作业）。这条断言把「去重靠的是队列策略，不是 singletonKey 本身」钉住。
    expect(CONTACT_ATTEMPT_TIMEOUT_QUEUE_POLICY).toBe('short');
  });

  it('short 策略 + singletonKey 去重：同一个 attemptId 连排两次，只有一个待执行作业', async () => {
    const attemptId = `delay-single-${Date.now().toString(36)}`;
    await sendContactAttemptTimeout(boss, attemptId);
    await sendContactAttemptTimeout(boss, attemptId);
    const jobs = await boss.findJobs<{ attemptId: string }>(CONTACT_ATTEMPT_TIMEOUT_QUEUE, {
      key: attemptId,
      queued: true,
    });
    expect(jobs).toHaveLength(1);
  });
});
