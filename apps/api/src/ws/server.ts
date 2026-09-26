// **全仓库唯一** import `ws` 的文件（RESEARCH §2.1 四条不可协商包边界之一）。
//
// 为什么这条边界重要：「WS 下发只接受 GatedText」这条约束的执行点就是这一个模块。
// 只要别处能 `new WebSocketServer`，那条约束就可以被一个新出口静默绕过。
// eslint.config.js 里对除本目录外的全部文件禁止导入 `ws`，就是这条边界的机械形式。
//
// 本 plan 的范围：连接建立、心跳、按 conversationId 的房间登记。
// **不做消息投递** —— Plan 04 的 tracer 从这里接进来，且必须接在这一条路径上，
// 不新建第二条投递路径（RESEARCH §2.4）。

import type { IncomingMessage, Server as HttpServer } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import { logError, logEvent } from '../obs/logger.ts';

export const WS_PATH = '/ws';

/** 心跳间隔。ws 不会自己检测半开连接，没有心跳的话对端掉线后房间会一直留着它。 */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** 单帧上限 64 KiB。v1 只有文字 + 表情，任何更大的帧都不是合法客户端。 */
const MAX_PAYLOAD_BYTES = 64 * 1024;

const CLOSE_MISSING_CONVERSATION = 4400;

export interface WebSocketHandle {
  /** 某个会话当前挂着几条连接。Plan 04 的投递与本 plan 的验收都读它。 */
  readonly roomSize: (conversationId: string) => number;
  readonly close: () => Promise<void>;
}

function readConversationId(req: IncomingMessage): string | null {
  // req.url 只有 path + query；base 仅用于构造 URL，不参与任何判断。
  const url = new URL(req.url ?? '/', 'http://localhost');
  const raw = url.searchParams.get('conversationId');
  if (raw === null || raw.length === 0 || raw.length > 64) return null;
  return raw;
}

export function attachWebSocket(server: HttpServer): WebSocketHandle {
  const wss = new WebSocketServer({ server, path: WS_PATH, maxPayload: MAX_PAYLOAD_BYTES });
  const rooms = new Map<string, Set<WebSocket>>();
  const alive = new WeakSet<WebSocket>();
  let connectionSeq = 0;

  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const conversationId = readConversationId(req);
    if (conversationId === null) {
      socket.close(CLOSE_MISSING_CONVERSATION, 'conversationId required');
      return;
    }

    connectionSeq += 1;
    const wsConnectionId = `ws-${String(connectionSeq)}`;
    alive.add(socket);

    const room = rooms.get(conversationId) ?? new Set<WebSocket>();
    room.add(socket);
    rooms.set(conversationId, room);
    logEvent('ws.connected', { wsConnectionId, conversationId, count: room.size });

    socket.on('pong', () => {
      alive.add(socket);
    });

    socket.on('message', () => {
      // 本 plan 不处理上行帧。计数而不是静默丢弃 —— 静默丢弃会让 Plan 04 接投递时
      // 分不清「客户端没发」和「服务端没收」。
      logEvent('ws.inbound_dropped', { wsConnectionId, conversationId }, 'debug');
    });

    socket.on('error', (error: Error) => {
      logError('ws.socket_error', error, { wsConnectionId, conversationId });
    });

    socket.on('close', () => {
      const current = rooms.get(conversationId);
      if (current !== undefined) {
        current.delete(socket);
        if (current.size === 0) rooms.delete(conversationId);
      }
      logEvent('ws.disconnected', {
        wsConnectionId,
        conversationId,
        count: current?.size ?? 0,
      });
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!alive.has(socket)) {
        // 上一轮 ping 没有收到 pong：这是一条半开连接，留着它会让房间大小说谎。
        socket.terminate();
        continue;
      }
      alive.delete(socket);
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  return {
    roomSize: (conversationId: string): number => rooms.get(conversationId)?.size ?? 0,
    close: async (): Promise<void> => {
      clearInterval(heartbeat);
      // 1001 = going away。客户端据此走重连补拉路径（STACK §4：DB 是真相源）。
      for (const socket of wss.clients) socket.close(1001, 'server shutting down');
      await new Promise<void>((resolve, reject) => {
        wss.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    },
  };
}
