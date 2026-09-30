// 配置驱动的模型服务层（llm.config.json 的加载与校验）。
//
// ── 这层配置为什么存在 ────────────────────────────────────────────────────────
// 内置路由表（routes.ts 的 BUILTIN_ROUTES）写死在 git 里，那是「厂商直连」的登记处。
// 但部署者可能需要接入**自己的模型服务**：本地启动的模型代理（OpenAI 兼容）、
// 腾讯云 / 阿里云等厂商的兼容端点。这层配置让 provider 集合与路由指向可以被
// 声明在进程外，而**不需要改代码**。
//
// 设计参照 opencode / pi 的模型目录模式：
//   - providers 是对象（id → 配置），与内置目录**并存**而不是替换它；
//   - 路由用 provider/model 引用（"local-proxy/glm-4.7"）；
//   - 角色级覆盖，未覆盖的角色保留内置路由。
//
// ── 与项目安全哲学的关系（不可协商的部分）────────────────────────────────────
//   1. 配置只在进程启动时读一次，之后全部表结构不可变 —— 与 ROUTES 的
//      「不接受运行时覆盖」同一条哲学。
//   2. DENIED_LLM_HOSTS（已知 LLM 网关黑名单）**不可配置覆盖**：配置声明的 host
//      命中黑名单时，注册阶段直接抛错（hosts.ts 的 registerConfiguredHosts）。
//   3. 配置模型必须**显式声明可 pin 性**（pinnability: snapshot | alias-only）——
//      「未登记不得默认成 snapshot」对配置模型同样成立。
//   4. 校验失败 = 抛错 = 进程起不来。不存在「配置格式错就静默用内置表」——
//      那会让「以为在走本地代理」这件事没有任何征兆。
//   5. 路由覆盖里的 model 引用只能指向**配置声明的 provider**。想让某个角色保留
//      厂商直连：不给它写覆盖即可。内置 provider 的模型不能经配置重指 ——
//      「内置 provider + 换个模型」没有不换 baseURL 就成立的形态。
//
// ⚠️ 手写校验而不是 zod：packages/llm 的依赖里没有 zod，而给本包新增供应链依赖
// 需要一次阻断式人工包合法性确认（Plan 02 的 checkpoint 协议）。这层结构固定、
// 字段类型简单，手写校验的成本低于占用一次人工门禁。

import { readFileSync } from 'node:fs';

import {
  hostOf,
  registerConfiguredHosts,
  resetConfiguredHostsForTests,
} from './hosts.ts';
import { SEMANTIC_ROLES, type SemanticRole } from './types.ts';

/** 指向配置文件路径的环境变量。未设置 = 不加载配置，全部走内置路由表。 */
export const LLM_ROUTES_CONFIG_ENV = 'LLM_ROUTES_CONFIG';

/** Phase 1 唯一支持的配置 provider API 形态。 */
export type ConfiguredProviderApi = 'openai-compatible';

export type ConfiguredPinnability = 'snapshot' | 'alias-only';

/** 配置声明的单个模型（provider 名下的 models 条目）。 */
export interface ConfiguredModel {
  readonly pinnability: ConfiguredPinnability;
}

/** 配置声明的一个 provider（如本地代理、云厂商兼容端点）。 */
export interface ConfiguredProvider {
  readonly id: string;
  readonly api: ConfiguredProviderApi;
  readonly baseUrl: string;
  /** API key 的环境变量名。key 本体不进配置文件 —— 与 .env 的分工一致。 */
  readonly apiKeyEnv: string;
  readonly models: Readonly<Record<string, ConfiguredModel>>;
}

/**
 * 路由覆盖补丁：model 引用（provider/model）已被解析成 RouteConfig 兼容的字段。
 * 全部字段在 routes.ts 的 mergeRouteTable 里做字段级合并。
 */
export interface RouteOverride {
  readonly provider: string;
  readonly modelSnapshot: string;
  readonly baseURL: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly thinkingMode?: 'off' | 'auto';
  readonly priceTierBoundaries?: readonly number[];
  readonly aliasOnlyWaiver?: string | null;
  readonly enabled?: boolean;
}

/** 规范化后的完整配置。 */
export interface LlmRoutesConfig {
  readonly providers: Readonly<Record<string, ConfiguredProvider>>;
  readonly routes: Readonly<Partial<Record<SemanticRole, RouteOverride>>>;
}

const EMPTY_CONFIG: LlmRoutesConfig = Object.freeze({
  providers: Object.freeze({}) as Readonly<Record<string, ConfiguredProvider>>,
  routes: Object.freeze({}),
});

// ── 手写校验（结构固定，fail-fast）────────────────────────────────────────────

class ConfigError extends Error {
  constructor(path: string, message: string) {
    super(`llm.config.json 的 ${path}：${message}`);
    this.name = 'ConfigError';
  }
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(path, '必须是对象');
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(path, '必须是非空字符串');
  }
  return value;
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(path, '必须是有限数字');
  }
  return value;
}

/** 内置 provider 名 —— 配置 id 与它们冲突会让 resolveProvider 的语义分叉。 */
const BUILTIN_PROVIDER_IDS = new Set(['volcengine', 'zhipu', 'aliyun', 'anthropic', 'deepseek', 'mock']);

function parsePinnability(value: unknown, path: string): ConfiguredPinnability {
  if (value !== 'snapshot' && value !== 'alias-only') {
    throw new ConfigError(path, "必须是 'snapshot' | 'alias-only'（未登记不得默认成 snapshot）");
  }
  return value;
}

function parseModels(value: unknown, path: string): Record<string, ConfiguredModel> {
  const source = asObject(value, path);
  const models: Record<string, ConfiguredModel> = {};
  const keys = Object.keys(source);
  if (keys.length === 0) {
    throw new ConfigError(path, 'models 不能为空 —— 一个 provider 至少声明一个模型');
  }
  for (const modelId of keys) {
    const entry = asObject(source[modelId], `${path}.models.${modelId}`);
    models[modelId] = Object.freeze({
      pinnability: parsePinnability(
        entry['pinnability'],
        `${path}.models.${modelId}.pinnability`,
      ),
    });
  }
  return Object.freeze(models);
}

function parseProvider(id: string, value: unknown): ConfiguredProvider {
  const path = `providers.${id}`;
  const source = asObject(value, path);
  const api = source['api'];
  if (api !== 'openai-compatible') {
    throw new ConfigError(`${path}.api`, "Phase 1 只支持 'openai-compatible'");
  }
  const baseUrl = asString(source['baseUrl'], `${path}.baseUrl`);
  // 显式校验 URL 形状：解析不出 host 的 baseUrl 无法做白名单检查（hosts.ts 的哲学）。
  try {
    if (new URL(baseUrl).host.length === 0) throw new Error('no host');
  } catch {
    throw new ConfigError(`${path}.baseUrl`, '必须是可解析出 host 的完整 URL');
  }
  const provider: ConfiguredProvider = Object.freeze({
    id,
    api,
    baseUrl,
    apiKeyEnv: asString(source['apiKeyEnv'], `${path}.apiKeyEnv`),
    models: parseModels(source['models'], path),
  });
  return provider;
}

function parseModelReference(
  value: unknown,
  path: string,
  providers: Readonly<Record<string, ConfiguredProvider>>,
): { readonly providerId: string; readonly model: string } {
  const reference = asString(value, path);
  const slash = reference.indexOf('/');
  if (slash <= 0 || slash === reference.length - 1) {
    throw new ConfigError(path, "model 引用必须是 'provider/model' 形态");
  }
  const providerId = reference.slice(0, slash);
  const model = reference.slice(slash + 1);
  const provider = providers[providerId];
  if (provider === undefined) {
    // 只允许指向配置声明的 provider —— 内置 provider 的模型不经配置重指（见文件头第 5 条）。
    throw new ConfigError(
      path,
      `引用的 provider '${providerId}' 没有在 providers 里声明。内置厂商模型不经配置覆盖；想保留内置路由就不写这个角色`,
    );
  }
  if (provider.models[model] === undefined) {
    throw new ConfigError(
      path,
      `provider '${providerId}' 的 models 里没有登记 '${model}'`,
    );
  }
  return Object.freeze({ providerId, model });
}

function parseRouteOverride(
  role: string,
  value: unknown,
  providers: Readonly<Record<string, ConfiguredProvider>>,
): RouteOverride {
  const path = `routes.${role}`;
  const source = asObject(value, path);
  if (!(SEMANTIC_ROLES as readonly string[]).includes(role)) {
    throw new ConfigError(path, `不属于语义角色（${SEMANTIC_ROLES.join(' | ')}）`);
  }
  const { providerId, model } = parseModelReference(source['model'], `${path}.model`, providers);

  const override: {
    provider: string;
    modelSnapshot: string;
    baseURL: string;
    temperature?: number;
    maxOutputTokens?: number;
    thinkingMode?: 'off' | 'auto';
    priceTierBoundaries?: number[];
    aliasOnlyWaiver?: string | null;
    enabled?: boolean;
  } = {
    provider: providerId,
    modelSnapshot: model,
    baseURL: providers[providerId]?.baseUrl ?? '',
  };

  if (source['temperature'] !== undefined) {
    const t = asNumber(source['temperature'], `${path}.temperature`);
    if (t < 0 || t > 2) throw new ConfigError(`${path}.temperature`, '必须在 [0, 2]');
    override.temperature = t;
  }
  if (source['maxOutputTokens'] !== undefined) {
    const m = asNumber(source['maxOutputTokens'], `${path}.maxOutputTokens`);
    if (m <= 0) throw new ConfigError(`${path}.maxOutputTokens`, '必须大于 0');
    override.maxOutputTokens = m;
  }
  if (source['thinkingMode'] !== undefined) {
    if (source['thinkingMode'] !== 'off' && source['thinkingMode'] !== 'auto') {
      throw new ConfigError(`${path}.thinkingMode`, "必须是 'off' | 'auto'");
    }
    override.thinkingMode = source['thinkingMode'];
  }
  if (source['priceTierBoundaries'] !== undefined) {
    const raw = source['priceTierBoundaries'];
    if (!Array.isArray(raw)) {
      throw new ConfigError(`${path}.priceTierBoundaries`, '必须是数字数组');
    }
    const boundaries = raw.map((b, i) => {
      const n = asNumber(b, `${path}.priceTierBoundaries[${i}]`);
      if (i > 0 && n <= (raw[i - 1] as number)) {
        throw new ConfigError(`${path}.priceTierBoundaries`, '必须严格升序（档位会算错）');
      }
      return n;
    });
    override.priceTierBoundaries = boundaries;
  }
  if (source['aliasOnlyWaiver'] !== undefined) {
    const w = source['aliasOnlyWaiver'];
    if (w !== null && typeof w !== 'string') {
      throw new ConfigError(`${path}.aliasOnlyWaiver`, '必须是字符串或 null');
    }
    override.aliasOnlyWaiver = w;
  }
  if (source['enabled'] !== undefined) {
    if (typeof source['enabled'] !== 'boolean') {
      throw new ConfigError(`${path}.enabled`, '必须是布尔值');
    }
    override.enabled = source['enabled'];
  }
  return Object.freeze(override);
}

/** 解析（校验）一份原始 JSON。导出给契约测试喂「被改坏的副本」。 */
export function parseLlmConfig(raw: unknown): LlmRoutesConfig {
  const root = asObject(raw, '(root)');
  const providersRaw = asObject(root['providers'] ?? {}, 'providers');

  const providers: Record<string, ConfiguredProvider> = {};
  for (const id of Object.keys(providersRaw)) {
    if (BUILTIN_PROVIDER_IDS.has(id)) {
      throw new ConfigError(
        `providers.${id}`,
        'id 与内置 provider 名冲突 —— 那是厂商直连的登记名，配置不得复用',
      );
    }
    providers[id] = parseProvider(id, providersRaw[id]);
  }

  const routesRaw = asObject(root['routes'] ?? {}, 'routes');
  const routes: Partial<Record<SemanticRole, RouteOverride>> = {};
  for (const role of Object.keys(routesRaw)) {
    routes[role as SemanticRole] = parseRouteOverride(role, routesRaw[role], providers);
  }
  return Object.freeze({
    providers: Object.freeze(providers),
    routes: Object.freeze(routes),
  });
}

// ── 加载（进程生命周期内一次）──────────────────────────────────────────────────

let loaded: LlmRoutesConfig | undefined;

/** 读 env 指向的配置文件并校验。未设置 env ⇒ 空配置（全内置路由）。 */
function load(): LlmRoutesConfig {
  const configPath = process.env[LLM_ROUTES_CONFIG_ENV];
  if (configPath === undefined || configPath.length === 0) return EMPTY_CONFIG;
  let text: string;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch (cause) {
    throw new Error(`LLM_ROUTES_CONFIG=${configPath} 读取失败：${String(cause)} —— 配置路径存在就必须可读，起不来是可见的。`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new Error(`LLM_ROUTES_CONFIG=${configPath} 不是合法 JSON：${String(cause)}`);
  }
  const parsed = parseLlmConfig(raw);
  // 配置声明的 host 一次性注入白名单（网关黑名单在这里就拦下）。
  registerConfiguredHosts(Object.values(parsed.providers).map((p) => hostOf(p.baseUrl)));
  return parsed;
}

function current(): LlmRoutesConfig {
  if (loaded === undefined) loaded = load();
  return loaded;
}

/** 当前生效的完整配置（快照）。 */
export function llmConfig(): LlmRoutesConfig {
  return current();
}

/** 配置是否声明了这个 provider id。 */
export function isConfiguredProviderId(id: string): boolean {
  return current().providers[id] !== undefined;
}

/** 取配置 provider；未声明返回 undefined。 */
export function configuredProviderOf(id: string): ConfiguredProvider | undefined {
  return current().providers[id];
}

/** 配置模型 → provider 归属（等价于内置 MODELS 表的配置侧）。 */
export function configuredProviderOfModel(model: string): string | undefined {
  for (const provider of Object.values(current().providers)) {
    if (provider.models[model] !== undefined) return provider.id;
  }
  return undefined;
}

/** 配置模型 → 可 pin 性。 */
export function configuredPinnabilityOf(model: string): ConfiguredPinnability | undefined {
  for (const provider of Object.values(current().providers)) {
    const entry = provider.models[model];
    if (entry !== undefined) return entry.pinnability;
  }
  return undefined;
}

/** 角色级路由覆盖。 */
export function routeOverrides(): Readonly<Partial<Record<SemanticRole, RouteOverride>>> {
  return current().routes;
}

/** 仅供测试：注入指定路径的配置并重置 host 注册表。不影响已冻结的 ROUTES。 */
export function reloadLlmConfigForTests(path: string): LlmRoutesConfig {
  resetConfiguredHostsForTests();
  loaded = undefined;
  process.env[LLM_ROUTES_CONFIG_ENV] = path;
  const result = load();
  loaded = result;
  return result;
}

/** 仅供测试：清空配置，回到「全内置路由」状态。 */
export function clearLlmConfigForTests(): void {
  resetConfiguredHostsForTests();
  loaded = undefined;
  delete process.env[LLM_ROUTES_CONFIG_ENV];
}
