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
