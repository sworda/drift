'use client';

// 输入栏（CHAT-03/04 / UI-SPEC E5）。
//
// ── 硬约束 ──────────────────────────────────────────────────────────────────
//   - 占位符「说点什么…」。
//   - 自增高至最多 5 行后**框内**滚动，不挤压消息流、不得把 AI 常驻条挤出首屏。
//   - 发送中不清空输入框直到服务端受理（E5：失败时内容仍在）。
//   - 发送按钮是 icon-only 控件：可访问名称「发送」；禁用态图标用 Neutral non-text
//     色（#94A3B8，不承载文字 —— 该色值在 tokens.css 明文禁止承载文字）。
//   - 插入表情由 EmojiPicker 提供（aria-label「插入表情」）。
//
// onSend 返回是否被服务端受理 —— true 才清空输入框（调用方在受理后追加消息流）。

import { useCallback, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { SendHorizonal } from 'lucide-react';

import { EmojiPicker } from './emoji-picker';
import { COMPOSER_PLACEHOLDER, SEND_LABEL } from './copy';

/** 最多 5 行（16px 正文 × 1.5 行高 ≈ 120px + 上下 padding）。 */
const MAX_ROWS = 5;
const LINE_HEIGHT_PX = 24;
const INPUT_PX = 20;

export interface ComposerProps {
  readonly onSend: (text: string) => Promise<boolean>;
  /** 发送中（服务端未受理前）：输入保留、按钮禁用。 */
  readonly pending?: boolean | undefined;
  readonly disabled?: boolean | undefined;
}

export function Composer({ onSend, pending = false, disabled = false }: ComposerProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const autosize = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.style.height = 'auto';
    // 框内滚动：高度封顶在 5 行，超出部分 overflow-y: auto（className 已带）。
    const maxHeight = LINE_HEIGHT_PX * MAX_ROWS + INPUT_PX;
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, maxHeight))}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || pending || disabled) return;
    const accepted = await onSend(trimmed);
    // 受理才清空（E5）；失败时内容仍在，可直接重试。
    if (accepted) setText('');
    autosize();
  }, [autosize, disabled, onSend, pending, text]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter 发送、Shift+Enter 换行（移动端虚拟键盘同一条约定）。
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void submit();
      }
    },
    [submit],
  );

  const onPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    // 纯文本粘贴 —— v1 没有任何富文本通道（也杜绝粘贴 HTML 进输入态）。
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  }, []);

  const canSend = text.trim().length > 0 && !pending && !disabled;

  return (
    <div className="flex shrink-0 items-end gap-xs border-t border-border bg-card px-sm py-sm">
      <EmojiPicker
        disabled={disabled}
        onPick={(emoji) => {
          setText((current) => `${current}${emoji}`);
          textareaRef.current?.focus();
        }}
      />
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          autosize();
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={COMPOSER_PLACEHOLDER}
        aria-label={COMPOSER_PLACEHOLDER}
        data-testid="composer-input"
        rows={1}
        disabled={disabled}
        className="max-h-[140px] min-h-touch flex-1 resize-none overflow-y-auto rounded-lg border border-input bg-background px-3 py-sm text-base text-text-primary placeholder:text-text-placeholder focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed"
      />
      {/* icon-only 发送控件：可访问名称「发送」，禁用态 Neutral non-text 图标色。 */}
      <button
        type="button"
        aria-label={SEND_LABEL}
        data-testid="composer-send"
        onClick={() => void submit()}
        disabled={!canSend}
        className={
          'flex size-touch shrink-0 items-center justify-center rounded-lg ' +
          (canSend
            ? 'bg-primary text-primary-foreground'
            : 'text-neutral-nontext')
        }
      >
        <SendHorizonal aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}
