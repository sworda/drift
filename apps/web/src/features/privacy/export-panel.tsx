// 一键导出面板（PRIV-04 / UI-SPEC E9）—— Progress + 10s 追加行 + 失败态 + 空态。
//
// 状态覆盖（UI Considerations E9）：
//   loading  Progress +「正在打包你的数据」；超过 10s 追加「数据较多，还在继续」
//   error    「导出没有完成。你的数据没有受到影响，重试一次即可。」
//   empty    删除后再次导出：「这里已经没有你的数据了」+ 删除时间戳
//
// ⚠️ 10s 追加行的 setTimeout 只在导出面板（E9 明文要求），危机卡片与计时器的
// 服务端权威是另一条规则 —— eslint 的计时器禁令只作用于 apps/web/src/features/chat/**。

'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyOrError } from '@/components/empty-or-error';
import { Progress } from '@/components/ui/progress';

import { authedFetch } from '@/lib/session';

import { EXPORT_CTA, EXPORT_FAILED_COPY, EXPORT_PACKING_COPY, EXPORT_SLOW_NOTE } from './copy';

const POLL_INTERVAL_MS = 500;
const SLOW_NOTE_AFTER_MS = 10_000;

type ExportPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly exportId: string; readonly slow: boolean }
  | { readonly kind: 'complete'; readonly exportId: string }
  | { readonly kind: 'failed' };

export interface ExportPanelProps {
  /** 删除完成后的空态输入（E9 empty：显示删除时间戳）。 */
  readonly deletedAt?: string | null;
}

export function ExportPanel({ deletedAt }: ExportPanelProps) {
  const [phase, setPhase] = useState<ExportPhase>({ kind: 'idle' });
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 带身份取字节 → Blob → 触发下载。
   *
   * `<a href={`${API_ORIGIN}/me/export/.../download`}>` 结构性**无法**携带
   * Authorization 头（浏览器导航不经过 fetch，不会带上 localStorage 里的 token），
   * 而 /me/export/:id/download 走 currentUserId(c) —— 无 Bearer 即 401。所以下载
   * 必须先走一次真正的带身份请求拿到字节，再用 Blob 触发本地保存。
   *
   * 失败（导出文件已被 7 天 TTL 清理 / 401）不静默：复用本面板既有的失败态，
   * 不新编文案。
   */
  async function downloadExport(exportId: string, format: 'md' | 'json'): Promise<void> {
    try {
      const response = await authedFetch(`/me/export/${exportId}/download?format=${format}`);
      if (!response.ok) throw new Error(`download returned ${String(response.status)}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `drift-export-${exportId}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setPhase({ kind: 'failed' });
    }
  }

  useEffect(() => {
    return () => {
      if (slowTimer.current !== null) clearTimeout(slowTimer.current);
    };
  }, []);

  async function pollUntilDone(exportId: string): Promise<void> {
    for (let round = 0; round < 240; round += 1) {
      const response = await authedFetch(`/me/export/${exportId}`).catch(() => null);
      if (response !== null && response.status === 200) {
        const payload = (await response.json()) as { readonly status?: string };
        if (payload.status === 'complete') {
          setPhase({ kind: 'complete', exportId });
          return;
        }
        if (payload.status === 'failed') {
          setPhase({ kind: 'failed' });
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    setPhase({ kind: 'failed' });
  }

  async function startExport(): Promise<void> {
    const response = await authedFetch('/me/export', {
      method: 'POST',
    }).catch(() => null);
    if (response === null || response.status !== 202) {
      setPhase({ kind: 'failed' });
      return;
    }
    const { exportId } = (await response.json()) as { exportId: string };
    setPhase({ kind: 'running', exportId, slow: false });
    slowTimer.current = setTimeout(() => {
      setPhase((current) => (current.kind === 'running' ? { ...current, slow: true } : current));
    }, SLOW_NOTE_AFTER_MS);
    await pollUntilDone(exportId);
    if (slowTimer.current !== null) clearTimeout(slowTimer.current);
  }

  // 删除后的空态优先（E9 empty：成功标准 4 的可见证据）。经由 EmptyOrError ——
  // 空态/错误态的统一区分容器（Plan 14 Task 2，四处接入点之一）。
  if (deletedAt !== undefined && deletedAt !== null) {
    return (
      <EmptyOrError
        kind="empty"
        testId="export-deleted-empty"
        heading="这里已经没有你的数据了"
        body={`你在 ${deletedAt} 删除了全部数据。新产生的对话会重新出现在这里。`}
      />
    );
  }

  return (
    <div className="px-md py-lg" data-testid="export-panel">
      {/* 本屏唯一吃 accent 的元素（UI-SPEC 视觉锚点契约）。 */}
      <Button data-testid="export-cta" className="w-full" onClick={() => void startExport()}>
        {EXPORT_CTA}
      </Button>

      {phase.kind === 'running' ? (
        <div className="mt-md" data-testid="export-running">
          <Progress label={EXPORT_PACKING_COPY} />
          <p className="mt-sm text-label leading-relaxed text-text-secondary" role="status">
            {EXPORT_PACKING_COPY}
          </p>
          {phase.slow ? (
            <p className="mt-xs text-label leading-relaxed text-text-secondary" data-testid="export-slow-note">
              {EXPORT_SLOW_NOTE}
            </p>
          ) : null}
        </div>
      ) : null}

      {phase.kind === 'failed' ? (
        <div className="mt-md" data-testid="export-failed">
          <EmptyOrError
            kind="error"
            message={EXPORT_FAILED_COPY}
            action={{ label: '重试一次', onRetry: () => void startExport() }}
          />
        </div>
      ) : null}

      {phase.kind === 'complete' ? (
        <div className="mt-md" data-testid="export-done">
          <p className="text-label leading-relaxed text-text-secondary">打包完成，七天有效。选择格式下载：</p>
          <div className="mt-sm flex gap-sm">
            <Button
              variant="outline"
              size="lg"
              data-testid="export-download-md"
              onClick={() => void downloadExport(phase.exportId, 'md')}
            >
              下载 .md
            </Button>
            <Button
              variant="outline"
              size="lg"
              data-testid="export-download-json"
              onClick={() => void downloadExport(phase.exportId, 'json')}
            >
              下载 .json
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
