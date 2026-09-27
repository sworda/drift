// @vitest-environment jsdom

// ChatClient 的关键结构断言（CHAT-06/07 · COMPLY-01 / Plan 14 Task 1）：
//   1. 重连细条在 DOM 顺序上位于 AI 常驻条之后（compareDocumentPosition，不遮挡它）
//   2. 分割线在已读标记（POST read）之后仍在 DOM（进入时定位一次并固定）
//   3. 空态下 AI 常驻条同样在场（不等到有消息才出现〔法定〕）
//
// fetch 全量 mock（vi.stubGlobal）—— ChatClient 在 mount 时串行发 GET messages 与
// POST read，测试对两者分别给桩；WS 在 jsdom 中连不上桩地址，onclose 后进入
// disconnected 态恰好是重连细条的验证形态。

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatClient } from './chat-client';
import type { ChatMessage } from './chat-view';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const MESSAGES: readonly ChatMessage[] = [
  {
    messageId: 'm1',
    seq: 1,
    senderKind: 'user',
    text: '在吗',
    disclosure: null,
    createdAt: '2026-09-27T10:00:00.000Z',
  },
  {
    messageId: 'm2',
    seq: 2,
    senderKind: 'character',
    text: '在的。',
    disclosure: { kind: 'ai_generated' },
    createdAt: '2026-09-27T10:00:05.000Z',
  },
  {
    messageId: 'm3',
    seq: 3,
    senderKind: 'character',
    text: '离线期间的这条。',
    disclosure: { kind: 'ai_generated' },
    createdAt: '2026-09-27T11:00:05.000Z',
  },
];

function stubApi(options: { readonly firstUnreadSeq: number | null }): {
  readonly readCalls: { (): number };
} {
  let readCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/read')) {
        readCalls += 1;
        return jsonResponse({ ok: true, lastReadSeq: 3 });
      }
      // GET messages（含 after_seq=0 的首载与补拉）。
      return jsonResponse({
        conversation: {
          id: 'conv-1',
          characterId: 'seed-zhou-yan',
          characterName: '周砚',
          characterAvatar: 'zhou-yan',
          counterpartKind: 'ai_character',
          status: 'active',
          unreadCount: 2,
        },
        firstUnreadSeq: options.firstUnreadSeq,
        messages: MESSAGES,
      });
    }),
  );
  return {
    readCalls: () => readCalls,
  };
}

describe('ChatClient（CHAT-06/07 · COMPLY-01）', () => {
  it('重连细条在 DOM 顺序上位于 AI 常驻条之后（不遮挡法定常驻条）', async () => {
    stubApi({ firstUnreadSeq: null });
    render(<ChatClient conversationId="conv-1" />);
    const banner = await waitFor(() => screen.getByTestId('ai-banner-chat'));
    // WS 连不上 ⇒ 断连态出现。
    const bar = await waitFor(() => screen.getByTestId('reconnect-bar'));
    // bar 在 banner 之后：banner 包含 bar 为假、bar 包含 banner 为假，只有先后为真。
    expect(banner.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('未读分割线出现在首条未读之前，且 POST read 之后仍在 DOM（定位一次并固定）', async () => {
    const { readCalls } = stubApi({ firstUnreadSeq: 3 });
    render(<ChatClient conversationId="conv-1" />);
    const separator = await waitFor(() => screen.getByTestId('unread-separator'));
    expect(separator.textContent).toContain('以下是你离开后的消息');
    // read 已被触发（进入会话即已读）。
    await waitFor(() => expect(readCalls()).toBeGreaterThan(0));
    // 已读之后分割线不消失 —— 它属于本次浏览，不属于服务端已读状态。
    expect(screen.getByTestId('unread-separator')).toBe(separator);
  });

  it('四个 icon-only 控件都有可编程确定的名称：返回 / 发送 / 插入表情 / 更多操作', async () => {
    stubApi({ firstUnreadSeq: null });
    render(<ChatClient conversationId="conv-1" />);
    await waitFor(() => screen.getByTestId('composer-input'));
    // getByRole 的 name 查询逐个断言（UI-SPEC ## 交互契约 无障碍名称行）——
    // tooltip 不作为唯一来源：这些控件根本没有 tooltip。
    expect(screen.getByRole('link', { name: '返回' })).toBeDefined();
    expect(screen.getByRole('button', { name: '发送' })).toBeDefined();
    expect(screen.getByRole('button', { name: '插入表情' })).toBeDefined();
    expect(screen.getByRole('button', { name: '更多操作' })).toBeDefined();
  });

  it('输入框增高后 AI 常驻条仍 sticky 置顶（不被挤出首屏）', async () => {
    stubApi({ firstUnreadSeq: null });
    render(<ChatClient conversationId="conv-1" />);
    const banner = await waitFor(() => screen.getByTestId('ai-banner-chat'));
    // jsdom 无布局：结构保证 = sticky top-0（滚动时钉在视口顶）。
    expect(banner.className).toContain('sticky');
    expect(banner.className).toContain('top-0');
    // 输入区高度封顶（5 行后框内滚动），结构上不可能把常驻条顶出首屏。
    expect(screen.getByTestId('composer-input').className).toContain('max-h-[140px]');
  });

  it('空消息流（新会话）下 AI 常驻条与空态文案都在场，不渲染成分割线', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          conversation: {
            id: 'conv-1',
            characterId: 'seed-zhou-yan',
            characterName: '周砚',
            characterAvatar: 'zhou-yan',
            counterpartKind: 'ai_character',
            status: 'active',
            unreadCount: 0,
          },
          firstUnreadSeq: null,
          messages: [],
        }),
      ),
    );
    render(<ChatClient conversationId="conv-1" />);
    const banner = await waitFor(() => screen.getByTestId('ai-banner-chat'));
    expect(banner).toBeDefined();
    expect(screen.getByText('还没有开始')).toBeDefined();
    expect(screen.getByText('说点什么，周砚 会回你。')).toBeDefined();
    expect(screen.queryByTestId('unread-separator')).toBeNull();
  });
});
