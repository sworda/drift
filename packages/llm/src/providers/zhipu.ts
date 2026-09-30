// 智谱 provider 实例。境内，Phase 1 的 safety.classify 通道。
//
// ⚠️ 这个通道跑的是**安全分类器**，而它的模型在 pinnability 表里是不可 pin 的
// （Q4）。补偿措施是 resolved_model 的日 diff 告警 —— 见 tools/ci/model-snapshot-diff.mjs。

import { createOpenAICompatibleProvider } from './openai-compatible.ts';
import { ZHIPU_BASE_URL } from '../routes.ts';
import type { Provider } from '../types.ts';

let instance: Provider | undefined;

export function zhipuProvider(): Provider {
  const existing = instance;
  if (existing !== undefined) return existing;
  const created = createOpenAICompatibleProvider({
    id: 'zhipu',
    baseURL: ZHIPU_BASE_URL,
    apiKeyEnv: 'ZHIPU_API_KEY',
  });
  instance = created;
  return created;
}
