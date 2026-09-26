// mock provider（D-27）—— **路由表里的一个 provider**，不是一个测试替身。
//
// 为什么不是 msw / nock 的 HTTP 层拦截，也不是 fixture 回放（两者都被明确否决）：
// HTTP 层拦截绕过 Router 的落库与可 pin 性检查，于是测试路径与生产路径不同，
// 「所有 LLM 调用必经 Router」这条约束在测试里**根本没有被验证过**。反过来，
// 「mock 也必须经 Router」本身就是对 PLAT-03 的一次验证。
//
// ⚠️ 它照样经 Router 写 llm_call 行（provider='mock'）。跳过落库会让 RESEARCH §4.1
// 的两条 SQL 断言（判定顺序、模型分离）在集成测试里查不到任何数据 —— 两条断言会
// 变成空真通过，而那正是它们要防的东西。

import { createHash } from 'node:crypto';

import type { Provider, ProviderRequest, ProviderResponse } from '../types.ts';

/** 确定性：同一输入恒得同一输出。随机 mock 会让集成断言间歇性变红，然后被人加重试。 */
function digest(request: ProviderRequest): string {
  return createHash('sha256')
    .update(`${request.purpose}\u0000${request.modelSnapshot}\u0000${request.prompt}`, 'utf8')
    .digest('hex');
}

/** Phase 1 的 mock 回复模板。语体刻意平淡 —— 它不是要像谁，只是要能被链路搬运。 */
const REPLY_TEMPLATES = [
  '嗯，我在。你慢慢说。',
  '这事我听明白了。你想先从哪一段讲？',
  '我没什么高明的建议，但我可以一直在这儿听。',
  '先别急着下结论。你刚才说的那一点，我想再确认一下。',
] as const;

export const mockProvider: Provider = {
  id: 'mock',
  baseUrl: null,
  generate: async (request: ProviderRequest): Promise<ProviderResponse> => {
    const hex = digest(request);
    const pick = Number.parseInt(hex.slice(0, 4), 16) % REPLY_TEMPLATES.length;

    // safety.classify 的输出必须是结构化的 —— 网关消费的是 level，不是自然语言。
    // Phase 1 的 mock 恒返回 none；故障注入与危机判定的真实分类在 Plan 07/08。
    const text =
      request.purpose === 'safety.classify'
        ? JSON.stringify({ level: 'none', confidence: 0.99 })
        : (REPLY_TEMPLATES[pick] ?? REPLY_TEMPLATES[0]);

    return {
      text,
      // mock 不做别名解析，所以 resolved === requested。真实 provider 下两者不一致
      // 就是「别名被解析」，Router 会把它落成两列以便告警。
      resolvedModel: request.modelSnapshot,
      providerRequestId: `mock-${hex.slice(0, 24)}`,
      promptTokens: Math.ceil(request.prompt.length / 4),
      completionTokens: Math.ceil(text.length / 4),
      cachedTokens: 0,
      priceTier: 'mock',
    };
  },
};
