// provider 名 → 实例的解析。
//
// `LLM_PROVIDER_MODE`（默认 mock）决定走 mock 还是真实 provider。两种模式**都经
// Router**，所以 llm_call 照样落库、可 pin 性照样被检查（PLAT-03）。
//
// ⚠️ 未接入的 provider 在这里**显式抛错**，不回落到 mock：回落会让「以为在跑真
// 模型」这件事没有任何征兆，而那种误判会一路污染到探针基线与成本表。

import { arkProvider } from './ark.ts';
import { mockProvider } from './mock.ts';
import { zhipuProvider } from './zhipu.ts';
import type { Provider, ProviderName } from '../types.ts';

export type ProviderMode = 'mock' | 'live';

export function providerMode(): ProviderMode {
  const mode = process.env['LLM_PROVIDER_MODE'] ?? 'mock';
  if (mode === 'mock' || mode === 'live') return mode;
  throw new Error(`LLM_PROVIDER_MODE=${mode} 不是合法取值（mock | live）。`);
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
  }
}

export { arkProvider } from './ark.ts';
export { mockProvider } from './mock.ts';
export { zhipuProvider } from './zhipu.ts';
