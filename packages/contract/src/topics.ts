// 事件总线的 topic 命名空间 —— IFC-08 的第三项预留（D-26，ARCHITECTURE §17.6）。
//
// ⚠️ **派生，不是抄。** 下面这一行从 ws.ts 的 discriminated union 里取出全部 type
// 字面量。手写第二份字符串列表会分叉，而分叉的表现是「某个事件在总线上有、在 WS
// 下行里没有」（或反过来）—— 一个不会有任何报错、只会让某类通知悄悄不到达的故障。
//
// 之所以在 Phase 1 就预留：IFC-08 的不可后补性来自「事后无法为历史消息补溯源」，
// 而 topic 命名空间与 message.provenance / message.audience 一样，是会被后续阶段
// 的每一条事件引用的约定 —— 先定下来的成本是这一个文件。

import { WsDownstream } from './ws.ts';

/**
 * 事件总线 topic 全集 = WS 下行事件 type 全集。
 *
 * 顺序与 ws.ts 里 union 成员的书写顺序一致（不排序）—— 排序会让 diff 在新增事件时
 * 变得难读，而这份常量的消费方都是按名字查的。
 */
export const WS_TOPICS = Object.freeze(
  WsDownstream.options.map((option) => option.shape.type.value),
) as readonly WsDownstream['type'][];

export type WsTopic = (typeof WS_TOPICS)[number];

/** 某个字符串是不是一个合法 topic。总线在 publish 前用它做一次运行时收窄。 */
export function isWsTopic(value: string): value is WsTopic {
  return (WS_TOPICS as readonly string[]).includes(value);
}
