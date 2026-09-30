'use client';

// 角色详情页（CHAT-01 / CHAT-02 / COMPLY-01 / COMPLY-08）。
//
// ── 视觉锚点契约（角色详情页行，逐条）────────────────────────────────────────
//   - 首读元素：角色名（Heading 20px，本页唯一）+ 紧随其后的 AI 徽标，作为**一个
//     视觉组**、首屏第一行且 sticky —— 长简介滚动时该行不移出视口（30 字角色名的
//     backstop 也在它身上：标题 truncate、徽标 shrink-0）。
//   - 简介区首行固定「这是一个 AI 角色。」—— 法定标识的第一人称陈述。
//   - 「加为好友」是本屏唯一 accent 主 CTA。
//
// ── 骨架屏包含徽标位占位（loading E6）───────────────────────────────────────
// 法定标识不允许闪缺窗口：loading 态的名字骨架旁渲染一个与徽标同尺寸的占位块。
//
// ── 加好友 ──────────────────────────────────────────────────────────────────
// POST /characters/:id/friend（幂等：已是好友返回既有 conversationId）。
// 成功后进入会话。已结束的既有会话照常进入（历史可读）。

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AiBadge } from '@/components/ai-badge';
import { Button } from '@/components/ui/button';
import { authedFetch } from '@/lib/session';

export const CHARACTER_DETAIL_FIRST_LINE = '这是一个 AI 角色。';
export const ADD_FRIEND_LABEL = '加为好友';
export const ADD_FRIEND_PENDING = '正在添加…';
export const ADD_FRIEND_RETRY = '重试';

export interface CharacterDetailData {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly blurb: string;
  readonly dossier: string;
  readonly isAi: boolean;
}

export function CharacterDetailSkeleton() {
  return (
    <div data-testid="character-detail-skeleton" className="flex flex-col">
      {/* 首行与真实首行同构：名字骨架 + 徽标位占位（法定标识不闪缺，loading E6）。 */}
      <div className="sticky top-0 z-10 flex items-center gap-sm border-b border-border bg-card px-md py-md">
        <span aria-hidden="true" className="h-6 w-32 animate-pulse rounded bg-character-bubble" />
        <span
          aria-hidden="true"
          data-testid="ai-badge-skeleton"
          className="inline-flex h-[22px] w-[34px] shrink-0 animate-pulse items-center rounded border px-xs"
        />
      </div>
      <div className="flex flex-col gap-sm px-md py-lg">
        <span className="h-4 w-40 animate-pulse rounded bg-character-bubble" />
        <span className="h-4 w-full animate-pulse rounded bg-character-bubble" />
        <span className="h-4 w-4/5 animate-pulse rounded bg-character-bubble" />
        <span className="mt-lg h-11 w-40 animate-pulse rounded-lg bg-character-bubble" />
      </div>
    </div>
  );
}

type FriendState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'failed' };

export function CharacterDetail({ character }: { readonly character: CharacterDetailData }) {
  const router = useRouter();
  const [friendState, setFriendState] = useState<FriendState>({ kind: 'idle' });

  const addFriend = useCallback(async () => {
    if (friendState.kind === 'pending') return;
    setFriendState({ kind: 'pending' });
    try {
      const response = await authedFetch(`/characters/${character.id}/friend`, { method: 'POST' });
      if (!response.ok) {
        setFriendState({ kind: 'failed' });
        return;
      }
      const body = (await response.json()) as { conversationId: string };
      router.push(`/chat/${body.conversationId}`);
    } catch {
      setFriendState({ kind: 'failed' });
    }
  }, [character.id, friendState.kind, router]);

  return (
    <div data-testid="character-detail" className="flex flex-col">
      {/* 角色名（本页唯一 20px）+ AI 徽标：一个视觉组，sticky 首行。 */}
      <div className="sticky top-0 z-10 flex items-center gap-sm border-b border-border bg-card px-md py-md">
        <h1 className="truncate text-heading font-semibold text-text-primary">{character.name}</h1>
        {character.isAi ? <AiBadge data-testid="ai-badge-character-detail" /> : null}
      </div>

      <div className="flex flex-col gap-md px-md py-lg">
        <div className="flex items-center gap-md-tight">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-character-bubble text-body font-semibold text-text-primary"
          >
            {/* 头像字母刻意用 16px：角色名是本页唯一的 20px（视觉锚点契约）。 */}
            {character.name.slice(0, 1)}
          </span>
          <p className="text-label text-text-secondary">{character.blurb}</p>
        </div>

        {/* 简介区首行：固定法定陈述。 */}
        <div className="mt-sm flex flex-col gap-sm">
          <p className="text-body font-semibold text-text-primary">{CHARACTER_DETAIL_FIRST_LINE}</p>
          {character.dossier
            .split('\n\n')
            .filter((paragraph) => paragraph.trim().length > 0)
            .map((paragraph, index) => (
              <p key={index} className="text-body leading-relaxed text-text-primary">
                {paragraph}
              </p>
            ))}
        </div>

        {/* 本屏唯一 accent 主 CTA。失败态重试（错误文案含下一步）。 */}
        <div className="mt-sm flex flex-col items-start gap-xs">
          <Button
            onClick={() => void addFriend()}
            disabled={friendState.kind === 'pending'}
            aria-busy={friendState.kind === 'pending'}
            className="w-44"
          >
            {friendState.kind === 'pending' ? ADD_FRIEND_PENDING : ADD_FRIEND_LABEL}
          </Button>
          {friendState.kind === 'failed' ? (
            <p className="text-label text-destructive">
              没能完成添加 —— 网络或服务器暂时没有响应。点「重试」再试一次。
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
