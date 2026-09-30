'use client';

// 消息重试控件（CHAT-03 · WCAG 1.4.1 / UI-SPEC ## 交互契约 重试行，逐字）：
// **图标 + 13px 可见文字「重试」**，aria-label = 「重试发送这条消息」，触控区
// ≥44×44（min-h-touch / min-w-touch）。红色只作冗余强化 —— 去掉颜色后仍可识别
//（文字节点非空，RTL 断言钉住这一点，颜色断言不存在：它本来就不得承载语义）。
//
// 点击气泡或该控件均可重试（onRetry 由调用方接实际的重新发送）。

import { RotateCcw } from 'lucide-react';

import { MESSAGE_RETRY_ARIA, MESSAGE_RETRY_LABEL, SEND_FAILED_COPY } from './copy';

export interface MessageRetryProps {
  readonly onRetry: () => void;
}

export function MessageRetry({ onRetry }: MessageRetryProps) {
  return (
    <span data-testid="message-retry" className="flex flex-col items-start gap-xs">
      <button
        type="button"
        aria-label={MESSAGE_RETRY_ARIA}
        onClick={onRetry}
        className="flex min-h-touch min-w-touch items-center gap-xs text-label text-text-primary"
      >
        <RotateCcw aria-hidden="true" className="size-4 text-destructive" />
        {/* 13px 可见文字 —— icon-only 是被 UI-SPEC 明文禁止的形态。 */}
        <span className="text-label">{MESSAGE_RETRY_LABEL}</span>
      </button>
      <p className="text-label text-destructive">{SEND_FAILED_COPY}</p>
    </span>
  );
}
