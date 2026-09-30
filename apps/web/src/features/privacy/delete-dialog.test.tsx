// 删除对话框的 RTL 断言（PRIV-05 / UI-SPEC 交互契约「一键删除」行）。
//
// ⚠️ 本文件住在 apps/web 而不是 tools/ci：react 只装在 apps/web（01-09 先例）。
//
// 断言集（PLAN Task 2 的 acceptance）：
//   · AlertDialog 的初始焦点在**取消**按钮（document.activeElement）
//   · 短语不匹配时确认禁用；逐字输入后解锁
//   · 执行中渲染 Progress；**执行完成后**才跳转（202 期间不跳、拿到终态才跳）
//   · 401（session 已随账号消失）切换 token 路径并跳转回执页
//   · 请求失败渲染失败态（不是假装进行中）

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeleteDialog } from '@/features/privacy/delete-dialog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** jsdom 不实现导航 —— 替换 location 为可断言的桩。 */
function stubLocation(): { readonly href: () => string } {
  const target = { href: '' };
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: target,
  });
  return { href: () => target.href };
}

function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  const impl = vi.fn(handler) as unknown as typeof fetch;
  vi.stubGlobal('fetch', impl);
  return impl;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function openDialog(): Promise<void> {
  fireEvent.click(screen.getByTestId('delete-entry'));
  await waitFor(() => {
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
}

describe('DeleteDialog（PRIV-05 的入口闸门）', () => {
  it('AlertDialog 的初始焦点在取消按钮上（破坏性操作的默认焦点不落在确认）', async () => {
    stubLocation();
    stubFetch(async () => json(202, {}));
    render(<DeleteDialog />);
    await openDialog();
    await waitFor(() => {
      expect((document.activeElement as HTMLElement | null)?.textContent).toBe('取消');
    });
  });

  it('短语不逐字匹配时确认按钮禁用；逐字输入后解锁', async () => {
    stubLocation();
    stubFetch(async () => json(202, {}));
    render(<DeleteDialog />);
    await openDialog();

    const confirm = screen.getByRole('button', { name: '确认删除' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('删除确认短语输入'), { target: { value: '删除我的全部数据' } });
    expect(confirm.disabled).toBe(false);

    // 差一个字也不行 —— 闸门是逐字的。
    fireEvent.change(screen.getByLabelText('删除确认短语输入'), { target: { value: '删除我的全部数据 ' } });
    expect(confirm.disabled).toBe(true);
  });

  it('执行中渲染 Progress，作业 202 期间**不**跳转，拿到终态后才跳转回执页', async () => {
    const location = stubLocation();
    let pollCount = 0;
    stubFetch(async (input) => {
      const url = String(input);
      if (url.includes('/me/delete')) return json(202, { actionId: 'act-1', receiptToken: 'tok-1' });
      pollCount += 1;
      // 前两轮 202（未完成），第三轮 200（终态）。
      return pollCount < 3 ? json(202, { status: 'pending' }) : json(200, { status: 'complete', clearedCount: 16 });
    });

    render(<DeleteDialog />);
    await openDialog();
    fireEvent.change(screen.getByLabelText('删除确认短语输入'), { target: { value: '删除我的全部数据' } });
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(
      () => {
        expect(screen.getByTestId('delete-running')).toBeTruthy();
      },
      { timeout: 8_000 },
    );
    expect(location.href(), '202 期间不跳转 —— 提前跳转会让回执数字不可信').toBe('');

    await waitFor(
      () => {
        expect(location.href()).toBe('/privacy/receipt/act-1?token=tok-1');
      },
      { timeout: 8_000 },
    );
  });

  it('401（session 已随账号消失）后切 token 路径读取回执并跳转', async () => {
    const location = stubLocation();
    stubFetch(async (input) => {
      const url = String(input);
      if (url.includes('/me/delete')) return json(202, { actionId: 'act-2', receiptToken: 'tok-2' });
      if (url.includes('/me/privacy-actions/')) return json(401, { error: 'unauthorized' });
      if (url.includes('/privacy-receipts/act-2')) return json(200, { status: 'complete', clearedCount: 16 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<DeleteDialog />);
    await openDialog();
    fireEvent.change(screen.getByLabelText('删除确认短语输入'), { target: { value: '删除我的全部数据' } });
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(location.href()).toBe('/privacy/receipt/act-2?token=tok-2');
    });
  });

  it('请求失败（503 = 什么都没发生）渲染失败态，不假装进行中', async () => {
    stubLocation();
    stubFetch(async () => json(503, { error: 'deletion_not_started' }));

    render(<DeleteDialog />);
    await openDialog();
    fireEvent.change(screen.getByLabelText('删除确认短语输入'), { target: { value: '删除我的全部数据' } });
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeTruthy();
      },
      { timeout: 8_000 },
    );
    expect(screen.getByRole('alert').textContent).toContain('删除没有开始');
    expect(screen.queryByTestId('delete-running')).toBeNull();
  });
});
