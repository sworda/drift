// Model Router 的契约断言（PLAT-03/05/06/07 + SAFE-02）。
//
// ⚠️ 这一层**不连数据库、不连 LLM**，所以这里只 import Router 的配置与纯函数模块，
// 不 import `@drift/llm` 的包入口 —— 入口会经 router.ts 拉进 @drift/db，而那个包在
// import 时就要求 DATABASE_URL。contract 层（ci:fast）跑在没有数据库的托管 runner 上。
//
// ── 这个文件的判据不是「检查存在」，而是「检查在被违反时真的会失败」──────────
// 每一条启动期断言都配了一个**被改坏的路由表副本**：断言通过一个正确的表不能证明
// 任何事（空真），只有「喂它一个错的表、它炸了」才能。assertRouterInvariants 的
// routes 参数就是为此存在的。

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { aliasResolvedEvent } from '../../packages/llm/src/events.ts';
import {
  ALLOWED_LLM_HOSTS,
  DENIED_LLM_HOSTS,
  hostOf,
  MOCK_HOST_SENTINEL,
  SYNTHETIC_ONLY_HOSTS,
} from '../../packages/llm/src/hosts.ts';
import { PINNABLE, pinnabilityOf } from '../../packages/llm/src/pinnability.ts';
import { mockProvider } from '../../packages/llm/src/providers/mock.ts';
import {
  boundariesForModel,
  classifyHost,
  priceTierFor,
  ROUTES,
  type RouteConfig,
} from '../../packages/llm/src/routes.ts';
import {
  assertRouterInvariants,
  type RouteTable,
} from '../../packages/llm/src/startup-assertions.ts';
import { SEMANTIC_ROLES, type Provider, type SemanticRole } from '../../packages/llm/src/types.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PINNABILITY_SOURCE = readFileSync(
  join(REPO_ROOT, 'packages', 'llm', 'src', 'pinnability.ts'),
  'utf8',
);

/** 改坏一条路由后的副本。断言必须对它失败。 */
function withRoute(role: SemanticRole, patch: Partial<RouteConfig>): RouteTable {
  return { ...ROUTES, [role]: { ...ROUTES[role], ...patch } } as RouteTable;
}

/** 删掉一个角色后的副本。PLAT-05 的完备性断言必须对它失败。 */
function withoutRole(role: SemanticRole): RouteTable {
  const copy: Record<string, RouteConfig> = { ...ROUTES };
  delete copy[role];
  return copy as RouteTable;
}

describe('PLAT-05：6 个语义角色各自独立配置，无空洞', () => {
  it('ROUTES 的键恰好是 6 个 SemanticRole', () => {
    expect(new Set(Object.keys(ROUTES))).toEqual(new Set(SEMANTIC_ROLES));
    expect(SEMANTIC_ROLES).toHaveLength(6);
  });

  it('每条配置字段齐全（留空洞等于第一次用到时临时配一个）', () => {
    for (const role of SEMANTIC_ROLES) {
      const route = ROUTES[role];
      expect(route.provider.length, role).toBeGreaterThan(0);
      expect(route.requestedModel.length, role).toBeGreaterThan(0);
      expect(route.modelSnapshot.length, role).toBeGreaterThan(0);
      expect(route.baseURL.length, role).toBeGreaterThan(0);
      expect(route.temperature, role).toBeGreaterThanOrEqual(0);
      expect(route.temperature, role).toBeLessThanOrEqual(2);
      expect(route.maxOutputTokens, role).toBeGreaterThan(0);
      expect(['off', 'auto'], role).toContain(route.thinkingMode);
      expect(Array.isArray(route.priceTierBoundaries), role).toBe(true);
      expect(typeof route.enabled, role).toBe('boolean');
    }
  });

  it('Phase 1 恰好启用 chat.reply 与 safety.classify 两个角色', () => {
    const enabled = SEMANTIC_ROLES.filter((role) => ROUTES[role].enabled);
    expect(new Set(enabled)).toEqual(new Set(['chat.reply', 'safety.classify']));
  });

  it('删掉任一角色后启动期断言必须抛错', () => {
    for (const role of SEMANTIC_ROLES) {
      expect(() => {
        assertRouterInvariants(withoutRole(role));
      }, `删掉 ${role} 后断言竟然通过了`).toThrow(/PLAT-05|没有路由表条目/);
    }
  });

  it('未改动的真实路由表通过全部断言', () => {
    expect(() => {
      assertRouterInvariants();
    }).not.toThrow();
  });
});

describe('SAFE-02：危机判定由与扮演角色不同的模型、不同厂商执行', () => {
  it('真实配置下 safety.classify 与两个扮演角色都不同模型、且与 chat.reply 不同厂商', () => {
    const classify = ROUTES['safety.classify'];
    expect(classify.modelSnapshot).not.toBe(ROUTES['chat.reply'].modelSnapshot);
    expect(classify.modelSnapshot).not.toBe(ROUTES['chat.reply.frontier'].modelSnapshot);
    expect(classify.provider).not.toBe(ROUTES['chat.reply'].provider);
  });

  it('把 safety.classify 改成与 chat.reply 同模型 ⇒ 抛错', () => {
    const reply = ROUTES['chat.reply'];
    expect(() => {
      assertRouterInvariants(
        withRoute('safety.classify', {
          modelSnapshot: reply.modelSnapshot,
          requestedModel: reply.requestedModel,
        }),
      );
    }).toThrow(/SAFE-02/);
  });

  it('把 safety.classify 改成与 chat.reply.frontier 同模型 ⇒ 抛错', () => {
    expect(() => {
      assertRouterInvariants(
        withRoute('safety.classify', {
          modelSnapshot: ROUTES['chat.reply.frontier'].modelSnapshot,
          requestedModel: ROUTES['chat.reply.frontier'].requestedModel,
          aliasOnlyWaiver: null,
        }),
      );
    }).toThrow(/SAFE-02/);
  });

  it('模型不同但厂商相同 ⇒ 仍然抛错（一次厂商侧故障不应同时打掉两层）', () => {
    expect(() => {
      assertRouterInvariants(
        withRoute('safety.classify', { provider: ROUTES['chat.reply'].provider }),
      );
    }).toThrow(/同一个厂商/);
  });
});

describe('PLAT-06 第三层：baseURL host 白名单', () => {
  it('每条 baseURL 的 host 都在白名单里，且只有 chat.reply.frontier 可以是境外', () => {
    for (const role of SEMANTIC_ROLES) {
      const host = hostOf(ROUTES[role].baseURL);
      const hostClass = classifyHost(host);
      expect(hostClass, `${role} 的 host ${host} 不在任何白名单里`).not.toBe('unlisted');
      if (role === 'chat.reply.frontier') expect(hostClass).toBe('synthetic-only');
      else expect(hostClass, `${role} 指向了境外 host`).toBe('domestic');
    }
  });

  it('境内白名单与「仅合成」白名单互斥，且都不含已知网关 host', () => {
    for (const host of ALLOWED_LLM_HOSTS) {
      expect(SYNTHETIC_ONLY_HOSTS.has(host), host).toBe(false);
      expect(DENIED_LLM_HOSTS.has(host), host).toBe(false);
    }
    for (const host of SYNTHETIC_ONLY_HOSTS) {
      expect(DENIED_LLM_HOSTS.has(host), host).toBe(false);
    }
    expect(DENIED_LLM_HOSTS.size).toBeGreaterThan(0);
  });

  it('把某条 baseURL 改成不在白名单里的 host ⇒ 抛错', () => {
    expect(() => {
      assertRouterInvariants(
        withRoute('chat.reply', { baseURL: 'https://gateway.ai.cloudflare.com/v1/openai' }),
      );
    }).toThrow(/不在任何白名单里/);
  });

  it('把非 frontier 角色指向境外 host ⇒ 抛错（真实对话发出即已出境）', () => {
    expect(() => {
      assertRouterInvariants(withRoute('chat.reply', { baseURL: 'https://api.anthropic.com/v1' }));
    }).toThrow(/境外/);
  });

  it('把 frontier 指向境内 host ⇒ 抛错（约束会失去被检查的对象）', () => {
    expect(() => {
      assertRouterInvariants(
        withRoute('chat.reply.frontier', { baseURL: ROUTES['chat.reply'].baseURL }),
      );
    }).toThrow(/境内白名单/);
  });

  it('不出网（null）映射到哨兵 host，且哨兵在白名单内', () => {
    expect(hostOf(null)).toBe(MOCK_HOST_SENTINEL);
    expect(ALLOWED_LLM_HOSTS.has(MOCK_HOST_SENTINEL)).toBe(true);
    expect(mockProvider.baseUrl).toBeNull();
  });

  it('解析不出 host 的 baseURL ⇒ 抛错，而不是放过', () => {
    expect(() => hostOf('不是一个 URL')).toThrow(/无法解析/);
  });
});

describe('PLAT-03：可 pin 性是显式表，不是推断', () => {
  it('pinnability.ts 里不出现任何模式匹配 API 的名字', () => {
    for (const needle of ['RegExp', '.test(', 'startsWith', 'endsWith', 'match(']) {
      expect(PINNABILITY_SOURCE.includes(needle), `pinnability.ts 含 ${needle}`).toBe(false);
    }
  });

  it('智谱 flash 分类器被标成 alias-only（Q4），且那一行不出现 snapshot', () => {
    const lines = PINNABILITY_SOURCE.split('\n').filter((line) => line.includes('glm-4.7-flash'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toContain('alias-only');
      expect(line).not.toContain('snapshot');
    }
    expect(pinnabilityOf('glm-4.7-flash')).toBe('alias-only');
  });

  it('每条路由指向的模型都有登记的可 pin 性；未登记返回 undefined 而不是默认 snapshot', () => {
    for (const role of SEMANTIC_ROLES) {
      expect(pinnabilityOf(ROUTES[role].modelSnapshot), role).toBeDefined();
    }
    expect(pinnabilityOf('doubao-seed-character-999999')).toBeUndefined();
    expect(Object.keys(PINNABLE).length).toBeGreaterThanOrEqual(6);
  });

  it('只能 pinned 的角色指向 alias-only 模型 ⇒ 抛错（尺子不得被静默换掉）', () => {
    expect(() => {
      assertRouterInvariants(
        withRoute('persona.probe', {
          modelSnapshot: 'glm-4.7-flash',
          requestedModel: 'glm-4.7-flash',
          provider: 'zhipu',
          baseURL: ROUTES['safety.classify'].baseURL,
        }),
      );
    }).toThrow(/只能走 pinned/);
  });

  it('routed 角色用 alias-only 模型但没写 waiver ⇒ 抛错', () => {
    expect(() => {
      assertRouterInvariants(withRoute('safety.classify', { aliasOnlyWaiver: null }));
    }).toThrow(/aliasOnlyWaiver/);
  });

  it('真实配置里每个 alias-only 路由都写了 waiver 理由', () => {
    for (const role of SEMANTIC_ROLES) {
      const route = ROUTES[role];
      if (pinnabilityOf(route.modelSnapshot) === 'snapshot') continue;
      expect(route.aliasOnlyWaiver, role).not.toBeNull();
      expect((route.aliasOnlyWaiver ?? '').length, role).toBeGreaterThan(20);
    }
  });
});

describe('计价档位：分段计费的边界两侧各一次', () => {
  it('边界下方进 tier0，达到边界进 tier1', () => {
    expect(priceTierFor([32_768], 1)).toBe('tier0');
    expect(priceTierFor([32_768], 32_767)).toBe('tier0');
    expect(priceTierFor([32_768], 32_768)).toBe('tier1');
    expect(priceTierFor([32_768], 120_000)).toBe('tier1');
  });

  it('多段边界逐级抬升；无边界恒为 tier0（但永不为空）', () => {
    expect(priceTierFor([1_000, 10_000], 999)).toBe('tier0');
    expect(priceTierFor([1_000, 10_000], 1_000)).toBe('tier1');
    expect(priceTierFor([1_000, 10_000], 10_000)).toBe('tier2');
    expect(priceTierFor([], 999_999)).toBe('tier0');
    expect(priceTierFor([], 0).length).toBeGreaterThan(0);
  });

  it('chat.reply 的模型带一条 32k 边界（RESEARCH §5.2 的 ¥2→¥6）', () => {
    expect(boundariesForModel(ROUTES['chat.reply'].modelSnapshot)).toEqual([32_768]);
    expect(boundariesForModel('从未登记过的模型')).toEqual([]);
  });

  it('边界不是严格升序 ⇒ 抛错（档位会算错，而成本表看起来是对的）', () => {
    expect(() => {
      assertRouterInvariants(withRoute('chat.reply', { priceTierBoundaries: [32_768, 1_024] }));
    }).toThrow(/升序/);
  });
});

describe('别名被解析：一条 warn 事件，且不含任何对话内容', () => {
  const prompt = '你是「阿离」。对方说：我今天很难过，想找个人说说话。';

  it('requested 与 resolved 一致 ⇒ 没有事件', () => {
    expect(
      aliasResolvedEvent({
        purpose: 'safety.classify',
        requestedModel: 'glm-4.7-flash',
        resolvedModel: 'glm-4.7-flash',
      }),
    ).toBeNull();
  });

  it('用 mock provider 构造一次不一致的回传 ⇒ 一条 warn 事件，字段只有三个', async () => {
    // mock provider 本身恒返回 resolved === requested，所以在它之上派生一个
    // 「厂商把别名解析到另一个快照」的 provider —— 这是 T-05-04 的确切形态。
    const drifting: Provider = {
      ...mockProvider,
      generate: async (request) => ({
        ...(await mockProvider.generate(request)),
        resolvedModel: 'glm-4.7-flash-0930',
      }),
    };
    const response = await drifting.generate({
      purpose: 'safety.classify',
      prompt,
      modelSnapshot: 'glm-4.7-flash',
      temperature: 0,
      maxOutputTokens: 256,
    });
    const event = aliasResolvedEvent({
      purpose: 'safety.classify',
      requestedModel: 'glm-4.7-flash',
      resolvedModel: response.resolvedModel,
    });
    expect(event).not.toBeNull();
    expect(event?.event).toBe('llm.model_alias_resolved');
    expect(event?.level).toBe('warn');
    expect(new Set(Object.keys(event?.fields ?? {}))).toEqual(
      new Set(['purpose', 'requestedModel', 'resolvedModel']),
    );

    // 事件序列化后不得含提示词正文的任何 6 字以上子串。日志文件是一个不能按行
    // 删除的存储位置 —— 一键删除（PRIV-05）级联不到它。
    const serialized = JSON.stringify(event);
    for (let i = 0; i + 6 <= prompt.length; i += 1) {
      expect(serialized.includes(prompt.slice(i, i + 6)), `事件里出现了正文片段：${prompt.slice(i, i + 6)}`).toBe(false);
    }
  });
});

describe('PLAT-07 / 探针：两条类型层约束有负向 fixture 守着', () => {
  it('tools/ci/type-fixtures/probe-routed.ts 必须让 tsc 报出至少 2 条 error TS', () => {
    const tsc = join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
    const run = spawnSync(tsc, ['--noEmit', '-p', 'tools/ci/type-fixtures/tsconfig.json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    expect(run.status, `tsc 竟然通过了负向 fixture：\n${output}`).not.toBe(0);
    const ownErrors = output
      .split('\n')
      .filter((line) => line.includes('probe-routed.ts') && /error TS\d+/.test(line));
    expect(
      ownErrors.length,
      `probe-routed.ts 的报错不足 —— CallMode 的 Exclude 或 SyntheticText 品牌类型可能已退化：\n${output}`,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('resolved_model 日 diff：告警本身不是空真的', () => {
  function runDiff(args: readonly string[], env: NodeJS.ProcessEnv = process.env): ReturnType<typeof spawnSync> {
    return spawnSync(process.execPath, ['tools/ci/model-snapshot-diff.mjs', ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
  }

  it('--dry-run 做出判定并退出 0（校验基线格式，不连库）', () => {
    const run = runDiff(['--dry-run']);
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    expect(run.status, output).toBe(0);
    expect(
      output.includes('OK no model drift') || output.includes('DRIFT '),
      `脚本没有做出任何判定：\n${output}`,
    ).toBe(true);
  });

  it('--self-test 必须非零退出：人造的「出现新模型」输入真的被判成漂移', () => {
    const run = runDiff(['--self-test']);
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    // 非零退出**就是**这个开关的正确结果 —— 它是这条告警的负向 fixture。
    expect(run.status, `人造的新模型没有让脚本失败，这条日 diff 是空真的：\n${output}`).not.toBe(0);
    expect(output).toContain('DRIFT ');
    expect(output, `自测判定本身坏了：\n${output}`).toContain('SELF-TEST OK');
    expect(output).not.toContain('SELF-TEST BROKEN');
  });

  it('缺 DATABASE_URL 时非零退出，而不是当成「没有漂移」', () => {
    const env = { ...process.env };
    delete env['DATABASE_URL'];
    const run = runDiff([], env);
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    expect(run.status, output).not.toBe(0);
    expect(output).not.toContain('OK no model drift');
  });
});
