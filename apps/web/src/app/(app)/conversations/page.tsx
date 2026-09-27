'use client';

// 会话列表页（CHAT-05 / CHAT-06 / COMPLY-01）。
//
// 客户端组件：身份是 Authorization: Bearer（lib/session.ts），服务端组件拿不到
// 浏览器存储里的 token —— 与隐私中心页同一条先例。
//
// 空态 / 错误态 / 加载骨架三态可区分（UI-SPEC 不可协商项）：加载失败渲染错误文案
// + 重试，绝不静默渲染成「还没有任何对话」。

import { useCallback, useEffect, useState } from 'react';

import { EmptyOrError } from '@/components/empty-or-error';
import {
  ConversationList,
  type ConversationListItem,
} from '@/features/conversations/conversation-list';
import { authedFetch } from '@/lib/session';

import {
  CONVERSATIONS_EMPTY_BODY,
  CONVERSATIONS_EMPTY_CTA,
  CONVERSATIONS_EMPTY_HEADING,
  CONVERSATIONS_RETRY_LABEL,
  CONVERSATIONS_TITLE,
} from '@/features/conversations/copy';
import { LIST_LOAD_ERROR_COPY } from '@/features/chat/copy';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ok'; readonly conversations: readonly ConversationListItem[] };

export default function ConversationsPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const response = await authedFetch('/conversations');
      if (!response.ok) {
        setState({ kind: 'error' });
        return;
      }
      const body = (await response.json()) as { conversations: ConversationListItem[] };
      setState({ kind: 'ok', conversations: body.conversations });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px]">
      <h1 className="px-md py-lg text-heading font-semibold text-text-primary">
        {CONVERSATIONS_TITLE}
      </h1>

      {state.kind === 'loading' ? (
        // 骨架：固定 72px 行高 ×6，与真实行一致 —— 加载完成不产生布局跳动。
        <div data-testid="conversation-skeleton" aria-hidden="true" className="flex flex-col">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex h-conversation-row items-center gap-md-tight px-md">
              <span className="size-12 shrink-0 animate-pulse rounded-full bg-character-bubble" />
              <span className="flex flex-1 flex-col gap-xs">
                <span className="h-5 w-28 animate-pulse rounded bg-character-bubble" />
                <span className="h-4 w-44 animate-pulse rounded bg-character-bubble" />
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {state.kind === 'error' ? (
        <EmptyOrError
          kind="error"
          message={LIST_LOAD_ERROR_COPY}
          action={{ label: CONVERSATIONS_RETRY_LABEL, onRetry: () => void load() }}
        />
      ) : null}

      {state.kind === 'ok' && state.conversations.length === 0 ? (
        <EmptyOrError
          kind="empty"
          heading={CONVERSATIONS_EMPTY_HEADING}
          body={CONVERSATIONS_EMPTY_BODY}
          cta={{ label: CONVERSATIONS_EMPTY_CTA, href: '/characters' }}
        />
      ) : null}

      {state.kind === 'ok' && state.conversations.length > 0 ? (
        <ConversationList conversations={state.conversations} />
      ) : null}
    </main>
  );
}
