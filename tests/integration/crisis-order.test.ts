// SAFE-01 / SAFE-02 —— 把「判定在人格渲染之后、由不同模型执行」变成两条 SQL。
//
// 两条断言原样取自 01-RESEARCH.md §4.1，各必须返回 0 行。
//
// ⚠️ 「返回 0 行」的默认状态是**空真通过**：一个根本没写 llm_call 的实现同样返回 0 行。
// 所以每条断言都配一条**注入式非空真证明** —— 用 owner 身份往 llm_call 里插两行故意
// 违反的记录，断言同一条 SQL 这时返回 >0 行，再删掉它们。这比「临时改一次源码再还原」
// 强，因为它每个 PR 都跑，而改文件的破坏验证只在执行者手里跑过一次。

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'crisis-order-test-operator-token-0123456789';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

const { runTurn } = await import('../../apps/api/src/modules/chat/turn.ts');
const { closeDb, db, llmCall, ownerSql, safetyEvent, sessionRiskState } = await import('@drift/db');
const { seedConversation } = await import('./fixtures.ts');

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

beforeAll(async () => {
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
});

afterAll(async () => {
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
