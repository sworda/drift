// ConsentTicket 守卫与撤回语义（PRIV-02，Plan 09 Task 2）。
//
// 四条断言各自对应一个具体的失效模式：
//   (a) 撤回 sensitive_pi 之后写消息抛错 —— 票据守卫在运行时真的生效
//   (b) 撤回各多一行 consent_event 与 privacy_action —— 留证不是可选项
//   (c) 撤回必选项触发 enqueueAccountDeletion —— 不是「撤回后继续聊天」
//   (d) 不存在任何降级只读路径 —— 行为断言（入队失败即整条回滚）+ 源码断言
//
// ⚠️ (c)(d) 用**注入的** enqueue 而不是 mock 模块：revokeConsent 的 deps 参数就是为此
// 存在的。模块 mock 会连带把「入队与撤回同事务」这条性质一起 mock 掉。

import { afterAll, describe, expect, it } from 'vitest';

process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'consent-ticket-test-operator-token-0123456';
process.env['BETTER_AUTH_SECRET'] ??= 'consent-ticket-test-better-auth-secret-0123';
process.env['CONTACT_ENCRYPTION_KEY'] ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

const { readFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const { and, eq } = await import('drizzle-orm');

const {
  AccountDeletionNotImplementedError,
  enqueueAccountDeletion,
} = await import('../../apps/api/src/worker/jobs/account-deletion.ts');
const { listConsents, revokeConsent } = await import(
  '../../apps/api/src/modules/consent/service.ts'
);
const {
  ConsentNotGrantedError,
  closeDb,
  consent,
  consentEvent,
  db,
  insertUserMessage,
  ownerSql,
  privacyAction,
  requireConsent,
  tx,
} = await import('@drift/db');
const { seedConversation } = await import('./fixtures.ts');

const SERVICE_SOURCE = readFileSync(
  fileURLToPath(new URL('../../apps/api/src/modules/consent/service.ts', import.meta.url)),
  'utf8',
);

/** 一个总是成功的入队器。返回值是作业 id。 */
function spyEnqueue(): {
  readonly fn: typeof enqueueAccountDeletion;
  readonly calls: { userId: string; reason: string }[];
} {
  const calls: { userId: string; reason: string }[] = [];
  return {
    calls,
    fn: (_executor, userId, options) => {
      calls.push({ userId, reason: options.reason });
      return Promise.resolve(`job-${userId}`);
    },
  };
}

async function countEvents(userId: string): Promise<{ events: number; actions: number }> {
  const [e] = await db
    .select({ scope: consentEvent.scope })
    .from(consentEvent)
    .where(eq(consentEvent.userId, userId))
    .then((rows) => [rows.length]);
  const [a] = await db
    .select({ kind: privacyAction.kind })
    .from(privacyAction)
    .where(eq(privacyAction.userId, userId))
    .then((rows) => [rows.length]);
  return { events: e ?? 0, actions: a ?? 0 };
}

afterAll(async () => {
  await closeDb();
  await ownerSql.end({ timeout: 5 });
});

describe('ConsentTicket 守卫（Plan 09 Task 2）', () => {
  it('(a) 撤回 sensitive_pi 之后 insertUserMessage 抛错', async () => {
    const seeded = await seedConversation('ticket-a');

    // 撤回之前：票拿得到，消息写得进去。没有这一半，(a) 可能是因为别的原因失败。
    const before = await tx(async (t) => {
      const ticket = await requireConsent(t, seeded.userId, 'sensitive_pi');
      return insertUserMessage(t, {
        conversationId: seeded.conversationId,
        text: '撤回前的消息',
        provenance: {
          sourceUserId: seeded.userId,
          sourceConversationId: seeded.conversationId,
          acquiredVia: 'direct',
        },
        ticket,
      });
    });
    expect(before.seq).toBeGreaterThanOrEqual(0);

    await revokeConsent(seeded.userId, 'sensitive_pi', { enqueueAccountDeletion: spyEnqueue().fn });

    await expect(
      tx(async (t) => {
        const ticket = await requireConsent(t, seeded.userId, 'sensitive_pi');
        return insertUserMessage(t, {
          conversationId: seeded.conversationId,
          text: '撤回后的消息',
          provenance: {
            sourceUserId: seeded.userId,
            sourceConversationId: seeded.conversationId,
            acquiredVia: 'direct',
          },
          ticket,
        });
      }),
    ).rejects.toThrow(ConsentNotGrantedError);
  });

  it('(b) 撤回后 consent_event 与 privacy_action 各多一行', async () => {
    const seeded = await seedConversation('ticket-b');
    const before = await countEvents(seeded.userId);

    await revokeConsent(seeded.userId, 'research_l0');

    const after = await countEvents(seeded.userId);
    expect(after.events).toBe(before.events + 1);
    expect(after.actions).toBe(before.actions + 1);

    const rows = await db
      .select({ granted: consent.granted })
      .from(consent)
      .where(and(eq(consent.userId, seeded.userId), eq(consent.scope, 'research_l0')));
    expect(rows[0]?.granted).toBe(false);

    // 可选项撤回**不**进入删除流程，也不影响 sensitive_pi 的票。
    const views = await listConsents(db, seeded.userId);
    expect(views.find((v) => v.scope === 'research_l0')?.granted).toBe(false);
    expect(views.find((v) => v.scope === 'sensitive_pi')?.granted).toBe(true);
  });

  it('(c) 撤回 basic_service 触发 enqueueAccountDeletion，恰好一次且 reason 正确', async () => {
    const seeded = await seedConversation('ticket-c');
    const spy = spyEnqueue();

    const result = await revokeConsent(seeded.userId, 'basic_service', {
      enqueueAccountDeletion: spy.fn,
    });

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]?.userId).toBe(seeded.userId);
    expect(spy.calls[0]?.reason).toBe('revoke_required_consent');
    expect(result.enteredDeletion).toBe(true);
    expect(result.deletionJobId).not.toBeNull();
  });

  it('(d) 入队失败 ⇒ 整条撤回回滚，不存在「撤回了但没进删除」的中间态', async () => {
    const seeded = await seedConversation('ticket-d');
    const before = await countEvents(seeded.userId);

    // 默认入队器就是 Plan 11 之前那个抛 not-implemented 的实现。
    await expect(revokeConsent(seeded.userId, 'sensitive_pi')).rejects.toThrow(
      AccountDeletionNotImplementedError,
    );

    const rows = await db
      .select({ granted: consent.granted })
      .from(consent)
      .where(and(eq(consent.userId, seeded.userId), eq(consent.scope, 'sensitive_pi')));
    expect(rows[0]?.granted, '撤回已提交但删除从未开始 —— 无合法性基础仍在持有数据').toBe(true);

    const after = await countEvents(seeded.userId);
    expect(after).toEqual(before);

    // 票仍然拿得到 —— 回滚意味着这次撤回没有发生，而不是发生了一半。
    const ticket = await tx(async (t) => requireConsent(t, seeded.userId, 'sensitive_pi'));
    expect(ticket.scope).toBe('sensitive_pi');
  });

  it('(d2) 源码里不存在「撤回后继续聊天」的降级只读分支', () => {
    // 行为断言证明当前这条路径正确；源码断言防的是**后来**有人加一条降级支。
    //
    // **先去注释再扫**：文件头那段说明本身就要写出「这里不存在降级只读」这句话，
    // 而一条把自己的说明也判为违规的断言只会逼人把说明删掉 —— 那是在用检查换沉默。
    const code = SERVICE_SOURCE.replace(/\/\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/u, ''))
      .join('\n');
    for (const banned of ['只读', 'readOnly', 'readonlyMode', 'degrade', '继续聊天']) {
      expect(code.includes(banned), `consent/service.ts 出现了降级词：${banned}`).toBe(false);
    }
    // 去注释这件事本身要非空真：把违规词放进代码位置仍然要被抓到。
    expect(`${code}\nconst readOnly = true;`.includes('readOnly')).toBe(true);

    // 必选项那一支只有一个出口：入队删除。没有第二个 return。
    const requiredBranch = code.slice(code.indexOf('if (!isRequiredScope'));
    expect(requiredBranch).toContain("reason: 'revoke_required_consent'");
    expect(requiredBranch.match(/return \{/gu) ?? []).toHaveLength(2);
  });

  it('Phase 1 只有 sensitive_pi 有 requireConsent 消费方', async () => {
    // 另外三个 scope 在 Phase 1 没有任何写入路径。为它们造消费点会让
    // Plan 10 的「你已经授权，我们目前还没有开始收集这项数据」变成一句假话。
    const { execFileSync } = await import('node:child_process');
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const out = execFileSync(
      'git',
      ['grep', '-n', "requireConsent(", '--', 'apps', 'packages'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    for (const scope of ['research_l0', 'research_l1', 'persona_evolution']) {
      expect(out.includes(`'${scope}'`), `为无数据流的 scope ${scope} 造了假消费点`).toBe(false);
    }
    expect(out).toContain("'sensitive_pi'");
  });
});
