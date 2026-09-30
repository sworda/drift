'use client';

// 角色详情页（CHAT-01/02 · COMPLY-01）。客户端组件（身份在浏览器存储里，
// 见 lib/session.ts 的说明）。空态 / 错误态 / 骨架三态可区分；骨架含徽标位占位。

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { EmptyOrError } from '@/components/empty-or-error';
import {
  CharacterDetail,
  CharacterDetailSkeleton,
  type CharacterDetailData,
} from '@/features/characters/character-detail';
import { authedFetch } from '@/lib/session';
import { LIST_LOAD_ERROR_COPY } from '@/features/chat/copy';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ok'; readonly character: CharacterDetailData };

export default function CharacterDetailPage() {
  const params = useParams<{ readonly characterId: string }>();
  const characterId = params.characterId;
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const response = await authedFetch(`/characters/${characterId}`);
      if (!response.ok) {
        setState({ kind: 'error' });
        return;
      }
      const body = (await response.json()) as { character: CharacterDetailData };
      setState({ kind: 'ok', character: body.character });
    } catch {
      setState({ kind: 'error' });
    }
  }, [characterId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] md:max-w-[640px] lg:max-w-[720px]">
      {state.kind === 'loading' ? <CharacterDetailSkeleton /> : null}
      {state.kind === 'error' ? (
        <EmptyOrError
          kind="error"
          message={LIST_LOAD_ERROR_COPY}
          action={{ label: '重试', onRetry: () => void load() }}
        />
      ) : null}
      {state.kind === 'ok' ? <CharacterDetail character={state.character} /> : null}
    </main>
  );
}
