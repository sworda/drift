// SAFE-05 —— 分类器三类失败全部 fail-closed 到 elevated，且**不联络第三方**。
//
// 三类失败（RESEARCH §4.3）各注入一次，每次断言四条：
//   ① session_risk_state.level 为 elevated（不是 none，也不是 crisis）
//   ② 渲染的是一级卡片，与一级完全相同 —— 用户看不到「系统出错了」（UI-SPEC 明文）
//   ③ contact_attempt 表无新增行（crisis 才联络，而 crisis 会让别人的手机响）
//   ④ safety_event 恰好一行且 classifier_status 为 failed
//
// ⚠️ 注入点是 runTurn 的 `classifyInvoke` 端口，而不是「临时改一次源码再还原」：
// 改文件的破坏验证只在执行者手里跑过一次，注入式的用例每个 PR 都跑。这个端口能替换的
// 只是传输层 —— 返回值仍然要过 classifySafety 的 schema 校验与置信度下限，所以它
// **造不出**「原样透传候选回复」这个形态。

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 纯类型导入 —— 会被擦除，因此它不会在 env 设好之前加载任何模块。
import type { ClassifyInvoke } from '@drift/safety';

process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'fail-closed-test-operator-token-0123456789';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

const { runTurn } = await import('../../apps/api/src/modules/chat/turn.ts');
const { closeDb, contactAttempt, db, message, safetyEvent, sessionRiskState } =
  await import('@drift/db');
const { seedConversation } = await import('./fixtures.ts');

/** 三类失败各一个注入实现。 */
const INJECTIONS: readonly (readonly [string, ClassifyInvoke])[] = [
  // (a) provider 报错/超时。
  ['provider 报错', () => Promise.reject(new Error('provider exploded'))],
  // (b) 结构化输出 schema 校验失败。
  [
    'schema 校验失败',
    () => Promise.resolve({ text: '我觉得这个人有点难过吧', modelSnapshot: 'glm-4.7-flash' }),
  ],
  // (c) 置信度低于阈值 —— 注意它说的是 crisis，但低置信不得变成一次真的 crisis。
  [
    '置信度低于阈值',
    () =>
      Promise.resolve({
        text: JSON.stringify({ level: 'crisis', confidence: 0.2, categories: ['suicidal_intent'] }),
        modelSnapshot: 'glm-4.7-flash',
      }),
  ],
];

interface Injected {
  readonly label: string;
  readonly seeded: Awaited<ReturnType<typeof seedConversation>>;
  readonly reply: Awaited<ReturnType<typeof runTurn>>['reply'];
}

const runs: Injected[] = [];

beforeAll(async () => {
  for (const [label, classifyInvoke] of INJECTIONS) {
    const seeded = await seedConversation('fail-closed');
    const result = await runTurn(
      {
        conversationId: seeded.conversationId,
        userId: seeded.userId,
        // 刻意用一句**不命中入站规则**的中性消息：这样最终等级完全由 fail-closed
        // 决定，而不是被规则层的建议等级掩盖。
        text: '今天上班有点忙，晚饭还没吃。',
      },
      { classifyInvoke },
    );
    runs.push({ label, seeded, reply: result.reply });
  }
});

afterAll(async () => {
  await closeDb();
});

describe.each(INJECTIONS.map(([label]) => label))('分类器失败「%s」', (label) => {
  function current(): Injected {
    const found = runs.find((run) => run.label === label);
    if (found === undefined) throw new Error(`注入用例 ${label} 没有跑起来`);
    return found;
  }

  it('① session_risk_state 为 elevated（不是 none，也不是 crisis）', async () => {
    const { seeded } = current();
    const rows = await db
      .select({ level: sessionRiskState.level })
      .from(sessionRiskState)
      .where(eq(sessionRiskState.conversationId, seeded.conversationId));
    expect(rows[0]?.level).toBe('elevated');
  });

  it('② 渲染一级卡片，且文案里没有任何「系统出错了」的痕迹', () => {
    const { reply } = current();
    expect(reply.outcome).toBe('escalated');
    if (reply.outcome !== 'escalated') return;
    expect(reply.level).toBe('elevated');
    expect(reply.careCard.level).toBe('level1');
    // 一级卡片在**类型上**就没有 contactStatus（SAFE-03 的「不联络」）。
    expect('contactStatus' in reply.careCard).toBe(false);
    const serialized = JSON.stringify(reply.careCard);
    expect(serialized).not.toMatch(/出错|异常|error|failed/iu);
    // 兜底清单非空：一张没有任何号码的关怀卡片比没有卡片更糟。
    expect(reply.careCard.resources.length).toBeGreaterThanOrEqual(2);
  });

  it('③ contact_attempt 表无新增行（分类器 bug 不得让别人的手机响）', async () => {
    const { seeded } = current();
    const rows = await db
      .select({ id: contactAttempt.id })
      .from(contactAttempt)
      .where(eq(contactAttempt.userId, seeded.userId));
    expect(rows).toHaveLength(0);
  });

  it('④ safety_event 恰好一行且 classifier_status 为 failed', async () => {
    const { seeded } = current();
    const rows = await db
      .select({
        previousLevel: safetyEvent.previousLevel,
        level: safetyEvent.level,
        classifierStatus: safetyEvent.classifierStatus,
        ruleHits: safetyEvent.ruleHits,
        overrideApplied: safetyEvent.overrideApplied,
      })
      .from(safetyEvent)
      .where(eq(safetyEvent.conversationId, seeded.conversationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.classifierStatus).toBe('failed');
    expect(rows[0]?.level).toBe('elevated');
    expect(rows[0]?.previousLevel).toBe('none');
    expect(rows[0]?.overrideApplied).toBe(true);
    expect(rows[0]?.ruleHits).toContain('classifier:failed');
  });

  it('角色消息未落库 —— 不存在「降级为直接下发人格回复」这条路径', async () => {
    const { seeded } = current();
    const rows = await db
      .select({ senderKind: message.senderKind })
      .from(message)
      .where(eq(message.conversationId, seeded.conversationId));
    // 只有用户那一条。
    expect(rows.map((row) => row.senderKind)).toEqual(['user']);
  });
});

describe('非空真对照：contact_attempt 那条断言不是空真的', () => {
  it('同一套装置下，一条命中入站规则的二级危机消息**会**产生一行 contact_attempt', async () => {
    // ⚠️ 上面四组用例里的「contact_attempt 无新增行」如果没有这一条正向对照，就是
    // 空真的：一个根本没有联络实现的分支同样满足它。这一条证明装置本身能产生行。
    const seeded = await seedConversation('fail-closed-contact-control');
    const result = await runTurn(
      {
        conversationId: seeded.conversationId,
        userId: seeded.userId,
        text: '我真的不想活了，今天就想结束自己的生命。',
      },
      // 没有 emergency_contact 记录 ⇒ 这一行会是 unavailable；但它**存在**，
      // 而这正是本条对照要证明的东西。
      {},
    );
    expect(result.reply.outcome).toBe('escalated');
    if (result.reply.outcome !== 'escalated') return;
    expect(result.reply.level).toBe('crisis');
    const rows = await db
      .select({ status: contactAttempt.status })
      .from(contactAttempt)
      .where(eq(contactAttempt.userId, seeded.userId));
    expect(rows, 'crisis 路径必须产生一行 contact_attempt').toHaveLength(1);
  });
});

describe('非空真对照：同一条中性消息在分类器正常时是 gated', () => {
  it('不注入故障 ⇒ outcome 为 gated 且角色消息落库', async () => {
    const seeded = await seedConversation('fail-closed-control');
    const result = await runTurn({
      conversationId: seeded.conversationId,
      userId: seeded.userId,
      text: '今天上班有点忙，晚饭还没吃。',
    });
    expect(result.reply.outcome, 'mock 分类器判 none ⇒ 应当放行').toBe('gated');
    const rows = await db
      .select({ senderKind: message.senderKind })
      .from(message)
      .where(eq(message.conversationId, seeded.conversationId));
    expect(rows.map((row) => row.senderKind)).toEqual(['user', 'character']);
    // 分类器正常 ⇒ 没有 safety_event，也没有风险态。
    const events = await db
      .select({ id: safetyEvent.id })
      .from(safetyEvent)
      .where(eq(safetyEvent.conversationId, seeded.conversationId));
    expect(events).toHaveLength(0);
  });
});
