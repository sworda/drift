// 启动期断言（SAFE-02 / PLAT-05 / PLAT-06）。
//
// 三类配置错误在这里变成「进程起不来」，而不是「半年后从数据里看出来」：
//   1. 危机判定与扮演角色被配到了同一个模型（或同一个厂商）
//   2. 只能 pinned 的角色指向了一个 alias-only 模型（= 尺子会被静默换掉）
//   3. 某条 baseURL 的 host 不在白名单里（= 真实对话可能出境，不可逆）
//
// ⚠️ 全部断言都接受一个 `routes` 参数（默认 ROUTES）。这不是为了灵活性，而是为了
// **可证伪**：契约测试传入被改坏的副本，证明这些断言真的会炸。一条从未被证明会
// 失败的启动断言与一条不存在的断言没有区别，而它还会提供虚假的安全感。

import { classifyHost, ROUTES, type RouteConfig } from './routes.ts';
import { isConfiguredProviderId } from './config.ts';
import { ALLOWED_LLM_HOSTS, DENIED_LLM_HOSTS, hostOf, SYNTHETIC_ONLY_HOSTS } from './hosts.ts';
import { pinnabilityOf } from './pinnability.ts';
import { PINNED_ONLY_ROLES, SEMANTIC_ROLES, type SemanticRole } from './types.ts';

export type RouteTable = Readonly<Record<SemanticRole, RouteConfig>>;

/** 只有这个角色可以指向境外 host，且它在类型层只接受 SyntheticText（PLAT-07）。 */
const FRONTIER_ROLE: SemanticRole = 'chat.reply.frontier';

function assertRolesComplete(routes: RouteTable): void {
  const configured = new Set(Object.keys(routes));
  for (const role of SEMANTIC_ROLES) {
    if (!configured.has(role)) {
      throw new Error(
        `PLAT-05 违反：语义角色 ${role} 没有路由表条目。留空洞的后果是第一次用到它时临时配一个 —— 那个配置不会经过这里的任何一条断言。`,
      );
    }
    configured.delete(role);
  }
  if (configured.size > 0) {
    throw new Error(
      `路由表里有不属于 SemanticRole 的键：${[...configured].join(', ')} —— purpose 的取值域与 llm_call 的 CHECK 约束必须逐字一致。`,
    );
  }
}

/**
 * SAFE-02「不同厂商」要求在自定义 provider（llm.config.json 注入）场景下的放宽判定。
 *
 * 内置厂商（volcengine / zhipu / …）的分离要求**不变** —— 一次厂商侧故障不应同时
 * 打掉角色层与安全层。自定义 provider（本地代理、云厂商兼容端点）背后是**部署者
 * 自己控制的模型集合**：chat.reply 与 safety.classify 同走一个自定义 provider 时，
 * 分离语义由「不同模型」（assertModelSeparation 的第一条断言，不放宽）承担。
 * 这是部署者在配置文件里的显式选择，不是静默豁免 —— 所以仅当两个 provider 都是
 * 配置注入的 id 时才放行；任何一侧是内置厂商都照常抛错。
 */
function safe02ProviderWaiver(replyProvider: string, classifyProvider: string): boolean {
  return (
    replyProvider === classifyProvider &&
    isConfiguredProviderId(replyProvider) &&
    isConfiguredProviderId(classifyProvider)
  );
}

/** 断言 1：模型分离（SAFE-02）。 */
function assertModelSeparation(routes: RouteTable): void {
  const reply = routes['chat.reply'];
  const frontier = routes[FRONTIER_ROLE];
  const classify = routes['safety.classify'];

  if (classify.modelSnapshot === reply.modelSnapshot) {
    throw new Error(
      `SAFE-02 违反：safety.classify 与 chat.reply 用了同一个模型（${classify.modelSnapshot}）。危机判定必须由与扮演角色不同的模型执行 —— 同一个模型既扮演又判定，人格指令会与安全指令竞争并系统性降低敏感度。`,
    );
  }
  if (classify.modelSnapshot === frontier.modelSnapshot) {
    throw new Error(
      `SAFE-02 违反：safety.classify 与 chat.reply.frontier 用了同一个模型（${classify.modelSnapshot}）。`,
    );
  }
  if (classify.provider === reply.provider && !safe02ProviderWaiver(reply.provider, classify.provider)) {
    throw new Error(
      `SAFE-02 违反：safety.classify 与 chat.reply 用了同一个厂商（${classify.provider}）。不同厂商是硬要求 —— 一次厂商侧故障不应同时打掉角色层与安全层。`,
    );
  }
}

/** 断言 2：alias-only 不得进 pinned 路径；routed 路径用它必须有书面 waiver。 */
function assertPinnability(routes: RouteTable): void {
  for (const role of SEMANTIC_ROLES) {
    const route = routes[role];
    const declared = pinnabilityOf(route.modelSnapshot);
    if (declared === undefined) {
      throw new Error(
        `${role} 指向的模型 ${route.modelSnapshot} 没有登记可 pin 性。未登记不得默认成 snapshot —— 那等于让一个没人核实过的模型直接进 pinned 路径。`,
      );
    }
    const pinnedOnly = (PINNED_ONLY_ROLES as readonly SemanticRole[]).includes(role);
    if (pinnedOnly && declared !== 'snapshot') {
      throw new Error(
        `${role} 只能走 pinned 模式，但它指向的 ${route.modelSnapshot} 是 ${declared}。降级换模型等于尺子在测量过程中被换掉 —— 拒绝启动，不降级不静默。`,
      );
    }
    if (declared !== 'snapshot' && (route.aliasOnlyWaiver ?? '').length === 0) {
      throw new Error(
        `${role} 指向的 ${route.modelSnapshot} 不可 pin，但 routes.ts 里没有写 aliasOnlyWaiver 理由。不可 pin 的模型可以用，但必须留下一条书面理由与补偿措施（resolved_model 日 diff 告警）。`,
      );
    }
    for (let i = 1; i < route.priceTierBoundaries.length; i += 1) {
      const prev = route.priceTierBoundaries[i - 1] ?? 0;
      const current = route.priceTierBoundaries[i] ?? 0;
      if (current <= prev) {
        throw new Error(
          `${role} 的 priceTierBoundaries 不是严格升序（${String(prev)} → ${String(current)}）—— 档位会算错，而成本表看起来是对的。`,
        );
      }
    }
  }
}

/** 断言 3：host 白名单（PLAT-06 的第三层，补 AST 规则看不见的那个漏洞）。 */
function assertHosts(routes: RouteTable): void {
  for (const host of ALLOWED_LLM_HOSTS) {
    if (DENIED_LLM_HOSTS.has(host)) {
      throw new Error(
        `境内白名单里出现了一个已知的 LLM 网关 host：${host}。网关不属于任何模型厂商，它把请求转发到别处 —— 备案主体对不上，流量落在哪个国家不可知。`,
      );
    }
    if (SYNTHETIC_ONLY_HOSTS.has(host)) {
      throw new Error(
        `${host} 同时出现在境内白名单与仅合成白名单里。两张表必须互斥，否则「真实对话只走境内」就退化成一次代码评审。`,
      );
    }
  }
  for (const host of SYNTHETIC_ONLY_HOSTS) {
    if (DENIED_LLM_HOSTS.has(host)) {
      throw new Error(`仅合成白名单里出现了一个已知的 LLM 网关 host：${host}。`);
    }
  }

  for (const role of SEMANTIC_ROLES) {
    const route = routes[role];
    const host = hostOf(route.baseURL);
    const hostClass = classifyHost(host);
    if (hostClass === 'unlisted') {
      throw new Error(
        `${role} 的 baseURL host ${host} 不在任何白名单里。AST 规则看不出一个 URL 是不是网关，所以未登记的 host 一律拒绝启动。`,
      );
    }
    if (hostClass === 'synthetic-only' && role !== FRONTIER_ROLE) {
      throw new Error(
        `${role} 的 baseURL host ${host} 是境外的（仅合成通道）。只有 ${FRONTIER_ROLE} 可以用它，因为只有那个角色在类型层只接受 SyntheticText。真实用户对话发出即已出境，不可逆。`,
      );
    }
    if (hostClass === 'domestic' && role === FRONTIER_ROLE) {
      throw new Error(
        `${FRONTIER_ROLE} 的 baseURL host ${host} 落在境内白名单里。这条通道的定义就是境外；把它指向境内 host 会让「境外通道只接受合成文本」这条约束失去被检查的对象。`,
      );
    }
    // loopback（回环）与 configured（配置声明的宿主代理，如 docker 网桥 IP）对
    // **任何**角色放行，frontier 也不例外：两者都是部署者显式控制的服务边界，不是
    // 公网上的可猜测域名，「真实对话出境」的威胁模型对它们不成立；frontier 通道的
    // 类型层防线（只接受 SyntheticText）与通道指向无关，照常成立。
  }
}

/**
 * 三条启动期断言。**进程启动的第一步**调用它，抛错即让进程 exit 1。
 *
 * 顺序有意：先完备性（键集合），再模型分离，再可 pin 性，最后 host。
 * 配置不完备时先报「缺哪个角色」比先报一条看起来无关的 host 错误可读得多。
 */
export function assertRouterInvariants(routes: RouteTable = ROUTES): void {
  assertRolesComplete(routes);
  assertModelSeparation(routes);
  assertPinnability(routes);
  assertHosts(routes);
}
