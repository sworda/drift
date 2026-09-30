// 语义角色 → 模型/provider/endpoint 的路由表（PLAT-05）。
//
// ── 为什么 6 个角色一个都不能少 ──────────────────────────────────────────────
// PLAT-05 要求「每个语义角色各自独立配置」。留空洞（某个角色没有条目、或条目缺
// 字段）的后果不是「用不了那个角色」，而是**第一次用到它的时候临时找一个配置**——
// 那个临时配置不会经过启动期断言，也不会被 SAFE-02 的模型分离检查看见。
// 所以 Phase 1 只实际连通两个角色，但 6 个条目全部写齐、字段全部填满，
// 未启用的用 `enabled: false` 标出来；startup-assertions.ts 遍历 SEMANTIC_ROLES
// 断言键集合恰好相等。
//
// ── baseURL 为什么写在这里而不是环境变量 ──────────────────────────────────────
// 环境变量可以在运行时被改成一个网关地址，而那正是 T-05-01（真实对话出境，
// 不可逆）的确切形态。写在 git 里 + host 白名单 + 启动期断言 = 改它必须过一次
// code review 和一次 CI。provider 实例从这里读 baseURL，**不接受运行时覆盖**。
//
// ── 配置驱动的扩展（llm.config.json，见 config.ts）───────────────────────────
// BUILTIN_ROUTES 是上面这套硬约束的登记处；配置文件（进程启动时读一次、校验、
// 冻结）可以按角色覆盖它 —— 部署者接入自己的模型服务（本地代理 / 云厂商兼容端点）
// 不需要改代码。合并发生在模块加载时，合并产物同样只读冻结，之后不可运行时篡改。
// host 白名单 / 网关黑名单 / 可 pin 性断言对合并产物同样生效。

import { routeOverrides, type RouteOverride } from './config.ts';
import {
  ALLOWED_LLM_HOSTS,
  isConfiguredHost,
  isLoopbackHost,
  SYNTHETIC_ONLY_HOSTS,
} from './hosts.ts';
import {
  SEMANTIC_ROLES,
  type ModelSnapshot,
  type ProviderName,
  type SemanticRole,
} from './types.ts';

/** 火山方舟（境内，chat.reply）。 */
export const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
/** 智谱（境内，safety.classify）。 */
export const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
/** 阿里云百炼（境内，persona.reflect，Phase 1 未启用）。 */
export const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
/** Anthropic（**境外**，只服务 chat.reply.frontier，只接受 SyntheticText）。 */
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

export interface RouteConfig {
  readonly provider: ProviderName;
  /** 调用方要求的模型标识。落 llm_call.requested_model。 */
  readonly requestedModel: ModelSnapshot;
  /** 路由表解析出的快照标识。SAFE-02 的模型分离断言比的是这一列。 */
  readonly modelSnapshot: ModelSnapshot;
  readonly baseURL: string;
  /** 探针与危机分类固定 0；人格回复要有温度。 */
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly thinkingMode: 'off' | 'auto';
  /**
   * 分段计费的 prompt_tokens 边界，升序。
   *
   * 火山方舟与智谱**分段计费**（doubao-seed-character 的输出价在 32k 上下文处
   * ¥2→¥6）。空数组 = 单一档位；**不猜边界** —— 猜一个错的边界比没有档位更糟，
   * 因为成本表会看起来是对的。
   */
  readonly priceTierBoundaries: readonly number[];
  /**
   * 该模型在 pinnability 表里是 `alias-only` 时**必须**写下的理由。
   *
   * 这不是注释，是启动期断言的输入：alias-only 且没有 waiver ⇒ 拒绝启动。
   * 于是「又有人把一个不可 pin 的模型接进来了」不会静默发生。
   */
  readonly aliasOnlyWaiver: string | null;
  /** Phase 1 只连通 chat.reply 与 safety.classify。未启用的角色被调用时抛错，不静默降级。 */
  readonly enabled: boolean;
}

/** 内置路由表：厂商直连的登记处（原 ROUTES，配置层的合并基线）。 */
export const BUILTIN_ROUTES: Readonly<Record<SemanticRole, RouteConfig>> = Object.freeze({
  'chat.reply': {
    provider: 'volcengine',
    requestedModel: 'doubao-seed-character-251128',
    modelSnapshot: 'doubao-seed-character-251128',
    baseURL: ARK_BASE_URL,
    temperature: 0.8,
    maxOutputTokens: 800,
    thinkingMode: 'off',
    priceTierBoundaries: [32_768],
    aliasOnlyWaiver: null,
    enabled: true,
  },
  'chat.reply.frontier': {
    // ⚠️ 境外。唯一入口是 callFrontier(FrontierMessages)，真实用户原文在类型层
    // 传不进去（PLAT-07）。Phase 1 不启用 —— 但配置现在就写全，因为 PLAT-05
    // 不允许空洞，而「第一次用到时临时配一个」绕过全部启动期断言。
    provider: 'anthropic',
    requestedModel: 'claude-sonnet-5',
    modelSnapshot: 'claude-sonnet-5',
    baseURL: ANTHROPIC_BASE_URL,
    temperature: 0.8,
    maxOutputTokens: 2048,
    thinkingMode: 'auto',
    priceTierBoundaries: [],
    aliasOnlyWaiver: null,
    enabled: false,
  },
  'persona.reflect': {
    provider: 'aliyun',
    requestedModel: 'qwen3.8-max-0902',
    modelSnapshot: 'qwen3.8-max-0902',
    baseURL: DASHSCOPE_BASE_URL,
    temperature: 0.3,
    maxOutputTokens: 2048,
    thinkingMode: 'auto',
    priceTierBoundaries: [],
    aliasOnlyWaiver: null,
    enabled: false,
  },
  'persona.probe': {
    // 探针只能经 pinned 模式（CallMode 的类型层已排除 routed）。这条配置是
    // 「探针声明要测的那个模型」的登记处：启动期断言要求它必须是 snapshot。
    provider: 'volcengine',
    requestedModel: 'doubao-seed-character-251128',
    modelSnapshot: 'doubao-seed-character-251128',
    baseURL: ARK_BASE_URL,
    temperature: 0,
    maxOutputTokens: 800,
    thinkingMode: 'off',
    priceTierBoundaries: [32_768],
    aliasOnlyWaiver: null,
    enabled: false,
  },
  'memory.extract': {
    provider: 'zhipu',
    requestedModel: 'glm-4.7-flash',
    modelSnapshot: 'glm-4.7-flash',
    baseURL: ZHIPU_BASE_URL,
    temperature: 0,
    maxOutputTokens: 1024,
    thinkingMode: 'off',
    priceTierBoundaries: [],
    aliasOnlyWaiver:
      '智谱未提供带日期的快照 ID（STACK §15.9，Confidence MEDIUM）。记忆抽取不做 baseline 对照，漂移影响可接受；补偿措施是 resolved_model 日 diff 告警。',
    enabled: false,
  },
  'safety.classify': {
    // SAFE-02：与 chat.reply / chat.reply.frontier 必须是不同模型**且不同厂商**——
    // 一次厂商侧故障不应同时打掉角色层与安全层。启动期断言检查这件事。
    provider: 'zhipu',
    requestedModel: 'glm-4.7-flash',
    modelSnapshot: 'glm-4.7-flash',
    baseURL: ZHIPU_BASE_URL,
    temperature: 0,
    maxOutputTokens: 256,
    thinkingMode: 'off',
    priceTierBoundaries: [],
    aliasOnlyWaiver:
      '智谱未提供带日期的快照 ID（STACK §15.9，Confidence MEDIUM）。Q4 裁决：如实标成不可 pin 并用 resolved_model 日 diff 告警补偿，而不是当成快照用着 —— 后者会让厂商静默换模型时探针通过率的变化被归因错。',
    enabled: true,
  },
});

/**
 * 字段级合并内置路由表与配置覆盖（config.ts 已把 model 引用解析成具体字段）。
 *
 * **纯函数**，契约测试喂构造的覆盖副本来证伪合并语义。未覆盖的角色原样保留 ——
 * 「想保留内置路由就不写这个角色」是配置层承诺的合并语义。
 */
export function mergeRouteTable(
  builtin: Readonly<Record<SemanticRole, RouteConfig>>,
  overrides: Readonly<Partial<Record<SemanticRole, RouteOverride>>>,
): Readonly<Record<SemanticRole, RouteConfig>> {
  const merged: Record<SemanticRole, RouteConfig> = { ...builtin };
  for (const role of SEMANTIC_ROLES) {
    const override = overrides[role];
    if (override === undefined) continue;
    const base = builtin[role];
    merged[role] = {
      // model 引用覆盖 provider / requestedModel / modelSnapshot / baseURL 四位一体：
      // 拆开声明会出现「provider 换了但 baseURL 还是旧厂商」的断裂形态。
      provider: override.provider,
      requestedModel: override.modelSnapshot,
      modelSnapshot: override.modelSnapshot,
      baseURL: override.baseURL,
      temperature: override.temperature ?? base.temperature,
      maxOutputTokens: override.maxOutputTokens ?? base.maxOutputTokens,
      thinkingMode: override.thinkingMode ?? base.thinkingMode,
      priceTierBoundaries: override.priceTierBoundaries ?? base.priceTierBoundaries,
      // waiver **不跨模型继承**：内置 waiver 是关于内置模型的书面理由，覆盖已换了
      // 模型还沿用旧文本，等于「把 A 模型的理由安到 B 模型头上」—— 那是看起来对
      // 的错法。配置模型是 alias-only 且没写自己的 waiver ⇒ 断言炸，强制部署者留下
      // 自己的理由（内置路径的语义完全不变）。
      aliasOnlyWaiver: override.aliasOnlyWaiver ?? null,
      enabled: override.enabled ?? base.enabled,
    };
  }
  return Object.freeze(merged);
}

/**
 * 生效路由表 = 内置 + llm.config.json 的角色覆盖（启动时合并一次，冻结）。
 *
 * 启动期断言（assertRouterInvariants）与全部业务代码都只看这一份 —— 合并产物
 * 与内置表走完全相同的断言，配置不是断言的豁免通道。
 */
export const ROUTES: Readonly<Record<SemanticRole, RouteConfig>> = mergeRouteTable(
  BUILTIN_ROUTES,
  routeOverrides(),
);

/**
 * host 分类：境内白名单 / 仅合成 / 回环 / 都不在。
 *
 * 断言与测试共用同一个判定，避免两处各写一遍然后分叉。
 *
 * `loopback`（回环）与 `configured`（配置声明）是配置驱动 provider（llm.config.json）
 * 引入的两类：前者是本地代理跑在 127.0.0.1 / localhost / [::1] 上（**不出网卡**）；
 * 后者是部署者在配置文件里显式声明的服务边界（如 docker 网桥上的宿主代理
 * 172.17.0.1:8787）—— 它同样不是公网厂商端点，流量的出境与否由部署者控制的服务
 * 拓扑决定，而不是由一个可被猜测的域名决定。两类都视同境内可用：任何角色可以直接
 * 指向它们（含 frontier —— PLAT-07 的类型层防线仍然在，而「发出即已出境」的威胁
 * 对部署者自建边界不成立）。
 */
export type HostClass = 'domestic' | 'synthetic-only' | 'loopback' | 'configured' | 'unlisted';

export function classifyHost(host: string): HostClass {
  // 回环优先于一切判定：回环地址不出网卡，白名单对它没有意义。
  if (isLoopbackHost(host)) return 'loopback';
  if (ALLOWED_LLM_HOSTS.has(host)) return 'domestic';
  if (SYNTHETIC_ONLY_HOSTS.has(host)) return 'synthetic-only';
  // 配置文件声明的自定义 provider host（启动时一次性注入）。**独立于 domestic**：
  // 把它算进境内白名单会撞上「frontier 不得指向境内 host」的断言 —— 部署者的
  // docker 网桥代理不是厂商直连端点，两者不该共享类别。
  if (isConfiguredHost(host)) return 'configured';
  return 'unlisted';
}

/**
 * 按 prompt_tokens 与分段边界推出计价档位。
 *
 * 边界语义：升序、**下界**。`[32768]` 表示 `prompt_tokens >= 32768` 进 tier1。
 * 返回值恒非空（无边界时是 tier0），因为 llm_call.price_tier 为空就等于成本算不出来，
 * 而成本是 Phase 2 才会有人去看的东西 —— 那时补不了历史行。
 */
export function priceTierFor(boundaries: readonly number[], promptTokens: number): string {
  let tier = 0;
  for (const boundary of boundaries) {
    if (promptTokens >= boundary) tier += 1;
  }
  return `tier${String(tier)}`;
}

/**
 * 某个模型快照的分段边界。
 *
 * pinned 模式没有角色，只有模型名，所以按模型反查。查不到 ⇒ 空边界（tier0），
 * 而不是抛错：pinned 模式允许用任何已登记为 snapshot 的模型，档位未知不该阻断探针。
 */
export function boundariesForModel(modelSnapshot: string): readonly number[] {
  for (const route of Object.values(ROUTES)) {
    if (route.modelSnapshot === modelSnapshot) return route.priceTierBoundaries;
  }
  return [];
}
