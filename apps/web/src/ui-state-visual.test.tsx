// @vitest-environment jsdom

// 四条 backstop 视觉 UI-state 的**渲染层**断言（UI-SPEC 标记 backstop 的行 / Plan 14
// Task 3）。结构层（源码类契约）在 tools/ci/ui-state-visual.test.ts —— react 只装在
// apps/web（01-09 先例），两层各守一半。
//
// jsdom 无布局引擎：视觉结论由渲染出的结构（元素在场、类名、DOM 顺序）承载。

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCareCard } from '@drift/safety';

import { ConversationList, type ConversationListItem } from '@/features/conversations/conversation-list';
import { ChatView, type ChatMessage } from '@/features/chat/chat-view';
import { CareCard } from '@/features/crisis/care-card';
import { contactStatusLine } from '@/features/crisis/copy';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LONG_NAME = '周砚'.repeat(15); // 30 字

function conversationItem(): ConversationListItem {
  return {
    id: 'conv-1',
    characterId: 'seed-zhou-yan',
    characterName: LONG_NAME,
    characterAvatar: 'zhou-yan',
    counterpartKind: 'ai_character',
    status: 'active',
    unreadCount: 3,
    lastMessageAt: '2026-09-27T10:00:00.000Z',
    lastMessagePreview: '在的。',
  };
}

describe('backstop 1：30 字角色名渲染会话行 —— AI 徽标仍完整可见', () => {
  it('徽标在场、shrink-0；标题 truncate（30 字名不挤出法定标识）', () => {
    render(<ConversationList conversations={[conversationItem()]} />);
    const badge = screen.getByTestId('ai-badge-conversation-list');
    expect(badge.className).toContain('shrink-0');
    expect(badge.textContent).toBe('AI');
    const title = screen.getByText(LONG_NAME);
    expect(title.className).toContain('truncate');
  });
});

describe('backstop 2：2000 字单条消息 —— 80% 宽 + 强制换行，不遮挡常驻条', () => {
  it('长消息正常渲染，气泡内容带宽度与换行约束', () => {
    const longText = '长'.repeat(2000);
    const messages: readonly ChatMessage[] = [
      {
        messageId: 'm1',
        seq: 1,
        senderKind: 'character',
        text: longText,
        disclosure: { kind: 'ai_generated' },
        createdAt: '2026-09-27T10:00:00.000Z',
      },
    ];
    const { container } = render(<ChatView messages={messages} />);
    expect(screen.getByText(longText)).toBeDefined();
    // 80% 宽度上限住在**气泡外框**（Bubble）上，不在内容盒上：Bubble 是 w-fit，
    // 内容盒再按百分比设限会与「气泡宽 = 内容宽」形成循环引用，把气泡压窄。
    const bubble = container.querySelector('[data-slot="bubble"]');
    const bubbleContent = container.querySelector('[data-slot="bubble-content"]');
    expect(bubble?.className).toContain('max-w-[80%]');
    expect(bubbleContent?.className).not.toMatch(/max-w-\[/u);
    expect(bubbleContent?.className).toContain('break-words');
  });
});

describe('backstop 3：危机资源清单超屏 —— 二级卡片 sticky、联络行在场、不可 dismiss', () => {
  it('failed 态：热线行（拨打 12356）在安抚段之前，卡片 sticky', () => {
    const card = buildCareCard('level2', { contactStatus: 'failed', contactName: '张三' });
    const { container } = render(<CareCard card={card} />);
    const alert = container.querySelector('[data-care-card-level="2"]');
    expect(alert?.className).toContain('sticky');
    const hotline = screen.getByLabelText('拨打 12356');
    const reassurance = screen.getByText(card.reassurance);
    // failed 态热线行是首屏第一行：DOM 顺序在安抚段之前。
    expect(
      (hotline.compareDocumentPosition(reassurance) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ).toBe(true);
    // 卡片内没有任何 dismiss/关闭控件。
    expect(screen.queryByRole('button', { name: /关闭|取消/u })).toBeNull();
  });

  it('pending 态：联络行在安抚段之后（非 hotlineFirst），四态行可渲染', () => {
    const card = buildCareCard('level2', {
      contactStatus: 'pending',
      contactName: '张三',
      maskedContact: '138****1234',
    });
    render(<CareCard card={card} />);
    const line = contactStatusLine('pending', { name: '张三', masked: '138****1234' });
    expect(screen.getByText(line)).toBeDefined();
  });
});

describe('backstop 4：超长紧急联系人姓名 —— 联络状态行不被挤出', () => {
  it('20 字姓名完整渲染在状态行里（不截断、不省略）', () => {
    const longName = '欧阳龙傲天forever不让截断'.repeat(2);
    const card = buildCareCard('level2', { contactStatus: 'pending', contactName: longName });
    const { container } = render(<CareCard card={card} />);
    const row = container.querySelector('[data-slot="contact-status-row"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain(longName);
    expect(row?.className).not.toContain('truncate');
    // 状态行在资源清单（滚动容器）之外。
    const list = container.querySelector('[data-slot="crisis-resource-list"]');
    expect(list).not.toBeNull();
    expect(list?.contains(row)).toBe(false);
  });
});
