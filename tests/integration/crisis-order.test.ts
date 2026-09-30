// SAFE-01 / SAFE-02 —— 把「判定在人格渲染之后、由不同模型执行」变成两条 SQL。
//
// 两条断言原样取自 01-RESEARCH.md §4.1，各必须返回 0 行。
//
// ⚠️ 「返回 0 行」的默认状态是**空真通过**：一个根本没写 llm_call 的实现同样返回 0 行。
// 所以每条断言都配一条**注入式非空真证明** —— 用 owner 身份往 llm_call 里插两行故意
// 违反的记录，断言同一条 SQL 这时返回 >0 行，再删掉它们。这比「临时改一次源码再还原」
// 强，因为它每个 PR 都跑，而改文件的破坏验证只在执行者手里跑过一次。

import { eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'crisis-order-test-operator-token-0123456789';
// Plan 09 新增的两个必填变量（better-auth 签名密钥 + 紧急联系人加密密钥）。
// 两者都没有默认值也没有回退分支，所以测试必须显式给值。
process.env['BETTER_AUTH_SECRET'] ??= 'crisis-order-test-better-auth-secret-0123456789';
process.env['CONTACT_ENCRYPTION_KEY'] ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

const { runTurn } = await import('../../apps/api/src/modules/chat/turn.ts');
const { AlertPayloadLeakError, assertNoUserText, buildWecomPayload, findLeakedSubstring, MIN_LEAK_LENGTH } =
  await import('../../apps/api/src/modules/safety/alert.ts');
const { registerContactAttemptTimeout, setContactAttemptTimeoutScheduler } = await import(
  '../../apps/api/src/worker/jobs/contact-attempt-timeout.ts'
);
const {
  closeDb,
  contactAttempt,
  db,
  emergencyContact,
  encryptContact,
  llmCall,
  ownerDb,
  ownerSql,
  safetyEvent,
  sessionRiskState,
} = await import('@drift/db');
const { seedConversation } = await import('./fixtures.ts');

/**
 * 触发消息里嵌一段长随机中文特征串。
 *
 * 随机而不是固定：固定串有可能恰好出现在告警模板里（那时断言会一直红，然后被人
 * 改宽）。随机串保证「载荷里出现它」只有一个可能的来源 —— 它是从触发消息拷过去的。
 */
const TRACER_CHARS = '柰茜霖旻珩黛琰璟宸昀曦皓';
function makeTracer(): string {
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out += TRACER_CHARS[Math.floor(Math.random() * TRACER_CHARS.length)] ?? '柰';
  }
  return out;
}

/** RESEARCH §4.1 断言 1：safety.classify 不得早于 chat.reply。 */
async function misorderedTurns(turnId?: string): Promise<number> {
  const rows = turnId === undefined
    ? await ownerSql<{ readonly n: number }[]>`
        select count(*)::int as n
        from llm_call r join llm_call s using (turn_id)
        where r.purpose = 'chat.reply' and s.purpose = 'safety.classify'
          and s.created_at < r.created_at`
    : await ownerSql<{ readonly n: number }[]>`
        select count(*)::int as n
        from llm_call r join llm_call s using (turn_id)
        where r.purpose = 'chat.reply' and s.purpose = 'safety.classify'
          and s.created_at < r.created_at and r.turn_id = ${turnId}`;
  return rows[0]?.n ?? -1;
}

/** RESEARCH §4.1 断言 2（SAFE-02）：两者不得是同一个模型快照。 */
async function sharedModelTurns(turnId?: string): Promise<number> {
  const rows = turnId === undefined
    ? await ownerSql<{ readonly n: number }[]>`
        select count(*)::int as n
        from llm_call r join llm_call s using (turn_id)
        where r.purpose = 'chat.reply' and s.purpose = 'safety.classify'
          and s.model_snapshot = r.model_snapshot`
    : await ownerSql<{ readonly n: number }[]>`
        select count(*)::int as n
        from llm_call r join llm_call s using (turn_id)
        where r.purpose = 'chat.reply' and s.purpose = 'safety.classify'
          and s.model_snapshot = r.model_snapshot and r.turn_id = ${turnId}`;
  return rows[0]?.n ?? -1;
}

let seeded: Awaited<ReturnType<typeof seedConversation>>;
let turnId: string;
let boss: PgBoss;

/** 第二次 turn：带紧急联系人与可拦截的 webhook，用来走到告警载荷构造点。 */
let alertSeeded: Awaited<ReturnType<typeof seedConversation>>;
let alertTracer: string;
let alertTriggerText: string;
let capturedBodies: string[] = [];

beforeAll(async () => {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined) throw new Error('DATABASE_URL 未设置');
  // 独立 schema：与其他集成测试文件的 boss 并发跑时不互相迁移同一套表。
  boss = new PgBoss({
    connectionString,
    schema: 'pgboss_crisis_order',
    application_name: 'crisis-order-test',
  });
  boss.on('error', () => undefined);
  await boss.start();
  await registerContactAttemptTimeout(boss, { executor: db });

  seeded = await seedConversation('crisis-order');
  // 明确的自残自杀意图 ⇒ 入站规则层建议 crisis，而 mock 分类器判 none。
  // resolveRisk 取较高者 ⇒ crisis（规则层只能抬升，不能降低）。
  const result = await runTurn({
    conversationId: seeded.conversationId,
    userId: seeded.userId,
    text: '我真的不想活了，今天就想结束自己的生命。',
  });
  turnId = result.turnId;
  expect(result.reply.outcome, '危机路径不应产出角色回复').toBe('escalated');

  // ── 第二次 turn：走到 acute 告警的载荷构造点（Task 3）───────────────────────
  alertSeeded = await seedConversation('crisis-alert');
  await ownerDb.insert(emergencyContact).values({
    userId: alertSeeded.userId,
    kind: 'emergency',
    name: '联系人甲',
    contactRefEncrypted: encryptContact('13812341234'),
  });
  alertTracer = makeTracer();
  alertTriggerText = `我真的不想活了，${alertTracer}，今天就想结束自己的生命。`;
  capturedBodies = [];
  const alertResult = await runTurn(
    {
      conversationId: alertSeeded.conversationId,
      userId: alertSeeded.userId,
      text: alertTriggerText,
    },
    {
      alertFetch: (_input, init) => {
        capturedBodies.push(typeof init?.body === 'string' ? init.body : String(init?.body ?? ''));
        return Promise.resolve(
          new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
    },
  );
  expect(alertResult.reply.outcome).toBe('escalated');
});

afterAll(async () => {
  setContactAttemptTimeoutScheduler(null);
  await boss.stop({ graceful: false, timeout: 5_000 });
  await closeDb();
});

describe('SAFE-01：安全判定在人格渲染之后（一条返回 0 行的 SQL）', () => {
  it('全库的顺序断言返回 0 行', async () => {
    expect(await misorderedTurns()).toBe(0);
  });

  it('本次 turn 的顺序断言返回 0 行', async () => {
    expect(await misorderedTurns(turnId)).toBe(0);
  });

  it('同一 turn_id 下恰好 2 行 llm_call，purpose 集合为 { chat.reply, safety.classify }', async () => {
    const calls = await db
      .select({ purpose: llmCall.purpose, modelSnapshot: llmCall.modelSnapshot })
      .from(llmCall)
      .where(eq(llmCall.turnId, turnId));
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((row) => row.purpose))).toEqual(
      new Set(['chat.reply', 'safety.classify']),
    );
  });

  it('非空真证明：插入两行故意违反顺序的记录后，同一条 SQL 返回 >0 行', async () => {
    const fakeTurn = `fake-order-${Date.now().toString(36)}`;
    await insertFakePair(fakeTurn, { reversed: true, sameModel: false });
    try {
      expect(await misorderedTurns(fakeTurn)).toBeGreaterThan(0);
      expect(await misorderedTurns()).toBeGreaterThan(0);
    } finally {
      await deleteFakePair(fakeTurn);
    }
    // 删干净之后全库断言重新回到 0 —— 否则后面的断言会被残留污染。
    expect(await misorderedTurns()).toBe(0);
  });
});

describe('SAFE-02：危机判定由与扮演角色不同的模型执行（一条返回 0 行的 SQL）', () => {
  it('全库与本次 turn 的模型分离断言都返回 0 行', async () => {
    expect(await sharedModelTurns()).toBe(0);
    expect(await sharedModelTurns(turnId)).toBe(0);
  });

  it('非空真证明：插入两行共用同一 model_snapshot 的记录后，同一条 SQL 返回 >0 行', async () => {
    const fakeTurn = `fake-model-${Date.now().toString(36)}`;
    await insertFakePair(fakeTurn, { reversed: false, sameModel: true });
    try {
      expect(await sharedModelTurns(fakeTurn)).toBeGreaterThan(0);
      expect(await sharedModelTurns()).toBeGreaterThan(0);
    } finally {
      await deleteFakePair(fakeTurn);
    }
    expect(await sharedModelTurns()).toBe(0);
  });
});

describe('crisis 路径的结构化事实', () => {
  it('session_risk_state 被抬升到 crisis，且 decay_after 非空（冷静期存在）', async () => {
    const rows = await db
      .select({
        level: sessionRiskState.level,
        decayAfter: sessionRiskState.decayAfter,
        clearedBy: sessionRiskState.clearedBy,
      })
      .from(sessionRiskState)
      .where(eq(sessionRiskState.conversationId, seeded.conversationId));
    expect(rows[0]?.level).toBe('crisis');
    expect(rows[0]?.decayAfter).not.toBeNull();
    expect(rows[0]?.clearedBy).toBeNull();
  });

  it('safety_event 恰好一行：risk 轨迹 none → crisis，只有哈希与长度，没有正文', async () => {
    const rows = await db
      .select({
        previousLevel: safetyEvent.previousLevel,
        level: safetyEvent.level,
        ruleHits: safetyEvent.ruleHits,
        classifierStatus: safetyEvent.classifierStatus,
        classifierModelSnapshot: safetyEvent.classifierModelSnapshot,
        candidateReplyHash: safetyEvent.candidateReplyHash,
        candidateReplyLen: safetyEvent.candidateReplyLen,
        overrideApplied: safetyEvent.overrideApplied,
      })
      .from(safetyEvent)
      .where(eq(safetyEvent.conversationId, seeded.conversationId));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.previousLevel).toBe('none');
    expect(row?.level).toBe('crisis');
    expect(row?.overrideApplied).toBe(true);
    expect(row?.classifierStatus).toBe('ok');
    expect(row?.classifierModelSnapshot).not.toBeNull();
    // sha256 hex = 64 位。表里没有任何正文列，所以整行序列化后不含用户原话。
    expect(row?.candidateReplyHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(row?.candidateReplyLen).toBeGreaterThan(0);
    expect(JSON.stringify(row)).not.toContain('不想活');
    // 命中的是规则 id，不是用户原文片段。
    expect(row?.ruleHits.some((hit) => hit.startsWith('suicidal_intent.'))).toBe(true);
  });

  it('safety_event 表里不存在任何正文列（append-only 留证不得含个人信息正文）', async () => {
    const columns = await ownerSql<{ readonly column_name: string }[]>`
      select column_name from information_schema.columns where table_name = 'safety_event'
    `;
    const names = columns.map((row) => row.column_name);
    for (const banned of ['text', 'content', 'candidate_reply', 'body', 'message_text']) {
      expect(names, `safety_event 出现了正文列 ${banned}`).not.toContain(banned);
    }
  });

  it('角色消息未落库 —— 该轮由关怀卡片接管，角色不发消息', async () => {
    const rows = await ownerSql<{ readonly n: number }[]>`
      select count(*)::int as n from message
      where conversation_id = ${seeded.conversationId} and sender_kind = 'character'
    `;
    expect(rows[0]?.n).toBe(0);
  });
});

/** 用 owner 身份插两行故意违反的 llm_call（app_role 对该表只有 INSERT/SELECT）。 */
async function insertFakePair(
  fakeTurn: string,
  options: { readonly reversed: boolean; readonly sameModel: boolean },
): Promise<void> {
  const replyModel = 'doubao-seed-character-251128';
  const classifyModel = options.sameModel ? replyModel : 'glm-4.7-flash';
  const replyAt = options.reversed ? '2026-01-01T00:00:10Z' : '2026-01-01T00:00:00Z';
  const classifyAt = options.reversed ? '2026-01-01T00:00:00Z' : '2026-01-01T00:00:10Z';
  for (const [purpose, model, at] of [
    ['chat.reply', replyModel, replyAt],
    ['safety.classify', classifyModel, classifyAt],
  ] as const) {
    await ownerSql`
      insert into llm_call (
        id, turn_id, purpose, provider, requested_model, model_snapshot, resolved_model,
        provider_request_id, prompt_version, input_hash, thinking_mode, temperature,
        prompt_tokens, completion_tokens, cached_tokens, price_tier, latency_ms, created_at
      ) values (
        ${`fake-${fakeTurn}-${purpose}`}, ${fakeTurn}, ${purpose}, 'mock', ${model}, ${model}, ${model},
        'fake', 'pv_fake', 'sha256:fake', 'off', 0, 0, 0, 0, 'tier0', 0, ${at}
      )
    `;
  }
}

async function deleteFakePair(fakeTurn: string): Promise<void> {
  await ownerSql`delete from llm_call where turn_id = ${fakeTurn}`;
}

describe('SAFE-16 / PRIV-11：运营者告警载荷不含任何对话文本', () => {
  it('(1) 一次 crisis 流程里 notifyOperator 恰好被调用一次', async () => {
    expect(capturedBodies, 'acute 告警应当恰好投递一次').toHaveLength(1);
    // 且这次投递真的把 contact_attempt 推进到了 pending —— 否则「调用了一次」可能
    // 只是一次失败的尝试，而本组断言的对象是**成功投递**的那条载荷。
    const rows = await db
      .select({ status: contactAttempt.status })
      .from(contactAttempt)
      .where(eq(contactAttempt.userId, alertSeeded.userId));
    expect(rows[0]?.status).toBe('pending');
  });

  it('(2) 实际发出的 JSON 不含触发消息的任何 6 字以上子串', () => {
    const body = capturedBodies[0] ?? '';
    expect(body.length).toBeGreaterThan(0);
    const leaked = findLeakedSubstring(body, alertTriggerText, MIN_LEAK_LENGTH);
    expect(leaked, `告警载荷泄漏了对话片段：${leaked ?? ''}\n载荷：${body}`).toBeNull();
    // 特征串单独再查一次（上面的窗口扫描已覆盖，这一行是给读失败信息的人看的）。
    expect(body).not.toContain(alertTracer);
  });

  it('(3) 负向 fixture：把消息片段塞进 note 字段时 assertNoUserText 抛错', () => {
    const alert = {
      userId: alertSeeded.userId,
      conversationId: alertSeeded.conversationId,
      riskLevel: 'crisis',
      occurredAt: new Date('2026-09-27T10:00:00.000Z'),
      safetyEventId: 'sev_negative_fixture',
    } as const;
    const honest = buildWecomPayload(alert, ['@all']);
    // 先证明自检对**干净**载荷不误报 —— 否则下面那条「抛错」可能只是恒抛。
    expect(() => {
      assertNoUserText(honest, alertTriggerText);
    }).not.toThrow();

    // 人为构造一个把触发消息片段塞进 note 字段的载荷（8 字，> MIN_LEAK_LENGTH）。
    const fragment = alertTriggerText.slice(0, 8);
    const leaky = { ...honest, note: `用户说：${fragment}` };
    expect(() => {
      assertNoUserText(leaky, alertTriggerText);
    }).toThrow(AlertPayloadLeakError);
    // 异常信息里不得原样带出那段泄漏文本（它会进日志/CI 输出）。
    try {
      assertNoUserText(leaky, alertTriggerText);
    } catch (error) {
      expect(error instanceof AlertPayloadLeakError).toBe(true);
      expect(String(error)).not.toContain(fragment);
    }
  });

  it('(4) 自检在 fetch **之前** —— 泄漏的载荷一次都发不出去', async () => {
    const { notifyOperator } = await import('../../apps/api/src/modules/safety/alert.ts');
    const sent: string[] = [];
    const alert = {
      userId: 'usr_guard',
      // 把触发消息塞进一个本该是 id 的字段：这是「顺手多带一点方便排查」的真实形态。
      conversationId: alertTriggerText,
      riskLevel: 'crisis',
      occurredAt: new Date('2026-09-27T10:00:00.000Z'),
      safetyEventId: 'sev_guard',
    } as const;
    await expect(
      notifyOperator(
        alert,
        {
          webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=guard',
          fetchImpl: (_input, init) => {
            sent.push(String(init?.body ?? ''));
            return Promise.resolve(new Response('{"errcode":0}', { status: 200 }));
          },
        },
        { triggeringMessage: alertTriggerText },
      ),
    ).rejects.toThrow(AlertPayloadLeakError);
    expect(sent, '自检抛错之后 fetch 不应被调用过').toHaveLength(0);
  });
});
