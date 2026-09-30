'use client';

// 空态与错误态的统一区分容器（UI-SPEC 不可协商项：两者必须可区分，不得把加载
// 失败静默渲染成空列表 —— 用户会以为自己没有数据，而实际是服务没响应）。
//
// 强制调用方传入 kind 与对应字段（类型在 ./empty-or-error-props.ts）：error 必带
// 「下一步做什么」的 action；empty 必带 heading 与 body。错误文案含下一步的要求
// 由调用方传入的文案承担（LIST_LOAD_ERROR_COPY 等常量），本组件只保证结构。
//
// ⚠️ 类型刻意住在隔壁的 -props.ts（纯 .ts、零 import）：负向 type fixture 的
// tsconfig 解析不了 @/ paths 与 JSX，类型单独成文件它才 import 得到。

import type { EmptyOrErrorProps } from './empty-or-error-props';

export function EmptyOrError(props: EmptyOrErrorProps) {
  if (props.kind === 'error') {
    return (
      <div
        role="alert"
        data-testid={props.testId ?? 'empty-or-error-error'}
        className="flex flex-col items-start gap-sm px-md py-lg"
      >
        <p className="text-body text-destructive">{props.message}</p>
        <button
          type="button"
          onClick={props.action.onRetry}
          className="text-body text-primary underline underline-offset-4"
        >
          {props.action.label}
        </button>
      </div>
    );
  }
  return (
    <div
      data-testid={props.testId ?? 'empty-or-error-empty'}
      className="flex flex-col items-start gap-sm px-md py-lg"
    >
      <p className="text-body font-semibold text-text-primary">{props.heading}</p>
      <p className="text-body text-text-secondary">{props.body}</p>
      {props.cta !== undefined ? (
        <a
          href={props.cta.href}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-md text-base text-primary-foreground"
        >
          {props.cta.label}
        </a>
      ) : null}
    </div>
  );
}
