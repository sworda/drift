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
// ── 为什么不用 shadcn 的 message-scroller ───────────────────────────────────
// 它会引入一个新的外部依赖（@shadcn/react），而它唯一难以自己实现的能力是虚拟
// 滚动 —— UI-SPEC 明确 v1 不做虚拟滚动。剩下的「新消息贴底」就是下面那个 useEffect。
// 聊天滚动行为恰好是 UI-SPEC 硬约束最密集的地方（补拉期间输入框可用、新消息进
// 「发送中」态、拿到终态原地替换且不重排不改焦点），这几行自己拿着更稳。
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
}

export function ChatView({ messages, typing = false }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // 贴底。behavior: 'auto' 而不是 'smooth' —— 平滑滚动会与「拿到终态原地替换、
    // 不滚动」这条约束打架（替换触发一次重渲染，smooth 会让列表明显动一下）。
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [messages.length, typing]);

  if (messages.length === 0) {
    // 空态：有文案与下一步，不是静默的空容器（UI-SPEC 不可协商项）。
    return (
      <p className="px-md py-lg text-body text-text-secondary">
        还没有消息。发一条打个招呼吧。
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-md py-md">
      <MessageGroup>
        {messages.map((entry) => {
          const isUser = entry.senderKind === 'user';
          return (
            <Message key={entry.messageId} align={isUser ? 'end' : 'start'}>
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
          );
        })}
      </MessageGroup>

      {typing ? (
        <p aria-live="polite" className="px-md py-sm text-label text-text-secondary">
          对方正在输入…
        </p>
      ) : null}

      <div ref={bottomRef} />
    </div>
  );
}
