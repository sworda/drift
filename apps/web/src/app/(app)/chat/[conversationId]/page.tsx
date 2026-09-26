// 聊天界面（CHAT-03/04/07 · COMPLY-01/03/05）。
//
// 常驻条与消息流分别由 AiBanner 与 ChatView 承担 —— 文案与 32px/sticky 的硬约束
// 都收在 components/ai-banner.tsx 一处（全仓唯一定义）。
//
// 会话凭证还没有前端载体（登录 UI 属 Plan 09），所以消息流在未登录时渲染空态。
// ⚠️ 但**常驻条无条件渲染** —— 它是法定告知，不能因为「还没登录 / 还没消息」
// 而缺席。一个只在有消息时才出现的标识等于一次未履行的告知。

import { AiBanner } from '@/components/ai-banner';
import { ChatView, type ChatMessage } from '@/features/chat/chat-view';

const API_ORIGIN = process.env['NEXT_PUBLIC_API_ORIGIN'] ?? 'http://127.0.0.1:3001';

async function loadMessages(conversationId: string): Promise<readonly ChatMessage[]> {
  try {
    const response = await fetch(
      `${API_ORIGIN}/conversations/${conversationId}/messages?after_seq=0`,
      { cache: 'no-store' },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { messages: ChatMessage[] };
    return body.messages;
  } catch {
    return [];
  }
}

export default async function ChatPage({
  params,
}: {
  readonly params: Promise<{ readonly conversationId: string }>;
}) {
  const { conversationId } = await params;
  const messages = await loadMessages(conversationId);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
      <AiBanner />
      <ChatView messages={messages} />
    </div>
  );
}
