// 导出面板的 RTL 断言（PRIV-04 / UI-SPEC E9 的三个状态行）。
//
// ⚠️ 本文件住在 apps/web（react 只装在 apps/web，01-09 先例）。

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExportPanel } from '@/features/privacy/export-panel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(handler: (input: RequestInfo | URL) => Promise<Response>): typeof fetch {
  const impl = vi.fn(handler) as unknown as typeof fetch;
  vi.stubGlobal('fetch', impl);
  return impl;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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

  it('complete：两个格式各一个下载链接（绑定 :exportId）', async () => {
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
    const links = screen.getAllByRole('link');
    expect(links.map((node) => (node as HTMLAnchorElement).href)).toEqual([
      expect.stringContaining('/me/export/exp-1/download?format=md'),
      expect.stringContaining('/me/export/exp-1/download?format=json'),
    ]);
  });
});
