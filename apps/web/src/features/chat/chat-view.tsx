'use client';

// 聊天消息流（CHAT-03 / CHAT-06 / CHAT-07 · COMPLY-01）。
//
// ── UI-SPEC 的不可协商项（逐条对应）──────────────────────────────────────────
//   - `BubbleContent` 的上游默认字号是 14px → **必须覆写为 text-base**（16px），
//     padding 保持 12px/8px。理由不是审美：主流 IM 的正文都在 16-17px，字号偏小会
//     让界面一眼「像后台系统」，而这与「类微信」的第一性目标直接冲突。
//   - 用户气泡 `variant="default"`（accent 填充，这是 accent 4 项闭合清单之一），
//     角色气泡 `variant="secondary"`。
//   - **时间戳在气泡外**的 `message` 行布局里（MessageFooter）。用户气泡内
//     不承载任何次级文本。
//   - 常驻条与徽标的文案从 @drift/contract 的常量读，**不从 API 读**。
//
// ── 三种消息形态视觉不可混淆（R1.24 / Plan 08）─────────────────────────────
//   用户气泡（accent、右对齐、80% 宽）/ 角色气泡（secondary、左对齐）/ 关怀卡片
//（全宽、Alert 基座、无气泡形态）。一级关怀卡片内联插在消息流里触发它的那条用户
//   消息之后；二级关怀卡片挂 sticky 层置顶阻断。
//
// ── 三种非常规消息行（Plan 14）──────────────────────────────────────────────
//   - system 行（硬退出的中性系统卡片）：ExitSystemCard（Alert 基座、neutral、
//     不吃 care），不进气泡原语（R1.24 同一条理由）。
//   - 未读分割线（CHAT-06）：首条未读前插入，父层定位一次后不消失。
//   - 加载失败态：错误文案 + 重试 —— 不得静默渲染成空消息流（与空列表同一条禁令）。
//
// ── 为什么不用 shadcn 的 message-scroller ───────────────────────────────────
// 它会引入一个新的外部依赖（@shadcn/react），而它唯一难以自己实现的能力是虚拟
// 滚动 —— UI-SPEC 明确 v1 不做虚拟滚动。剩下的「新消息贴底」就是下面那个 useEffect。
//
// ⚠️ Phase 1 是**整段生成**（D-24），不存在任何增量下发路径。
// 流式与 CHAT-07 和出站安全网关在结构上不相容：chunk 没有 seq，重连补拉拿不到
// 半条消息；逐 token 流出则绕过了出站安全网关。

import { useEffect, useRef } from 'react';

import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageContent, MessageFooter, MessageGroup } from '@/components/ui/message';

import { CareCard, type CareCardData } from '../crisis/care-card';
import { ExitSystemCard } from './exit-system-card';
import { LIST_LOAD_ERROR_COPY } from './copy';
import { MessageRetry } from './message-retry';
import { UnreadSeparator } from './unread-separator';

export interface ChatMessage {
  readonly messageId: string;
  readonly seq: number;
  readonly senderKind: 'user' | 'character' | 'system';
  readonly text: string;
  /** 角色消息恒非空（DB CHECK 保证）。气泡流不消费它 —— 逐条脚注 UI-SPEC 明确不做。 */
  readonly disclosure: { readonly kind: 'ai_generated' } | null;
  readonly createdAt: string;
  /** 乐观发送中的本地消息。终态到达时**原地替换**，不重排、不滚动、不改焦点。 */
  readonly pending?: boolean;
  /** 发送失败（网络断开/服务端未受理）：渲染重试控件，点击气泡或控件均可重试。 */
  readonly failed?: boolean;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export interface ChatViewProps {
  readonly messages: readonly ChatMessage[];
  /** 服务端正在生成。整段生成 ⇒ 这段时长天然等于实际生成时间（REAL-03）。 */
  readonly typing?: boolean;
  /**
   * 危机关怀卡片（TurnResult.reply.escalated.careCard / WS safety.care_card）。
   * 一级内联插在消息流里，二级 sticky 置顶阻断。undefined = 本会话当前没有
   * 未确认的危机态。
   */
  readonly crisisCard?: CareCardData | undefined;
  /** 一级卡片插在哪条消息之后（通常是触发危机的那条用户消息）。缺省 = 消息流末尾。 */
  readonly crisisAfterMessageId?: string | undefined;
  /** 首条未读的 seq（CHAT-06 分割线定位）。null = 无未读，不渲染分割线。 */
  readonly firstUnreadSeq?: number | null | undefined;
  /** 聊天空态标题/正文（UI-SPEC ## Copywriting Contract 聊天空态行）。 */
  readonly emptyHeading?: string | undefined;
  readonly emptyBody?: string | undefined;
  /** 首载失败（与空消息流必须可区分 —— 不得静默渲染成「还没有开始」）。 */
  readonly loadFailed?: boolean | undefined;
  readonly onRetryLoad?: (() => void) | undefined;
  /** 重试一条发送失败的消息（CHAT-03：点击气泡或重试控件均可）。 */
  readonly onRetryMessage?: ((message: ChatMessage) => void) | undefined;
}

export function ChatView({
  messages,
  typing = false,
  crisisCard,
  crisisAfterMessageId,
  firstUnreadSeq,
  emptyHeading,
  emptyBody,
  loadFailed = false,
  onRetryLoad,
  onRetryMessage,
}: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // 贴底。behavior: 'auto' 而不是 'smooth' —— 平滑滚动会与「拿到终态原地替换、
    // 不滚动」这条约束打架（替换触发一次重渲染，smooth 会让列表明显动一下）。
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [messages.length, typing]);

  // 二级关怀卡片挂 sticky 层：置顶阻断，直到用户点击唯一确认按钮。
  const stickyCard =
    crisisCard !== undefined && crisisCard.level === 'level2' ? (
      <CareCard card={crisisCard} />
    ) : null;

  // 一级卡片内联：插在触发消息之后（缺省末尾）。它没有移除交互，可向下滚动越过。
  const inlineCard =
    crisisCard !== undefined && crisisCard.level === 'level1' ? (
      <CareCard card={crisisCard} />
    ) : null;

  // 分割线渲染在首条 seq >= firstUnreadSeq 的消息之前（CHAT-06）。
  const unreadSeq = firstUnreadSeq ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 32px AI 常驻条由聊天页渲染（components/ai-banner.tsx，法定组件）—— 消息流
          组件不重复渲染它，否则一页出现两条。危机卡片与它的层级关系由页面结构保证：
          常驻条不随滚动消失、不可关闭（COMPLY-01），绕过类探针的「标识不被人格覆盖」
          断言在 crisis 契约测试里钉住。 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-md py-md">
        {stickyCard}
        {messages.length === 0 ? (
          loadFailed ? (
            // 错误态 ≠ 空态：文案含下一步（重试），不静默渲染成「还没有开始」。
            <div role="alert" className="flex flex-col items-start gap-sm px-md py-lg">
              <p className="text-body text-destructive">{LIST_LOAD_ERROR_COPY}</p>
              {onRetryLoad !== undefined ? (
                <button
                  type="button"
                  onClick={onRetryLoad}
                  className="text-body text-primary underline underline-offset-4"
                >
                  重试
                </button>
              ) : null}
            </div>
          ) : inlineCard === null ? (
            // 空态：有文案与下一步，不是静默的空容器（UI-SPEC 不可协商项）。
            <div className="px-md py-lg">
              <p className="text-body font-semibold text-text-primary">{emptyHeading}</p>
              <p className="mt-xs text-body text-text-secondary">{emptyBody}</p>
            </div>
          ) : (
            inlineCard
          )
        ) : (
          <MessageGroup>
            {messages.map((entry, index) => {
              const isUser = entry.senderKind === 'user';
              const insertCardAfter =
                inlineCard !== null &&
                (crisisAfterMessageId === undefined
                  ? index === messages.length - 1
                  : entry.messageId === crisisAfterMessageId);
              const previous = index > 0 ? messages[index - 1] : undefined;
              const separatorBefore =
                unreadSeq !== null &&
                entry.seq >= unreadSeq &&
                (previous === undefined || previous.seq < unreadSeq);
              return (
                <div key={entry.messageId} className="contents">
                  {separatorBefore ? <UnreadSeparator /> : null}
                  {entry.senderKind === 'system' ? (
                    // 硬退出的中性系统卡片：Alert 基座、neutral、无任何按钮。
                    <ExitSystemCard text={entry.text} />
                  ) : (
                    <Message align={isUser ? 'end' : 'start'}>
                      <MessageContent>
                        {/* 发送失败：气泡左侧重试控件（图标 + 13px 文字，CHAT-03）；点击
                            气泡或该控件均可重试（UI-SPEC error E4）。 */}
                        {entry.failed === true && onRetryMessage !== undefined ? (
                          <MessageRetry onRetry={() => onRetryMessage(entry)} />
                        ) : null}
                        <Bubble
                          variant={isUser ? 'default' : 'secondary'}
                          align={isUser ? 'end' : 'start'}
                          className={entry.failed === true ? 'cursor-pointer' : undefined}
                          onClick={
                            entry.failed === true && onRetryMessage !== undefined
                              ? () => onRetryMessage(entry)
                              : undefined
                          }
                        >
                          {/* text-base 覆写上游默认的 14px。padding 保持默认的 12/8。
                              ⚠️ 这里**不得**再挂 max-w-*：气泡的宽度上限（80%）由上游
                              Bubble 承担，而 Bubble 是 w-fit —— 气泡宽由内容决定。内容盒
                              再取「气泡的百分比」，就与「气泡宽 = 内容宽」互相引用，形成
                              循环百分比；引擎只能把整条气泡压窄，长消息被 break-words 从
                              词中间切断（E4 backstop 的真实失败形态）。内容盒保持上游的
                              max-w-full（撑满气泡）才是这个原语的分工。 */}
                          <BubbleContent className="text-base break-words whitespace-normal">
                            {entry.text}
                          </BubbleContent>
                        </Bubble>
                        {/* 时间戳在气泡**外**。用户气泡（accent 填充）内不承载次级文本。 */}
                        <MessageFooter>
                          {entry.pending === true
                            ? '发送中'
                            : entry.failed === true
                              ? '没有发出去'
                              : formatTime(entry.createdAt)}
                        </MessageFooter>
                      </MessageContent>
                    </Message>
                  )}
                  {insertCardAfter ? inlineCard : null}
                </div>
              );
            })}
          </MessageGroup>
        )}

        {typing ? (
          <p aria-live="polite" className="px-md py-sm text-label text-text-secondary">
            对方正在输入…
          </p>
        ) : null}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
