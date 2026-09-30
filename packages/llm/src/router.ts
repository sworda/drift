// Model Router —— **全仓库唯一**的 LLM 调用入口（PLAT-03）。
//
// 包边界（不可协商）：packages/llm 是 @ai-sdk/* / openai / @anthropic-ai/* 的唯一
// 导入者，静态与动态 import 都只允许在这里（eslint.config.js 的 no-restricted-imports
// + ImportExpression 选择器）。
//
// call() 做五件事，缺一不可：
//   1. 解析 route（或校验 pinned 的可 pin 性）
//   2. 执行 provider 调用
//   3. 在调用方给的 executor 上写一行 llm_call（turn_id + purpose 非空）
//   4. 把 requested / snapshot / resolved 三者**分三列**落库
//   5. resolved ≠ requested 时发一条 warn 事件（别名被解析，是应告警事件）
//
// 第 3 条是 RESEARCH §4.1 两条 SQL 断言（判定顺序、SAFE-02 模型分离）的数据前提。
//
// ⚠️ 本模块在加载时就跑一次 assertRouterInvariants()。apps/api 的启动第一步还会
// 显式再跑一次 —— 重复是故意的：显式调用是给读代码的人看的（启动顺序摆在眼前），
// 模块级调用是给「将来某个新入口忘了调」兜底的。

import { inputHash } from '@drift/prompts';

import { llmCall, type Executor, type LlmPurpose } from '@drift/db';

import { configuredProviderOfModel } from './config.ts';
import { aliasResolvedEvent, emitLlmEvent } from './events.ts';
import { pinnabilityOf } from './pinnability.ts';
import { resolveProvider } from './providers/index.ts';
import { boundariesForModel, priceTierFor, ROUTES } from './routes.ts';
import { assertRouterInvariants } from './startup-assertions.ts';
import {
  MODELS,
  type CallMode,
  type FrontierMessages,
  type ProviderName,
  type SemanticRole,
} from './types.ts';

assertRouterInvariants();

export interface CallRequest {
  /** 同一次用户消息引发的全部调用共享一个 turnId。两条架构断言按它 JOIN。 */
  readonly turnId: string;
  readonly prompt: string;
  readonly promptVersion: string;
  readonly userId: string | null;
  readonly conversationId: string | null;
  readonly personaVersionId: string | null;
}

export interface CallResult {
  readonly text: string;
  readonly purpose: LlmPurpose;
  readonly provider: string;
  readonly requestedModel: string;
  readonly modelSnapshot: string;
  readonly resolvedModel: string;
  /** provider 回传的模型与我们要求的不一致 ⇒ 别名被解析。落库 + 一条 warn 事件。 */
  readonly aliasResolved: boolean;
  readonly priceTier: string;
  readonly latencyMs: number;
}

interface ResolvedCall {
  readonly purpose: SemanticRole;
  readonly providerName: ProviderName;
  readonly modelSnapshot: string;
  readonly requestedModel: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly thinkingMode: string;
  readonly priceTierBoundaries: readonly number[];
}

function resolveRoutedCall(role: SemanticRole): ResolvedCall {
  const route = ROUTES[role];
  if (!route.enabled) {
    throw new Error(
      `语义角色 ${role} 在 Phase 1 未启用（routes.ts 的 enabled=false）。不静默换一个启用的角色 —— 换角色等于换模型、换温度、换计价档位。`,
    );
  }
  return {
    purpose: role,
    providerName: route.provider,
    modelSnapshot: route.modelSnapshot,
    requestedModel: route.requestedModel,
    temperature: route.temperature,
    maxOutputTokens: route.maxOutputTokens,
    thinkingMode: route.thinkingMode,
    priceTierBoundaries: route.priceTierBoundaries,
  };
}

function resolveMode(mode: CallMode): ResolvedCall {
  if (mode.mode === 'routed') return resolveRoutedCall(mode.role);

  // pinned：探针与对照组。别名在这里必须**抛错**而不是降级。
  const pinnability = pinnabilityOf(mode.modelSnapshot);
  if (pinnability === undefined) {
    throw new Error(
      `pinned 模式拒绝 ${mode.modelSnapshot}：它没有登记可 pin 性。未登记不得默认成 snapshot。`,
    );
  }
  if (pinnability !== 'snapshot') {
    throw new Error(
      `pinned 模式拒绝 ${mode.modelSnapshot}：它是 ${pinnability}。降级换模型等于尺子在测量过程中被换掉。`,
    );
  }
  const probeRoute = ROUTES['persona.probe'];
  const providerName = declaredProviderOf(mode.modelSnapshot);
  if (providerName === undefined) {
    throw new Error(`${mode.modelSnapshot} 没有登记 provider 归属。`);
  }
  return {
    purpose: 'persona.probe',
    providerName,
    modelSnapshot: mode.modelSnapshot,
    requestedModel: mode.modelSnapshot,
    // 探针把可控变量全部锁死（RESEARCH：只有这样剩下的方差才只来自模型侧）。
    temperature: 0,
    maxOutputTokens: probeRoute.maxOutputTokens,
    thinkingMode: 'off',
    priceTierBoundaries: boundariesForModel(mode.modelSnapshot),
  };
}

async function dispatch(
  resolved: ResolvedCall,
  request: CallRequest,
  executor: Executor,
): Promise<CallResult> {
  const provider = resolveProvider(resolved.providerName);

  const startedAt = Date.now();
  const response = await provider.generate({
    purpose: resolved.purpose,
    prompt: request.prompt,
    modelSnapshot: resolved.modelSnapshot,
    temperature: resolved.temperature,
    maxOutputTokens: resolved.maxOutputTokens,
  });
  const latencyMs = Date.now() - startedAt;

  // 计价档位由**边界 + 实际 prompt_tokens** 推出，而不是由 provider 回传：
  // 分段计费的边界是合同事实，provider 的回包里没有它。
  const priceTier = priceTierFor(resolved.priceTierBoundaries, response.promptTokens);

  // 「别名被解析」是一条应告警事件，不是一个可以只落库的字段：落库的行要等到有人
  // 去查才被看见，而厂商静默换模型这件事需要在**当天**被看见（V.2 的采样论证）。
  const aliasEvent = aliasResolvedEvent({
    purpose: resolved.purpose,
    requestedModel: resolved.requestedModel,
    resolvedModel: response.resolvedModel,
  });
  if (aliasEvent !== null) emitLlmEvent(aliasEvent);

  await executor.insert(llmCall).values({
    turnId: request.turnId,
    purpose: resolved.purpose,
    // 落**实际执行**的 provider（mock 模式下就是 'mock'），而不是路由表声明的那个。
    // 记声明值会让「这一行到底是真调用还是 mock」永远查不出来。
    provider: provider.id,
    requestedModel: resolved.requestedModel,
    modelSnapshot: resolved.modelSnapshot,
    resolvedModel: response.resolvedModel,
    providerRequestId: response.providerRequestId,
    promptVersion: request.promptVersion,
    // ⚠️ 只存输入哈希，不存 prompt 正文（否则等于把全部对话原文再存一份）。
    inputHash: inputHash(request.prompt),
    personaVersionId: request.personaVersionId,
    thinkingMode: resolved.thinkingMode,
    temperature: resolved.temperature,
    promptTokens: response.promptTokens,
    completionTokens: response.completionTokens,
    cachedTokens: response.cachedTokens,
    priceTier,
    latencyMs,
    userId: request.userId,
    conversationId: request.conversationId,
    retrievedMemoryIds: null,
    recallScores: null,
  });

  return {
    text: response.text,
    purpose: resolved.purpose,
    provider: provider.id,
    requestedModel: resolved.requestedModel,
    modelSnapshot: resolved.modelSnapshot,
    resolvedModel: response.resolvedModel,
    aliasResolved: aliasEvent !== null,
    priceTier,
    latencyMs,
  };
}

/**
 * 唯一入口（境内通道）。
 *
 * `executor` 由调用方传入 —— llm_call 与业务写入用同一个执行器，于是
 * 「有回复但没有调用记录」这种状态不会因为忘了传而出现。
 *
 * ⚠️ `CallMode` 的 role 在类型层排除了 `persona.probe`（只能 pinned）与
 * `chat.reply.frontier`（只能经 callFrontier，且只接受 SyntheticText）。
 */
export async function call(
  mode: CallMode,
  request: CallRequest,
  executor: Executor,
): Promise<CallResult> {
  return dispatch(resolveMode(mode), request, executor);
}

/**
 * 境外通道的唯一入口（PLAT-07）。
 *
 * 参数类型是 `FrontierMessages` = `readonly SyntheticText[]`：真实用户原文在**编译期**
 * 就传不进来。这条防线必须是编译期的 —— PITFALLS 把「用户原文误发境外 provider」
 * 列为 HIGH 且**不可逆**（发出即已出境），运行时判断与代码评审都来不及。
 *
 * Phase 1 不启用该通道（routes.ts 的 enabled=false），所以调用它会抛错；
 * 但签名现在就定下来，因为签名是最便宜的 CI 级防线。
 */
export async function callFrontier(
  messages: FrontierMessages,
  request: Omit<CallRequest, 'prompt'>,
  executor: Executor,
): Promise<CallResult> {
  if (messages.length === 0) {
    throw new Error('callFrontier 的 messages 为空 —— 境外通道不接受空载荷。');
  }
  const resolved = resolveRoutedCall('chat.reply.frontier');
  return dispatch(resolved, { ...request, prompt: messages.join('\n\n') }, executor);
}

/** 供启动自检与测试读取：某个 snapshot 声明归属哪个厂商。 */
export function declaredProviderOf(modelSnapshot: string): ProviderName | undefined {
  const builtin = MODELS[modelSnapshot as keyof typeof MODELS]?.provider;
  if (builtin !== undefined) return builtin;
  return configuredProviderOfModel(modelSnapshot);
}
