// 未读数徽章（CHAT-05）—— accent 闭合清单的第 3 项，会话列表里**唯一**吃 accent 的
// 元素（## 视觉锚点契约 会话列表行）。
//
// zero-one-many（UI-SPEC E3）：0 不渲染、1–99 显示数字、≥100 显示 99+。徽章宽度
// 自适应但行高固定 72px 不变 —— 「未读数位置不跳动」的前提是行高先不动。

export interface UnreadBadgeProps {
  readonly count: number;
}

export function UnreadBadge({ count }: UnreadBadgeProps) {
  if (count <= 0) return null;
  const label = count >= 100 ? '99+' : String(count);
  return (
    <span
      data-testid="unread-badge"
      aria-label={`${label} 条未读消息`}
      className="flex min-w-[22px] shrink-0 items-center justify-center rounded-full bg-primary px-xs text-label font-semibold leading-[18px] text-primary-foreground"
    >
      {label}
    </span>
  );
}
