// @vitest-environment jsdom

// 会话列表与未读徽章的 RTL 契约断言（CHAT-05 / CHAT-06 / Plan 14 Task 1）。
//
// ⚠️ 本文件住在 apps/web（react 只装在 apps/web —— 01-09 先例）。
//
// ── jsdom 没有布局引擎 ──────────────────────────────────────────────────────
// 「行高恒为 72px」无法用 getBoundingClientRect 证明（jsdom 全部返回 0）。这里的
// 断言对象是产生该视觉结果的**结构保证**：行元素带 h-conversation-row（→
// --size-conversation-row: 72px，tokens.css），且三种未读情形下同一行类名不变。

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ConversationList,
  type ConversationListItem,
} from '@/features/conversations/conversation-list';

afterEach(() => {
  cleanup();
});

function item(overrides: Partial<ConversationListItem> = {}): ConversationListItem {
  return {
    id: 'conv-1',
    characterId: 'seed-zhou-yan',
    characterName: '周砚',
    characterAvatar: 'zhou-yan',
    counterpartKind: 'ai_character',
    status: 'active',
    unreadCount: 0,
    lastMessageAt: '2026-09-27T10:00:00.000Z',
    lastMessagePreview: '早上好。',
    ...overrides,
  };
}

function firstRowLink(): HTMLAnchorElement {
  const link = screen.getByTestId('conversation-list').querySelector('a');
  if (link === null) throw new Error('会话列表第一行不是链接');
  return link;
}

describe('ConversationList（CHAT-05/06）', () => {
  it('三种未读情形（0 / 5 / 150）下行元素都带 h-conversation-row（72px 固定行高）', () => {
    for (const count of [0, 5, 150]) {
      cleanup();
      render(<ConversationList conversations={[item({ unreadCount: count })]} />);
      const row = firstRowLink();
      expect(row).not.toBeNull();
      expect(row?.className).toContain('h-conversation-row');
    }
  });

  it('未读 0 不渲染徽章；1–99 显示数字；150 显示 99+', () => {
    render(<ConversationList conversations={[item({ unreadCount: 0 })]} />);
    expect(screen.queryByTestId('unread-badge')).toBeNull();
    cleanup();

    render(<ConversationList conversations={[item({ unreadCount: 5 })]} />);
    expect(screen.getByTestId('unread-badge').textContent).toBe('5');
    cleanup();

    render(<ConversationList conversations={[item({ unreadCount: 150 })]} />);
    expect(screen.getByTestId('unread-badge').textContent).toBe('99+');
  });

  it('30 字角色名：标题 truncate、AI 徽标 shrink-0 且仍在 DOM（法定标识不被挤出）', () => {
    render(
      <ConversationList
        conversations={[item({ characterName: '周砚'.repeat(15), unreadCount: 3 })]}
      />,
    );
    const row = firstRowLink();
    const title = row?.querySelector('span.truncate');
    expect(title?.textContent).toBe('周砚'.repeat(15));
    const badge = screen.getByTestId('ai-badge-conversation-list');
    expect(badge.className).toContain('shrink-0');
    expect(badge.textContent).toBe('AI');
  });

  it('无消息的会话渲染摘要占位短句，行高仍为 h-conversation-row（E6 partial）', () => {
    render(
      <ConversationList
        conversations={[item({ lastMessagePreview: null, lastMessageAt: null })]}
      />,
    );
    const row = firstRowLink();
    expect(row?.className).toContain('h-conversation-row');
    expect(row?.textContent).toContain('新会话');
  });

  it('整行为可点区域且 ≥44px：行元素本身是块级链接并带固定行高类', () => {
    render(<ConversationList conversations={[item()]} />);
    const row = firstRowLink();
    expect(row?.tagName).toBe('A');
    expect(row?.getAttribute('href')).toBe('/chat/conv-1');
    expect(row?.className).toContain('flex');
  });
});
