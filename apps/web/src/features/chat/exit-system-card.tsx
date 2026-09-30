'use client';

// 硬退出的中性系统卡片与禁用输入框（COMPLY-05 / UI-SPEC ## 硬退出呈现契约）。
//
// ── neutral 色，不用 care 色 ───────────────────────────────────────────────
// 退出不是危机。care（暖琥珀）只属于两级危机干预卡片与情感边界引导 —— 用它
// 渲染一次正常的离开，等于把「你离开了」说成「你有风险」。本组件只用 Alert 的
// default 变体（bg-card / border-border），不引用 care 调色板的任何 token。
//
// ── 不计入出站消息 ─────────────────────────────────────────────────────────
// 系统卡片是平台的退出确认（UI-SPEC 明文），由服务端 executeHardExit 落库为
// sender_kind = 'system' 的消息行；本组件只负责渲染那条消息。COMPLY-05 的
// 「不再产生任何出站消息」指角色消息与推送。
//
// ── 禁止的 UI（UI-SPEC 明文，逐条落实）────────────────────────────────────
// 任何「确定要离开吗」二次确认、任何「再聊一会」按钮、任何挽留/愧疚文案。
// 本文件不含任何按钮 —— 交互只剩「随时可以回来」（重新开一个会话）。

import { Alert, AlertDescription } from '@/components/ui/alert';

import { EXIT_INPUT_PLACEHOLDER } from './copy';

/** 系统卡片：渲染服务端插入的 sender_kind = 'system' 消息行（text 由 DB 来）。 */
export function ExitSystemCard({ text }: { readonly text: string }) {
  return (
    <Alert variant="default" data-testid="exit-system-card">
      {/* 中性正文（EXIT_SYSTEM_CARD_COPY 由服务端写入消息行，这里不重复定义）。 */}
      <AlertDescription className="text-body">{text}</AlertDescription>
    </Alert>
  );
}

/**
 * 会话结束后的输入框：禁用态 + 占位符「本次会话已结束」。
 *
 * 占位符是 UI-SPEC 的法定契约文案 —— 从 copy.ts 读，不内联。
 */
export function EndedComposer() {
  return (
    <div className="border-t border-border px-md py-sm">
      <input
        type="text"
        disabled
        placeholder={EXIT_INPUT_PLACEHOLDER}
        aria-label={EXIT_INPUT_PLACEHOLDER}
        data-testid="ended-composer"
        className="h-11 w-full rounded-lg border border-input bg-muted px-3 text-body text-text-secondary placeholder:text-text-secondary disabled:cursor-not-allowed"
      />
    </div>
  );
}
