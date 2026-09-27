// 一个 turn 的编排（D-24 / RESEARCH §12.2）。
//
//   用户消息 → 落库(seq) → 入站规则层 scanInbound + raiseRisk(只升不降)
//     → typing.start → 人格渲染(chat.reply, **整段**)
//     → safety.classify（决定性判定）→ safetyGateway()（确定性覆写）
//     → gated: 落库(seq + disclosure，受 DB CHECK 保护) → WS 投递
//     → escalated: 关怀卡片 + safety_event + session_risk_state（同一事务）
//     → typing.stop
//
// ── 四条不可协商的顺序 ───────────────────────────────────────────────────────
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
//  4. **入站规则层在生成之前，且只能抬升**（R1.20 第一层）。它不具决定性 ——
//     「不具决定性」的含义是不能用来降级，而不是可以被忽略：resolveRisk 取它与分类
//     结果中较高的那一个（packages/safety/src/risk.ts）。
//
// ── 为什么这个文件里没有一个 catch（T-07-01）──────────────────────────────────
// 「在 turn 外层包一个 try/catch，catch 里降级为直接下发人格回复」在功能上正确、在
// 合规上是一条绕过网关的路径 —— 这正是成功标准 2 要求证明不存在的东西。两处设计让那个
// catch 没有存在的理由：classifySafety **永不抛错**（三类失败全部收敛成 failed 分支），
// 而 GatedResult 的 escalated / refused 三支**在类型层就没有可投递的候选回复**。
// 下面唯一的 try 配的是 finally（typing.stop），不是 catch。
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
import { buildChatReplyPrompt } from '@drift/prompts';
import {
  classifySafety,
  maxRisk,
  safetyGateway,
  scanInbound,
  type CareCard,
  type ClassifyInvoke,
  type ContactAttemptOutcome,
  type ContactChannel,
  type RiskLevel,
} from '@drift/safety';
import {
  character,
  conversation,
  db,
  insertCharacterMessage,
  insertUserMessage,
  message,
  personaVersion,
  requireConsent,
  tx,
  type ConsentTicket,
  type MessageProvenance,
} from '@drift/db';

import { env } from '../../config/env.ts';
import { logError, logEvent } from '../../obs/logger.ts';
import { startContactAttempt } from '../safety/contact.ts';
import { raiseRisk, readRiskLevel, writeSafetyEvent } from '../safety/state.ts';
import { requireContactAttemptTimeoutScheduler } from '../../worker/jobs/contact-attempt-timeout.ts';
import { getUsageReminderScheduler } from '../../worker/jobs/usage-reminder.ts';
import { afterTouchUsage, touchUsageSegment } from '../usage/segment.ts';
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
    | {
        readonly outcome: 'escalated';
        readonly level: 'elevated' | 'crisis';
        /**
         * 确定性覆写的产物。**不是**一条角色消息 —— 它不落 message 表、不带
         * ai_generated 标识、渲染层用 Alert 而不是 Bubble（R1.24：覆写内容不得伪装
         * 成角色的自然发言）。四态联络状态行的渲染分支在 Plan 08。
         */
        readonly careCard: CareCard;
        readonly safetyEventId: string;
        readonly riskLevel: RiskLevel;
        /** 联络尝试。**elevated 恒为 null**（SAFE-03 明文「不联络」）。 */
        readonly contact: ContactAttemptOutcome | null;
      }
    | { readonly outcome: 'refused'; readonly reason: 'conversation_ended' | 'retention_phrase' };
}

/**
 * 故障注入用的窄端口（tests/integration/fail-closed.test.ts）。
 *
 * ⚠️ 它能替换的只是 safety.classify 的**传输层**，返回值仍然要过 classifySafety 的
 * schema 校验与置信度下限。因此注入能造成的最坏结果是 `classifierStatus: 'failed'`
 * ⇒ fail-closed 到 elevated；它**造不出**「原样透传候选回复」这个形态 —— 那个形态在
 * GatedResult 的类型里不存在。与 alert.ts 的 `fetchImpl` 是同一种注入点。
 *
 * 为什么用注入而不是「临时改一次源码再还原」：改文件的破坏验证只在执行者手里跑过
 * 一次，注入式的用例每个 PR 都跑。
 */
export interface TurnOverrides {
  readonly classifyInvoke?: ClassifyInvoke;
  /**
   * 告警投递的 fetch 实现（tests/integration/contact-attempt.test.ts）。
   * 与 alert.ts 的 `fetchImpl` 是同一个注入点，只是从这里透传下去 —— 四态的
   * webhook 200 / 500 两条分支必须在不出网的进程里都可达。
   */
  readonly alertFetch?: typeof fetch;
}

export async function runTurn(
  input: {
    readonly conversationId: string;
    readonly userId: string;
    readonly text: string;
  },
  overrides?: TurnOverrides,
): Promise<TurnResult> {
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
    // 消息落库就是敏感个人信息处理（RESEARCH §6.3）—— 票在同一个事务里取，
    // 撤回过 sensitive_pi 的用户在这里直接抛错，而不是先写进去再说。
    const ticket = await requireConsent(t, input.userId, 'sensitive_pi');
    const userMessage = await insertUserMessage(t, {
      conversationId: found.id,
      text: input.text,
      provenance,
      ticket,
    });
    await t
      .update(conversation)
      .set({ lastMessageAt: userMessage.createdAt })
      .where(eq(conversation.id, found.id));

    // 连续使用计时的入站 touch（COMPLY-03）：与用户消息落库同一事务。
    const usage = await touchUsageSegment(t, input.userId, userMessage.createdAt);

    return { conversation: found, userMessage, usage };
  });

  // 计时副作用（WS 投递 + pg-boss 排定）在事务提交之后执行 —— 见 afterTouchUsage
  // 的说明。排定器未注册（worker 未起）时记 warn 跳过，不挡消息链路。
  {
    const scheduler = getUsageReminderScheduler();
    if (scheduler === null) {
      logEvent('usage.reminder_unschedulable', { segmentId: prepared.usage.segmentId }, 'warn');
    } else {
      await afterTouchUsage(prepared.usage, input.userId, scheduler);
    }
  }

  // ── 2. 入站规则层（R1.20 第一层）—— 在生成之前，只升不降 ────────────────
  //
  // ⚠️ 顺序：用户消息已落库，所以即便本轮被覆写，用户说过的话仍然在 DB 里（真相源）。
  // scanInbound 是纯函数（正则 + 词典），命中只产出规则 id，不产出用户原文片段。
  const inbound = scanInbound(input.text);
  const previousLevel = await readRiskLevel(db, prepared.conversation.id);
  if (inbound.suggestedLevel !== 'none') {
    await raiseRisk(db, {
      conversationId: prepared.conversation.id,
      level: inbound.suggestedLevel,
    });
  }
  // 供 safety.classify 的判定输入用（RESEARCH §4.1：判定对象是用户消息 + 候选回复 +
  // **会话风险态**三者）。取较高者而不是重新读库：raiseRisk 只升不降，所以这两个值
  // 的较高者就是抬升后的结果，少一次往返。
  const sessionRiskLevel: RiskLevel = maxRisk(previousLevel, inbound.suggestedLevel);

  // ── 3. 人格与历史（读，不需要在写事务里）────────────────────────────────
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
    // ── 4. 人格渲染（chat.reply，整段）──────────────────────────────────────
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

    // ── 5. 安全分类（**在人格渲染之后**，决定性判定）────────────────────────
    //
    // classifySafety 永不抛错：provider 报错/超时、schema 校验失败、置信度低于下限
    // 三类失败全部收敛成 `classifierStatus: 'failed'`，而 resolveRisk 对该分支恒返回
    // elevated 并封顶在 elevated（SAFE-05：crisis 会让别人的手机响，分类器 bug 不该
    // 导致一次针对第三方的个人信息使用）。所以这里不需要 try/catch。
    const classifyInvoke: ClassifyInvoke =
      overrides?.classifyInvoke ??
      (async (prompt) => {
        const result = await call(
          { mode: 'routed', role: 'safety.classify' },
          {
            turnId,
            prompt: prompt.text,
            promptVersion: prompt.version,
            userId: input.userId,
            conversationId: prepared.conversation.id,
            personaVersionId: null,
          },
          db,
        );
        return { text: result.text, modelSnapshot: result.modelSnapshot };
      });

    const classified = await classifySafety(
      {
        userText: input.text,
        candidateReply: candidate.text,
        sessionRiskLevel,
      },
      { invoke: classifyInvoke },
    );

    // ── 6. 出站安全网关 —— GatedText 与关怀卡片的唯一来源 ─────────────────
    // ⚠️ recordSafetyEvent 是必填的，不是可选项，且必须返回落库行的 id：crisis 分支的
    // contact_attempt 以 safety_event_id 为外键，而 safety_event 属 append-only 表族
    // ——「先联络、事后补留证」这个顺序补不回来。
    //
    // safety_event 与 session_risk_state 的抬升在**同一个事务**里：两者是同一次判定的
    // 两个面，分开写会留下「风险态升了但没有留证」或反之的半状态，而那种半状态在
    // append-only 表上无法修复。
    const gated = await safetyGateway({
      candidateText: candidate.text,
      classification: classified.classification,
      conversationStatus: prepared.conversation.status,
      inboundSuggestedLevel: inbound.suggestedLevel,
      inboundRuleHits: inbound.hits,
      previousLevel,
      classifierModelSnapshot: classified.modelSnapshot,
      // SAFE-04 的联络通道。**只有 crisis 分支会调它**（SAFE-03 明文一级不联络），
      // 分工在网关里而不是在这里 —— 这里给的只是「怎么联络」。
      contactChannel: contactChannel({
        userId: input.userId,
        conversationId: prepared.conversation.id,
        // 只作为告警载荷自检的针（见 alert.ts 的 assertNoUserText）。不进载荷。
        triggeringMessage: input.text,
        alertFetch: overrides?.alertFetch,
      }),
      recordSafetyEvent: async (draft) =>
        tx(async (t) => {
          const safetyEventId = await writeSafetyEvent(t, draft, {
            userId: input.userId,
            conversationId: prepared.conversation.id,
            // 触发这次判定的那条用户消息。候选回复没有落库（它被拦下了），
            // 「当时判的是哪段文本」由 candidateReplyHash 回答。
            messageId: prepared.userMessage.id,
          });
          if (draft.level === 'elevated' || draft.level === 'crisis') {
            await raiseRisk(t, {
              conversationId: prepared.conversation.id,
              level: draft.level,
            });
          }
          return safetyEventId;
        }),
    });

    if (gated.outcome === 'escalated') {
      // 该轮由关怀卡片接管，角色**不发**任何消息（UI-SPEC〔法定〕）。候选回复既不
      // 落库也不投递 —— 此刻**不回落到直接下发人格回复**，那正是成功标准 2 要求
      // 证明不存在的那条路径。硬退出提示的内容在 Plan 12。
      logEvent(
        'turn.escalated',
        {
          userId: input.userId,
          conversationId: prepared.conversation.id,
          riskLevel: gated.level,
          modelSnapshot: classified.modelSnapshot,
          contactAttemptStatus: gated.contact?.status ?? null,
        },
        'warn',
      );
      return {
        turnId,
        userMessage: { id: prepared.userMessage.id, seq: prepared.userMessage.seq },
        reply: {
          outcome: 'escalated',
          level: gated.level,
          careCard: gated.careCard,
          safetyEventId: gated.safetyEventId,
          riskLevel: gated.level,
          contact: gated.contact,
        },
      };
    }

    if (gated.outcome !== 'gated') {
      logEvent(
        'turn.gate_blocked',
        { userId: input.userId, conversationId: prepared.conversation.id, riskLevel: 'none' },
        'warn',
      );
      return {
        turnId,
        userMessage: { id: prepared.userMessage.id, seq: prepared.userMessage.seq },
        reply: { outcome: 'refused', reason: gated.reason },
      };
    }

    // ── 7. 落库取 seq 并注入 disclosure，**然后**投递（CHAT-07）───────────
    const characterTurn = await tx(async (t) => {
      // 角色消息同样进 message 表，同样要票 —— 用户在本轮期间撤回 sensitive_pi 时，
      // 这一步会抛错而不是把回复写进去（撤回后相应数据流**立即**停止，PRIV-02）。
      const ticket: ConsentTicket<'sensitive_pi'> = await requireConsent(
        t,
        input.userId,
        'sensitive_pi',
      );
      const characterMessage = await insertCharacterMessage(t, {
        conversationId: prepared.conversation.id,
        text: gated.text,
        provenance: {
          sourceUserId: null,
          sourceConversationId: prepared.conversation.id,
          acquiredVia: 'direct',
        },
        audience: 'user',
        ticket,
      });
      // 出站 touch：与角色消息落库同一事务（入站/出站各一次，D-14）。
      const usage = await touchUsageSegment(t, input.userId, characterMessage.createdAt);
      return { characterMessage, usage };
    });
    const { characterMessage } = characterTurn;
    {
      const scheduler = getUsageReminderScheduler();
      if (scheduler === null) {
        logEvent('usage.reminder_unschedulable', { segmentId: characterTurn.usage.segmentId }, 'warn');
      } else {
        await afterTouchUsage(characterTurn.usage, input.userId, scheduler);
      }
    }
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
      durationMs: candidate.latencyMs,
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

/**
 * 构造联络通道（SAFE-04 / SAFE-16）。
 *
 * ⚠️ 这里有一个 catch，它**不是** T-07-01 那条被禁止的路径：它把一次联络失败降级为
 * `unavailable`（一个有出路的终态：UI-SPEC 要求此时把「拨打 12356」提到卡片首屏第一
 * 行），而**不是**降级为下发人格回复 —— 这个 catch 的作用域里既没有 deliver 也没有
 * insertCharacterMessage，也拿不到候选回复。
 *
 * 为什么必须兜住：联络失败不能连带把关怀卡片丢掉。二级危机里用户最需要的是那张带
 * 号码的卡片，而一次 webhook 超时把整个请求变成 500 会让他什么也拿不到。
 */
function contactChannel(ctx: {
  readonly userId: string;
  readonly conversationId: string;
  readonly triggeringMessage: string;
  readonly alertFetch?: typeof fetch | undefined;
}): ContactChannel {
  return async (safetyEventId) => {
    try {
      const result = await startContactAttempt(
        db,
        {
          safetyEventId,
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          triggeringMessage: ctx.triggeringMessage,
        },
        {
          transport: {
            webhookUrl: env.WECOM_WEBHOOK_URL,
            ...(ctx.alertFetch === undefined ? {} : { fetchImpl: ctx.alertFetch }),
          },
          // ⚠️ **延迟解析**排定器，而不是在构造 deps 时就解析：未注册时
          // requireContactAttemptTimeoutScheduler() 会抛错，而在这里抛就会让整个
          // contactChannel 落进下面那个 catch —— 结果是**一行 contact_attempt 都没有**，
          // 即一次联络尝试失败却没有任何留证。延迟到调用点抛，则由
          // startContactAttempt 的 timeout_not_schedulable 分支如实插一行 unavailable。
          scheduleTimeout: async (attemptId) => {
            await requireContactAttemptTimeoutScheduler()(attemptId);
          },
          onEvent: (event) => {
            logEvent(event.name, {
              userId: ctx.userId,
              conversationId: ctx.conversationId,
              contactAttemptStatus: event.status,
              errorCode: event.reason,
            });
          },
        },
      );
      return {
        status: result.status,
        contactName: result.contactName,
        maskedContact: result.maskedContact,
      };
    } catch (error) {
      // 没有可用通道 —— 包括「超时作业排不上」这一类：一个排不上超时的 pending 是
      // 无界的，而 UI-SPEC 明文 pending 必须有界。
      logError('contact_attempt.start_failed', error, {
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        contactAttemptStatus: 'unavailable',
      });
      return { status: 'unavailable', contactName: null, maskedContact: null };
    }
  };
}
