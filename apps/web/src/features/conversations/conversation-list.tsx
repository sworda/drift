// 会话列表（CHAT-05 / CHAT-06 / COMPLY-01）。AI 明示标识的四处落点之一〔法定〕：
// 每行标题后紧跟「AI」徽标，标题 truncate、徽标 shrink-0 —— 徽标不得因标题过长
// 被挤出或省略（T-14-05）。
//
// ── 行的硬约束（UI-SPEC）─────────────────────────────────────────────────────
//   - 72px 固定行高（h-conversation-row → --size-conversation-row）：头像 48 +
//     上下 12。固定行高是「未读数位置不跳动」的前提，也是无未读 / 未读 5 / 未读 150
//     三种情形下计算高度恒等的断言对象。
//   - 整行可点（≥44px），行内不放按钮 —— 未读徽章区的触控由整行承担。
//   - 新建会话尚无消息时摘要位渲染占位短句（E6 partial），行高仍为 72px。

import Link from 'next/link';

import { AiBadge } from '@/components/ai-badge';

import { UnreadBadge } from './unread-badge';

/** 摘要位占位短句（E6：会话无最后消息摘要）。 */
export const EMPTY_PREVIEW_PLACEHOLDER = '新会话：发条消息打个招呼';

export interface ConversationListItem {
  readonly id: string;
  readonly characterId: string;
  readonly characterName: string;
  readonly characterAvatar: string;
  readonly counterpartKind: 'ai_character';
  readonly status: 'active' | 'ended';
  readonly unreadCount: number;
  readonly lastMessageAt: string | null;
  readonly lastMessagePreview: string | null;
}

export interface ConversationListProps {
  readonly conversations: readonly ConversationListItem[];
}

function formatListTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function ConversationList({ conversations }: ConversationListProps) {
  return (
    <ul className="flex flex-col" data-testid="conversation-list">
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <Link
            href={`/chat/${conversation.id}`}
            className="flex h-conversation-row min-w-0 items-center gap-md-tight px-md"
          >
            {/* 头像是静态资源标识而不是 URL —— 渲染层不绑存储层（与角色库同一先例）。 */}
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-character-bubble text-heading text-text-primary"
            >
              {conversation.characterName.slice(0, 1)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-xs">
              <span className="flex min-w-0 items-center gap-sm">
                <span className="truncate text-body font-semibold text-text-primary">
                  {conversation.characterName}
                </span>
                {conversation.counterpartKind === 'ai_character' ? (
                  <AiBadge data-testid="ai-badge-conversation-list" />
                ) : null}
              </span>
              <span className="truncate text-label text-text-secondary">
                {conversation.lastMessagePreview ?? EMPTY_PREVIEW_PLACEHOLDER}
              </span>
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-sm">
              {conversation.lastMessageAt !== null ? (
                <span className="text-label text-text-secondary">
                  {formatListTime(conversation.lastMessageAt)}
                </span>
              ) : null}
              <UnreadBadge count={conversation.unreadCount} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
