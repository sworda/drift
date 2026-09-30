// provider 名 → 实例的解析。
//
// `LLM_PROVIDER_MODE`（默认 mock）决定走 mock 还是真实 provider。两种模式**都经
// Router**，所以 llm_call 照样落库、可 pin 性照样被检查（PLAT-03）。
//
// ⚠️ 未接入的 provider 在这里**显式抛错**，不回落到 mock：回落会让「以为在跑真
// 模型」这件事没有任何征兆，而那种误判会一路污染到探针基线与成本表。
//
// 解析顺序：内置 provider（switch，Phase 1 只连通火山方舟与智谱）→ llm.config.json
// 声明的自定义 provider（本地代理 / 云厂商兼容端点，openai-compatible 实例化）。
// 两类都未命中 ⇒ 抛错。

import { configuredProviderOf, isConfiguredProviderId } from '../config.ts';
import { arkProvider } from './ark.ts';
import { mockProvider } from './mock.ts';
import { zhipuProvider } from './zhipu.ts';
import { createOpenAICompatibleProvider } from './openai-compatible.ts';
import type { Provider, ProviderName } from '../types.ts';

export type ProviderMode = 'mock' | 'live';

export function providerMode(): ProviderMode {
  const mode = process.env['LLM_PROVIDER_MODE'] ?? 'mock';
  if (mode === 'mock' || mode === 'live') return mode;
  throw new Error(`LLM_PROVIDER_MODE=${mode} 不是合法取值（mock | live）。`);
}

/**
 * 配置声明 provider 的实例缓存（Phase 1 只有 openai-compatible 一种 API 形态）。
 *
 * 实例构造会检查 host 白名单（openai-compatible.ts 的构造期断言）—— 配置里的
 * 回环 / 已登记 host 在启动加载时已通过 registerConfiguredHosts 注入。
 */
const configuredInstances = new Map<string, Provider>();

function resolveConfiguredProvider(name: string): Provider {
  const existing = configuredInstances.get(name);
  if (existing !== undefined) return existing;
  const config = configuredProviderOf(name);
  if (config === undefined) {
    throw new Error(
      `provider ${name} 没有在 llm.config.json 的 providers 里声明 —— 不回落、不猜测。`,
    );
  }
  const created = createOpenAICompatibleProvider({
    id: name,
    baseURL: config.baseUrl,
    apiKeyEnv: config.apiKeyEnv,
  });
  configuredInstances.set(name, created);
  return created;
}

export function resolveProvider(name: ProviderName): Provider {
  if (providerMode() === 'mock') return mockProvider;
  switch (name) {
    case 'volcengine':
      return arkProvider();
    case 'zhipu':
      return zhipuProvider();
    case 'mock':
      return mockProvider;
    case 'aliyun':
    case 'anthropic':
    case 'deepseek':
      throw new Error(
        `provider ${name} 在 Phase 1 未接入（只连通火山方舟与智谱）。不回落到其他 provider —— 换 provider 等于换模型。`,
      );
    default:
      // 配置声明的自定义 provider（本地代理 / 云厂商兼容端点）。
      if (isConfiguredProviderId(name)) return resolveConfiguredProvider(name);
      throw new Error(
        `provider ${name} 既不是内置 provider，也没有在 llm.config.json 里声明。不回落到 mock —— 回落会让「以为在跑自己的模型」没有任何征兆。`,
      );
  }
}

export { arkProvider } from './ark.ts';
export { mockProvider } from './mock.ts';
export { zhipuProvider } from './zhipu.ts';
