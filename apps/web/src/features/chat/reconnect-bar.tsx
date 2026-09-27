// 断连补拉细条（CHAT-07 / UI-SPEC error E4 WebSocket 断连行）。
//
// ⚠️ 该细条位于 AI 常驻条**下方**（DOM 顺序在 AiBanner 之后渲染），不得遮挡它
// 〔法定〕—— 常驻条是 32px 法定告知，任何覆盖它的重连提示都是在用传输层状态
// 压制法定标识。补拉完成后细条消失（visible=false 即 unmount）。
//
// 补拉期间输入框保持可用 —— 本组件不参与禁用输入（禁用只发生在会话 ended）。

import { RECONNECTING_COPY } from './copy';

export interface ReconnectBarProps {
  readonly visible: boolean;
}

export function ReconnectBar({ visible }: ReconnectBarProps) {
  if (!visible) return null;
  return (
    <div
      data-testid="reconnect-bar"
      role="status"
      aria-live="polite"
      className="flex h-9 shrink-0 items-center justify-center gap-sm border-b border-border bg-character-bubble px-md text-label text-text-secondary"
    >
      {RECONNECTING_COPY}
    </div>
  );
}
