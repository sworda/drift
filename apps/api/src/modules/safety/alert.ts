// acute（crisis 级）事件的运营者告警 —— **第四个出站出口**（D-09 / SAFE-16）。
//
// 它是一条出口，也是一条**新的个人信息流向**：向运营者披露「某用户触发了二级危机」
// 这一事实。因此它同时受两条约束：
//
//  1. **载荷类型不含任何对话文本字段。** AcuteAlert 只有五个字段，类型体里没有
//     text/content/reply 这类列可填。为什么靠类型而不是靠自觉：告警 JSON 不会有人
//     去读，所以「它带上了对话片段」这件事只能靠断言发现 —— 而类型是最便宜的那条
//     断言。tools/ci/egress-registry.test.ts 的第三条绑定断言再补一层运行时证明：
//     用一条含特征串的触发消息走到载荷构造点，断言序列化后的 webhook 载荷不含该
//     特征串的任何片段。
//  2. **投递结果如实返回，不吞。** SAFE-16：2xx 且业务码成功 ⇒ 调用方进 pending；
//     **投递失败直接进 unavailable、不经 pending**。所以这里绝不能把失败包成成功，
//     也不能只 log 不返回 —— 状态机（Plan 07）要靠这个返回值分辨那两条路。
//
// ── 为什么本文件零依赖 ────────────────────────────────────────────────────────
// 它既不 import config/env.ts 也不 import obs/logger.ts（后者 import 前者）。env.ts 在
// **模块加载时**校验环境变量并 exit 1，于是任何 import 它的模块都无法在没有完整 env
// 的进程里被加载 —— 包括 L4 契约层的测试进程。第三条绑定断言必须能在 ci:fast（不带
// 任何 WECOM_ 凭据、不连境内资源）里跑，所以 webhook URL 与 fetch 实现都从参数进来，
// 日志由调用方按白名单字段记。
//
// 本 plan 只实现投递与类型；contact_attempt 四态状态机在 Plan 07。

/** 告警载荷的字段全集。与 AcuteAlert 的严格一致由下面的编译期断言守着。 */
export const ACUTE_ALERT_FIELDS = [
  'userId',
  'conversationId',
  'riskLevel',
  'occurredAt',
  'safetyEventId',
] as const;

export type AcuteAlertField = (typeof ACUTE_ALERT_FIELDS)[number];

/**
 * 二级危机告警载荷。
 *
 * ⚠️ 五个字段，一个都不多。新增字段前先回答：运营者需要它来做什么？以及它在
 * DATA_INVENTORY 里登记成什么？—— 「多带一点方便排查」是这条出口唯一的失效方式。
 */
export interface AcuteAlert {
  readonly userId: string;
  readonly conversationId: string;
  readonly riskLevel: 'crisis';
  readonly occurredAt: Date;
  readonly safetyEventId: string;
}

type FieldSetsEqual<A extends string, B extends string> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

/**
 * 编译期断言：字段清单与类型严格一致。
 * 给 AcuteAlert 加一个字段而不改 ACUTE_ALERT_FIELDS ⇒ 这一行报错（true 不可赋给 false）。
 */
export const ACUTE_ALERT_FIELDS_MATCH_TYPE: FieldSetsEqual<keyof AcuteAlert, AcuteAlertField> =
  true;

/** 企业微信群机器人的投递通道。URL 只从 env 经调用方传入，不进日志、不进 git。 */
export interface AlertTransport {
  readonly webhookUrl: string;
  /** @ 到的运营者（企业微信 userid 或 '@all'）。COVERAGE.md 已定：只用 mentioned_list。 */
  readonly mentionedList?: readonly string[];
  /** 注入点，测试用。省略即用全局 fetch。 */
  readonly fetchImpl?: typeof fetch;
}

export type AlertFailureReason = 'http_error' | 'business_error' | 'network_error';

/**
 * 投递结果。
 *
 * delivered true ⇒ 调用方置 contact_attempt 为 pending；false ⇒ 直接置 unavailable
 * （SAFE-16 明文：不经 pending）。
 */
export type AlertDeliveryResult =
  | { readonly delivered: true; readonly httpStatus: number }
  | {
      readonly delivered: false;
      readonly reason: AlertFailureReason;
      readonly httpStatus: number | null;
      readonly errcode: number | null;
    };

/** 投递超时。有界时间是 SAFE-16 的字面要求，没有超时就没有「有界」。 */
export const ALERT_TIMEOUT_MS = 10_000;

/**
 * 渲染告警正文。
 *
 * ⚠️ 只能引用 AcuteAlert 的五个字段。不要为了「让运营者看得懂」而拼一句用户原话 ——
 * 运营者需要的是「去哪里看」，而后台按 conversationId 打得开；告警本身不必是副本。
 */
export function renderAlertContent(alert: AcuteAlert): string {
  return [
    '【Drift 二级危机告警】',
    `风险等级：${alert.riskLevel}`,
    `发生时间：${alert.occurredAt.toISOString()}`,
    `用户：${alert.userId}`,
    `会话：${alert.conversationId}`,
    `安全事件：${alert.safetyEventId}`,
    '请在后台按会话 id 查看详情并推进联络。本告警不含对话内容。',
  ].join('\n');
}

/** 企业微信群机器人的 text 消息体（msgtype text + mentioned_list，见 COVERAGE.md）。 */
export function buildWecomPayload(
  alert: AcuteAlert,
  mentionedList: readonly string[] = [],
): Record<string, unknown> {
  return {
    msgtype: 'text',
    text: {
      content: renderAlertContent(alert),
      mentioned_list: [...mentionedList],
    },
  };
}

function readErrcode(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || !('errcode' in body)) return null;
  const errcode = (body as { errcode: unknown }).errcode;
  return typeof errcode === 'number' ? errcode : null;
}

/**
 * 投递一条 acute 告警。**第四个出站出口。**
 *
 * @returns 投递结果。业务码非 0 视为失败（企业微信对无效 webhook 同样返回 200）。
 */
export async function notifyOperator(
  alert: AcuteAlert,
  transport: AlertTransport,
): Promise<AlertDeliveryResult> {
  const send = transport.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await send(transport.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildWecomPayload(alert, transport.mentionedList ?? [])),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
  } catch {
    // 网络层失败（含超时）。不重试：重试逻辑属状态机（Plan 07），在这里偷偷重试会让
    // 「有界时间」的上界变成一个没人算得出来的数。
    return { delivered: false, reason: 'network_error', httpStatus: null, errcode: null };
  }

  if (!response.ok) {
    return {
      delivered: false,
      reason: 'http_error',
      httpStatus: response.status,
      errcode: null,
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const errcode = readErrcode(body);
  // 业务码缺失也算失败：企业微信成功响应一定带 errcode: 0，缺了说明对面不是它。
  if (errcode !== 0) {
    return {
      delivered: false,
      reason: 'business_error',
      httpStatus: response.status,
      errcode,
    };
  }
  return { delivered: true, httpStatus: response.status };
}
