// Walking Skeleton 的那一刀（RESEARCH §2.4）—— 一条真实消息从邀请码走到带 AI 徽标
// 的角色气泡，每一段都有机器断言。
//
//   邀请码校验 → 建账号 + 同一事务写 5 条 consent → 角色库真实 DB 读
//     → 加好友建 conversation → 发 1 条用户消息（落库取 seq）
//     → Model Router（mock provider，走完整路由表 + 落 llm_call）
//     → safety.classify → safetyGateway() 产出 GatedText
//     → 落库（取 seq + 注入 disclosure，受 DB CHECK 保护）→ WS 投递
//
// ⚠️ 这条测试**不是**「跑通了就行」的 smoke test。它的每一段都断言一条结构化事实：
// seq 无空洞、disclosure 非空、llm_call 恰好两行且 purpose 成对、WS 收到的 seq 等于
// 库里的 seq。断言「响应是 200」会让这整条链路在任何一段悄悄退化时仍然全绿。
//
// ⚠️ 这里用的是**全局 WebSocket**（Node 22+ 自带）而不是 import 'ws'：
// eslint.config.js 只允许 apps/api/src/ws/** 导入 ws —— 那条边界的意义就是「下发
// 只接受 GatedText」只有一个执行点，测试文件也不例外。

import type { AddressInfo } from 'node:net';

import { serve } from '@hono/node-server';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// env.ts 在 import 时就解析环境变量并在缺失时 process.exit(1)，所以这些必须在
// 任何 apps/api 模块被 import **之前**设好。DATABASE_URL 由 setup.ts 指向一次性测试库。
// env.ts 的 schema 要求 PORT >= 1，而本测试并不监听它 —— 服务器用 port: 0 让内核
// 分配一个空闲端口（并发跑多个测试文件时固定端口会互相抢）。这里只是让校验通过。
process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

const { createApp } = await import('../../apps/api/src/http/app.ts');
const { attachWebSocket } = await import('../../apps/api/src/ws/server.ts');
const {
  closeDb,
  consent,
  conversation,
  db,
  friendship,
  insertCharacterMessage,
  insertUserMessage,
  llmCall,
  message,
  ownerSql,
  tx,
} = await import('@drift/db');
const { safetyGateway } = await import('@drift/safety');
const { PROMPTS } = await import('@drift/prompts');

const POLICY_VERSION = 'sha256:tracer-policy';

let baseUrl: string;
let wsUrl: string;
let stopServer: () => Promise<void>;

interface RegisteredUser {
  readonly userId: string;
  readonly sessionToken: string;
}

function authHeaders(user: RegisteredUser): Record<string, string> {
  return { authorization: `Bearer ${user.sessionToken}`, 'content-type': 'application/json' };
}

async function mintInviteCode(code: string): Promise<void> {
  await ownerSql`insert into invite_code (code, created_by) values (${code}, 'tracer')`;
}

async function register(code: string, suffix: string): Promise<Response> {
  return fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      inviteCode: code,
      email: `tracer-${suffix}@example.invalid`,
      password: 'correct-horse-battery',
      name: `tracer-${suffix}`,
      birthDate: '1995-06-15',
      consents: { basic_service: true, sensitive_pi: true },
      policyVersion: POLICY_VERSION,
    }),
  });
}

/** 等一条满足谓词的下行帧，或超时。超时必须失败 —— 静默等下去会让测试挂而不是红。 */
function waitForFrame(
  socket: WebSocket,
  predicate: (frame: { readonly type: string; readonly payload?: unknown }) => boolean,
  timeoutMs = 10_000,
): Promise<{ readonly type: string; readonly payload: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error(`等待下行帧超时（${String(timeoutMs)}ms）`));
    }, timeoutMs);
    function onMessage(event: MessageEvent): void {
      const parsed = JSON.parse(String(event.data)) as {
        type: string;
        payload: Record<string, unknown>;
      };
      if (!predicate(parsed)) return;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      resolve(parsed);
    }
    socket.addEventListener('message', onMessage);
  });
}

function openSocket(conversationId: string): Promise<WebSocket> {
  const socket = new WebSocket(`${wsUrl}?conversationId=${encodeURIComponent(conversationId)}`);
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve(socket);
    });
    socket.addEventListener('error', () => {
      reject(new Error('WebSocket 连接失败'));
    });
  });
}

beforeAll(async () => {
  const app = createApp();
  const listener = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  const ws = attachWebSocket(listener as never);
  stopServer = async (): Promise<void> => {
    await ws.close();
    await new Promise<void>((resolve) => {
      listener.close(() => {
        resolve();
      });
    });
  };

  // ⚠️ serve() 是异步开始监听的：立刻读 address() 拿到的是 null。等 'listening'
  // 事件而不是 sleep 一小会儿 —— 后者在负载高的 CI 上会变成一条间歇性红。
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
  wsUrl = `ws://127.0.0.1:${String(address.port)}/ws`;
});

afterAll(async () => {
  await stopServer();
  await closeDb();
  await ownerSql.end({ timeout: 5 });
});

describe('tracer —— 一条真实消息打穿全链路', () => {
  let user: RegisteredUser;
  let conversationId: string;
  let characterId: string;

  it('(1) 同一个邀请码并发注册两次，恰好一个成功（T-04-03）', async () => {
    const code = `tracer-race-${Date.now().toString(36)}`;
    await mintInviteCode(code);

    // 真并发：两个请求同时发出，靠 invite_code 的条件更新 + 行锁裁决。
    // 串行跑这条测试会通过一个「先 select 再 update」的错误实现 —— 那正是要防的。
    const [first, second] = await Promise.all([register(code, 'race-a'), register(code, 'race-b')]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses, `两个请求的状态码应为 [201, 409]，实际 ${JSON.stringify(statuses)}`).toEqual([
      201, 409,
    ]);

    const rows = await ownerSql<{ readonly n: number }[]>`
      select count(*)::int as n from "user" where invite_code_id = ${code}
    `;
    expect(rows[0]?.n, '同一个邀请码建出了多于一个账号').toBe(1);
  });

  it('(2) 注册成功后 consent 恰好 5 行，两项必选为 true', async () => {
    const code = `tracer-main-${Date.now().toString(36)}`;
    await mintInviteCode(code);
    const response = await register(code, 'main');
    expect(response.status).toBe(201);
    user = (await response.json()) as RegisteredUser;

    const rows = await db
      .select({ scope: consent.scope, granted: consent.granted })
      .from(consent)
      .where(eq(consent.userId, user.userId))
      .orderBy(asc(consent.scope));

    expect(rows).toHaveLength(5);
    const granted = new Map(rows.map((r) => [r.scope, r.granted]));
    expect(granted.get('basic_service')).toBe(true);
    expect(granted.get('sensitive_pi')).toBe(true);
    // 三项可选默认未勾 —— 「缺项视为未授权」而不是「默认同意」。
    expect(granted.get('research_l0')).toBe(false);
    expect(granted.get('research_l1')).toBe(false);
    expect(granted.get('persona_evolution')).toBe(false);
  });

  it('(3) GET /characters 返回 3 条，且来自 DB', async () => {
    const response = await fetch(`${baseUrl}/characters`, { headers: authHeaders(user) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      characters: { id: string; name: string; isAi: boolean }[];
    };
    expect(body.characters).toHaveLength(3);
    // 不是静态 JSON：库里的 id 集合必须与接口返回的一致。
    const dbIds = await ownerSql<{ readonly id: string }[]>`select id from "character"`;
    expect(new Set(body.characters.map((ch) => ch.id))).toEqual(new Set(dbIds.map((r) => r.id)));
    // 服务端只回答「是不是 AI」，不回答「标识说什么」（COMPLY-01 的分工）。
    for (const ch of body.characters) expect(ch.isAi).toBe(true);
    characterId = body.characters[0]?.id ?? '';
    expect(characterId).not.toHaveLength(0);
  });

  it('(3b) 未登录访问角色库返回 401', async () => {
    const response = await fetch(`${baseUrl}/characters`);
    expect(response.status).toBe(401);
  });

  it('(4) 加好友后 counterpart_kind=ai_character、relationship=stranger', async () => {
    const response = await fetch(`${baseUrl}/characters/${characterId}/friend`, {
      method: 'POST',
      headers: authHeaders(user),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { conversationId: string; created: boolean };
    conversationId = body.conversationId;

    const convRows = await db
      .select({
        counterpartKind: conversation.counterpartKind,
        status: conversation.status,
        nextSeq: conversation.nextSeq,
      })
      .from(conversation)
      .where(eq(conversation.id, conversationId));
    expect(convRows[0]?.counterpartKind).toBe('ai_character');
    expect(convRows[0]?.status).toBe('active');
    expect(convRows[0]?.nextSeq, '新会话的取号器应从 1 开始').toBe(1);

    const friendRows = await db
      .select({ relationship: friendship.relationship })
      .from(friendship)
      .where(and(eq(friendship.userId, user.userId), eq(friendship.characterId, characterId)));
    expect(friendRows[0]?.relationship).toBe('stranger');

    // 幂等：再点一次不产生第二个会话。
    const again = await fetch(`${baseUrl}/characters/${characterId}/friend`, {
      method: 'POST',
      headers: authHeaders(user),
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { conversationId: string }).conversationId).toBe(conversationId);
  });

  it('(5)(6)(7)(8) 发一条消息：seq 1/2 无空洞、disclosure 非空、llm_call 成对、WS 收到同一个 seq', async () => {
    const socket = await openSocket(conversationId);
    const frameArrived = waitForFrame(socket, (frame) => frame.type === 'message.created');

    const response = await fetch(`${baseUrl}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: authHeaders(user),
      body: JSON.stringify({ text: '你好，第一次跟你说话。' }),
    });
    expect(response.status).toBe(201);
    const turn = (await response.json()) as {
      turnId: string;
      userMessage: { seq: number };
      reply: { outcome: string; seq: number };
    };
    expect(turn.reply.outcome, '回复被网关拦下了 —— mock 分类器应返回 none').toBe('gated');

    // (5) message 表恰好 2 行，seq 1 和 2，无空洞无重复
    const messages = await db
      .select({ seq: message.seq, senderKind: message.senderKind, disclosure: message.disclosure })
      .from(message)
      .where(eq(message.conversationId, conversationId))
      .orderBy(asc(message.seq));
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(messages.map((m) => m.senderKind)).toEqual(['user', 'character']);

    // (6) 角色消息的 disclosure 非空，且只存事实不存文案
    const characterRow = messages[1];
    expect(characterRow?.disclosure, '角色消息的 disclosure 为空 —— DB CHECK 本应挡住它').not.toBeNull();
    expect(characterRow?.disclosure?.kind).toBe('ai_generated');
    expect(characterRow?.disclosure?.labelerVersion).toBe('disclosure-v1');
    // 文案不进 message 行：它在 @drift/contract 的常量里。
    expect(JSON.stringify(characterRow?.disclosure)).not.toContain('AI 角色互动');

    // (7) 同一 turn_id 下 llm_call 恰好 2 行，purpose 成对，provider 均为 mock
    const calls = await db
      .select({
        purpose: llmCall.purpose,
        provider: llmCall.provider,
        requestedModel: llmCall.requestedModel,
        modelSnapshot: llmCall.modelSnapshot,
        resolvedModel: llmCall.resolvedModel,
        priceTier: llmCall.priceTier,
        promptVersion: llmCall.promptVersion,
        turnId: llmCall.turnId,
        createdAt: llmCall.createdAt,
        inputHash: llmCall.inputHash,
      })
      .from(llmCall)
      .where(eq(llmCall.turnId, turn.turnId))
      .orderBy(asc(llmCall.createdAt));
    expect(calls, 'mock provider 也必须经 Router 落 llm_call').toHaveLength(2);
    expect(calls.map((r) => r.purpose)).toEqual(['chat.reply', 'safety.classify']);
    expect(calls.map((r) => r.provider)).toEqual(['mock', 'mock']);
    // SAFE-02：安全层与扮演角色用的不是同一个模型。
    expect(calls[0]?.modelSnapshot).not.toBe(calls[1]?.modelSnapshot);
    // 不存 prompt 正文，只存输入哈希。
    for (const row of calls) expect(row.inputHash.startsWith('sha256:')).toBe(true);

    // Plan 05：requested / resolved **分两列**落库（STACK §15.9 第 3 条）。
    // 落库无条件发生 —— 两者一致时也要写，否则 resolved_model 的日 diff 在
    // 「厂商还没换模型」的日子里无值可比，而那正是它需要建立基线的那些天。
    for (const row of calls) {
      expect(row.requestedModel.length, `${row.purpose} 的 requested_model 为空`).toBeGreaterThan(0);
      expect(
        (row.resolvedModel ?? '').length,
        `${row.purpose} 的 resolved_model 为空 —— 日 diff 将无值可比`,
      ).toBeGreaterThan(0);
      // 计价档位：火山方舟与智谱分段计费，不记档位算不出真实成本，而 llm_call 是
      // append-only 表 —— 等到有人去看成本时补不了历史行。
      expect((row.priceTier ?? '').length, `${row.purpose} 的 price_tier 为空`).toBeGreaterThan(0);
      // PLAT-08：prompt_version 是内容哈希，不是手工递增的版本号。
      expect(row.promptVersion.startsWith('pv_'), `${row.purpose} 的 prompt_version 不是内容哈希`).toBe(true);
    }

    // 落库的 prompt_version 与 git 里注册表的值**逐字相等**。这一条是「真相源在
    // git」的可查询形态：两者不等就意味着运行时生效的提示词不是仓库里那一份，
    // 而那正是 prompt_version 失去归因能力的唯一途径。于是「改了提示词但版本没变」
    // 在结构上不可能发生 —— 版本由正文算出来（单元测试证明改一个标点即变化）。
    const replyCall = calls.find((row) => row.purpose === 'chat.reply');
    const classifyCall = calls.find((row) => row.purpose === 'safety.classify');
    expect(replyCall?.promptVersion).toBe(PROMPTS['chat.reply.system'].version);
    expect(classifyCall?.promptVersion).toBe(PROMPTS['safety.classify.system'].version);
    expect(replyCall?.promptVersion).not.toBe(classifyCall?.promptVersion);

    // SAFE-01 的顺序断言，原样用 RESEARCH §4.1 的那条 SQL。
    const misordered = await ownerSql<{ readonly n: number }[]>`
      select count(*)::int as n
      from llm_call r join llm_call s using (turn_id)
      where r.purpose = 'chat.reply' and s.purpose = 'safety.classify'
        and s.created_at < r.created_at
    `;
    expect(misordered[0]?.n, '危机判定发生在人格渲染之前').toBe(0);

    // (8) WS 客户端收到一条 message.created，seq 等于库里角色消息的 seq
    const frame = await frameArrived;
    expect(frame.payload['seq']).toBe(characterRow?.seq);
    expect(frame.payload['senderKind']).toBe('character');
    expect(frame.payload['disclosure']).not.toBeNull();
    socket.close();
  });

  it('断连补拉：再写 2 条后用 after_seq=3 恰好取回 seq 4、5（CHAT-07）', async () => {
    // 另起一个会话，直接在服务端写，让「3 条 → 断开 → 再 2 条」的条数与 seq 对得上。
    const friendResponse = await fetch(`${baseUrl}/characters/${characterId}/friend`, {
      method: 'POST',
      headers: authHeaders(user),
    });
    expect(friendResponse.status).toBe(200);

    const secondCharacter = await ownerSql<{ readonly id: string }[]>`
      select id from "character" where id <> ${characterId} limit 1
    `;
    const otherCharacterId = secondCharacter[0]?.id;
    expect(otherCharacterId).toBeDefined();
    const created = await fetch(`${baseUrl}/characters/${otherCharacterId ?? ''}/friend`, {
      method: 'POST',
      headers: authHeaders(user),
    });
    expect(created.status).toBe(201);
    const backfillConversationId = ((await created.json()) as { conversationId: string })
      .conversationId;

    const provenance = {
      sourceUserId: user.userId,
      sourceConversationId: backfillConversationId,
      acquiredVia: 'direct',
    } as const;

    // GatedText 只能由 safetyGateway 产出 —— 测试也不例外。这一句本身就是那条约束
    // 的一次使用证明：想绕过网关就得手写一次类型断言，而 eslint 的仓库级禁令会拦
    //（唯一豁免写在 packages/safety/src/gateway.ts 的使用点上）。
    const gated = safetyGateway({
      candidateText: '这是断连期间写入的角色消息。',
      classification: { classifierStatus: 'ok', level: 'none' },
      conversationStatus: 'active',
    });
    expect(gated.outcome).toBe('gated');
    if (gated.outcome !== 'gated') return;

    const socket = await openSocket(backfillConversationId);

    await tx(async (t) => {
      await insertUserMessage(t, { conversationId: backfillConversationId, text: '1', provenance });
      await insertCharacterMessage(t, {
        conversationId: backfillConversationId,
        text: gated.text,
        provenance,
      });
      await insertUserMessage(t, { conversationId: backfillConversationId, text: '3', provenance });
    });

    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    await tx(async (t) => {
      await insertCharacterMessage(t, {
        conversationId: backfillConversationId,
        text: gated.text,
        provenance,
      });
      await insertUserMessage(t, { conversationId: backfillConversationId, text: '5', provenance });
    });

    const backfill = await fetch(
      `${baseUrl}/conversations/${backfillConversationId}/messages?after_seq=3`,
      { headers: authHeaders(user) },
    );
    expect(backfill.status).toBe(200);
    const body = (await backfill.json()) as { messages: { seq: number }[] };
    expect(body.messages, '补拉条数不等于断连期间写入的条数').toHaveLength(2);
    expect(body.messages.map((m) => m.seq), 'seq 有空洞或重复').toEqual([4, 5]);

    // 从 0 开始补拉应拿到全部 5 条且连续 —— 「无空洞」要正面验一次。
    const all = await fetch(
      `${baseUrl}/conversations/${backfillConversationId}/messages?after_seq=0`,
      { headers: authHeaders(user) },
    );
    const allBody = (await all.json()) as { messages: { seq: number }[] };
    expect(allBody.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('跨用户访问他人会话返回 404（T-04-01）', async () => {
    const code = `tracer-other-${Date.now().toString(36)}`;
    await mintInviteCode(code);
    const response = await register(code, 'other');
    expect(response.status).toBe(201);
    const other = (await response.json()) as RegisteredUser;

    const read = await fetch(`${baseUrl}/conversations/${conversationId}/messages`, {
      headers: authHeaders(other),
    });
    // 404 而不是 403：403 会告诉攻击者「这个 id 存在」。
    expect(read.status).toBe(404);

    const write = await fetch(`${baseUrl}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: authHeaders(other),
      body: JSON.stringify({ text: '越权写入' }),
    });
    expect(write.status).toBe(404);
  });

  it('未满 18 岁注册被法定终态拒绝（COMPLY-07）', async () => {
    const code = `tracer-minor-${Date.now().toString(36)}`;
    await mintInviteCode(code);
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inviteCode: code,
        email: 'tracer-minor@example.invalid',
        password: 'correct-horse-battery',
        name: 'minor',
        birthDate: new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        consents: { basic_service: true, sensitive_pi: true },
        policyVersion: POLICY_VERSION,
      }),
    });
    expect(response.status).toBe(403);
    // 邀请码不得被这次失败消耗掉。
    const rows = await ownerSql<{ readonly usedBy: string | null }[]>`
      select used_by as "usedBy" from invite_code where code = ${code}
    `;
    expect(rows[0]?.usedBy).toBeNull();
  });
});
