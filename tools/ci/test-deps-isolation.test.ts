// 测试专用依赖的隔离（Plan 09 包合法性 checkpoint 的放行条件 1–3）。
//
// `@testing-library/react@16.3.3` / `@testing-library/dom@10.4.2` / `jsdom@30.1.1` 是
// 2026-09-27 一次 blocking-human 包合法性 checkpoint 的产物：编排器独立核验 registry
// （许可证 / 维护者 / repo / 周下载量 / peer 相容），用户裁决放行。三个放行条件：
//   1. 锁精确版本，不用 caret / tilde；
//   2. 只进 workspace 根的 devDependencies；
//   3. 不得泄漏进生产依赖图。
// 本文件是这三条的机械形态。
//
// ── 条件 3 的实测结论（写在这里，因为它决定了下面断言的形状）──────────────────
// `@testing-library/*` 确实不在任何 app 的生产闭包里。但 **jsdom 与 vitest 在**，
// 而且不是因为谁把它们写进了 dependencies：
//
//   better-auth 把 `vitest` 声明为**可选 peer**，vitest 又把 `jsdom` 声明为**可选 peer**。
//   pnpm 会从 workspace 图里满足可选 peer，于是 apps/api 的 better-auth 快照带上了
//   vitest，vitest 快照带上了 jsdom。实测：两者都出现在 `docker build -f
//   apps/api/Dockerfile` 产出镜像的 `/app/node_modules/.pnpm` 里。
//
// 试过但**无效**的两条路（都实测过，别再重复）：
//   - `.npmrc` 的 `resolve-peers-from-workspace-root=false` —— pnpm 12.6.0 下 better-auth
//     仍然解析出 vitest peer（remove + add 强制重解析后依旧）；
//   - Dockerfile 的 `pnpm install --prod` —— 能去掉 `@testing-library/*`，但 jsdom 与
//     vitest 是**生产依赖的** peer，照旧进镜像。
// 真正的修法是 `pnpm deploy --prod` 或多阶段构建裁剪，那是一次需要「容器仍能正常服务」
// 作为验收的基础设施改动，不属于本 plan 的范围。已在 01-09-SUMMARY.md 如实记录。
//
// 因此下面第二条断言是一个**已知状态的钉子**（allowlist + 理由），不是一张放行条 ——
// 任何**新**的测试包泄漏、或泄漏面扩大到 apps/web，都会让它变红。

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../', import.meta.url);
const REPO_ROOT_PATH = fileURLToPath(REPO_ROOT);

/** 三个包的精确版本（条件 1）。 */
export const TEST_ONLY_VERSIONS = {
  '@testing-library/react': '16.3.3',
  '@testing-library/dom': '10.4.2',
  jsdom: '30.1.1',
} as const;

/** 测试专用包的识别模式。前缀匹配覆盖整个 scope。 */
const TEST_ONLY_PATTERNS = ['@testing-library/', 'jsdom', 'vitest'] as const;

/**
 * 已知的、由**可选 peer** 链路带进生产闭包的包（见文件头）。
 * 缩小这个集合是进步，扩大它必须在 SUMMARY 里说明原因。
 */
const KNOWN_OPTIONAL_PEER_LEAKS: Readonly<Record<string, readonly string[]>> = {
  '@drift/web': [],
  // better-auth → (optional peer) vitest → (optional peer) jsdom
  '@drift/api': ['jsdom', 'vitest'],
};

/** 每个 app 一个「必须在场」的已知生产依赖 —— 空闭包会让断言无条件通过。 */
const CLOSURE_ANCHOR: Readonly<Record<string, string>> = {
  '@drift/web': 'react',
  '@drift/api': 'hono',
};

interface PnpmNode {
  readonly version?: string;
  readonly dependencies?: Record<string, PnpmNode>;
}

function prodClosure(filter: string): Set<string> {
  const raw = execFileSync(
    'pnpm',
    ['--filter', filter, 'list', '--prod', '--depth', 'Infinity', '--json'],
    { cwd: REPO_ROOT_PATH, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(raw) as readonly PnpmNode[];
  const names = new Set<string>();
  const seen = new Set<string>();
  const visit = (node: PnpmNode): void => {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      const key = `${name}@${child.version ?? '?'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      names.add(name);
      visit(child);
    }
  };
  for (const node of parsed) visit(node);
  return names;
}

function manifest(relative: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, REPO_ROOT)), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

describe('条件 1/2：精确版本，且只在 workspace 根的 devDependencies 里', () => {
  const rootPkg = manifest('package.json');

  it.each(Object.entries(TEST_ONLY_VERSIONS))('%s 锁在 %s（不用 caret / tilde）', (name, version) => {
    expect(rootPkg.devDependencies?.[name]).toBe(version);
  });

  it('根没有任何 dependencies（三个包不可能从根进生产图）', () => {
    expect(rootPkg.dependencies ?? {}).toEqual({});
  });

  it.each(['apps/web/package.json', 'apps/api/package.json'])(
    '%s 没有声明任何测试专用包',
    (relative) => {
      const pkg = manifest(relative);
      const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      const offenders = declared.filter((name) =>
        Object.keys(TEST_ONLY_VERSIONS).some((test) => name === test),
      );
      expect(offenders, `${relative} 声明了测试专用包`).toEqual([]);
    },
  );
});

describe('条件 3：生产依赖闭包里的测试专用包恰好等于已知的可选 peer 泄漏', () => {
  it.each(Object.keys(KNOWN_OPTIONAL_PEER_LEAKS))('%s 的生产闭包', (filter) => {
    const closure = prodClosure(filter);
    const anchor = CLOSURE_ANCHOR[filter] ?? '';
    expect(closure.size, `${filter} 的生产闭包解析为空`).toBeGreaterThan(5);
    expect(closure.has(anchor), `${filter} 的闭包里没有 ${anchor} —— 解析结果不可信`).toBe(true);

    const found = [...closure]
      .filter((name) =>
        TEST_ONLY_PATTERNS.some((prefix) => name === prefix || name.startsWith(prefix)),
      )
      .sort();
    expect(
      found,
      `${filter} 的生产依赖闭包里的测试专用包与已知集合不符 —— ` +
        '新增泄漏必须先修，缩小是进步但要同步改本文件的 KNOWN_OPTIONAL_PEER_LEAKS',
    ).toEqual([...(KNOWN_OPTIONAL_PEER_LEAKS[filter] ?? [])].sort());
  });

  it('@testing-library/* 不在任何 app 的生产闭包里（这一条是干净的）', () => {
    for (const filter of Object.keys(KNOWN_OPTIONAL_PEER_LEAKS)) {
      const leaked = [...prodClosure(filter)].filter((name) =>
        name.startsWith('@testing-library/'),
      );
      expect(leaked, `${filter} 的生产闭包里出现了 @testing-library/*`).toEqual([]);
    }
  });
});
