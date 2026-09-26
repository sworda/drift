// 聊天界面（CHAT-03/04/07 · COMPLY-01/03/05）。
//
// 本 plan 只建路由与顶部 AI 常驻条的位置；消息流、气泡与投递在 Plan 04 的 tracer 接入。

/**
 * AI 常驻条的文案。〔法定 · COMPLY-01〕
 *
 * 它是一个**常量**：不由服务端下发、不可被人格 / 角色配置 / 用户设置改写。
 * 这比「只渲染服务端下发的文案」更强 —— 下发字段可以被置空或被配置改写，常量不能。
 * 服务端只回答「对手方是不是 AI」（conversation.counterpart_kind），不回答「标识说什么」。
 *
 * Plan 04 把这个常量搬到 `@drift/contract`（跨端唯一真相源），届时本地定义删除。
 * 在那之前它留在这里而不是留空 —— 一个空的常驻条是一次未履行的法定告知。
 */
const AI_DISCLOSURE_BANNER = '你正在与 AI 角色互动，内容由 AI 生成';

export default async function ChatPage({
  params,
}: {
  readonly params: Promise<{ readonly conversationId: string }>;
}) {
  const { conversationId } = await params;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
      {/*
        AI 常驻条〔法定〕—— 高度固定 32px（--size-ai-bar），sticky top-0。
        **不可关闭、不可折叠、不随滚动消失**：没有 dismiss 按钮、没有 onClick、
        没有任何折叠状态。面色与底部 1px 描边都取 AI-label 的独立 token，
        不是 Border —— 没有描边时条的下沿对页面底只有 1.15:1，几乎不可见。
      */}
      <div
        role="note"
        className="sticky top-0 z-10 flex h-ai-bar shrink-0 items-center justify-center border-b border-ai-label-border bg-ai-label-surface px-md text-label text-ai-label-text"
      >
        {AI_DISCLOSURE_BANNER}
      </div>

      <main className="flex-1 px-md py-md">
        <p className="text-body text-text-secondary">
          会话 {conversationId} 的消息流将在此渲染。
        </p>
      </main>
    </div>
  );
}
