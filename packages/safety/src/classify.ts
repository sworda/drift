// safety.classify 的调用封装（SAFE-05 的三类失败在这里被统一映射为 failed）。
//
// ── 为什么本文件不 import @drift/llm ────────────────────────────────────────
// packages/llm 的 router.ts import 了 @drift/db，而后者在模块加载时读 DATABASE_URL 并
// 构造连接池。packages/safety 必须能在**不连库**的进程里被加载：Plan 06 的出口注册表
// 集合相等断言（tools/ci/egress-registry.test.ts）住在 L4 契约层，而 fast workflow 的
// 第一条约束就是不依赖任何数据库或境内资源。因此模型调用以一个窄端口
// （ClassifyInvoke）从参数进来，由 apps/api 的 turn.ts 用 `call({ mode: 'routed',
// role: 'safety.classify' }, …)` 实现 —— 于是 llm_call 照样落库，RESEARCH §4.1 的两条
// SQL 断言照样有数据可查。
//
// 这条端口同时是**故障注入点**：tests/integration/fail-closed.test.ts 用它注入三类
// 失败，而不是临时改一次源码。注入能通过它做的最坏的事是让本函数返回 failed 分支
// ——「原样透传候选回复」在 GatedResult 的类型里不存在，注入点拿不到那个形态。
//
// ── generateObject 与 PLAN 的偏离 ───────────────────────────────────────────
// PLAN 写的是「generateObject + schema 校验 + 修复重试」。仓库里没有安装 `ai` /
// `@ai-sdk/*`（01-05 已裁决：provider 用 fetch 直连，装 SDK 要走 Plan 02 的包合法性
// checkpoint）。这里用 @drift/prompts 的 `SafetyClassifyOutput` zod 契约直接校验模型
// 回包 —— 三类失败的**判据**与 PLAN 一致，少的只是 SDK 的自动修复重试一环，而那一环
// 在 fail-closed 语义下只影响误升级率，不影响安全方向。

import { SafetyClassifyOutput, buildSafetyClassifyPrompt } from '@drift/prompts';
import type { SafetyHitCategory } from '@drift/prompts';

import type { Classification, RiskLevel } from './risk.ts';

/**
 * 置信度下限。低于它视为 SAFE-05 的第三类分类器失败（前两类是 provider 报错/超时与
 * 结构化输出 schema 校验失败）。
 *
 * 取 0.5 的理由：低于 0.5 的判定在四档取值域上不比抛硬币更有信息量，把它当成一次
 * 有效判定就等于让 fail-closed 只覆盖「报错」而不覆盖「猜的」。抬高这个值会换来
 * 更多误升级（用户看到关怀卡片而不是回复），因此它是一个可调参数而不是常识 ——
 * 调整它需要 L6 探针集的实测分布（Plan 08）作为依据。
 */
export const SAFETY_CONFIDENCE_FLOOR = 0.5;

/**
 * 分类调用的超时上限。
 *
 * 有上限是 fail-closed 的前提：没有超时的话「provider 挂着不回」这一类失败会表现为
 * 整个 turn 悬停，而悬停既不是 failed 也不是 ok —— 它是一个没有任何断言覆盖的第三态。
 */
export const CLASSIFY_TIMEOUT_MS = 12_000;

/** 三类失败的细分原因。只进日志与 safety_event 的 rule_hits，不影响等级映射。 */
export const CLASSIFY_FAILURE_REASONS = [
  'provider_error',
  'timeout',
  'schema_invalid',
  'low_confidence',
] as const;
export type ClassifyFailureReason = (typeof CLASSIFY_FAILURE_REASONS)[number];

export interface ClassifyInput {
  readonly userText: string;
  /** **完整**候选回复。判定在人格渲染之后，看的是整段而不是半句（SAFE-01）。 */
  readonly candidateReply: string;
  readonly sessionRiskLevel: RiskLevel;
}

export interface ClassifyInvocationResult {
  readonly text: string;
  readonly modelSnapshot: string;
}

export type ClassifyInvoke = (prompt: {
  readonly text: string;
  readonly version: string;
}) => Promise<ClassifyInvocationResult>;

export interface ClassifyOutcome {
  readonly classification: Classification;
  /** 执行判定的模型快照。失败且未拿到回包时为 null。 */
  readonly modelSnapshot: string | null;
  readonly failureReason: ClassifyFailureReason | null;
  readonly confidence: number | null;
  readonly categories: readonly SafetyHitCategory[];
}

function failed(
  reason: ClassifyFailureReason,
  modelSnapshot: string | null,
  confidence: number | null = null,
): ClassifyOutcome {
  return {
    classification: { classifierStatus: 'failed' },
    modelSnapshot,
    failureReason: reason,
    confidence,
    categories: [],
  };
}

/**
 * 解析 safety.classify 的模型输出。
 *
 * 解析失败 ⇒ `{ classifierStatus: 'failed' }`，而不是「当成 none」。覆盖 SAFE-05 的
 * 后两类失败：schema 校验失败（非 JSON / 缺字段 / 取值越界）与置信度低于下限。
 * 第一类（provider 报错/超时）由 classifySafety 的 try/catch 与超时竞速覆盖。
 *
 * ⚠️ 保留这个独立导出是因为它是一个纯函数，可以被穷举；gateway.test.ts 与 turn 的
 * 调用路径共用它，于是「解析规则」只有一处。
 */
export function parseClassification(raw: string): Classification {
  return parseClassifyOutcome(raw, null).classification;
}

/** 解析并保留失败原因与置信度（供留证与日志用）。 */
export function parseClassifyOutcome(raw: string, modelSnapshot: string | null): ClassifyOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failed('schema_invalid', modelSnapshot);
  }
  const validated = SafetyClassifyOutput.safeParse(parsed);
  if (!validated.success) return failed('schema_invalid', modelSnapshot);
  const { level, confidence, categories } = validated.data;
  if (confidence < SAFETY_CONFIDENCE_FLOOR) {
    return failed('low_confidence', modelSnapshot, confidence);
  }
  return {
    classification: { classifierStatus: 'ok', level: level satisfies RiskLevel },
    modelSnapshot,
    failureReason: null,
    confidence,
    categories,
  };
}

/** 超时竞速。返回的 sentinel 是一个本模块私有的符号，调用方无法伪造。 */
const TIMED_OUT = Symbol('classify.timeout');

async function withTimeout(
  work: Promise<ClassifyInvocationResult>,
  timeoutMs: number,
): Promise<ClassifyInvocationResult | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      resolve(TIMED_OUT);
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface ClassifyDeps {
  readonly invoke: ClassifyInvoke;
  readonly timeoutMs?: number;
}

/**
 * 跑一次安全分类。
 *
 * **永不抛错。** 三类失败全部收敛成 `{ classifierStatus: 'failed' }`，而 resolveRisk
 * 对该分支恒返回 elevated。这一点是刻意的：抛错会把「分类失败」变成调用方的一次
 * try/catch，而在 turn 外层包一个 catch 后降级下发人格回复，正是 T-07-01 要防的那条
 * 静默路径。既然本函数不抛，turn.ts 里就没有那个 catch 存在的理由。
 */
export async function classifySafety(
  input: ClassifyInput,
  deps: ClassifyDeps,
): Promise<ClassifyOutcome> {
  const prompt = buildSafetyClassifyPrompt({
    userText: input.userText,
    candidateReply: input.candidateReply,
    sessionRiskLevel: input.sessionRiskLevel,
  });

  let raw: ClassifyInvocationResult | typeof TIMED_OUT;
  try {
    raw = await withTimeout(deps.invoke(prompt), deps.timeoutMs ?? CLASSIFY_TIMEOUT_MS);
  } catch {
    // (a) provider 报错。错误对象里可能带 prompt 片段，所以既不记它也不往上抛。
    return failed('provider_error', null);
  }
  if (raw === TIMED_OUT) return failed('timeout', null);

  return parseClassifyOutcome(raw.text, raw.modelSnapshot);
}
