// 会话列表（CHAT-05 / CHAT-06 / COMPLY-01）。AI 明示标识的四处落点之一〔法定〕：
// 每行标题后紧跟「AI」徽标，标题 truncate、徽标 shrink-0 —— 徽标不得因标题过长
// 被挤出或省略。真实数据与徽标渲染在 Plan 04 接入（显隐由会话级
// conversation.counterpart_kind 驱动，文案是常量、不由服务端下发）。

export default function ConversationsPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px]">
      <h1 className="px-md py-lg text-heading font-semibold text-text-primary">消息</h1>
      <p className="px-md text-body text-text-secondary">
        还没有会话。从角色库添加一个角色为好友后，会话会出现在这里。
      </p>
    </main>
  );
}
