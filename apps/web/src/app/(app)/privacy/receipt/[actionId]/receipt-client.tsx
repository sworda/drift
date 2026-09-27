// 回执页的客户端部分：用一次性 token 拉取回执并渲染（服务端组件只负责解参）。

'use client';

import { useEffect, useState } from 'react';

import { DeletionReceipt, type ReceiptData } from '@/features/privacy/receipt';

const API_ORIGIN = process.env['NEXT_PUBLIC_API_ORIGIN'] ?? 'http://127.0.0.1:3001';

export function ReceiptClient({
  actionId,
  token,
}: {
  readonly actionId: string;
  readonly token: string;
}) {
  const [state, setState] = useState<
    | { readonly kind: 'loading' }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'ok'; readonly receipt: ReceiptData }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `${API_ORIGIN}/privacy-receipts/${actionId}?token=${encodeURIComponent(token)}`,
          { credentials: 'include' },
        );
        if (cancelled) return;
        if (response.status !== 200) {
          setState({ kind: 'not_found' });
          return;
        }
        setState({ kind: 'ok', receipt: (await response.json()) as ReceiptData });
      } catch {
        if (!cancelled) setState({ kind: 'not_found' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actionId, token]);

  if (state.kind === 'loading') {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-[480px] px-md">
        <p className="pt-lg text-body text-text-secondary" role="status">
          正在读取删除回执……
        </p>
      </main>
    );
  }

  if (state.kind === 'not_found') {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-[480px] px-md">
        <h1 className="pt-lg text-heading font-semibold text-text-primary">找不到这份回执</h1>
        <p className="mt-md whitespace-normal break-words text-body leading-relaxed text-text-secondary">
          回执链接不完整或已失效。如果删除没有完成，请回到隐私中心再试一次；如果反复失败，请提交申诉，我们会人工处理并回复你。
        </p>
      </main>
    );
  }

  return (
    <DeletionReceipt
      receipt={state.receipt}
      onRetry={() => {
        window.location.href = '/privacy';
      }}
      onExportCopy={() => {
        window.location.href = '/privacy';
      }}
    />
  );
}
