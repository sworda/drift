// 五项同意的选择状态 —— **纯函数**，不依赖 React、不依赖 DOM。
//
// ── 为什么把状态提成一个纯模块（对 PLAN 的偏离，方向是加强）─────────────────
// PLAN 写的是「五个 Checkbox 各自绑定独立 state」。那样做能让「点一项其余四项不变」
// 为真，但**只能靠肉眼确认**：没有任何断言能在有人后来把两个 setState 写到同一个
// onChange 里时变红。提成纯函数之后，那条性质变成一条可以**穷举**证明的断言
// （5 个 scope × 2 个目标值，每次只有一个键变化 —— 见 consent-state.test.ts），
// 而且不需要 DOM。
//
// ⚠️ 这里**没有**也不会有任何能一次改多项的导出：没有 setAll / toggleAll /
// selectAll，也没有接受多个 scope 的签名。捆绑同意在这一层就不可表达
// （个保法第十四条）。`setScope` 的签名只吃**一个** scope —— 这是结构性的，
// 不是约定。

import { CONSENT_SCOPES, type ConsentScope, REQUIRED_SCOPES } from '@drift/contract';

export type ConsentSelection = Readonly<Record<ConsentScope, boolean>>;

/**
 * 初始状态：**五项全部未勾**，包括两项必选。
 *
 * 必选项也不预勾：预勾的复选框不是同意，是默认（个保法第十四条要求「自愿、明确」）。
 * 代价是用户必须亲手点两下，而那正是这条要求的全部内容。
 */
export const INITIAL_CONSENT_SELECTION: ConsentSelection = Object.freeze(
  Object.fromEntries(CONSENT_SCOPES.map((scope) => [scope, false])) as Record<
    ConsentScope,
    boolean
  >,
);

/** 改**一个** scope 的值，返回新对象。其余 scope 逐键原样带过。 */
export function setScope(
  selection: ConsentSelection,
  scope: ConsentScope,
  value: boolean,
): ConsentSelection {
  return Object.freeze({ ...selection, [scope]: value });
}

/** 两项必选是否都已勾选。主 CTA 的禁用判据（不是提交后报错）。 */
export function requiredSatisfied(selection: ConsentSelection): boolean {
  return REQUIRED_SCOPES.every((scope) => selection[scope]);
}

/**
 * 尚未勾选的必选项，按 CONSENT_SCOPES 的顺序返回。
 *
 * 主 CTA 的禁用是契约强制的，屏幕就必须说得出「还差哪几项」—— 这个函数是那行说明的
 * 唯一数据来源（label 由调用方从 CONSENT_SCOPE_SPECS 取，不在这里硬编码）。
 */
export function missingRequiredScopes(selection: ConsentSelection): readonly ConsentScope[] {
  return REQUIRED_SCOPES.filter((scope) => !selection[scope]);
}

/** 提交给服务端的形态。缺项视为未授权，因此原样传五项。 */
export function toRequestPayload(selection: ConsentSelection): Record<ConsentScope, boolean> {
  return { ...selection };
}
