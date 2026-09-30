// LLM 出网 host 白名单（PLAT-06 第三层）。
//
// 为什么需要它：PLAT-06 的 ESLint 规则（Plan 02）挡住了 `model: '字符串'` 这种
// 默认路由到境外 AI Gateway 的写法，但 RESEARCH §5.4 第 3 条记了一个 AST 看不出来的
// 漏洞 —— **provider 实例本身可以指向一个网关**
// （`createOpenAICompatible({ baseURL: 'https://gateway…' })`）。AST 规则看不出
// 一个 URL 字符串是不是网关，所以只能用「host 必须在一张写死的白名单里」来补位，
// 并且在启动期断言一次（tools/ci/llm-router-contract.test.ts 同时在 CI 里遍历一次）。
//
// ── 两张表，不是一张 ────────────────────────────────────────────────────────
// 真实用户对话只能走 ALLOWED_LLM_HOSTS（境内）。境外 host 单独放在
// SYNTHETIC_ONLY_HOSTS，且只有 chat.reply.frontier 一个角色可以用它 —— 而那个角色
// 在类型层只接受 SyntheticText（PLAT-07）。两张表必须互斥：把境外 host 混进
// 境内白名单，就等于把 T-05-01（真实对话出境、不可逆）降级成一次代码评审。

/** mock provider 不出网。它需要一个显式的 host 取值，否则断言里会出现一条 `null 就跳过` 的分支 —— 那是典型的 fail-open 形状。 */
export const MOCK_HOST_SENTINEL = 'mock.invalid';

/**
 * 境内 host 白名单。真实用户对话只能落在这里面。
 *
 * `.invalid` 是 RFC 2606 保留域，DNS 永不解析 —— 万一哨兵值真的被发出去，
 * 它也到不了任何主机。
 */
export const ALLOWED_LLM_HOSTS: ReadonlySet<string> = Object.freeze(
  new Set([
    'ark.cn-beijing.volces.com', // 火山方舟（chat.reply，Phase 1 启用）
    'open.bigmodel.cn', // 智谱（safety.classify，Phase 1 启用）
    'dashscope.aliyuncs.com', // 阿里云百炼（persona.reflect 声明用它，Phase 1 未启用）
    MOCK_HOST_SENTINEL,
  ]),
);

/**
 * 境外 host —— **只允许 chat.reply.frontier 使用**，且该通道只接受 SyntheticText。
 * 这张表里的每一项都是一次「真实对话绝不能流过去」的声明。
 */
export const SYNTHETIC_ONLY_HOSTS: ReadonlySet<string> = Object.freeze(
  new Set(['api.anthropic.com']),
);

/**
 * 已知的 LLM 网关 / 中转 host。
 *
 * 它们不属于任何一家模型厂商，而是「把请求转发到别处」的中间层 —— 也就是
 * T-05-01 的确切形态：备案主体对不上，且流量实际落在哪个国家不可知。
 * 断言要求上面两张表与这张表**不相交**：有人往白名单里加网关 host 时立刻炸。
 */
export const DENIED_LLM_HOSTS: ReadonlySet<string> = Object.freeze(
  new Set([
    'gateway.ai.cloudflare.com',
    'ai-gateway.vercel.sh',
    'gateway.vercel.ai',
    'openrouter.ai',
    'gateway.helicone.ai',
    'api.portkey.ai',
  ]),
);

/**
 * 回环 host：localhost / 127.x.x.x / [::1]，允许带任意端口。
 *
 * 回环地址不出网卡，「真实对话出境」（T-05-01）对它不成立，所以它不需要进
 * ALLOWED_LLM_HOSTS 就能被 classifyHost 放行 —— 本地代理服务（llm.config.json 的
 * 配置 provider）跑在这里。
 *
 * 端口剥离：IPv6 字面量形如 `[::1]:8080`（从 `]` 后剥），其余从最后一个 `:` 剥。
 */
const LOOPBACK_HOST_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/;

/** 判定一个 host（hostOf 的返回值，可能带端口）是否回环。 */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOST_PATTERN.test(host);
}

/**
 * 配置文件（llm.config.json）声明的自定义 provider host。
 *
 * 这些 host 不写进 ALLOWED_LLM_HOSTS（写死在 git 里的是「厂商直连」表），而是在
 * 启动加载配置时**一次性**经 registerConfiguredHosts 注入。注入窗口关闭后再次调用
 * 即抛错 —— 与 routes.ts 的「不接受运行时覆盖」同一条哲学：配置只在进程启动时读
 * 一次，之后全部表结构不可变。
 *
 * ⚠️ DENIED_LLM_HOSTS（网关黑名单）**不可配置覆盖**：已知 LLM 网关即使写进配置文件
 * 也照样拒绝 —— 那是 T-05-01 的确切形态，不属于「部署者可自行决定」的范围。
 */
const CONFIGURED_LLM_HOSTS = new Set<string>();
let configuredHostsFrozen = false;

/**
 * 注册配置声明的 host。只能在启动期调用一次；第二次调用抛错。
 * 与 DENIED_LLM_HOSTS 相交的 host 直接拒绝注册（fail-fast，不留到断言才发现）。
 */
export function registerConfiguredHosts(hosts: Iterable<string>): void {
  if (configuredHostsFrozen) {
    throw new Error('registerConfiguredHosts 已冻结：host 白名单只在进程启动时注入一次，不接受运行时篡改。');
  }
  for (const host of hosts) {
    if (DENIED_LLM_HOSTS.has(host)) {
      throw new Error(`配置文件声明了已知 LLM 网关 host：${host} —— 网关把请求转发到别处，流量落在哪个国家不可知，拒绝注册。`);
    }
    CONFIGURED_LLM_HOSTS.add(host);
  }
  configuredHostsFrozen = true;
}

/**
 * 取 baseURL 的 host。`null`（不出网）映射到哨兵值，于是调用方不需要写分支。
 *
 * 解析失败即抛错：一个解析不出 host 的 baseURL 无法被白名单检查，
 * 而「检查不了就放过」正是本文件要消灭的形状。
 */
export function hostOf(baseUrl: string | null): string {
  if (baseUrl === null) return MOCK_HOST_SENTINEL;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`baseURL 无法解析成 URL：${baseUrl} —— 无法对它做 host 白名单检查。`);
  }
  if (parsed.host.length === 0) {
    throw new Error(`baseURL 解析后没有 host：${baseUrl}`);
  }
  return parsed.host;
}

/**
 * 仅供测试：重置配置 host 注册表，让下一个用例可以注入不同的配置副本。
 *
 * ⚠️ 绝不在生产代码调用 —— 它的存在是「断言必须可证伪」的成本：没有它，
 * 契约测试只能测第一个注入的配置，之后的用例全部空转。
 */
export function resetConfiguredHostsForTests(): void {
  CONFIGURED_LLM_HOSTS.clear();
  configuredHostsFrozen = false;
}

/** 成员判定：classifyHost 用（活集合，读启动时注入的配置 host）。 */
export function isConfiguredHost(host: string): boolean {
  return CONFIGURED_LLM_HOSTS.has(host);
}

/** 断言与测试用：当前已注册的配置 host 快照。 */
export function configuredLlmHosts(): ReadonlySet<string> {
  return Object.freeze(new Set(CONFIGURED_LLM_HOSTS));
}
