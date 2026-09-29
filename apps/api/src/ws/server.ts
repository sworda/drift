// **全仓库唯一** import `ws` 的文件（RESEARCH §2.1 四条不可协商包边界之一）。
//
// 为什么这条边界重要：「WS 下发只接受 GatedText」这条约束的执行点就是这一个模块。
// 只要别处能 `new WebSocketServer`，那条约束就可以被一个新出口静默绕过。
// eslint.config.js 里对除本目录外的全部文件禁止导入 `ws`，就是这条边界的机械形式。
//
// 范围：连接建立（含身份与归属校验）、心跳、按 conversationId 的房间登记，以及
// **唯一的一条**下发路径。
//
// ── 鉴权（01-REVIEW Finding #1 修复）──────────────────────────────────────────
// 浏览器的 WebSocket API **不能设 Authorization 头** —— 身份只能走查询参数 `?token=`
//（与删除回执的「持有即有权」同风格）。代价是 token 会出现在访问日志的 query 里，
// 因此 Caddyfile 的 log 配置**必须**把 query 整段从 request>uri 里删掉后才落日志
//（两处改动是同一个修复的两半，改其一不改另一等于把一个洞换成另一个）。
// 校验流程：resolveSession(token) → conversation.userId === session.userId，任何一环
// 失败都以同一个 4400 + 同一句 'unauthorized' 关闭 —— 不区分「token 无效」与
//「无权限」（T-09-06：区分开就是可枚举的旁路），fail-closed：DB 故障同样拒绝。
//
// ── 出口签名（D-15）────────────────────────────────────────────────────────────
//   deliver(target, text: GatedText, seq)   ← 承载消息正文，只接受 GatedText
//   publish(conversationId, event)          ← 只接受**不含正文**的下行事件
//
// publish 的类型刻意排除了 'message.created'。否则它就是第二条投递路径：
// message.created 的 payload 带 text: string，谁都能用它把一段没过网关的模型输出
// 发出去，而 deliver 那道 GatedText 签名会变成一个可绕过的装饰。

import type { IncomingMessage, Server as HttpServer } from 'node:http';

import type { GatedText, Disclosure, WsDownstream } from '@drift/contract';
import { conversation, db, resolveSession } from '@drift/db';
import { eq } from 'drizzle-orm';
import { WebSocketServer, type WebSocket } from 'ws';

import { logError, logEvent } from '../obs/logger.ts';

export const WS_PATH = '/ws';

/** 心跳间隔。ws 不会自己检测半开连接，没有心跳的话对端掉线后房间会一直留着它。 */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** 单帧上限 64 KiB。v1 只有文字 + 表情，任何更大的帧都不是合法客户端。 */
const MAX_PAYLOAD_BYTES = 64 * 1024;

const CLOSE_MISSING_CONVERSATION = 4400;

/** 身份 / 归属校验失败（或 DB 故障 fail-closed）。与缺参同码，但 close reason 单一 —— 见文件头。 */
const CLOSE_UNAUTHORIZED = 4400;

export interface WebSocketHandle {
  /** 某个会话当前挂着几条连接。投递与验收都读它。 */
  readonly roomSize: (conversationId: string) => number;
  readonly close: () => Promise<void>;
}

/** 承载消息正文的下发目标。text 与 seq 单独传，是为了让出口签名一眼看见 GatedText。 */
export interface DeliveryTarget {
  readonly conversationId: string;
  readonly messageId: string;
  readonly senderKind: 'user' | 'character' | 'system';
  readonly disclosure: Disclosure | null;
  readonly createdAt: Date;
}

/** publish 能发的事件 = 下行事件里**不含正文**的那些。见文件头。 */
export type TextlessDownstream = Exclude<WsDownstream, { readonly type: 'message.created' }>;

/**
 * 进程内当前的 WS 句柄。
 *
 * PLAT-01 只允许两个部署单元，apps/api 是单进程三入口 —— 所以「房间」是进程内状态，
 * 不需要跨进程消息总线。把句柄放在模块级而不是层层透传，是为了让业务代码
 * （chat/turn.ts）无法自己 new 一个 WebSocketServer 绕过这两个出口。
 */
let activeHandle: InternalHandle | null = null;

interface InternalHandle {
  readonly send: (conversationId: string, frame: string) => number;
  readonly roomSize: (conversationId: string) => number;
}

/**
 * **唯一**承载消息正文的下发出口（D-15 的三个出口之一）。
 *
 * @param text 已由 packages/safety 的 safetyGateway() 产出的 GatedText。
 *             传裸 string 在编译期就不通过 —— 这就是这条签名的全部目的。
 * @returns 实际投出去的连接数。0 = 客户端当前不在线，消息已落库，等它重连按
 *          after_seq 补拉（CHAT-07：DB 是真相源，离线不用推）。
 */
export function deliver(target: DeliveryTarget, text: GatedText, seq: number): number {
  const frame = JSON.stringify({
    type: 'message.created',
    payload: {
      messageId: target.messageId,
      conversationId: target.conversationId,
      seq,
      senderKind: target.senderKind,
      text,
      disclosure: target.disclosure,
      createdAt: target.createdAt.toISOString(),
    },
  });
  const sent = activeHandle?.send(target.conversationId, frame) ?? 0;
  logEvent('ws.delivered', {
    conversationId: target.conversationId,
    messageSeq: seq,
    count: sent,
  });
  return sent;
}

/** 下发一条**不含正文**的事件（typing / 计时提醒 / 关怀卡片触发等）。 */
export function publish(conversationId: string, event: TextlessDownstream): number {
  const sent = activeHandle?.send(conversationId, JSON.stringify(event)) ?? 0;
  logEvent('ws.published', { conversationId, count: sent }, 'debug');
  return sent;
}

function readQueryParam(req: IncomingMessage, name: string, maxLength: number): string | null {
  // req.url 只有 path + query；base 仅用于构造 URL，不参与任何判断。
  const url = new URL(req.url ?? '/', 'http://localhost');
  const raw = url.searchParams.get(name);
  if (raw === null || raw.length === 0 || raw.length > maxLength) return null;
  return raw;
}

/**
 * 握手身份与归属校验。返回 true = 允许入房间。
 *
 * 三种失败（token 缺失/无效、会话不存在、无归属权）与 DB 故障全部走同一条拒绝路径
 * —— 调用方只知道「不允许」，客户端只见同一个 4400 + 'unauthorized'。
 */
async function authorizeConnection(
  conversationId: string,
  token: string | null,
): Promise<boolean> {
  if (token === null) return false;
  try {
    const session = await resolveSession(token);
    if (session === null) return false;
    const rows = await db
      .select({ userId: conversation.userId })
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .limit(1);
    return rows[0]?.userId === session.userId;
  } catch (error) {
    // fail-closed：鉴权链路上的任何故障都按拒绝处理 —— 放行一个未验明身份的
    // 连接比拒绝一个合法连接严重得多（旁听危机对话 vs 重连后补拉）。
    logError('ws.auth_error', error as Error, { conversationId });
    return false;
  }
}

export function attachWebSocket(server: HttpServer): WebSocketHandle {
  const wss = new WebSocketServer({ server, path: WS_PATH, maxPayload: MAX_PAYLOAD_BYTES });
  const rooms = new Map<string, Set<WebSocket>>();
  const alive = new WeakSet<WebSocket>();
  let connectionSeq = 0;

  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const conversationId = readQueryParam(req, 'conversationId', 64);
    if (conversationId === null) {
      socket.close(CLOSE_MISSING_CONVERSATION, 'conversationId required');
      return;
    }

    const token = readQueryParam(req, 'token', 512);
    void authorizeConnection(conversationId, token).then((authorized: boolean) => {
      if (!authorized) {
        logEvent('ws.auth_rejected', { conversationId });
        socket.close(CLOSE_UNAUTHORIZED, 'unauthorized');
        return;
      }
      admitConnection(socket, conversationId);
    });
  });

  function admitConnection(socket: WebSocket, conversationId: string): void {
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
  }

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

  const roomSize = (conversationId: string): number => rooms.get(conversationId)?.size ?? 0;

  activeHandle = {
    roomSize,
    send: (conversationId: string, frame: string): number => {
      const room = rooms.get(conversationId);
      if (room === undefined) return 0;
      let sent = 0;
      for (const socket of room) {
        // 1 === WebSocket.OPEN。半开连接由心跳 terminate，这里只跳过还没握完手的。
        if (socket.readyState !== 1) continue;
        socket.send(frame);
        sent += 1;
      }
      return sent;
    },
  };

  return {
    roomSize,
    close: async (): Promise<void> => {
      clearInterval(heartbeat);
      activeHandle = null;
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
