'use client';

// 角色库（CHAT-01 / CHAT-02 / COMPLY-08）。客户端组件：身份在浏览器存储
//（lib/session.ts），服务端组件拿不到 —— 与会话列表页同一条先例（Plan 14 把
// 它从服务端 fetch 改造过来：那版在真实浏览器会话里永远落在 401 空态）。
//
// 三态可区分：骨架（72px 行 ×6）/ 错误（重试）/ 空态。空态分两种（UI-SPEC E2）：
// 一个角色都没有（seed 前），与全部已添加（按 friendship 判定）。

import { useCallback, useEffect, useState } from 'react';

import { EmptyOrError } from '@/components/empty-or-error';
import {
  CharacterList,
  type CharacterListItem,
} from '@/features/characters/character-list';
import { LIST_LOAD_ERROR_COPY } from '@/features/chat/copy';
import { authedFetch } from '@/lib/session';

const CHARACTERS_TITLE = '角色库';
const ALL_ADDED_HEADING = '预设角色都已经在你的列表里了';
const ALL_ADDED_BODY = '回到会话列表继续聊天。更多角色会陆续加入。';
const ALL_ADDED_GOTO = '回到会话列表';
const RETRY_LABEL = '重试';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ok'; readonly characters: readonly CharacterListItem[]; readonly allAdded: boolean };

export default function CharactersPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [charactersResponse, conversationsResponse] = await Promise.all([
        authedFetch('/characters'),
        authedFetch('/conversations'),
      ]);
      if (!charactersResponse.ok || !conversationsResponse.ok) {
        setState({ kind: 'error' });
        return;
      }
      const charactersBody = (await charactersResponse.json()) as {
        characters: CharacterListItem[];
      };
      const conversationsBody = (await conversationsResponse.json()) as {
        conversations: readonly { readonly characterId: string }[];
      };
      const added = new Set(conversationsBody.conversations.map((conversation) => conversation.characterId));
      setState({
        kind: 'ok',
        characters: charactersBody.characters,
        allAdded:
          charactersBody.characters.length > 0 &&
          charactersBody.characters.every((character) => added.has(character.id)),
      });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] md:max-w-[640px] lg:max-w-[720px]">
      <h1 className="px-md py-lg text-heading font-semibold text-text-primary">{CHARACTERS_TITLE}</h1>

      {state.kind === 'loading' ? (
        <div aria-hidden="true" className="flex flex-col">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex h-conversation-row items-center gap-md-tight px-md">
              <span className="size-12 shrink-0 animate-pulse rounded-full bg-character-bubble" />
              <span className="flex flex-1 flex-col gap-xs">
                <span className="h-5 w-24 animate-pulse rounded bg-character-bubble" />
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
          action={{ label: RETRY_LABEL, onRetry: () => void load() }}
        />
      ) : null}

      {state.kind === 'ok' && state.allAdded ? (
        <EmptyOrError
          kind="empty"
          heading={ALL_ADDED_HEADING}
          body={ALL_ADDED_BODY}
          cta={{ label: ALL_ADDED_GOTO, href: '/conversations' }}
        />
      ) : null}

      {state.kind === 'ok' && !state.allAdded ? <CharacterList characters={state.characters} /> : null}
    </main>
  );
}
