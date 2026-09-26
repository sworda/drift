// AI 明示标识 —— 聊天界面 32px 常驻条〔法定 · COMPLY-01〕。
//
// 不可协商项（UI-SPEC 逐条标〔法定〕）：
//   - 高度固定 32px（h-ai-bar → --size-ai-bar）。不得因「太占地方」压低。
//   - sticky top-0：随页面滚动始终可见。
//   - **不可关闭、不可折叠、不随滚动消失** —— 没有 dismiss 按钮、没有 onClick、
//     没有折叠状态、没有 aria-hidden / hidden / tabIndex。
//   - 文案是常量，不由服务端下发（见 @drift/contract/disclosure.ts 的说明）。
//   - 底部 1px 描边取 AI-label 的独立 token：没有描边时条的下沿对页面底只有
//     1.15:1，几乎不可见。
//
// ⚠️ props 里同样**没有 text / children / 任何显隐开关**。显隐由调用方「是不是 AI
// 会话」决定（conversation.counterpart_kind），而 Phase 1 只有 AI 会话，所以聊天页
// 无条件渲染它 —— 一个带条件的常驻条迟早会有一条为假的分支。

import { AI_BANNER_TEXT } from '@drift/contract';

export interface AiBannerProps {
  readonly 'data-testid'?: string;
}

export function AiBanner(props: AiBannerProps) {
  return (
    <div
      role="note"
      data-slot="ai-banner"
      data-testid={props['data-testid'] ?? 'ai-banner-chat'}
      className="sticky top-0 z-10 flex h-ai-bar shrink-0 items-center justify-center border-b border-ai-label-border bg-ai-label-surface px-md text-label text-ai-label-text"
    >
      {AI_BANNER_TEXT}
    </div>
  );
}
