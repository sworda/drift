// 一个 turn 的编排（D-24 / RESEARCH §12.2）。
//
//   用户消息 → 落库(seq) → typing.start → 人格渲染(chat.reply, **整段**)
//     → safety.classify → safetyGateway() → GatedText
//     → 落库(seq + disclosure，受 DB CHECK 保护) → WS 投递 → typing.stop
//
// ── 三条不可协商的顺序 ───────────────────────────────────────────────────────
//
//  1. **整段生成，不流式**（D-24）。流式与 CHAT-07 和出站网关在结构上不相容：
//     chunk 没有 seq（重连补拉拿不到半条消息），且逐 token 流出绕过了网关。
//     顺带的关键收益：整段生成时 **typing 持续时间天然等于实际生成时间**，
//     REAL-03 的核心约束在 Phase 1 即自动满足，Phase 2 只在其上叠加延迟函数与
//     语义分条，**不重写投递链路**。
//  2. **safety.classify 在 chat.reply 之后**（成功标准 2）。两次调用都经 Router 落
//     llm_call，于是这条顺序变成一句 SQL：
//       select 1 from llm_call r join llm_call s using (turn_id)
//        where r.purpose='chat.reply' and s.purpose='safety.classify'
//          and s.created_at < r.created_at;   -- 必须 0 行
//  3. **先落库取 seq，再投递**（CHAT-07）。投递失败不影响消息存在；DB 是真相源。
//
// ── llm_call 的事务边界（与 PLAN 的偏离，Rule 1）──────────────────────────────
// PLAN 写的是「在同一事务里写 llm_call」。这里改成：**每次 provider 调用后立刻以
// 自己的短事务落 llm_call**，角色消息另起一个短事务。理由是失败方向：
//   - 这样崩溃只可能留下「有 llm_call、没有消息」（审计行多一条，安全方向）；
//   - 「有消息、没有 llm_call」由顺序本身排除，而那才是 SAFE-01/02 两条断言怕的。
// 而把事务横跨 provider 网络调用会让连接池上限（max=8）直接变成并发上限，
// 真实 provider 下单次 2-10s —— 那是经典的连接池耗尽姿势。

import { randomUUID } from 'node:crypto';

import { and, desc, eq } from 'drizzle-orm';

import { call } from '@drift/llm';
import { buildChatReplyPrompt, buildSafetyClassifyPrompt } from '@drift/prompts';
import { parseClassification, safetyGateway } from '@drift/safety';
import {
  character,
  conversation,
  db,
  insertCharacterMessage,
  insertUserMessage,
  message,
  personaVersion,
  tx,
  type MessageProvenance,
} from '@drift/db';

import { logEvent } from '../../obs/logger.ts';
import { deliver, publish } from '../../ws/server.ts';

/** 人格渲染带入的最近消息条数。Phase 1 不做检索（记忆系统在 Phase 3）。 */
const HISTORY_WINDOW = 20;

export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`conversation ${conversationId} 不存在或不属于当前用户`);
    this.name = 'ConversationNotFoundError';
  }
}

export interface TurnResult {
  readonly turnId: string;
  readonly userMessage: { readonly id: string; readonly seq: number };
  readonly reply:
    | { readonly outcome: 'gated'; readonly id: string; readonly seq: number; readonly delivered: number }
    | { readonly outcome: 'escalated'; readonly level: 'elevated' | 'crisis' }
    | { readonly outcome: 'refused'; readonly reason: 'conversation_ended' };
}

export async function runTurn(input: {
  readonly conversationId: string;
  readonly userId: string;
  readonly text: string;
}): Promise<TurnResult> {
  const turnId = randomUUID();

  // ── 1. 会话归属校验 + 用户消息落库（同一事务）────────────────────────────
  //
  // ⚠️ user_id 是**查询条件的一部分**，不是「先查出来再判断」（T-04-01）。
  // 先查后判的写法在并发下仍然正确，但它把「忘了判断」变成一个不会被类型或
  // 测试发现的遗漏；作为条件则连忘的机会都没有。
  const prepared = await tx(async (t) => {
    const rows = await t
      .select({
        id: conversation.id,
        status: conversation.status,
        characterId: conversation.characterId,
      })
      .from(conversation)
      .where(and(eq(conversation.id, input.conversationId), eq(conversation.userId, input.userId)));
    const found = rows[0];
    if (found === undefined) throw new ConversationNotFoundError(input.conversationId);

    const provenance: MessageProvenance = {
      sourceUserId: input.userId,
      sourceConversationId: found.id,
      acquiredVia: 'direct',
    };
    const userMessage = await insertUserMessage(t, {
      conversationId: found.id,
      text: input.text,
      provenance,
    });
    await t
      .update(conversation)
      .set({ lastMessageAt: userMessage.createdAt })
      .where(eq(conversation.id, found.id));

    return { conversation: found, userMessage };
  });

  // ── 2. 人格与历史（读，不需要在写事务里）────────────────────────────────
  const personaRows = await db
    .select({
      name: character.name,
      core: personaVersion.core,
      dossier: personaVersion.dossier,
      personaVersionId: personaVersion.id,
    })
    .from(character)
    .innerJoin(personaVersion, eq(character.currentPersonaVersionId, personaVersion.id))
    .where(eq(character.id, prepared.conversation.characterId));
  const persona = personaRows[0];
  if (persona === undefined) {
    throw new Error(`角色 ${prepared.conversation.characterId} 没有生效的 persona_version`);
  }

  const historyRows = await db
    .select({ senderKind: message.senderKind, text: message.text, seq: message.seq })
    .from(message)
    .where(eq(message.conversationId, prepared.conversation.id))
    .orderBy(desc(message.seq))
    .limit(HISTORY_WINDOW);
  const history = [...historyRows].reverse().filter((m) => m.seq !== prepared.userMessage.seq);

  // typing 指示。整段生成 ⇒ 它的持续时间就是实际生成时间（REAL-03）。
  publish(prepared.conversation.id, {
    type: 'typing.start',
    payload: { conversationId: prepared.conversation.id },
  });

  try {
    // ── 3. 人格渲染（chat.reply，整段）──────────────────────────────────────
    const replyPrompt = buildChatReplyPrompt({
      persona: { name: persona.name, core: persona.core, dossier: persona.dossier },
      history: history.map((m) => ({ senderKind: m.senderKind, text: m.text })),
      userText: input.text,
    });
    const candidate = await call(
      { mode: 'routed', role: 'chat.reply' },
      {
        turnId,
        prompt: replyPrompt.text,
        promptVersion: replyPrompt.version,
        userId: input.userId,
        conversationId: prepared.conversation.id,
        personaVersionId: persona.personaVersionId,
      },
      db,
    );

    // ── 4. 安全分类（**在人格渲染之后**）──────────────────────────────────
    const classifyPrompt = buildSafetyClassifyPrompt({
      userText: input.text,
      candidateReply: candidate.text,
      sessionRiskLevel: 'none',
    });
    const classified = await call(
      { mode: 'routed', role: 'safety.classify' },
      {
        turnId,
        prompt: classifyPrompt.text,
        promptVersion: classifyPrompt.version,
        userId: input.userId,
        conversationId: prepared.conversation.id,
        personaVersionId: null,
      },
      db,
    );

    // ── 5. 出站安全网关 —— GatedText 的唯一来源 ───────────────────────────
    const gated = safetyGateway({
      candidateText: candidate.text,
      classification: parseClassification(classified.text),
      conversationStatus: prepared.conversation.status,
    });

    if (gated.outcome !== 'gated') {
      // 不产出 GatedText ⇒ 两个出口在类型层都拿不到可投递的东西。
      // 关怀卡片与硬退出提示的内容分别在 Plan 07 / Plan 12 填入；此刻**不回落到
      // 直接下发人格回复** —— 那正是成功标准 2 要求证明不存在的那条路径。
      logEvent('turn.gate_blocked', {
        userId: input.userId,
        conversationId: prepared.conversation.id,
        riskLevel: gated.outcome === 'escalated' ? gated.level : 'none',
      }, 'warn');
      return {
        turnId,
        userMessage: { id: prepared.userMessage.id, seq: prepared.userMessage.seq },
        reply:
          gated.outcome === 'escalated'
            ? { outcome: 'escalated', level: gated.level }
            : { outcome: 'refused', reason: gated.reason },
      };
    }

    // ── 6. 落库取 seq 并注入 disclosure，**然后**投递（CHAT-07）───────────
    const characterMessage = await tx(async (t) =>
      insertCharacterMessage(t, {
        conversationId: prepared.conversation.id,
        text: gated.text,
        provenance: {
          sourceUserId: null,
          sourceConversationId: prepared.conversation.id,
          acquiredVia: 'direct',
        },
        audience: 'user',
      }),
    );
    await db
      .update(conversation)
      .set({ lastMessageAt: characterMessage.createdAt })
      .where(eq(conversation.id, prepared.conversation.id));

    const delivered = deliver(
      {
        conversationId: prepared.conversation.id,
        messageId: characterMessage.id,
        senderKind: 'character',
        disclosure: characterMessage.disclosure,
        createdAt: characterMessage.createdAt,
      },
      gated.text,
      characterMessage.seq,
    );

    logEvent('turn.completed', {
      userId: input.userId,
      conversationId: prepared.conversation.id,
      messageSeq: characterMessage.seq,
      modelSnapshot: candidate.modelSnapshot,
      provider: candidate.provider,
      durationMs: candidate.latencyMs + classified.latencyMs,
      count: delivered,
    });

    return {
      turnId,
      userMessage: { id: prepared.userMessage.id, seq: prepared.userMessage.seq },
      reply: { outcome: 'gated', id: characterMessage.id, seq: characterMessage.seq, delivered },
    };
  } finally {
    publish(prepared.conversation.id, {
      type: 'typing.stop',
      payload: { conversationId: prepared.conversation.id },
    });
  }
}
