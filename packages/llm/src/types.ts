// Model Router 的类型层（PLAT-03/05/06/07）。
//
// 这个文件里有两处「让错误不可表达」的设计，都不是风格选择：
//
//  1. `persona.probe` 在 `CallMode` 里**不可能**是 routed。探针是尺子；让它走路由
//     表就等于允许「尺子在测量过程中被换掉」——降级换模型之后，冻结 baseline 的
//     对比全部失效，而结果看起来完全正常。
//  2. `pinnability` 是**显式表**，不是从模型名正则推断。同一厂商的命名规则按世代
//     变化（claude-sonnet-5 无日期即快照，claude-sonnet-4-5 是别名），正则今天对
//     明天错，而错的方向是「把别名当快照 pin 住」——最坏的那个方向。

/** PLAT-05 的语义角色。llm_call.purpose 的取值域与它逐字一致。 */
export type SemanticRole =
  | 'chat.reply'
  | 'chat.reply.frontier'
  | 'persona.reflect'
  | 'persona.probe'
  | 'memory.extract'
  | 'safety.classify';

/** 可以走路由表的角色。probe 被排除在类型层。 */
export type RoutedRole = Exclude<SemanticRole, 'persona.probe'>;

export type CallMode =
  | { readonly mode: 'routed'; readonly role: RoutedRole }
  /** 探针与对照组：禁别名、禁降级。 */
  | { readonly mode: 'pinned'; readonly modelSnapshot: string };

export type Pinnability = 'snapshot' | 'alias-only';

/**
 * 模型登记表 —— provider 归属与可 pin 性的唯一真相源。
 *
 * ⚠️ `alias-only` 的模型**不得做 baseline**：它在某天会被 provider 重新解析到另一
 * 组权重上，而那时历史对比数据的「尺子」已经无从查证。
 */
export const MODELS = {
  'doubao-seed-character-251128': { provider: 'volcengine', pinnability: 'snapshot' },
  'glm-4.7-flash': { provider: 'zhipu', pinnability: 'snapshot' },
  'qwen3.8-max-0902': { provider: 'aliyun', pinnability: 'snapshot' },
  'claude-sonnet-5': { provider: 'anthropic', pinnability: 'snapshot' },
  'claude-sonnet-4-5': { provider: 'anthropic', pinnability: 'alias-only' },
  'deepseek-flash': { provider: 'deepseek', pinnability: 'alias-only' },
} as const satisfies Record<string, { readonly provider: string; readonly pinnability: Pinnability }>;

export type ModelSnapshot = keyof typeof MODELS;

/** 显式 pinnability 表（RESEARCH §5.1）。由 MODELS 派生，避免两份表分叉。 */
export const PINNABLE: Readonly<Record<string, Pinnability>> = Object.freeze(
  Object.fromEntries(
    Object.entries(MODELS).map(([model, meta]) => [model, meta.pinnability]),
  ),
);

export interface Route {
  readonly modelSnapshot: ModelSnapshot;
  /** 探针与危机分类固定 0；人格回复要有温度。 */
  readonly temperature: number;
  readonly thinkingMode: 'off' | 'auto';
}

export interface ProviderRequest {
  readonly purpose: SemanticRole;
  readonly prompt: string;
  readonly modelSnapshot: string;
  readonly temperature: number;
}

export interface ProviderResponse {
  readonly text: string;
  /** provider 回传的实际模型。与 requested 不一致即「别名被解析」，是应告警事件。 */
  readonly resolvedModel: string;
  readonly providerRequestId: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedTokens: number;
  /** 火山方舟与智谱分段计费；不记档位算不出真实成本。 */
  readonly priceTier: string;
}

export interface Provider {
  readonly id: string;
  /** null = 不出网（mock）。真实 provider 的 host 要过 ALLOWED_LLM_HOSTS 白名单（Plan 05）。 */
  readonly baseUrl: string | null;
  readonly generate: (request: ProviderRequest) => Promise<ProviderResponse>;
}
