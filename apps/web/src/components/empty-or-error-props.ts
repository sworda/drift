// EmptyOrError 的 props 类型 —— 独立的纯 .ts 模块（无任何 import）。
//
// 这样拆是为了让 tools/ci/type-fixtures 的负向 fixture 能直接 import 本类型：
// type-fixtures 的 tsconfig 不含 apps/web 的 @/ paths，也不能解析 .tsx 的 JSX。
// （同目录下的 empty-or-error.tsx 是组件本体 —— 两个文件名不能只差扩展名，
// 模块解析会有歧义。）
//
// 可判别联合是这条契约的全部：`kind: 'error'` 强制携带 action（重试），
// `kind: 'empty'` 强制携带 heading 与 body —— 「把加载失败静默渲染成空列表」
//（UI-SPEC 不可协商项）在类型层就无法表达：没有 action 的 error 是编译错误。

export interface EmptyOrErrorAction {
  readonly label: string;
  readonly onRetry: () => void;
}

export interface EmptyOrErrorCta {
  readonly label: string;
  readonly href: string;
}

/** 公共字段：调用方既有断言用的 testId（四处接入点各带各自的 id）。 */
export interface EmptyOrErrorTestId {
  readonly testId?: string | undefined;
}

export type EmptyOrErrorProps =
  | {
      readonly kind: 'empty';
      readonly heading: string;
      readonly body: string;
      readonly cta?: EmptyOrErrorCta | undefined;
    } & EmptyOrErrorTestId
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly action: EmptyOrErrorAction;
    } & EmptyOrErrorTestId;
