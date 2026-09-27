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
//
//     **Plan 07 又补了第三层：构造期自检。** notifyOperator 在 fetch 之前调用
//     `assertNoUserText(payload, triggeringMessage)`，命中即**抛错**（不是记一条
//     警告）。为什么抛错而不是告警：一条只被记录的警告需要有人去读那段 JSON，而
//     这条出口存在的全部理由就是「没有人会去读它」。抛错让泄漏在运行时立刻失败。
//     为什么它还需要 triggeringMessage 这个参数：子串检查需要针（needle）。这个
//     参数**从不被序列化**，它只进入比较 —— 所以 EGRESS_POINTS 里
//     `carriesUserText: false` 仍然成立：受约束的是**载荷类型**，而载荷类型里没有
//     任何文本字段。
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
 * 判定「载荷泄漏了触发消息」的最短子串长度。
 *
 * 6 个字符：中文下六个字已经足以复原一句话的语义片段，而更短的窗口（两三个字）会
 * 把「今天」「我们」这类必然共现的常用词判成泄漏 —— 一条恒红的断言会被人关掉，
 * 那比没有断言更糟。与 tools/ci/egress-registry.test.ts 的 MIN_LEAK_LENGTH 同值，
 * 两处由 Task 3 的 crisis-order 断言共同覆盖。
 */
export const MIN_LEAK_LENGTH = 6;

export class AlertPayloadLeakError extends Error {
  constructor(
    /** 泄漏的子串。**只进异常对象，不进日志** —— 它就是用户原文的一个片段。 */
    readonly leaked: string,
  ) {
    super(
      `acute 告警载荷里出现了触发消息的片段（${String(leaked.length)} 字）。告警不得携带任何对话内容（SAFE-16 / PRIV-11）。`,
    );
    this.name = 'AlertPayloadLeakError';
  }
}

/**
 * 返回载荷里第一段长度 >= minLength 的泄漏子串；没有泄漏则 null。**纯函数。**
 *
 * 穷举触发消息的所有长度 >= minLength 的子串，逐个在序列化载荷里找。对一条几百字的
 * 消息是 O(n²) 次 includes —— 在一次 webhook 投递的时间尺度上完全不值得优化，而
 * 「快一点但漏一种形态」在这条出口上是错的取舍。
 */
export function findLeakedSubstring(
  serialized: string,
  triggeringMessage: string,
  minLength: number = MIN_LEAK_LENGTH,
): string | null {
  for (let start = 0; start + minLength <= triggeringMessage.length; start += 1) {
    for (let end = triggeringMessage.length; end - start >= minLength; end -= 1) {
      const window = triggeringMessage.slice(start, end);
      if (serialized.includes(window)) return window;
    }
  }
  return null;
}

/**
 * 构造期自检：载荷不得含触发消息的任何 >= 6 字子串。**命中即抛错。**
 *
 * @param payload 即将被序列化发出的载荷对象。
 * @param triggeringMessage 触发本次告警的用户消息。**只作为比较用的针，不会被发出。**
 * @throws AlertPayloadLeakError
 */
export function assertNoUserText(payload: unknown, triggeringMessage: string): void {
  if (triggeringMessage.length < MIN_LEAK_LENGTH) return;
  const leaked = findLeakedSubstring(JSON.stringify(payload), triggeringMessage);
  if (leaked !== null) throw new AlertPayloadLeakError(leaked);
}

/**
 * 告警的留证上下文。
 *
 * 独立成一个参数而不是塞进 AlertTransport：transport 是「发到哪里、怎么发」，
 * 而这里是「拿什么当针」。两者混在一起会让人以为 triggeringMessage 会被发出去。
 */
export interface AlertGuard {
  /** 触发本次告警的用户消息。**只进 assertNoUserText 的比较，不进载荷。** */
  readonly triggeringMessage: string;
}

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
 * @param guard 触发消息（只作为子串检查的针）。省略等于放弃构造期自检 —— 因此它
 *   **不是可选的**：一个可选的自检等于把「这次有没有泄漏」变成调用方的选择题，而
 *   本文件存在的理由就是那道题不该存在。
 * @returns 投递结果。业务码非 0 视为失败（企业微信对无效 webhook 同样返回 200）。
 * @throws AlertPayloadLeakError 载荷含触发消息的 >= 6 字子串时。
 */
export async function notifyOperator(
  alert: AcuteAlert,
  transport: AlertTransport,
  guard: AlertGuard,
): Promise<AlertDeliveryResult> {
  const send = transport.fetchImpl ?? fetch;
  const payload = buildWecomPayload(alert, transport.mentionedList ?? []);
  // ⚠️ 自检在 fetch **之前**。放在之后就只是一次事后记录 —— 而那时载荷已经出境了。
  assertNoUserText(payload, guard.triggeringMessage);
  let response: Response;
  try {
    response = await send(transport.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
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
