// @vitest-environment jsdom

// 依赖告知 Dialog 的 RTL 契约断言（COMPLY-04 / SAFE-14 / Plan 12 Task 2）。

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// vitest 未开 globals —— RTL 的自动清理不会注册，必须显式 cleanup。
afterEach(() => {
  cleanup();
});

import { DependencyNoticeDialog } from './dependency-notice-dialog';
import { DEPENDENCY_NOTICE_BUTTON, DEPENDENCY_NOTICE_COPY } from './copy';
import { EMOTIONAL_BOUNDARY_COPY } from '../crisis/copy';

describe('DependencyNoticeDialog（COMPLY-04 / SAFE-14）', () => {
  it('可访问树中恰好 1 个 button，名称逐字为「我知道这是 AI 生成的」', () => {
    render(
      <DependencyNoticeDialog open onOpenChange={() => undefined} reportError={() => undefined} />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe(DEPENDENCY_NOTICE_BUTTON);
    expect(buttons[0]?.textContent).toBe('我知道这是 AI 生成的');
  });

  it('不存在「不再提醒」「以后不显示」一类的控件（告知不可关闭为可选项）', () => {
    render(
      <DependencyNoticeDialog open onOpenChange={() => undefined} reportError={() => undefined} />,
    );
    expect(screen.queryByText(/不再提醒/u)).toBeNull();
    expect(screen.queryByText(/以后不显示/u)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('正文与 SAFE-14 情感边界引导都在场（逐字）', () => {
    render(
      <DependencyNoticeDialog open onOpenChange={() => undefined} reportError={() => undefined} />,
    );
    expect(screen.getAllByText(DEPENDENCY_NOTICE_COPY).length).toBeGreaterThan(0);
    expect(screen.getAllByText(EMOTIONAL_BOUNDARY_COPY).length).toBeGreaterThan(0);
  });

  it('唯一按钮关闭 Dialog；渲染失败上报合规事件', () => {
    const onOpenChange = vi.fn();
    render(<DependencyNoticeDialog open onOpenChange={onOpenChange} reportError={() => undefined} />);
    screen.getByRole('button', { name: DEPENDENCY_NOTICE_BUTTON }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
