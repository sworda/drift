// @vitest-environment jsdom

// 2 小时提醒 Dialog 的 RTL 契约断言（COMPLY-03 / Plan 12 Task 1）。
//
// 住在 apps/web 而不是 tools/ci：react / react-dom 只装在 apps/web（pnpm 严格
// node_modules，从 tools/ci 解析不到它们）—— 01-09 的先例。

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// vitest 未开 globals —— RTL 的自动清理不会注册，必须显式 cleanup。
afterEach(() => {
  cleanup();
});

import {
  ComplianceRenderBoundary,
  UsageReminderDialog,
} from './usage-reminder-dialog';
import { USAGE_REMINDER_COPY, USAGE_REMINDER_PRIMARY, USAGE_REMINDER_SECONDARY } from './copy';

describe('UsageReminderDialog（COMPLY-03）', () => {
  it('正文与两个按钮文案逐字来自 copy.ts，恰好 2 个 button', () => {
    render(
      <UsageReminderDialog open onOpenChange={() => undefined} reportError={() => undefined} />,
    );
    expect(screen.getByText(USAGE_REMINDER_COPY)).toBeTruthy();
    expect(screen.getByRole('button', { name: USAGE_REMINDER_PRIMARY })).toBeTruthy();
    expect(screen.getByRole('button', { name: USAGE_REMINDER_SECONDARY })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('次按钮为 neutral 文字按钮，不吃 accent（data-variant=ghost 而非 default）', () => {
    render(
      <UsageReminderDialog open onOpenChange={() => undefined} reportError={() => undefined} />,
    );
    const secondary = screen.getByRole('button', { name: USAGE_REMINDER_SECONDARY });
    expect(secondary.getAttribute('data-variant')).toBe('ghost');
    const primary = screen.getByRole('button', { name: USAGE_REMINDER_PRIMARY });
    expect(primary.getAttribute('data-variant')).toBe('default');
  });

  it('两个按钮都会关闭 Dialog（onOpenChange(false)）', () => {
    const onOpenChange = vi.fn();
    render(<UsageReminderDialog open onOpenChange={onOpenChange} reportError={() => undefined} />);
    screen.getByRole('button', { name: USAGE_REMINDER_PRIMARY }).click();
    screen.getByRole('button', { name: USAGE_REMINDER_SECONDARY }).click();
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('渲染失败时上报合规事件，而不是静默消失（error E12）', () => {
    const reportError = vi.fn();
    function Boom(): never {
      throw new Error('render exploded');
    }
    render(
      <ComplianceRenderBoundary reportError={reportError}>
        <Boom />
      </ComplianceRenderBoundary>,
    );
    expect(reportError).toHaveBeenCalledTimes(1);
    // 只上报错误名，不携带 message（message 可能含触发渲染的输入）。
    expect(reportError).toHaveBeenCalledWith('dialog_render_failed:Error');
  });

  it('正常渲染时边界不打扰 children（reportError 不被调用）', () => {
    const reportError = vi.fn();
    render(<ComplianceRenderBoundary reportError={reportError}>一切正常</ComplianceRenderBoundary>);
    expect(screen.getByText('一切正常')).toBeTruthy();
    expect(reportError).not.toHaveBeenCalled();
  });
});
