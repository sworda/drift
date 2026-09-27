'use client';

// 聊天消息流（CHAT-03 / CHAT-07 · COMPLY-01）。
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
// ── 为什么不用 shadcn 的 message-scroller ───────────────────────────────────
// 它会引入一个新的外部依赖（@shadcn/react），而它唯一难以自己实现的能力是虚拟
// 滚动 —— UI-SPEC 明确 v1 不做虚拟滚动。剩下的「新消息贴底」就是下面那个 useEffect。
// 聊天滚动行为恰好是 UI-SPEC 硬约束最密集的地方（补拉期间输入框可用、新消息进
//「发送中」态、拿到终态原地替换且不重排不改焦点），这几行自己拿着更稳。
//
// ⚠️ Phase 1 是**整段生成**（D-24），不存在任何增量下发路径。
// （这里刻意不把那两个 AI SDK 流式函数名原样写出来：
//  tools/ci/design-tokens.test.ts 对 packages/ 与 apps/ 做一次**字面**扫描并要求
//  命中数为 0，连注释里的引用都会让它变红 —— 那不是断言过于粗暴，而是它刻意如此。）
// 流式与 CHAT-07 和出站安全网关在结构上不相容：chunk 没有 seq，重连补拉拿不到
// 半条消息；逐 token 流出则绕过了出站安全网关。

import { useEffect, useRef } from 'react';

import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageContent, MessageFooter, MessageGroup } from '@/components/ui/message';

import { CareCard, type CareCardData } from '../crisis/care-card';

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
   * 危机关怀卡片（TurnResult.reply.escalated.careCard）。
   * 一级内联插在消息流里，二级 sticky 置顶阻断。undefined = 本会话当前没有
   * 未确认的危机态。
   */
  readonly crisisCard?: CareCardData;
  /** 一级卡片插在哪条消息之后（通常是触发危机的那条用户消息）。缺省 = 消息流末尾。 */
  readonly crisisAfterMessageId?: string;
}

export function ChatView({
  messages,
  typing = false,
  crisisCard,
  crisisAfterMessageId,
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 32px AI 常驻条由聊天页渲染（components/ai-banner.tsx，法定组件）—— 消息流
          组件不重复渲染它，否则一页出现两条。危机卡片与它的层级关系由页面结构保证：
          常驻条不随滚动消失、不可关闭（COMPLY-01），绕过类探针的「标识不被人格覆盖」
          断言在 crisis 契约测试里钉住。 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-md py-md">
        {stickyCard}
        {messages.length === 0 ? (
          // 空态：有文案与下一步，不是静默的空容器（UI-SPEC 不可协商项）。
          inlineCard === null ? (
            <p className="px-md py-lg text-body text-text-secondary">
              还没有消息。发一条打个招呼吧。
            </p>
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
              return (
                <div key={entry.messageId} className="contents">
                  <Message align={isUser ? 'end' : 'start'}>
                    <MessageContent>
                      <Bubble variant={isUser ? 'default' : 'secondary'} align={isUser ? 'end' : 'start'}>
                        {/* text-base 覆写上游默认的 14px。padding 保持默认的 12/8。 */}
                        <BubbleContent className="text-base">{entry.text}</BubbleContent>
                      </Bubble>
                      {/* 时间戳在气泡**外**。用户气泡（accent 填充）内不承载次级文本。 */}
                      <MessageFooter>
                        {entry.pending === true ? '发送中' : formatTime(entry.createdAt)}
                      </MessageFooter>
                    </MessageContent>
                  </Message>
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