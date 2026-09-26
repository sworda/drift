// apps/api 的结构化日志 —— 唯一实例，白名单式字段。
//
// 为什么是白名单而不是黑名单：PITFALLS.md §8.2 第 4 条把「应用日志与 APM 记录消息体」
// 列为最常见的实际泄漏点。日志文件是一个**不能按行删除的存储位置** —— 一键删除
// （PRIV-05）无法级联到它，所以唯一诚实的姿态是让它**从设计上不含个人信息**，
// 而不是「记了以后再脱敏」。
//
// 两道防线，缺一不可：
//   1. `logEvent()` 的 `fields` 类型只接受 LOG_ALLOWED_FIELDS 里的键 —— 编译期拦住
//      `logEvent('x', { text: msg })`。这是主防线。
//   2. pino 的 `redact` 覆盖常见正文/联系方式路径 —— 运行时兜住第一道被绕过的情况
//      （例如将来某处直接拿到了实例，或白名单字段里塞进了对象）。
//
// ⚠️ **不导出裸 logger**。导出 `logger.info` 就等于把第一道防线变成可选项：业务模块
// 可以传任意对象，而 TypeScript 不会有任何意见。全仓唯一出口是 logEvent / logError。

import { pino } from 'pino';

import { env, type LogLevel } from '../config/env.ts';

/**
 * 允许出现在日志里的字段全集。
 *
 * 判据只有一条：**这个值本身不是、也不能反推出个人信息**。
 * 因此这里有 `userId`（不可反推的内部 id，且是排障必需）但没有 `phone` / `email` /
 * `nickname`；有 `errorName` / `errorCode` 但没有 `errorMessage`（pg 的报错串里就
 * 可能带参数值，而参数值就是消息正文）。
 *
 * 新增字段的门槛：必须能回答「它在 DATA_INVENTORY 里登记成什么」。
 */
export const LOG_ALLOWED_FIELDS = [
  // 主体与会话（均为内部 id，不可反推自然人）
  'userId',
  'conversationId',
  'characterId',
  'messageSeq',
  // 安全与合规状态（枚举值，非文本）
  'riskLevel',
  'contactAttemptStatus',
  'disclosureKind',
  // Model Router（PLAT-03 要求落库的同一组维度）
  'provider',
  'model',
  'modelSnapshot',
  'promptVersion',
  'tokensIn',
  'tokensOut',
  // 任务队列
  'jobId',
  'jobName',
  // HTTP / WS
  'route',
  'method',
  'statusCode',
  'wsConnectionId',
  // 通用计量与生命周期
  'count',
  'durationMs',
  'phase',
  'signal',
  'errorName',
  'errorCode',
] as const;

export type LogField = (typeof LOG_ALLOWED_FIELDS)[number];
export type LogValue = string | number | boolean | null;
export type LogFields = Partial<Record<LogField, LogValue>>;

/**
 * 第二道防线。第一道（类型）被绕过时这里仍会把值换成 [redacted]。
 * `*.x` 覆盖一层嵌套，裸 `x` 覆盖顶层。
 */
const REDACT_PATHS = [
  'text',
  'content',
  'message',
  'msg',
  'body',
  'prompt',
  'completion',
  'phone',
  'contactRef',
  'email',
  'nickname',
  '*.text',
  '*.content',
  '*.message',
  '*.msg',
  '*.body',
  '*.prompt',
  '*.completion',
  '*.phone',
  '*.contactRef',
  '*.email',
  '*.nickname',
];

const sink = pino({
  level: env.LOG_LEVEL,
  base: { service: 'drift-api' },
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label: string) => ({ level: label }),
  },
});

function emit(level: LogLevel, payload: Record<string, LogValue>): void {
  switch (level) {
    case 'fatal':
      sink.fatal(payload);
      break;
    case 'error':
      sink.error(payload);
      break;
    case 'warn':
      sink.warn(payload);
      break;
    case 'info':
      sink.info(payload);
      break;
    case 'debug':
      sink.debug(payload);
      break;
    case 'trace':
      sink.trace(payload);
      break;
  }
}

/**
 * 记一条事件。`event` 是一个稳定的点分名字（`ws.connected` / `llm.call`），
 * `fields` 只能是白名单里的键。
 */
export function logEvent(event: string, fields: LogFields = {}, level: LogLevel = 'info'): void {
  emit(level, { event, ...fields });
}

/**
 * 记一条错误事件。**只取 `name`**，不取 `message` 也不取 `stack`：
 * 两者都可能携带 SQL 参数或消息正文。需要更多线索时加一个枚举型 `errorCode`，
 * 而不是把原始串放进日志。
 */
export function logError(event: string, error: unknown, fields: LogFields = {}): void {
  const errorName = error instanceof Error ? error.name : typeof error;
  emit('error', { event, errorName, ...fields });
}
