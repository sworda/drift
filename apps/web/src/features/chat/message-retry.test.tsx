// @vitest-environment jsdom

// 重试控件的 RTL 契约断言（CHAT-03 · WCAG 1.4.1 / UI-SPEC error E4，逐字）。
//
// 「盒尺寸不小于 44×44」在 jsdom 里以类承载（min-h-touch / min-w-touch →
// --size-touch: 44px）：jsdom 没有布局引擎，getBoundingClientRect 全零。

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MessageRetry } from './message-retry';
import { MESSAGE_RETRY_ARIA, MESSAGE_RETRY_LABEL, SEND_FAILED_COPY } from './copy';

afterEach(() => {
  cleanup();
});

describe('MessageRetry（CHAT-03 · WCAG 1.4.1）', () => {
  it('同时含非空可见文字与 aria-label，触控区类不小于 44×44', () => {
    render(<MessageRetry onRetry={() => undefined} />);
    const control = screen.getByLabelText(MESSAGE_RETRY_ARIA);
    // 图标 + 13px 可见文字「重试」—— 只靠图标与颜色是被明文禁止的形态。
    expect(control.textContent).toContain(MESSAGE_RETRY_LABEL);
    expect(control.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(control.className).toContain('min-h-touch');
    expect(control.className).toContain('min-w-touch');
    // 失败文案（含「下一步做什么」）在场。
    expect(screen.getByText(SEND_FAILED_COPY)).toBeDefined();
  });

  it('去掉颜色后仍可识别：文字节点独立于 text-destructive 元素存在', () => {
    render(<MessageRetry onRetry={() => undefined} />);
    const control = screen.getByLabelText(MESSAGE_RETRY_ARIA);
    // 可见文字本身不带颜色类（红色只在图标上作冗余强化）。
    const textNode = Array.from(control.querySelectorAll('span')).find(
      (span) => span.textContent === MESSAGE_RETRY_LABEL,
    );
    expect(textNode).toBeDefined();
    expect(textNode?.className).not.toContain('destructive');
  });

  it('点击触发 onRetry', () => {
    const onRetry = vi.fn();
    render(<MessageRetry onRetry={onRetry} />);
    fireEvent.click(screen.getByLabelText(MESSAGE_RETRY_ARIA));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
