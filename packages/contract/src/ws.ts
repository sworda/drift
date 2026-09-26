// WebSocket envelope（CHAT-07 / IFC-08 第三项）。
//
// 裸 ws + 自定义 JSON envelope，用 zod 定义在这里 —— 任何平台十行可实现，这是
// PROJECT.md「API 优先、为 App 预留」的直接兑现。明确不用 socket.io（私有协议，
// 未来 Swift/Kotlin 客户端要引它的客户端；其核心价值多进程 adapter 与传输降级
// v1 都不需要）。
//
// ⚠️ **下行事件的 discriminated union 是唯一的一份定义。** topics.ts 从它派生事件
// 总线的 topic 命名空间（IFC-08 第三项，ARCHITECTURE §17.6），而不是手写第二份
// 字符串列表 —— 两份列表一定会分叉，而分叉的表现是「某个事件在总线上有、在 WS 上
// 没有」，没有任何断言会发现它。

import { z } from 'zod';

/** 单帧上限 64 KiB（apps/api/src/ws/server.ts 的 maxPayload）；文本上限另设。 */
export const MESSAGE_TEXT_MAX = 2_000;

// ── 上行 ────────────────────────────────────────────────────────────────────
//
// Phase 1 的上行只有两件事：心跳与重连补拉的游标声明。**发消息走 HTTP**
// （POST /conversations/:id/messages）而不是 WS —— 落库取 seq 必须在一个可返回
// 错误码的请求里完成，而 WS 帧没有天然的响应通道。

export const WsUpstream = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({
    type: z.literal('resume'),
    /** 客户端已持有的最大 seq。服务端据此判断是否需要提示补拉。 */
    afterSeq: z.number().int().nonnegative(),
  }),
]);
export type WsUpstream = z.infer<typeof WsUpstream>;

// ── 下行 ────────────────────────────────────────────────────────────────────

export const DisclosureSchema = z.object({
  kind: z.literal('ai_generated'),
  labeledAt: z.iso.datetime(),
  labelerVersion: z.literal('disclosure-v1'),
});

export const WsMessagePayload = z.object({
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  /** per-conversation 单调。客户端用它去重与判断是否有空洞（CHAT-07）。 */
  seq: z.number().int().positive(),
  senderKind: z.enum(['user', 'character', 'system']),
  text: z.string().max(MESSAGE_TEXT_MAX),
  /** 角色消息恒非空（DB CHECK 保证）。用户消息为 null。 */
  disclosure: DisclosureSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export const WsDownstream = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message.created'), payload: WsMessagePayload }),
  z.object({
    type: z.literal('typing.start'),
    payload: z.object({ conversationId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('typing.stop'),
    payload: z.object({ conversationId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('conversation.ended'),
    payload: z.object({ conversationId: z.string().min(1), endedAt: z.iso.datetime() }),
  }),
  z.object({
    type: z.literal('usage.reminder'),
    payload: z.object({ accumulatedSeconds: z.number().int().nonnegative() }),
  }),
  z.object({
    type: z.literal('dependency.notice'),
    payload: z.object({ ruleId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('safety.care_card'),
    payload: z.object({
      conversationId: z.string().min(1),
      /** 一级 / 二级。UI 用 Alert 而非 Bubble 渲染（R1.24：组件层区分）。 */
      tier: z.union([z.literal(1), z.literal(2)]),
    }),
  }),
]);
export type WsDownstream = z.infer<typeof WsDownstream>;
export type WsDownstreamType = WsDownstream['type'];
