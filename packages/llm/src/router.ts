// Model Router —— **全仓库唯一**的 LLM 调用入口（PLAT-03）。
//
// 包边界（不可协商）：packages/llm 是 @ai-sdk/* / openai / @anthropic-ai/* 的唯一
// 导入者，静态与动态 import 都只允许在这里（eslint.config.js 的 no-restricted-imports
// + ImportExpression 选择器）。
//
// call() 做四件事，缺一不可：
//   1. 解析 route（或校验 pinned 的可 pin 性）
//   2. 执行 provider 调用
//   3. **在调用方给的同一个 executor 上**写一行 llm_call（turn_id + purpose 非空）
//   4. 把 requested / snapshot / resolved 三者分开落库
//
// 第 3 条是 RESEARCH §4.1 两条 SQL 断言（判定顺序、SAFE-02 模型分离）的数据前提。

import { inputHash } from '@drift/prompts';

import { llmCall, type Executor, type LlmPurpose } from '@drift/db';

import { mockProvider } from './providers/mock.ts';
import {
  MODELS,
  PINNABLE,
  type CallMode,
  type Provider,
  type Route,
  type RoutedRole,
  type SemanticRole,
} from './types.ts';

/**
 * 语义角色 → 模型的路由表（PLAT-05）。
 *
 * ⚠️ `safety.classify` 必须与 `chat.reply` / `chat.reply.frontier` 用**不同**的模型
 * （SAFE-02），且建议不同厂商 —— 一次厂商侧故障不应同时打掉角色层与安全层。
 * 下面的 assertRoutes() 在模块加载时就检查这件事：进程起不来比半年后发现好。
 */
export const ROUTES: Readonly<Record<RoutedRole, Route>> = Object.freeze({
  'chat.reply': {
    modelSnapshot: 'doubao-seed-character-251128',
    temperature: 0.8,
    thinkingMode: 'off',
  },
  'chat.reply.frontier': {
    modelSnapshot: 'claude-sonnet-5',
    temperature: 0.8,
    thinkingMode: 'auto',
  },
  'persona.reflect': {
    modelSnapshot: 'qwen3.8-max-0902',
    temperature: 0.3,
    thinkingMode: 'auto',
  },
  'memory.extract': {
    modelSnapshot: 'glm-4.7-flash',
    temperature: 0,
    thinkingMode: 'off',
  },
  'safety.classify': {
    modelSnapshot: 'glm-4.7-flash',
    temperature: 0,
    thinkingMode: 'off',
  },
});

/** 启动期断言。任一条不成立即抛 —— 不降级、不静默。 */
export function assertRoutes(): void {
  const reply = ROUTES['chat.reply'].modelSnapshot;
  const frontier = ROUTES['chat.reply.frontier'].modelSnapshot;
  const classify = ROUTES['safety.classify'].modelSnapshot;
  if (classify === reply || classify === frontier) {
    throw new Error(
      `SAFE-02 违反：safety.classify 与扮演角色用了同一个模型（${classify}）。危机判定必须由与扮演角色不同的模型执行。`,
    );
  }
  for (const [role, route] of Object.entries(ROUTES)) {
    if (PINNABLE[route.modelSnapshot] !== 'snapshot') {
      throw new Error(
        `路由表里的 ${role} 指向 ${route.modelSnapshot}，它在 PINNABLE 里不是 snapshot —— 别名会在某天被重新解析到另一组权重上。`,
      );
    }
  }
}

assertRoutes();

/**
 * provider 解析。
 *
 * `LLM_PROVIDER_MODE=mock`（默认）时全部走 mock —— 但**仍然经这一个 call()**，
 * 所以 llm_call 照样落库、可 pin 性照样被检查。live 模式的真实 provider 实例在
 * Plan 05 接入；此刻显式抛错而不是悄悄回落到 mock：回落会让「以为在跑真模型」
 * 这件事没有任何征兆。
 */
function resolveProvider(): Provider {
  const mode = process.env['LLM_PROVIDER_MODE'] ?? 'mock';
  if (mode === 'mock') return mockProvider;
  throw new Error(
    `LLM_PROVIDER_MODE=${mode} 尚未接入真实 provider（Plan 05）。不回落到 mock —— 回落会让「以为在跑真模型」没有任何征兆。`,
  );
}

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
  readonly modelSnapshot: string;
  readonly resolvedModel: string;
  readonly latencyMs: number;
}

function resolveMode(mode: CallMode): {
  readonly purpose: SemanticRole;
  readonly modelSnapshot: string;
  readonly requestedModel: string;
  readonly temperature: number;
  readonly thinkingMode: string;
} {
  if (mode.mode === 'routed') {
    const route = ROUTES[mode.role];
    return {
      purpose: mode.role,
      modelSnapshot: route.modelSnapshot,
      requestedModel: route.modelSnapshot,
      temperature: route.temperature,
      thinkingMode: route.thinkingMode,
    };
  }
  // pinned：探针与对照组。别名在这里必须**抛错**而不是降级。
  if (PINNABLE[mode.modelSnapshot] !== 'snapshot') {
    throw new Error(
      `pinned 模式拒绝 ${mode.modelSnapshot}：它是 alias-only。降级换模型等于尺子在测量过程中被换掉。`,
    );
  }
  return {
    purpose: 'persona.probe',
    modelSnapshot: mode.modelSnapshot,
    requestedModel: mode.modelSnapshot,
    temperature: 0,
    thinkingMode: 'off',
  };
}

/**
 * 唯一入口。
 *
 * `executor` 由调用方传入（通常是当前 turn 的事务）—— llm_call 与业务写入落在同一个
 * 事务里，于是「有回复但没有调用记录」这种状态在结构上不可能出现。
 */
export async function call(
  mode: CallMode,
  request: CallRequest,
  executor: Executor,
): Promise<CallResult> {
  const resolved = resolveMode(mode);
  const provider = resolveProvider();

  const startedAt = Date.now();
  const response = await provider.generate({
    purpose: resolved.purpose,
    prompt: request.prompt,
    modelSnapshot: resolved.modelSnapshot,
    temperature: resolved.temperature,
  });
  const latencyMs = Date.now() - startedAt;

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
    priceTier: response.priceTier,
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
    modelSnapshot: resolved.modelSnapshot,
    resolvedModel: response.resolvedModel,
    latencyMs,
  };
}

/** 供启动自检与测试读取：某个 snapshot 声明归属哪个厂商。 */
export function declaredProviderOf(modelSnapshot: string): string | undefined {
  return MODELS[modelSnapshot as keyof typeof MODELS]?.provider;
}
