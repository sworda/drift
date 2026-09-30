// 聊天界面（CHAT-03/04/07 · COMPLY-01/03/05）。
//
// 页面只负责把 conversationId 交给客户端编排（features/chat/chat-client.tsx）——
// 消息流、常驻条、重连补拉、未读分割线、WS 事件到 Dialog/卡片的接线都在那里。
// ⚠️ 常驻条**无条件渲染**（chat-client 内）：它是法定告知，不能因为「还没登录 /
// 还没消息」而缺席。

import { ChatClient } from '@/features/chat/chat-client';

export default async function ChatPage({
  params,
}: {
  readonly params: Promise<{ readonly conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <ChatClient conversationId={conversationId} />;
}
