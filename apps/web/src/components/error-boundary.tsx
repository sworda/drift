'use client';

// 全局错误上报（D-28 / RESEARCH §12.6）—— React error boundary + unhandledrejection。
//
// ── 上报载荷是白名单字段（与 apps/api 的 TELEMETRY_ALLOWED_FIELDS 对齐）────
// 只有 errorName 与 route。**绝不**上报 props、state、componentStack、breadcrumb
// 或任何消息内容：componentStack/breadcrumb 极易携带用户消息片段，而
// client_error 是一个 append-only 的个人信息存储位置（STORAGE_LOCATIONS 已登记）。
// —— 比 PLAN 字面（「componentStack 前N字符 + 正则剥离」）更强：这些字段根本
// 不存在，剥离无从谈起。API 侧的 zod strict 白名单是同一道边界的另一半。
//
// 上报失败静默（旁路不得影响渲染），401/网络错误同样静默。

import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';

import { API_ORIGIN } from '@/lib/session';

export interface TelemetryReport {
  readonly errorName: string;
  readonly route?: string | undefined;
}

/** 上报一次前端错误（白名单字段，fire-and-forget）。导出供 Dialog 的 reportError 复用。 */
export async function reportClientError(report: TelemetryReport): Promise<void> {
  try {
    await fetch(`${API_ORIGIN}/telemetry/error`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
  } catch {
    // 上报本身失败不再上报（无出口），也不影响调用方。
  }
}

interface BoundaryState {
  readonly hasError: boolean;
}

export class AppErrorBoundary extends Component<{ readonly children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    // 只上报 error.name（与 pino 的 logError 同一条理由：message 可能携带用户输入）。
    void reportClientError({ errorName: error.name, route: window.location.pathname });
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="mx-auto flex min-h-dvh max-w-[480px] md:max-w-[640px] lg:max-w-[720px] flex-col items-start gap-sm p-md">
          <h1 className="text-heading font-semibold text-text-primary">页面出了点问题</h1>
          <p className="text-body text-text-secondary">
            这个页面没有正常显示 —— 刷新一次通常可以恢复。如果反复出现，可以从隐私中心导出你的数据留一份。
          </p>
        </main>
      );
    }
    return this.props.children;
  }
}

/** unhandledrejection 的挂载点（与 boundary 一起在 layout 挂一次）。 */
export function UnhandledRejectionReporter(): null {
  useEffect(() => {
    const handler = (event: PromiseRejectionEvent): void => {
      const name = event.reason instanceof Error ? event.reason.name : 'unhandledrejection';
      void reportClientError({ errorName: name, route: window.location.pathname });
    };
    window.addEventListener('unhandledrejection', handler);
    return () => {
      window.removeEventListener('unhandledrejection', handler);
    };
  }, []);
  return null;
}
