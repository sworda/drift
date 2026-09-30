// 火山方舟（豆包）provider 实例。境内，Phase 1 的 chat.reply 通道。
//
// baseURL 从 routes.ts 读 —— 不从环境变量读、不接受运行时覆盖（见 hosts.ts 的说明）。

import { createOpenAICompatibleProvider } from './openai-compatible.ts';
import { ARK_BASE_URL } from '../routes.ts';
import type { Provider } from '../types.ts';

let instance: Provider | undefined;

/** 懒构造：mock 模式下不需要 API key，也不该因为缺 key 而起不来。 */
export function arkProvider(): Provider {
  const existing = instance;
  if (existing !== undefined) return existing;
  const created = createOpenAICompatibleProvider({
    id: 'volcengine',
    baseURL: ARK_BASE_URL,
    apiKeyEnv: 'ARK_API_KEY',
  });
  instance = created;
  return created;
}
