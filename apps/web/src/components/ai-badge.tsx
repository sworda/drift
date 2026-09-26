// AI 明示标识 —— 行内徽标〔法定 · COMPLY-01/02〕。
//
// ⚠️ **props 里没有 text，也没有 children。** 这不是接口洁癖，而是这个组件的全部
// 意义所在：文案只能来自 @drift/contract 的 AI_BADGE_TEXT，任何「这里换个说法」的
// 尝试都是一次编译错误，而不是一次 code review 里可能被放过的改动。
//
// ⚠️ 三色取 AI-label 的**独立 token**（--ai-label-*），不引用 Border / Neutral。
// 引用通用 token 的那一刻，调一次描边颜色就会静默改掉一个法定标识的对比度，
// 而不会有任何检查变红（tools/ci/design-tokens.test.ts 盯着这件事）。
//
// ⚠️ shrink-0：徽标不得因标题过长被挤出或省略（UI-SPEC〔法定〕）。
// 配套要求是同一行的标题必须 truncate —— 见 character-list.tsx / 会话列表。

import { AI_BADGE_TEXT } from '@drift/contract';

/**
 * props 刻意只有 className 与 data-testid。
 * 没有 text、没有 children、没有任何显隐开关 —— 「以人格或用户设置为条件隐藏标识」
 * 在类型层就无法表达。
 */
export interface AiBadgeProps {
  readonly className?: string;
  /** 四处覆盖断言按它查找（DISCLOSURE_SURFACES 的 testId）。 */
  readonly 'data-testid'?: string;
}

export function AiBadge({ className, ...rest }: AiBadgeProps) {
  return (
    <span
      data-slot="ai-badge"
      {...rest}
      className={[
        'inline-flex shrink-0 items-center rounded border px-xs',
        'border-ai-label-border bg-ai-label-surface text-label text-ai-label-text',
        className ?? '',
      ]
        .filter((part) => part.length > 0)
        .join(' ')}
    >
      {AI_BADGE_TEXT}
    </span>
  );
}
