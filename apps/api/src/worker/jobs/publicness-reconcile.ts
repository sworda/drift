// registered_users 日对账作业（COMPLY-10 / D-23，RESEARCH §10.2）。
//
// 真相源在 git（compliance/publicness.json 的 registered_users），现实在数据库
// （invite_code 里 used_by 非空的计数）。**对账方向是告警，不是自动写回** —— 自动提交
// 会绕过 D-08 的签字机制，把整个公开性门禁变成装饰：脚本自己把数字改对了，于是「有人
// 重新逐条裁决过那六项合规条目吗」这个问题永远答不出来。
//
// 不相等 ⇒ 告警。超过上限 ⇒ 额外告警，并由 tools/ci/publicness.mjs 的 USERS_WITHIN_CAP
// 在下一次 CI 中阻断发布。这两件事分工明确：运行时负责**发现**，CI 负责**阻断**。
//
// ── 为什么本文件零 env 依赖 ──────────────────────────────────────────────────
// 它不 import config/env.ts 也不 import obs/logger.ts（后者 import 前者）。env.ts 在
// 模块加载时校验环境变量并 exit 1，于是任何 import 它的模块都无法在不带凭据的 L4 契约
// 测试进程里被加载。webhook URL、DB 计数、git 声明值全部从参数进来。
//
// ── 为什么 registerPublicnessReconcile 目前没有被 startWorker 调用 ──────────────
// apps/api 的镜像**不 COPY compliance/**（见 apps/api/Dockerfile：只拷 packages/ 与
// apps/api/），所以运行中的进程读不到 git 声明的 registered_users。在那种情况下注册这个
// schedule 只有两种收场：给它一个编造的声明值（于是对账拿运行时计数与自己比，永远相等，
// 正是本 plan 禁止的装饰性门禁），或者让作业每天失败一次。因此 Phase 1 的日对账执行点是
// nightly workflow（它有完整工作树），本模块提供载荷类型、渲染、投递与 cron 常量这一份
// 唯一实现；schedule 名与注册函数留给把声明值带进运行时的那个 plan 调用。

import { ALERT_TIMEOUT_MS } from '../../modules/safety/alert.ts';

import type { PgBoss } from 'pg-boss';

import type { AlertDeliveryResult, AlertTransport } from '../../modules/safety/alert.ts';

/** pg-boss 队列名，同时是 schedule 名。 */
export const PUBLICNESS_RECONCILE_QUEUE = 'publicness-reconcile';

/** 18:30 UTC = 次日 02:30 Asia/Shanghai。错开 nightly workflow 的 18:00，避免同时打库。 */
export const PUBLICNESS_RECONCILE_CRON = '30 18 * * *';

/**
 * 注册用户数上限 —— 四条抗辩之一。
 *
 * 这个常量在 tools/ci/publicness.mjs 里也有一份（USER_CAP）。两份是刻意的：CI 脚本不能
 * import apps/api 的运行时模块，而 apps/api 不能 import tools/ci。**分叉由一条断言挡着**
 * —— tools/ci/compliance-docs.test.ts 断言两者相等，所以改一处而忘了另一处会变红。
 */
export const REGISTERED_USERS_CAP = 10;

/**
 * 对账报告的字段全集。与 ReconcileReport 的严格一致由下面的编译期断言守着。
 *
 * ⚠️ 四个字段，一个都不多，且**没有一个是文本**。告警 JSON 不会有人去读，所以「它带上了
 * 用户标识或对话片段」这件事只能靠类型发现（T-13-09）。新增字段前先回答：运营者需要它来
 * 做什么？以及它在 DATA_INVENTORY 里登记成什么？
 */
export const RECONCILE_REPORT_FIELDS = ['declared', 'actual', 'matches', 'withinCap'] as const;

export type ReconcileReportField = (typeof RECONCILE_REPORT_FIELDS)[number];

/** 对账结果。两个计数 + 两个判定，没有任何可以塞进用户标识的位置。 */
export interface ReconcileReport {
  /** git 内 compliance/publicness.json 声明的值。 */
  readonly declared: number;
  /** 数据库里 invite_code 中 used_by 非空的计数。 */
  readonly actual: number;
  readonly matches: boolean;
  readonly withinCap: boolean;
}

type FieldSetsEqual<A extends string, B extends string> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

/**
 * 编译期断言：字段清单与类型严格一致。
 * 给 ReconcileReport 加一个字段而不改 RECONCILE_REPORT_FIELDS ⇒ 这一行报错。
 */
export const RECONCILE_REPORT_FIELDS_MATCH_TYPE: FieldSetsEqual<
  keyof ReconcileReport,
  ReconcileReportField
> = true;

/**
 * @param declared git 内声明的注册用户数
 * @param actual 数据库里已消耗的邀请码数
 */
export function buildReconcileReport(declared: number, actual: number): ReconcileReport {
  return {
    declared,
    actual,
    matches: declared === actual,
    withinCap: actual <= REGISTERED_USERS_CAP,
  };
}

/** 是否需要告警：不相等，或超过上限。 */
export function needsAlert(report: ReconcileReport): boolean {
  return !report.matches || !report.withinCap;
}

/**
 * 渲染告警正文。
 *
 * ⚠️ 只能引用 ReconcileReport 的四个字段。不要为了「让运营者查得快」而拼上哪些码被用了
 * 或者是谁用的 —— 运营者需要的是「去哪里看」，而后台按邀请码列表打得开。
 */
export function renderReconcileContent(report: ReconcileReport): string {
  const lines = [
    '【Drift 公开性对账】',
    'git 声明的注册用户数：' + String(report.declared),
    '数据库实际已消耗邀请码：' + String(report.actual),
  ];
  if (!report.matches) {
    lines.push(
      'MISMATCH —— 两者不相等。请核实后**人工**更新 compliance/publicness.json 的 registered_users，',
      '并在同一次变更里新增一份逐条裁决的 compliance/CHECKLIST-<日期>.md（自动写回会绕过签字机制）。',
    );
  }
  if (!report.withinCap) {
    lines.push(
      '超过上限 ' + String(REGISTERED_USERS_CAP) + ' —— 四条抗辩之一已破裂，',
      '下一次 CI 会由 USERS_WITHIN_CAP 阻断发布，直到六条必需合规条目逐条实装并重新签字。',
    );
  }
  lines.push('本告警不含任何用户标识与对话内容。');
  return lines.join('\n');
}

/** 企业微信群机器人的 text 消息体（与 acute 告警同一封装形态）。 */
export function buildReconcileWecomPayload(
  report: ReconcileReport,
  mentionedList: readonly string[] = [],
): Record<string, unknown> {
  return {
    msgtype: 'text',
    text: {
      content: renderReconcileContent(report),
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
 * 投递一条对账告警 —— **第五个出站出口**（已登记 EGRESS_POINTS 的 reconcile.publicnessWebhook）。
 *
 * 为什么不复用 notifyOperator：它的入参是 AcuteAlert（riskLevel 恒为 'crisis'），拿它发
 * 对账告警要么谎报一次危机，要么把 AcuteAlert 放宽成一个能装任何东西的类型 —— 后者会
 * 直接废掉「载荷里不存在文本字段」这条编译期保证。为什么也不抽一个
 * postWecomText(content: string, ...)：一个接受任意字符串的导出投递函数，正是 GatedText
 * 方案要堵的那个缺口（AST 扫描只看得见参数类型里的 GatedText，看不见 string）。
 *
 * 于是这里重复了十几行 fetch —— 代价是两处封装可能分叉，收益是两条出口的载荷类型各自
 * 都不可能承载文本。这笔交换是刻意的。超时常量从 alert.ts 取同一个值。
 *
 * @returns 投递结果。业务码非 0 视为失败（企业微信对无效 webhook 同样返回 200）。
 */
export async function deliverReconcileAlert(
  report: ReconcileReport,
  transport: AlertTransport,
): Promise<AlertDeliveryResult> {
  const send = transport.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await send(transport.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildReconcileWecomPayload(report, transport.mentionedList ?? [])),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
  } catch {
    return { delivered: false, reason: 'network_error', httpStatus: null, errcode: null };
  }

  if (!response.ok) {
    return { delivered: false, reason: 'http_error', httpStatus: response.status, errcode: null };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const errcode = readErrcode(body);
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

export interface PublicnessReconcileDeps {
  /** 数据库侧计数。由调用方注入 —— 本模块不 import @drift/db（那会读 DATABASE_URL）。 */
  readonly countUsedInviteCodes: () => Promise<number>;
  /** git 内声明的值。由调用方注入 —— 运行时镜像里不一定有 compliance/。 */
  readonly readDeclaredUsers: () => Promise<number>;
  readonly transport: AlertTransport;
  /** 观察点（日志由调用方按白名单字段记 —— 本模块不 import logger）。 */
  readonly onReport?: (report: ReconcileReport, delivery: AlertDeliveryResult | null) => void;
}

/**
 * 跑一次对账：取两个数、比、需要时告警。**不写任何文件、不动 git。**
 */
export async function runPublicnessReconcile(
  deps: PublicnessReconcileDeps,
): Promise<{ report: ReconcileReport; delivery: AlertDeliveryResult | null }> {
  const [declared, actual] = await Promise.all([
    deps.readDeclaredUsers(),
    deps.countUsedInviteCodes(),
  ]);
  const report = buildReconcileReport(declared, actual);
  const delivery = needsAlert(report) ? await deliverReconcileAlert(report, deps.transport) : null;
  deps.onReport?.(report, delivery);
  return { report, delivery };
}

/**
 * 把对账挂成 pg-boss 的每日 schedule。
 *
 * 尚未被 startWorker 调用 —— 理由见文件头。签名按 node_modules/pg-boss 的 .d.ts 实读：
 * createQueue(name, options?)、work(name, handler)（handler 收到的是 Job[] 批）、
 * schedule(name, cron, data?, options?) 且 ScheduleOptions 带 tz。
 */
export async function registerPublicnessReconcile(
  boss: PgBoss,
  deps: PublicnessReconcileDeps,
): Promise<void> {
  await boss.createQueue(PUBLICNESS_RECONCILE_QUEUE);
  await boss.work<null>(PUBLICNESS_RECONCILE_QUEUE, async () => {
    await runPublicnessReconcile(deps);
  });
  await boss.schedule(PUBLICNESS_RECONCILE_QUEUE, PUBLICNESS_RECONCILE_CRON, null, {
    tz: 'Asia/Shanghai',
    // 停机期间错过的那些不补发：对账是幂等的日快照，补发 N 次只会发 N 条一样的告警。
    missed: 'skip',
  });
}
