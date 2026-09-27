// Model Router 的类型层（PLAT-03/05/06/07）。
//
// 这个文件里有三处「让错误不可表达」的设计，都不是风格选择：
//
//  1. `persona.probe` 在 `CallMode` 里**不可能**是 routed。探针是尺子；让它走路由
//     表就等于允许「尺子在测量过程中被换掉」——降级换模型之后，冻结 baseline 的
//     对比全部失效，而结果看起来完全正常。
//  2. `chat.reply.frontier`（境外通道）同样不在 `CallMode` 里。它**只能**经
//     `callFrontier(messages: FrontierMessages)` 进入，而 `FrontierMessages` 是
//     `SyntheticText` 数组 —— 真实用户原文在类型层就传不进去（PLAT-07）。
//     「发出即已出境」不可逆，所以这条防线必须在编译期，不能是运行时判断。
//  3. 可 pin 性是**显式表**（pinnability.ts），不从模型名推断。同一厂商的命名规则
//     按世代变化（claude-sonnet-5 无日期即快照，claude-sonnet-4-5 是别名），
//     推断今天对明天错，而错的方向是「把别名当快照 pin 住」——最坏的那个方向。

import type { SyntheticText } from '@drift/contract';

/** PLAT-05 的语义角色。llm_call.purpose 的取值域与它逐字一致。 */
export type SemanticRole =
  | 'chat.reply'
  | 'chat.reply.frontier'
  | 'persona.reflect'
  | 'persona.probe'
  | 'memory.extract'
  | 'safety.classify';

/** 语义角色全集的运行时形态。ROUTES 的完备性断言按它遍历（PLAT-05 不允许空洞）。 */
export const SEMANTIC_ROLES = [
  'chat.reply',
  'chat.reply.frontier',
  'persona.reflect',
  'persona.probe',
  'memory.extract',
  'safety.classify',
] as const satisfies readonly SemanticRole[];

/** 有路由表条目的角色（= 全部 6 个）。ROUTES 的键类型。 */
export type RoutedRole = SemanticRole;

/**
 * 可以经 `call()` 进入的角色。
 *
 * 两个角色被排除，理由不同但同样不可协商：
 *   - `persona.probe`：只能 pinned（禁别名、禁降级）。
 *   - `chat.reply.frontier`：境外，只能经 `callFrontier` 且只接受 SyntheticText。
 */
export type CallableRole = Exclude<SemanticRole, 'persona.probe' | 'chat.reply.frontier'>;

export type CallMode =
  | { readonly mode: 'routed'; readonly role: CallableRole }
  /** 探针与对照组：禁别名、禁降级。 */
  | { readonly mode: 'pinned'; readonly modelSnapshot: string };

/** 只能走 pinned 的角色。启动期断言要求它们的声明模型必须是 snapshot。 */
export const PINNED_ONLY_ROLES = ['persona.probe'] as const satisfies readonly SemanticRole[];

export type Pinnability = 'snapshot' | 'alias-only';

/** provider 名。llm_call.provider 落的是**实际执行**的那个（mock 模式下就是 'mock'）。 */
export type ProviderName = 'volcengine' | 'zhipu' | 'aliyun' | 'anthropic' | 'deepseek' | 'mock';

/**
 * 模型 → provider 归属的登记表。
 *
 * 可 pin 性**不在这里**：它在 pinnability.ts，且用 `satisfies Record<ModelSnapshot, …>`
 * 绑定，于是「加了模型但忘了登记可 pin 性」是一条编译错误而不是一个默认值。
 */
export const MODELS = {
  'doubao-seed-character-251128': { provider: 'volcengine' },
  'glm-4.7-flash': { provider: 'zhipu' },
  'qwen3.8-max-0902': { provider: 'aliyun' },
  'claude-sonnet-5': { provider: 'anthropic' },
  'claude-sonnet-4-5': { provider: 'anthropic' },
  'deepseek-flash': { provider: 'deepseek' },
} as const satisfies Record<string, { readonly provider: ProviderName }>;

export type ModelSnapshot = keyof typeof MODELS;

/**
 * 境外通道的消息载荷（PLAT-07）。
 *
 * ⚠️ 这个别名存在的唯一理由是让「把真实用户原文发去境外」在编译期不可表达。
 * 把它改成 `readonly string[]` 之后，`callFrontier` 会静默接受任意文本，
 * 而没有任何测试会因此变红 —— 负向 type fixture
 * tools/ci/type-fixtures/probe-routed.ts 是这一行的唯一守卫。
 */
export type FrontierMessages = readonly SyntheticText[];

export interface ProviderRequest {
  readonly purpose: SemanticRole;
  readonly prompt: string;
  readonly modelSnapshot: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
}

export interface ProviderResponse {
  readonly text: string;
  /** provider 回传的实际模型。与 requested 不一致即「别名被解析」，是应告警事件。 */
  readonly resolvedModel: string;
  readonly providerRequestId: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedTokens: number;
}

export interface Provider {
  readonly id: ProviderName;
  /**
   * provider 实例的固定 baseURL。`null` = 不出网（mock）。
   *
   * ⚠️ 这一列存在是因为 PLAT-06 的 AST 规则有一个看不见的漏洞：规则挡住了
   * `model: 'x'` 字符串写法，但挡不住「provider 实例本身指向了一个网关」。
   * 白名单 + 启动期断言（startup-assertions.ts）是那个漏洞的补位。
   */
  readonly baseUrl: string | null;
  readonly generate: (request: ProviderRequest) => Promise<ProviderResponse>;
}
