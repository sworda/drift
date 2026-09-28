// 导出面板的 RTL 断言（PRIV-04 / UI-SPEC E9 的三个状态行）。
//
// ⚠️ 本文件住在 apps/web（react 只装在 apps/web，01-09 先例）。

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExportPanel } from '@/features/privacy/export-panel';
import { saveSessionToken } from '@/lib/session';

const ORIGINAL_CREATE_OBJECT_URL = URL.createObjectURL;
const ORIGINAL_REVOKE_OBJECT_URL = URL.revokeObjectURL;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // URL 的静态方法不是 spy 能自动还原的对象属性，逐个还原。
  Object.defineProperty(URL, 'createObjectURL', {
    value: ORIGINAL_CREATE_OBJECT_URL,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: ORIGINAL_REVOKE_OBJECT_URL,
    configurable: true,
    writable: true,
  });
});

function stubFetch(handler: (input: RequestInfo | URL) => Promise<Response>): typeof fetch {
  const impl = vi.fn(handler) as unknown as typeof fetch;
  vi.stubGlobal('fetch', impl);
  return impl;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type FetchCall = readonly [input: RequestInfo | URL, init: RequestInit | undefined];

/** 记录 init 的 fetch stub —— 下载用例要断言 Authorization 头确实附着在下载请求上。 */
function stubFetchWithInit(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): { readonly calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push([input, init]);
    return handler(input, init);
  });
  vi.stubGlobal('fetch', impl);
  return { calls };
}

/** 把 URL 的两个静态方法换成可观测的 stub（jsdom 是否原生实现不依赖）。 */
function stubObjectUrl(): {
  readonly create: ReturnType<typeof vi.fn>;
  readonly revoke: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(() => 'blob:mock');
  const revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true, writable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true, writable: true });
  return { create, revoke };
}

async function clickCta(): Promise<void> {
  fireEvent.click(screen.getByTestId('export-cta'));
}

describe('ExportPanel 的状态覆盖（E9）', () => {
  it('loading：Progress +「正在打包你的数据」，超过 10s 追加「数据较多，还在继续」', async () => {
    vi.useFakeTimers();
    try {
      stubFetch(async (input) => {
        const url = String(input);
        if (url.includes('/me/export') && !url.includes('/download')) {
          return json(202, { status: 'pending' });
        }
        throw new Error(`unexpected ${url}`);
      });
      render(<ExportPanel />);
      await clickCta();
      // 10s 之前：只有第一行。
      await vi.advanceTimersByTimeAsync(9_000);
      expect(screen.getByRole('status').textContent).toContain('正在打包你的数据');
      expect(screen.queryByTestId('export-slow-note')).toBeNull();
      // 越过 10s：追加第二行（UI-SPEC E9 的逐字文案）。
      await vi.advanceTimersByTimeAsync(2_000);
      expect(screen.getByTestId('export-slow-note').textContent).toBe('数据较多，还在继续');
    } finally {
      vi.useRealTimers();
    }
  });

  it('error：「导出没有完成。你的数据没有受到影响，重试一次即可。」+ 重试出路', async () => {
    stubFetch(async () => json(500, {}));
    render(<ExportPanel />);
    await clickCta();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.getByRole('alert').textContent).toContain('导出没有完成');
    expect(screen.getByRole('alert').textContent).toContain('你的数据没有受到影响');
    expect(screen.getByText('重试一次')).toBeTruthy();
  });

  it('empty（删除后）：「这里已经没有你的数据了」+ 删除时间戳，CTA 不渲染', () => {
    render(<ExportPanel deletedAt="2026-09-27T10:00:00.000Z" />);
    const empty = screen.getByTestId('export-deleted-empty');
    expect(empty.textContent).toContain('这里已经没有你的数据了');
    expect(empty.textContent).toContain('2026-09-27T10:00:00.000Z');
    expect(empty.textContent).toContain('新产生的对话会重新出现在这里');
    expect(screen.queryByTestId('export-cta')).toBeNull();
  });

  it('complete：两个格式各一个下载按钮，文案逐字保持「下载 .md」「下载 .json」，且不再有任何指向 API 的 <a> 链接', async () => {
    stubFetch(async (input) => {
      const url = String(input);
      if (url.endsWith('/me/export')) return json(202, { exportId: 'exp-1' });
      return json(200, { status: 'complete', md: 'exp-1.md', json: 'exp-1.json' });
    });
    render(<ExportPanel />);
    await clickCta();
    await waitFor(() => {
      expect(screen.getByTestId('export-done')).toBeTruthy();
    });
    expect(screen.getByTestId('export-download-md').textContent).toBe('下载 .md');
    expect(screen.getByTestId('export-download-json').textContent).toBe('下载 .json');
    // 结构性：<a href> 无法携带 Authorization —— 下载入口不得再是链接。
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('complete → 点击下载：走 authedFetch（附 Bearer 头）→ Blob → 触发本地保存', async () => {
    saveSessionToken('tok-123');
    const { calls } = stubFetchWithInit(async (input) => {
      const url = String(input);
      if (url.endsWith('/me/export')) return json(202, { exportId: 'exp-1' });
      if (url.includes('/download')) return new Response('本文件全部角色消息由 AI 生成', { status: 200 });
      return json(200, { status: 'complete' });
    });
    const { create, revoke } = stubObjectUrl();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(<ExportPanel />);
    await clickCta();
    await waitFor(() => {
      expect(screen.getByTestId('export-done')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('export-download-md'));
    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });

    const downloadCall = calls.find((call) => String(call[0]).includes('/download'));
    expect(downloadCall).toBeTruthy();
    expect(String(downloadCall?.[0])).toContain('/me/export/exp-1/download?format=md');
    // 关键断言：下载请求确实带了 Bearer —— 这正是缺陷修复的核心。
    expect(new Headers(downloadCall?.[1]?.headers).get('authorization')).toBe('Bearer tok-123');
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('complete → 下载失败（文件已被 TTL 清理 / 401）：落到既有失败态，不静默', async () => {
    saveSessionToken('tok-123');
    stubFetchWithInit(async (input) => {
      const url = String(input);
      if (url.endsWith('/me/export')) return json(202, { exportId: 'exp-1' });
      if (url.includes('/download')) return json(401, { error: 'unauthorized' });
      return json(200, { status: 'complete' });
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(<ExportPanel />);
    await clickCta();
    await waitFor(() => {
      expect(screen.getByTestId('export-done')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('export-download-md'));
    await waitFor(() => {
      expect(screen.getByTestId('export-failed')).toBeTruthy();
    });
    expect(screen.getByRole('alert').textContent).toContain('导出没有完成');
    expect(click).not.toHaveBeenCalled();
  });
});
