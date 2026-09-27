// @vitest-environment jsdom

// 硬退出与提醒 Dialog 的 RTL 契约断言（COMPLY-03/04/05 / Plan 12 Task 3）。
//
// 住在 apps/web 而不是 tools/ci：react / react-dom 只装在 apps/web（01-09 的
// 先例）。不需要渲染的静态断言在 tools/ci/exit-ui-contract.test.ts。

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// vitest 未开 globals —— RTL 的自动清理不会注册，必须显式 cleanup
//（crisis-ui-contract.test.tsx 同一条先例）。
afterEach(() => {
  cleanup();
});

import { DependencyNoticeDialog } from './dependency-notice-dialog';
import { ExitSystemCard, EndedComposer } from './exit-system-card';
import { ChatMoreSheet } from './more-sheet';
import { UsageReminderDialog } from './usage-reminder-dialog';
import {
  DEPENDENCY_NOTICE_BUTTON,
  EXIT_INPUT_PLACEHOLDER,
  USAGE_REMINDER_PRIMARY,
  USAGE_REMINDER_SECONDARY,
} from './copy';

describe('(a) 系统卡片：中性基座，不用 care 色', () => {
  it('以 Alert 基座渲染（role=alert），样式类里没有任何 care token', () => {
    render(<ExitSystemCard text="已停止本次会话。你随时可以回来。" />);
    const card = screen.getByRole('alert');
    expect(card.getAttribute('data-variant')).toBe('default');
    expect(card.className).not.toMatch(/care/u);
    expect(card.className).not.toMatch(/amber/u);
    expect(card.textContent).toContain('已停止本次会话。你随时可以回来。');
  });
});

describe('(b) 不存在二次确认 / 挽留控件（UI-SPEC 明文禁止）', () => {
  it('系统卡片与禁用输入框内没有任何按钮；全页面无「确定要离开 / 再聊一会 / 不要走」', () => {
    render(
      <div>
        <ExitSystemCard text="已停止本次会话。你随时可以回来。" />
        <EndedComposer />
      </div>,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText(/确定要离开/u)).toBeNull();
    expect(screen.queryByText(/再聊一会/u)).toBeNull();
    expect(screen.queryByText(/不要走/u)).toBeNull();
  });
});

describe('(c) 输入框禁用态与占位符', () => {
  it('disabled 且 placeholder 逐字为「本次会话已结束」', () => {
    render(<EndedComposer />);
    const input = screen.getByTestId('ended-composer');
    expect(input.hasAttribute('disabled')).toBe(true);
    expect(input.getAttribute('placeholder')).toBe(EXIT_INPUT_PLACEHOLDER);
    expect(input.getAttribute('placeholder')).toBe('本次会话已结束');
  });
});

describe('(d) 更多 Sheet 含「结束本次会话」入口，点击直接执行（无二次确认）', () => {
  it('入口存在、触发 onEndSession、且不弹出任何确认 Dialog', () => {
    const onEndSession = vi.fn();
    render(
      <ChatMoreSheet open onOpenChange={() => undefined} onEndSession={onEndSession} />,
    );
    const item = screen.getByRole('button', { name: '结束本次会话' });
    item.click();
    expect(onEndSession).toHaveBeenCalledTimes(1);
    // 无二次确认：点击后页面上仍然只有 Sheet 这一个 dialog，且不出现任何
    // 「确定要离开」类文案（onOpenChange 是 no-op，Sheet 故意不关 —— 断言的是
    // 「没有新增确认层」而不是「Sheet 消失」）。
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByText(/确定要离开/u)).toBeNull();
  });
});

describe('(e) 两个提醒 Dialog 的按钮数分别为 2 与 1', () => {
  it('2 小时提醒恰好 2 个按钮（先去歇一会 / 继续使用）', () => {
    render(
      <UsageReminderDialog open onOpenChange={() => undefined} reportError={() => undefined} />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: USAGE_REMINDER_PRIMARY })).toBeTruthy();
    expect(screen.getByRole('button', { name: USAGE_REMINDER_SECONDARY })).toBeTruthy();
  });

  it('依赖告知恰好 1 个按钮（我知道这是 AI 生成的）', () => {
    render(
      <DependencyNoticeDialog open onOpenChange={() => undefined} reportError={() => undefined} />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: DEPENDENCY_NOTICE_BUTTON })).toBeTruthy();
  });
});
