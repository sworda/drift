// 负向 type fixture（Plan 14 Task 2）—— EmptyOrError 的可判别联合不可绕过。
//
// 试图不传 action 渲染 error、不传 heading 渲染 empty，都必须是编译错误。
// 如果它竟然编译通过，说明「空态与错误态必须可区分」已退化成一条靠人记的约定
//（T-14-06）—— 而那正是 UI-SPEC 点名的失效模式：加载失败被静默渲染成空列表。
import type { EmptyOrErrorProps } from '../../../apps/web/src/components/empty-or-error-props.ts';

declare function render(props: EmptyOrErrorProps): void;

// 违反 1：error 分支缺 action —— 一次没有「下一步」的错误态。
render({ kind: 'error', message: '没能加载出来' });

// 违反 2：empty 分支缺 heading —— 只有一段正文的「空态」与消息正文不可区分。
render({ kind: 'empty', body: '还没有任何对话' });

// 违反 3：kind 混写不存在 —— empty 的 body 不能替代 error 的 message。
render({ kind: 'error', message: '没能加载出来', action: { label: '重试' } });

// 违反 4：action 的 onRetry 不可省 —— error 必须带一次可执行的下一步。
render({ kind: 'error', message: '没能加载出来', action: { label: '重试', onRetry: null } });

// 对照（应当通过）：合法的两种形态。
render({ kind: 'empty', heading: '还没有任何对话', body: '去角色库挑一个。' });
render({ kind: 'error', message: '没能加载出来', action: { label: '重试', onRetry: () => undefined } });
