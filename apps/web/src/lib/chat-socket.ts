'use client';

// 浏览器侧 WS 客户端（CHAT-07 / IFC-08 下行事件的唯一 UI 入口）。
//
// ⚠️ 本文件住在 lib/ 而不是 features/chat/ 是刻意的：eslint 对 apps/web/src/features/chat/**
// 禁止 setTimeout / setInterval（chat-timer-ban，COMPLY-03 的机械形式 —— 计时权威在
// 服务端）。那条禁令针对的是**使用时长计时与轮询**，而这里的 setTimeout 只做重连的
// 指数退避（传输层可靠性，与「数使用秒数」无关）。放 lib/ 让两者各守各的边界，
// 而不是给禁令开一个 features/chat 内的例外。
//
// ── v1 的补拉是原子的（PLAN 的 backstop 假设）───────────────────────────────
// 断线重连后按 after_seq 游标**一次性**拉全再整体替换（见 onReconnect 的消费方）。
// 不区分「已补齐区段」与「仍缺失区段」—— UI-SPEC 把它标为 unresolved，若将来改
// 流式补拉需回 UI-SPEC 补一行。

import { useEffect, useRef, useState } from 'react';

import { WsDownstream, type WsDownstream as WsDownstreamType } from '@drift/contract';

import { API_ORIGIN, readSessionToken } from './session';

/** ws(s) 基址，与 API_ORIGIN 同源（STACK §4：单条 WebSocket 承载全部实时语义）。 */
function wsOrigin(): string {
  return API_ORIGIN.replace(/^http/u, 'ws');
}

export interface ChatSocketHandlers {
  /** message.created（已通过 zod 校验的载荷）。 */
  readonly onMessage: (payload: Extract<WsDownstreamType, { type: 'message.created' }>['payload']) => void;
  /** typing.start / typing.stop。 */
  readonly onTyping: (typing: boolean) => void;
  /** 其余全部下行事件（usage.reminder / dependency.notice / safety.* / conversation.ended）。 */
  readonly onEvent: (event: WsDownstreamType) => void;
  /**
   * 断开后重连成功（socket 重新 open）。消费方在这里做 after_seq 原子补拉 ——
   * 补拉必须走 HTTP（DB 是真相源），不能指望断线期间的帧还能到达。
   */
  readonly onReconnect: () => void;
}

export type ChatSocketState = 'connecting' | 'open' | 'disconnected';

const MAX_BACKOFF_MS = 30_000;

/**
 * 挂一条会话级 WS 连接：open → 断开 → 指数退避重连。
 * 返回当前状态；断开态由消费方渲染 ReconnectBar。
 */
export function useChatSocket(conversationId: string | null, handlers: ChatSocketHandlers): ChatSocketState {
  const [state, setState] = useState<ChatSocketState>('connecting');
  // handlers 装进 ref：回调闭包变了不必断开重连。
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (conversationId === null) return;
    let closed = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = (): void => {
      if (closed) return;
      setState(attempt === 0 ? 'connecting' : 'disconnected');
      // 浏览器的 WebSocket API 不能设 Authorization 头，身份只能走 `?token=`（服务端
      // 在握手里校验归属，见 apps/api/src/ws/server.ts）。代价是 token 会出现在反代
      // 访问日志的 query 里 —— Caddyfile 的 log filter 把 query 整段删掉后才落日志，
      // 两处是同一修复的两半（01-REVIEW #1/#2）。
      const token = readSessionToken();
      const query = `conversationId=${encodeURIComponent(conversationId)}`;
      const fullQuery = token === null ? query : `${query}&token=${encodeURIComponent(token)}`;
      socket = new WebSocket(`${wsOrigin()}/ws?${fullQuery}`);
      socket.onopen = () => {
        if (closed) return;
        const isReconnect = attempt > 0;
        attempt = 0;
        setState('open');
        if (isReconnect) handlersRef.current.onReconnect();
      };
      socket.onclose = () => {
        if (closed) return;
        setState('disconnected');
        attempt += 1;
        const delay = Math.min(1_000 * 2 ** Math.min(attempt - 1, 5), MAX_BACKOFF_MS);
        timer = setTimeout(connect, delay);
      };
      socket.onmessage = (event: MessageEvent) => {
        if (closed) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(typeof event.data === 'string' ? event.data : '');
        } catch {
          return; // 坏帧丢弃 —— 客户端不应当为传输层的坏帧崩掉整个会话视图
        }
        const frame = WsDownstream.safeParse(parsed);
        if (!frame.success) return;
        const value = frame.data;
        if (value.type === 'message.created') handlersRef.current.onMessage(value.payload);
        else if (value.type === 'typing.start') handlersRef.current.onTyping(true);
        else if (value.type === 'typing.stop') handlersRef.current.onTyping(false);
        else handlersRef.current.onEvent(value);
      };
    };

    connect();
    return () => {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      // 1000 = normal closure（「本组件卸载」是正常关闭，不是断连）。
      socket?.close(1000, 'client unmount');
    };
  }, [conversationId]);

  return state;
}
