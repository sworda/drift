// OpenAI 兼容端点的 provider 实例工厂。
//
// ── 为什么是 fetch 而不是 AI SDK（与 PLAN 的偏离，Rule 3）───────────────────────
// PLAN 写的是「用 AI SDK 的 provider 实例工厂」。仓库里目前没有安装 `ai` /
// `@ai-sdk/*` 任何一个包，而安装 provider SDK 在本项目里是一次**阻断式的人工
// 包合法性确认**（Plan 02 的 checkpoint 协议）。Phase 1 不实际调用真实 provider
// （`LLM_PROVIDER_MODE` 默认 mock），所以现在为它引入一条新的供应链依赖买不到
// 任何东西，却要占用一次人工门禁。
//
// 更重要的是方向问题：PLAT-06 怕的是「AI SDK 的字符串 model 写法默认路由到
// 境外 AI Gateway」。直接对一个**写死在 git 里的 baseURL** 发 fetch 请求，在结构上
// 根本没有「被默认路由到网关」这个形态 —— 它比传 provider 实例更强，而不是更弱。
// 真正接真实 provider 时（Plan 07/08 需要 generateObject 的结构化输出修复重试）
// 再走一次包合法性 checkpoint 引入 AI SDK，届时本文件是唯一需要替换的实现。
//
// ⚠️ baseURL 由构造参数传入且**不读环境变量** —— 环境变量可以在运行时被改成一个
// 网关地址，那正是 T-05-01 的确切形态。

import { hostOf } from '../hosts.ts';
import { classifyHost } from '../routes.ts';
import type { Provider, ProviderName, ProviderRequest, ProviderResponse } from '../types.ts';

export interface OpenAICompatibleOptions {
  readonly id: ProviderName;
  /** 从 routes.ts 读。不接受运行时覆盖。 */
  readonly baseURL: string;
  /** API key 的环境变量名。缺失即抛错 —— 不静默降级到 mock。 */
  readonly apiKeyEnv: string;
  readonly timeoutMs?: number;
}

interface ChatCompletionShape {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly choices?: unknown;
  readonly usage?: unknown;
}

function pickNumber(source: unknown, key: string): number {
  if (typeof source !== 'object' || source === null) return 0;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : 0;
}

function parseCompletion(payload: unknown, requestedModel: string): ProviderResponse {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('provider 回包不是一个对象');
  }
  const body = payload as ChatCompletionShape;
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const first: unknown = choices[0];
  const messageValue =
    typeof first === 'object' && first !== null ? (first as Record<string, unknown>)['message'] : undefined;
  const contentValue =
    typeof messageValue === 'object' && messageValue !== null
      ? (messageValue as Record<string, unknown>)['content']
      : undefined;
  if (typeof contentValue !== 'string') {
    throw new Error('provider 回包里没有 choices[0].message.content');
  }
  // ⚠️ resolvedModel **不回落成 requestedModel**：回落会把「别名被解析」这件事
  // 抹掉，而那正是日 diff 告警唯一的证据来源。回包没带 model 是一个应该被看见的
  // 异常，所以落一个显式的哨兵串而不是假装一致。
  const resolvedModel = typeof body.model === 'string' ? body.model : `unreported(${requestedModel})`;
  const usage = body.usage;
  const cachedDetails =
    typeof usage === 'object' && usage !== null
      ? (usage as Record<string, unknown>)['prompt_tokens_details']
      : undefined;
  return {
    text: contentValue,
    resolvedModel,
    providerRequestId: typeof body.id === 'string' ? body.id : '',
    promptTokens: pickNumber(usage, 'prompt_tokens'),
    completionTokens: pickNumber(usage, 'completion_tokens'),
    cachedTokens: pickNumber(cachedDetails, 'cached_tokens'),
  };
}

export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): Provider {
  // 构造时就检查 host：一个指向网关的 provider 实例不应该等到第一次真实调用才被发现。
  const host = hostOf(options.baseURL);
  if (classifyHost(host) === 'unlisted') {
    throw new Error(
      `provider ${options.id} 的 baseURL host ${host} 不在白名单里 —— 拒绝构造实例。`,
    );
  }
  const endpoint = `${options.baseURL}/chat/completions`;
  const timeoutMs = options.timeoutMs ?? 60_000;

  return {
    id: options.id,
    baseUrl: options.baseURL,
    generate: async (request: ProviderRequest): Promise<ProviderResponse> => {
      const apiKey = process.env[options.apiKeyEnv];
      if (apiKey === undefined || apiKey.length === 0) {
        throw new Error(
          `${options.apiKeyEnv} 未设置：provider ${options.id} 无法调用。不回落到 mock —— 回落会让「以为在跑真模型」没有任何征兆。`,
        );
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        // 这里的 model 取的是变量而非字符串字面量 —— PLAT-06 的 ESLint 规则禁止
        // 字面量写法，而路由表解析出的快照标识本身就是唯一合法来源。
        body: JSON.stringify({
          model: request.modelSnapshot,
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
          messages: [{ role: 'user', content: request.prompt }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        // ⚠️ 不带回包正文：provider 的错误串里可能回显请求内容（= 对话正文）。
        throw new Error(`provider ${options.id} 返回 ${String(response.status)}`);
      }
      return parseCompletion(await response.json(), request.modelSnapshot);
    },
  };
}
