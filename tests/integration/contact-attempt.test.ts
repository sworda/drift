// SAFE-04 / SAFE-16 —— contact_attempt 四态的**全分支**覆盖。
//
// ⚠️ 这份测试存在的首要理由不是「验证功能」，而是证明四态没有静默退化成两态
// （T-07-08）。D-22 规定 R1.23 的可达性一律记为 unconfirmed；把它读成「未确认 ⇒ 永远
// unavailable」会让 pending 与 delivered 两个分支永不执行，**而没有任何现有断言会发现
// 这件事**。因此下面四个取值逐个断言，webhook 200 与 500 两条分支各一条用例。
//
// 分支清单（PLAN Task 2 的 (a)-(f)）：
//   (a) webhook 200 + 业务码 0      ⇒ pending，且 alert_sent_at 非空
//   (b) webhook 500                 ⇒ 直接 unavailable，alert_sent_at 为空（未经 pending）
//   (c) 无 emergency_contact 记录    ⇒ unavailable
//   (c2) contact_ref 为空白          ⇒ unavailable（号码在收集时就没存下来）
//   (d) pending 后触发超时作业       ⇒ failed
//   (e) 重复触发同一超时作业         ⇒ 第二次影响 0 行且不报错
//   (f) ackDelivered 传空 note       ⇒ 抛错（delivered 的判据是真人确认已通话）

import type { AddressInfo } from 'node:net';

import { serve } from '@hono/node-server';
import { eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'contact-attempt-test-operator-token-0123456789';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

const { runTurn } = await import('../../apps/api/src/modules/chat/turn.ts');
const {
  OperatorActionRefusedError,
  ackDelivered,
  markFailed,
} = await import('../../apps/api/src/modules/safety/contact.ts');
const {
  CONTACT_ATTEMPT_TIMEOUT_SECONDS,
  expireContactAttempt,
  registerContactAttemptTimeout,
  setContactAttemptTimeoutScheduler,
} = await import('../../apps/api/src/worker/jobs/contact-attempt-timeout.ts');
const {
  CONTACT_ATTEMPT_STATUSES: DB_CONTACT_ATTEMPT_STATUSES,
  closeDb,
  contactAttempt,
  db,
  emergencyContact,
  ownerDb,
  ownerSql,
} = await import('@drift/db');
const { CONTACT_ATTEMPT_STATUSES: SAFETY_CONTACT_ATTEMPT_STATUSES } = await import('@drift/safety');
const { createApp } = await import('../../apps/api/src/http/app.ts');
const { seedConversation } = await import('./fixtures.ts');

const OPERATOR_TOKEN = process.env['OPERATOR_API_TOKEN'] ?? '';

/** 触发二级危机的用户消息（命中入站规则层的 suicidal_intent 规则）。 */
const CRISIS_TEXT = '我真的不想活了，今天就想结束自己的生命。';

/** 企业微信成功响应：2xx **且**业务码 0（对无效 webhook 它同样返回 200）。 */
function okWebhook(): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
}

function failingWebhook(status: number): typeof fetch {
  return () => Promise.resolve(new Response('upstream boom', { status }));
}

/** 业务码非 0：HTTP 200 但企业微信拒了 —— 同样算投递失败（SAFE-16）。 */
function businessErrorWebhook(): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ errcode: 93_000, errmsg: 'invalid webhook url' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
}

async function giveEmergencyContact(userId: string, contactRef: string): Promise<void> {
  await ownerDb.insert(emergencyContact).values({
    userId,
    kind: 'emergency',
    name: '联系人甲',
    contactRefEncrypted: contactRef,
  });
}

async function readAttempt(userId: string): Promise<{
  readonly id: string;
  readonly status: string;
  readonly alertSentAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly contactRef: string | null;
  readonly note: string | null;
} | undefined> {
  const rows = await db
    .select({
      id: contactAttempt.id,
      status: contactAttempt.status,
      alertSentAt: contactAttempt.alertSentAt,
      deliveredAt: contactAttempt.deliveredAt,
      contactRef: contactAttempt.contactRef,
      note: contactAttempt.note,
    })
    .from(contactAttempt)
    .where(eq(contactAttempt.userId, userId));
  return rows[0];
}

/** 跑一次二级危机 turn，返回联络尝试的结果。 */
async function runCrisisTurn(label: string, alertFetch: typeof fetch, contactRef?: string) {
  const seeded = await seedConversation(label);
  if (contactRef !== undefined) await giveEmergencyContact(seeded.userId, contactRef);
  const result = await runTurn(
    { conversationId: seeded.conversationId, userId: seeded.userId, text: CRISIS_TEXT },
    { alertFetch },
  );
  expect(result.reply.outcome, '二级危机不应产出角色回复').toBe('escalated');
  return { seeded, reply: result.reply };
}

let boss: PgBoss;
let baseUrl = '';
let stopServer: () => Promise<void> = async () => undefined;

beforeAll(async () => {
  const listener = serve({ fetch: createApp().fetch, port: 0, hostname: '127.0.0.1' });
  const address = await new Promise<AddressInfo>((resolve, reject) => {
    const existing = listener.address() as AddressInfo | null;
    if (existing !== null) {
      resolve(existing);
      return;
    }
    listener.once('listening', () => {
      const bound = listener.address() as AddressInfo | null;
      if (bound === null) reject(new Error('测试服务器未绑定端口'));
      else resolve(bound);
    });
    listener.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
  stopServer = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      listener.close(() => {
        resolve();
      });
    });
  };

  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined) throw new Error('DATABASE_URL 未设置');
  boss = new PgBoss({ connectionString, schema: 'pgboss', application_name: 'contact-attempt-test' });
  boss.on('error', () => undefined);
  await boss.start();
  // 注册队列 + 作业体 + 进程级排定器。不注册排定器的话 startContactAttempt 会走
  // unavailable 分支 —— 那正是「排不上超时作业的 pending 是无界的」这条 fail-closed。
  await registerContactAttemptTimeout(boss, { executor: db });
}, 180_000);

afterAll(async () => {
  setContactAttemptTimeoutScheduler(null);
  await stopServer();
  await boss.stop({ graceful: false, timeout: 5_000 });
  await closeDb();
});

describe('取值域：@drift/safety 与 @drift/db 的四态常量必须是同一个集合', () => {
  it('两份独立声明的集合相等（分叉会让卡片与数据库各说各话）', () => {
    expect([...SAFETY_CONTACT_ATTEMPT_STATUSES]).toEqual([...DB_CONTACT_ATTEMPT_STATUSES]);
    expect(SAFETY_CONTACT_ATTEMPT_STATUSES).toHaveLength(4);
  });
});

describe('(a) webhook 200 且业务码成功 ⇒ pending', () => {
  it('status 为 pending、alert_sent_at 非空、卡片联络状态行与库里一致', async () => {
    const { seeded, reply } = await runCrisisTurn('contact-a', okWebhook(), 'enc:13812341234');
    const row = await readAttempt(seeded.userId);
    expect(row?.status).toBe('pending');
    expect(row?.alertSentAt, 'pending 必须有 alert_sent_at —— 否则是在等一件从未开始的事').not.toBeNull();
    expect(row?.contactRef).toBe('enc:13812341234');
    if (reply.outcome !== 'escalated') return;
    expect(reply.contact?.status).toBe('pending');
    if (reply.careCard.level !== 'level2') throw new Error('crisis 必须是二级卡片');
    expect(reply.careCard.contactStatus).toBe('pending');
    // T-07-03：pending 不得陈述「已经联系了」。
    expect(reply.careCard.claimsContacted).toBe(false);
    expect(reply.careCard.hotlineFirst).toBe(false);
  });

  it('pending 的超时作业真的被排上了（pending 必须有界）', async () => {
    const { seeded } = await runCrisisTurn('contact-a2', okWebhook(), 'enc:13812341234');
    const row = await readAttempt(seeded.userId);
    expect(row?.status).toBe('pending');
    const jobs = await boss.findJobs<{ attemptId: string }>('contact-attempt-timeout', {
      key: row?.id ?? '',
      queued: true,
    });
    expect(jobs, '没有排上超时作业 ⇒ 这个 pending 是无界的').toHaveLength(1);
    const startAfter = jobs[0]?.startAfter;
    expect(startAfter).toBeInstanceOf(Date);
    const delaySeconds = ((startAfter?.getTime() ?? 0) - Date.now()) / 1000;
    expect(delaySeconds).toBeGreaterThan(CONTACT_ATTEMPT_TIMEOUT_SECONDS - 30);
    expect(delaySeconds).toBeLessThanOrEqual(CONTACT_ATTEMPT_TIMEOUT_SECONDS + 5);
  });
});

describe('(b) webhook 投递失败 ⇒ 直接 unavailable，不经 pending', () => {
  it.each([
    ['HTTP 500', failingWebhook(500)],
    ['HTTP 200 但业务码非 0', businessErrorWebhook()],
  ])('%s ⇒ unavailable 且 alert_sent_at 为空（未经 pending 的判据）', async (_label, fetchImpl) => {
    const { seeded, reply } = await runCrisisTurn('contact-b', fetchImpl, 'enc:13812341234');
    const row = await readAttempt(seeded.userId);
    expect(row?.status).toBe('unavailable');
    // 本表允许 UPDATE，所以「有没有经过 pending」不能靠 status 的历史回答。
    // alert_sent_at 只在投递成功时写，因此它为空就是「从未进入过 pending」。
    expect(row?.alertSentAt).toBeNull();
    expect(row?.note).toBe('alert_delivery_failed');
    if (reply.outcome !== 'escalated') return;
    if (reply.careCard.level !== 'level2') throw new Error('crisis 必须是二级卡片');
    expect(reply.careCard.contactStatus).toBe('unavailable');
    expect(reply.careCard.claimsContacted).toBe(false);
    // UI-SPEC：failed / unavailable 两态把援助渠道行提到卡片首屏第一行。
    expect(reply.careCard.hotlineFirst).toBe(true);
    expect(reply.careCard.resources.length).toBeGreaterThanOrEqual(2);
  });
});

describe('(c) 无可用联络通道 ⇒ unavailable', () => {
  it('没有 emergency_contact 记录 ⇒ unavailable，且 contact_ref 为空', async () => {
    const { seeded } = await runCrisisTurn('contact-c', okWebhook());
    const row = await readAttempt(seeded.userId);
    expect(row?.status).toBe('unavailable');
    expect(row?.contactRef).toBeNull();
    expect(row?.note).toBe('no_contact_record');
  });

  it('contact_ref 为空白 ⇒ unavailable（号码在收集时就没存下来）', async () => {
    const { seeded } = await runCrisisTurn('contact-c2', okWebhook(), '   ');
    const row = await readAttempt(seeded.userId);
    expect(row?.status).toBe('unavailable');
    expect(row?.note).toBe('contact_ref_missing');
  });

  it('可达性 unconfirmed 本身**不**导致 unavailable（T-07-08 的正向证明）', async () => {
    // D-22：Phase 1 的可达性一律记为 unconfirmed。默认值就是它 —— 而这一条仍然进
    // pending。如果有人把「未确认」读成「永远 unavailable」，这条断言会红。
    const { seeded } = await runCrisisTurn('contact-c3', okWebhook(), 'enc:13812341234');
    const reachability = await ownerSql<{ readonly reachability: string }[]>`
      select reachability from emergency_contact where user_id = ${seeded.userId}
    `;
    expect(reachability[0]?.reachability).toBe('unconfirmed');
    expect((await readAttempt(seeded.userId))?.status).toBe('pending');
  });
});

describe('(d)(e) 服务端超时：条件更新，幂等', () => {
  it('pending ⇒ 触发超时作业后为 failed；再触发一次影响 0 行且不报错', async () => {
    const { seeded } = await runCrisisTurn('contact-d', okWebhook(), 'enc:13812341234');
    const row = await readAttempt(seeded.userId);
    expect(row?.status).toBe('pending');
    const attemptId = row?.id ?? '';

    // (d) 第一次：把这一行从 pending 扫成 failed。作业体就是这个函数 —— 不等 600 秒，
    // 因为被测对象是那条条件更新，而不是 pg-boss 的计时（计时由 pgboss-delay-api 锁定）。
    expect(await expireContactAttempt(db, attemptId)).toBe(1);
    expect((await readAttempt(seeded.userId))?.status).toBe('failed');

    // (e) 第二次：pg-boss 是 at-least-once，重复投递是正常情况。
    expect(await expireContactAttempt(db, attemptId)).toBe(0);
    expect((await readAttempt(seeded.userId))?.status).toBe('failed');
  });

  it('超时作业不会把一个已经 delivered 的行改回 failed', async () => {
    const { seeded } = await runCrisisTurn('contact-d2', okWebhook(), 'enc:13812341234');
    const attemptId = (await readAttempt(seeded.userId))?.id ?? '';
    expect(await ackDelivered(db, { attemptId, operatorId: 'op-1', note: '已与联系人甲通话' })).toBe(true);
    expect(await expireContactAttempt(db, attemptId)).toBe(0);
    expect((await readAttempt(seeded.userId))?.status).toBe('delivered');
  });
});

describe('delivered / failed 两态只能由人工推进（D-10）', () => {
  it('ackDelivered 非空 note ⇒ delivered，且 delivered_at 非空', async () => {
    const { seeded } = await runCrisisTurn('contact-ack', okWebhook(), 'enc:13812341234');
    const attemptId = (await readAttempt(seeded.userId))?.id ?? '';
    expect(await ackDelivered(db, { attemptId, operatorId: 'op-1', note: '已与联系人甲通话' })).toBe(true);
    const row = await readAttempt(seeded.userId);
    expect(row?.status).toBe('delivered');
    expect(row?.deliveredAt).not.toBeNull();
    expect(row?.note).toContain('op-1');
  });

  it('(f) ackDelivered 传空 note ⇒ 抛错（note 就是那次真人确认的记录）', async () => {
    const { seeded } = await runCrisisTurn('contact-f', okWebhook(), 'enc:13812341234');
    const attemptId = (await readAttempt(seeded.userId))?.id ?? '';
    await expect(
      ackDelivered(db, { attemptId, operatorId: 'op-1', note: '   ' }),
    ).rejects.toThrow(OperatorActionRefusedError);
    // 抛错之后这一行仍然是 pending —— 不存在「半推进」。
    expect((await readAttempt(seeded.userId))?.status).toBe('pending');
  });

  it('markFailed ⇒ failed；对非 pending 的行返回 false 而不是报错', async () => {
    const { seeded } = await runCrisisTurn('contact-mf', okWebhook(), 'enc:13812341234');
    const attemptId = (await readAttempt(seeded.userId))?.id ?? '';
    expect(await markFailed(db, { attemptId, operatorId: 'op-2', note: '连续三次未接' })).toBe(true);
    expect((await readAttempt(seeded.userId))?.status).toBe('failed');
    expect(await markFailed(db, { attemptId, operatorId: 'op-2' })).toBe(false);
  });
});

describe('四个取值逐个被覆盖过（防止四态静默退化成两态）', () => {
  it('contact_attempt 表里四个 status 取值各至少出现过一次', async () => {
    const rows = await ownerSql<{ readonly status: string }[]>`
      select distinct status from contact_attempt
    `;
    const seen = new Set(rows.map((row) => row.status));
    for (const status of DB_CONTACT_ATTEMPT_STATUSES) {
      expect(seen, `status=${status} 从未在本次测试中出现过 —— 这一态的实现可能不可达`).toContain(
        status,
      );
    }
  });
});

describe('数据库层的三条不变量（0003 迁移）', () => {
  it('delivered_at 非空而 status 不是 delivered ⇒ 被 CHECK 拒绝', async () => {
    const { seeded } = await runCrisisTurn('contact-chk1', okWebhook(), 'enc:13812341234');
    const attemptId = (await readAttempt(seeded.userId))?.id ?? '';
    await expect(
      ownerSql`update contact_attempt set delivered_at = now() where id = ${attemptId}`,
    ).rejects.toThrow(/contact_attempt_delivered_at_consistency/u);
  });

  it('pending 而 alert_sent_at 为空 ⇒ 被 CHECK 拒绝', async () => {
    const { seeded } = await runCrisisTurn('contact-chk2', failingWebhook(500), 'enc:13812341234');
    const attemptId = (await readAttempt(seeded.userId))?.id ?? '';
    // 这一行是 unavailable 且 alert_sent_at 为空。把它改成 pending 就构成「在等一件
    // 从未开始的事」，而 UI 会照样渲染「正在联系」。
    // ⚠️ 同一条语句里补上 contact_ref：unavailable 是唯一允许空 contact_ref 的一态，
    // 不补的话先撞上 contact_attempt_contact_ref_required，被测的那条约束就没被证明。
    await expect(
      ownerSql`
        update contact_attempt set status = 'pending', contact_ref = 'enc:13812341234'
        where id = ${attemptId}
      `,
    ).rejects.toThrow(/contact_attempt_pending_requires_alert/u);
  });

  it('非 unavailable 而 contact_ref 为空 ⇒ 被 CHECK 拒绝', async () => {
    const { seeded } = await runCrisisTurn('contact-chk3', okWebhook(), 'enc:13812341234');
    const attemptId = (await readAttempt(seeded.userId))?.id ?? '';
    await expect(
      ownerSql`update contact_attempt set contact_ref = null where id = ${attemptId}`,
    ).rejects.toThrow(/contact_attempt_contact_ref_required/u);
  });
});

describe('T-07-05 运营者端点：与用户 session 分离的认证，且不读会话内容', () => {
  async function postOperator(
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  it('无 token ⇒ 401；用户 session 的 Authorization 头**不能**当运营者用', async () => {
    const { seeded } = await runCrisisTurn('contact-op-401', okWebhook(), 'enc:13812341234');
    const attemptId = (await readAttempt(seeded.userId))?.id ?? '';
    expect(
      (await postOperator(`/internal/contact-attempts/${attemptId}/ack`, { operatorId: 'op', note: 'x' }, {}))
        .status,
    ).toBe(401);
    // 一个合法的用户 session token 放在 Authorization 头里同样不行 —— 两条认证路径
    // 不相交。若它能通过，任何用户都能把别人的联络尝试标成 delivered。
    expect(
      (
        await postOperator(
          `/internal/contact-attempts/${attemptId}/ack`,
          { operatorId: 'op', note: 'x' },
          { authorization: `Bearer ${OPERATOR_TOKEN}` },
        )
      ).status,
    ).toBe(401);
    // 这一行仍然是 pending —— 未授权的请求没有推进任何状态。
    expect((await readAttempt(seeded.userId))?.status).toBe('pending');
  });

  it('带正确 x-operator-token ⇒ 推进 delivered；空 note 被拒为 400', async () => {
    const { seeded } = await runCrisisTurn('contact-op-ok', okWebhook(), 'enc:13812341234');
    const attemptId = (await readAttempt(seeded.userId))?.id ?? '';
    const header = { 'x-operator-token': OPERATOR_TOKEN };
    // 空 note ⇒ zod 的 min(1) 直接 400（delivered 的判据是真人确认已通话）。
    expect(
      (await postOperator(`/internal/contact-attempts/${attemptId}/ack`, { operatorId: 'op', note: '' }, header))
        .status,
    ).toBe(400);
    expect((await readAttempt(seeded.userId))?.status).toBe('pending');

    const ok = await postOperator(
      `/internal/contact-attempts/${attemptId}/ack`,
      { operatorId: 'op-http', note: '已与联系人甲通话' },
      header,
    );
    expect(ok.status).toBe(200);
    expect((await readAttempt(seeded.userId))?.status).toBe('delivered');
    // 再推一次 ⇒ 409（已不是 pending），而不是静默成功。
    expect(
      (
        await postOperator(
          `/internal/contact-attempts/${attemptId}/ack`,
          { operatorId: 'op-http', note: '再来一次' },
          header,
        )
      ).status,
    ).toBe(409);
  });

  it('/failed 端点同样要求运营者 token，且能把 pending 推成 failed', async () => {
    const { seeded } = await runCrisisTurn('contact-op-failed', okWebhook(), 'enc:13812341234');
    const attemptId = (await readAttempt(seeded.userId))?.id ?? '';
    expect(
      (await postOperator(`/internal/contact-attempts/${attemptId}/failed`, { operatorId: 'op' }, {})).status,
    ).toBe(401);
    const ok = await postOperator(
      `/internal/contact-attempts/${attemptId}/failed`,
      { operatorId: 'op-http', note: '三次未接' },
      { 'x-operator-token': OPERATOR_TOKEN },
    );
    expect(ok.status).toBe(200);
    expect((await readAttempt(seeded.userId))?.status).toBe('failed');
  });
});
