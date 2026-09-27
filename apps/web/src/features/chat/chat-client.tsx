'use client';

// 聊天页的客户端编排（CHAT-03/04/06/07 · COMPLY-01/03/05）。
//
// 这一层是「事件到达 ⇒ 界面变化」的唯一浏览器侧入口（01-12 handoff #75 的义务）：
//   WS message.created → 追加消息（按 messageId 去重）
//   WS typing.*        → 输入指示
//   WS usage.reminder / dependency.notice → 弹对应 Dialog（不自设计时）
//   WS safety.care_card / safety.contact_status → 关怀卡片（在位更新联络状态行）
//   WS conversation.ended → 结束态（禁用输入 + 中性系统卡片）
//   断开 → ReconnectBar；重连成功 → after_seq 原子补拉（v1 假设：补完才渲染）
//
// ⚠️ 分割线只在首载定位一次（useState 只在 load ok 时写 firstUnreadSeq 一次）：
// 「以下是你离开后的消息」属于本次浏览，不随已读状态更新而消失（UI-SPEC 交互契约）。
//
// ⚠️ 本目录（features/chat）禁止任何前端计时器调用 —— 重连退避住在
// lib/chat-socket.ts，见那里的说明。

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, MoreHorizontal } from 'lucide-react';

import { buildCareCard, type CareCard } from '@drift/safety';

import { AiBadge } from '@/components/ai-badge';
import { AiBanner } from '@/components/ai-banner';
import { useChatSocket } from '@/lib/chat-socket';
import { authedFetch } from '@/lib/session';

import { reportClientError } from '@/components/error-boundary';

import type { CareCardData as CareCardView } from '../crisis/care-card';
import type { ContactStatus } from '../crisis/copy';
import { ChatView, type ChatMessage } from './chat-view';
import { CHAT_EMPTY_BODY_TEMPLATE, CHAT_EMPTY_HEADING } from './copy';
import { Composer } from './composer';
import { DependencyNoticeDialog } from './dependency-notice-dialog';
import { EndedComposer } from './exit-system-card';
import { ChatMoreSheet } from './more-sheet';
import { ReconnectBar } from './reconnect-bar';
import { UsageReminderDialog } from './usage-reminder-dialog';

interface ConversationMeta {
  readonly id: string;
  readonly characterId: string;
  readonly characterName: string;
  readonly characterAvatar: string;
  readonly counterpartKind: 'ai_character';
  readonly status: 'active' | 'ended';
  readonly unreadCount: number;
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ok'; readonly conversation: ConversationMeta };

/** 渲染失败 / 前端异常的上报口（/telemetry/error 白名单字段，见 error-boundary.ts）。 */
function reportError(kind: string): void {
  void reportClientError({ errorName: kind, route: window.location.pathname });
}

/** TurnResult 的客户端形状（apps/api chat/routes.ts 的响应）。 */
interface TurnResponse {
  readonly turnId: string;
  readonly userMessage: { readonly id: string; readonly seq: number };
  readonly reply:
    | { readonly outcome: 'gated'; readonly id: string; readonly seq: number; readonly delivered: number }
    | {
        readonly outcome: 'escalated';
        readonly level: 'elevated' | 'crisis';
        readonly careCard: CareCardView;
        readonly safetyEventId: string;
        readonly riskLevel: string;
        readonly contact: unknown;
      }
    | { readonly outcome: 'refused'; readonly reason: string }
    | { readonly outcome: 'exited'; readonly systemMessage: { readonly id: string; readonly seq: number }; readonly endedAt: string };
}

/** 浏览器与 jsdom 都有的 randomUUID；没有时用递减计数器兜底。 */
let localIdSeq = 0;
function newLocalId(): string {
  localIdSeq += 1;
  return `local-${String(localIdSeq)}`;
}

/** 服务端 CareCard（@drift/safety）→ 渲染层视图（crisis/care-card）。同形。 */
function toViewCard(card: CareCard): CareCardView {
  return card as CareCardView;
}

export function ChatClient({ conversationId }: { readonly conversationId: string }) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  // 分割线定位：只在首载 ok 时写一次（不随后续任何状态更新）。
  const [firstUnreadSeq, setFirstUnreadSeq] = useState<number | null>(null);
  const [typing, setTyping] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [dependencyOpen, setDependencyOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [crisisCard, setCrisisCard] = useState<CareCardView | null>(null);
  const [ended, setEnded] = useState(false);
  const [sending, setSending] = useState(false);
  // 最近一次联络状态事件（care_card 事件先到、contact_status 后到时补齐卡片数据用）。
  const latestContact = useRef<{
    readonly status: ContactStatus;
    readonly contactName: string | null;
    readonly contactMasked: string | null;
  } | null>(null);
  // 补拉用的「当前最大 seq」—— ref 而不是 state，避免闭包拿到旧值。
  const maxSeqRef = useRef(0);
  maxSeqRef.current = messages.reduce((max, m) => Math.max(max, m.seq), 0);

  const load = useCallback(async () => {
    setLoadState({ kind: 'loading' });
    try {
      const response = await authedFetch(`/conversations/${conversationId}/messages?after_seq=0`);
      if (!response.ok) {
        setLoadState({ kind: 'error' });
        return;
      }
      const body = (await response.json()) as {
        conversation: ConversationMeta;
        firstUnreadSeq: number | null;
        messages: readonly ChatMessage[];
      };
      setMessages(body.messages);
      setFirstUnreadSeq(body.firstUnreadSeq);
      setEnded(body.conversation.status === 'ended');
      setLoadState({ kind: 'ok', conversation: body.conversation });
      // 进入会话即已读（CHAT-05/06）。失败不致命 —— 徽章清零会在下次进入时重试。
      void authedFetch(`/conversations/${conversationId}/read`, { method: 'POST' });
    } catch {
      setLoadState({ kind: 'error' });
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 追加消息（按 messageId / seq 去重 —— WS 与 HTTP 补拉可能双写同一行）。 */
  const appendMessages = useCallback((incoming: readonly ChatMessage[]) => {
    setMessages((current) => {
      const seen = new Set(current.map((m) => m.messageId));
      const fresh = incoming.filter((m) => !seen.has(m.messageId));
      if (fresh.length === 0) return current;
      return [...current, ...fresh].sort((a, b) => a.seq - b.seq);
    });
  }, []);

  /** 断线重连后的原子补拉（v1 假设：补完才渲染 —— 见文件头）。 */
  const backfill = useCallback(async () => {
    try {
      const response = await authedFetch(
        `/conversations/${conversationId}/messages?after_seq=${String(maxSeqRef.current)}`,
      );
      if (!response.ok) return;
      const body = (await response.json()) as { messages: readonly ChatMessage[] };
      appendMessages(body.messages);
    } catch {
      // 补拉失败：细条保持可见（socket 仍 open 但 HTTP 失败 —— 下一次断连重连会再试）。
    }
  }, [appendMessages, conversationId]);

  const socketState = useChatSocket(loadState.kind === 'ok' ? conversationId : null, {
    onMessage: (payload) => {
      appendMessages([
        {
          messageId: payload.messageId,
          seq: payload.seq,
          senderKind: payload.senderKind,
          text: payload.text,
          disclosure: payload.disclosure,
          createdAt: payload.createdAt,
        },
      ]);
      setTyping(false);
    },
    onTyping: setTyping,
    onEvent: (event) => {
      if (event.type === 'usage.reminder') setUsageOpen(true);
      else if (event.type === 'dependency.notice') setDependencyOpen(true);
      else if (event.type === 'conversation.ended') setEnded(true);
      else if (event.type === 'safety.care_card') {
        // WS 事件只带 tier。完整卡片数据来自 turn 响应；这里用同一构造函数兜底
        // （Phase 1 服务端尚无该事件的发布点 —— 接线先就位，数据到位即渲染）。
        latestContact.current ??= { status: 'pending', contactName: null, contactMasked: null };
        const card =
          event.payload.tier === 1
            ? buildCareCard('level1')
            : buildCareCard('level2', {
                contactStatus: latestContact.current.status,
                contactName: latestContact.current.contactName,
                maskedContact: latestContact.current.contactMasked,
              });
        setCrisisCard(toViewCard(card));
      } else if (event.type === 'safety.contact_status') {
        latestContact.current = {
          status: event.payload.status,
          contactName: event.payload.contactName,
          contactMasked: event.payload.contactMasked,
        };
        // 在位更新（终态原地替换、卡片不重排）：只有二级卡片携带联络状态行。
        setCrisisCard((current) => {
          if (current === null || current.level !== 'level2') return current;
          return toViewCard(
            buildCareCard('level2', {
              contactStatus: event.payload.status,
              contactName: event.payload.contactName,
              maskedContact: event.payload.contactMasked,
            }),
          );
        });
      }
    },
    onReconnect: () => {
      void backfill();
    },
  });

  /**
   * 发送（CHAT-03 + E4/E5）：乐观 pending 消息 → POST；受理后原地替换为服务端行。
   * 失败（网络/未受理）：failed 态 + 重试控件，输入内容保留（Composer 不清空）。
   * 角色回复**不**从响应里取 —— 它没有正文（GatedText 只在 WS/补拉通道上出现），
   * WS deliver 或重连 backfill 才是消息正文的入口。
   */
  const postMessage = useCallback(
    async (text: string, localId: string): Promise<boolean> => {
      setSending(true);
      try {
        const response = await authedFetch(`/conversations/${conversationId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!response.ok) {
          setMessages((current) =>
            current.map((m) => (m.messageId === localId ? { ...m, failed: true } : m)),
          );
          return false;
        }
        const body = (await response.json()) as TurnResponse;
        setMessages((current) =>
          current.map((m) =>
            m.messageId === localId
              ? { ...m, messageId: body.userMessage.id, seq: body.userMessage.seq, pending: false, failed: false }
              : m,
          ),
        );
        if (body.reply.outcome === 'escalated') {
          // 关怀卡片带全量数据到达（TurnResult.reply.careCard）—— 这是不落 message
          // 表的结构化对象（01-07 handoff #48），渲染层用 Alert 版式。
          setCrisisCard(body.reply.careCard);
        } else if (body.reply.outcome === 'exited') {
          setEnded(true);
          await backfill();
        }
        return true;
      } catch {
        setMessages((current) =>
          current.map((m) => (m.messageId === localId ? { ...m, failed: true } : m)),
        );
        return false;
      } finally {
        setSending(false);
      }
    },
    [backfill, conversationId],
  );

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const localId = newLocalId();
      setMessages((current) => [
        ...current,
        {
          messageId: localId,
          seq: maxSeqRef.current + 1,
          senderKind: 'user',
          text,
          disclosure: null,
          createdAt: new Date().toISOString(),
          pending: true,
        },
      ]);
      return postMessage(text, localId);
    },
    [postMessage],
  );

  /** 重试（CHAT-03：点击气泡或重试控件均可）—— 原地回到 pending 再 POST。 */
  const retryMessage = useCallback(
    (message: ChatMessage): void => {
      const localId = newLocalId();
      setMessages((current) =>
        current.map((m) =>
          m.messageId === message.messageId
            ? { ...m, messageId: localId, pending: true, failed: false }
            : m,
        ),
      );
      void postMessage(message.text, localId);
    },
    [postMessage],
  );

  /** 「更多 → 结束本次会话」：直接执行（无二次确认，UI-SPEC 硬退出契约）。 */
  const endSession = useCallback(async () => {
    try {
      const response = await authedFetch(`/conversations/${conversationId}/exit`, { method: 'POST' });
      if (!response.ok) return;
      setEnded(true);
      // 中性系统卡片由服务端插入（sender_kind=system，带更高 seq）—— 一次 after_seq
      // 补拉把它带进来，不在本地伪造正文。
      await backfill();
    } catch {
      // 失败保持会话原状 —— 结束是服务端事实，本地不乐观置位。
    }
  }, [backfill, conversationId]);

  const conversation = loadState.kind === 'ok' ? loadState.conversation : null;
  const characterName = conversation?.characterName ?? '';

  return (
    <div className="mx-auto flex h-dvh w-full max-w-[480px] flex-col">
      {/* 页面头部：返回（icon-only ①）+ 角色名 + AI 徽标 + 更多（icon-only ④）。
          30 字角色名时徽标仍完整可见：标题 truncate、徽标 shrink-0。 */}
      <header className="flex h-14 shrink-0 items-center gap-sm border-b border-border bg-card px-sm">
        <Link
          href="/conversations"
          aria-label="返回"
          data-testid="chat-back"
          className="flex size-touch shrink-0 items-center justify-center rounded-lg text-text-primary"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </Link>
        <span className="flex min-w-0 flex-1 items-center gap-sm">
          {loadState.kind === 'loading' ? (
            // 加载期占位（法定标识不允许闪缺：徽标常驻，名字以骨架占位）。
            <>
              <span aria-hidden="true" className="h-5 w-24 animate-pulse rounded bg-character-bubble" />
              <AiBadge data-testid="ai-badge-chat-header" />
            </>
          ) : (
            <>
              <span className="truncate text-body font-semibold text-text-primary">{characterName}</span>
              {conversation?.counterpartKind === 'ai_character' ? (
                <AiBadge data-testid="ai-badge-chat-header" />
              ) : null}
            </>
          )}
        </span>
        <button
          type="button"
          aria-label="更多操作"
          data-testid="chat-more"
          onClick={() => setMoreOpen(true)}
          className="flex size-touch shrink-0 items-center justify-center rounded-lg text-text-primary"
        >
          <MoreHorizontal aria-hidden="true" className="size-5" />
        </button>
      </header>

      {/* 32px AI 常驻条〔法定〕在重连细条之前 —— DOM 顺序保证细条不遮挡它。
          细条只在 disconnected 态出现：首次连接的「connecting」不是断连。 */}
      <AiBanner />
      <ReconnectBar visible={socketState === 'disconnected'} />

      <ChatView
        messages={messages}
        typing={typing}
        crisisCard={crisisCard ?? undefined}
        firstUnreadSeq={firstUnreadSeq}
        emptyHeading={CHAT_EMPTY_HEADING}
        emptyBody={
          loadState.kind === 'ok' ? CHAT_EMPTY_BODY_TEMPLATE.replace('{角色名}', characterName) : undefined
        }
        loadFailed={loadState.kind === 'error'}
        onRetryLoad={() => void load()}
        onRetryMessage={retryMessage}
      />

      {ended ? (
        <EndedComposer />
      ) : (
        <Composer onSend={send} pending={sending} disabled={loadState.kind !== 'ok'} />
      )}

      <UsageReminderDialog open={usageOpen} onOpenChange={setUsageOpen} reportError={reportError} />
      <DependencyNoticeDialog
        open={dependencyOpen}
        onOpenChange={setDependencyOpen}
        reportError={reportError}
      />
      <ChatMoreSheet open={moreOpen} onOpenChange={setMoreOpen} onEndSession={() => void endSession()} />
    </div>
  );
}
