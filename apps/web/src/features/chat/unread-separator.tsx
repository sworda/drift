// 「以下是你离开后的消息」分割线（CHAT-06 / UI-SPEC ## 交互契约 未读行）。
//
// ⚠️ 该分割线在**本次会话内持续可见**：进入会话时定位一次并固定，之后用户把未读
// 全部读完（POST /read 已把 unread 清零）它也不消失 —— 「你离开过」这个事实属于
// 这一次浏览，不属于服务端的已读状态。固定由父层（chat-client 只在首载把
// firstUnreadSeq 写进 state）保证，本组件无状态。

import { Separator } from '@/components/ui/separator';

import { UNREAD_SEPARATOR_COPY } from './copy';

export function UnreadSeparator() {
  return (
    <div
      data-testid="unread-separator"
      role="separator"
      aria-label={UNREAD_SEPARATOR_COPY}
      className="flex items-center gap-sm px-md py-sm"
    >
      <Separator className="flex-1" />
      <span className="shrink-0 text-label text-text-secondary">{UNREAD_SEPARATOR_COPY}</span>
      <Separator className="flex-1" />
    </div>
  );
}
