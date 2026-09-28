// 主题桥接完整性守卫（Plan 01-14 checkpoint 修复 / text-line-height-bridge）。
//
// ── 缺陷 ────────────────────────────────────────────────────────────────────
// Tailwind v4 里「字号档位」是一族**配对键**，不是一条键：
//     --text-<档位>               字号
//     --text-<档位>--line-height  配对行高（同族：--text-<档位>--font-weight）
// text-label 这类 utility 会把基准键与配对键**一起**消费：字号进 font-size、
// 配对行高进 line-height。
//
// apps/web/src/app/globals.css 的 @theme inline 块是一份**手工维护**的
// token → Tailwind 命名空间映射。它转发了 01-UI-SPEC.md ## Typography 的四档字号，
// 却漏了配对的 --line-height 那半边。产物里于是只有
//     .text-label { font-size: var(--text-label) }
// —— 没有 line-height，**也没有任何报错**。四个档位全如此；注册页甚至手写了
// leading-[1.2] 来绕过它。这与 --spacing-* 劫持（ui-size-scale.test.ts）同根：
// 桥接不完整时 Tailwind **静默跳过**，不生成样式也不编译失败。
//
// tokens.css 的配对 token 本身一直是对的（13/1.4、16/1.5、20/1.3、28/1.2）。
// 缺的只是 globals.css 里那四行转发。
//
// ── 本守卫守什么 ────────────────────────────────────────────────────────────
// 不变量：tokens.css 里每个 `--text-<档位>` **若**带任一配对键
// （--line-height / --font-weight），globals.css 的 @theme 块必须把基准键与
// **每个**配对键一起转发。
//
// 配对集合从 tokens.css **派生**（真相源），不硬编码 —— 将来加一档字号、或给某档
// 补上字重配对，本守卫自动纳入，不会因为常量没更新而漏守。
//
// ── 非空真证明（照 01-05 / 01-14 先例，写成常驻用例）───────────────────────
// 下面既跑真实文件，也把「删掉任意一条转发必被判红」与「合法状态不得误报」写成
// 常驻用例 —— 零构建依赖，ci:fast 即可跑。
//
// ⚠️ 产物 CSS 的验收（.text-* 规则必须带 line-height）依赖 docker 构建，不进
//    ci:fast；由 01-14 走查记录里的「docker build + curl 产物 CSS」完成。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TOKENS_CSS = `${REPO_ROOT}apps/web/src/styles/tokens.css`;
const GLOBALS_CSS = `${REPO_ROOT}apps/web/src/app/globals.css`;

/** 去注释：本说明与 globals.css 的注释要能写出被检查的模式来解释规则本身。 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/u, ''))
    .join('\n');
}

/** 配对键 `--text-<档位>--<line-height|font-weight>`；档位里不得含 `--`。 */
const PAIR_TEXT_KEY = /^--text-((?!--).+?)--(line-height|font-weight)$/u;

/** 取出源码里所有已声明的自定义属性名（去注释后）。 */
export function declaredCustomProps(source: string): string[] {
  const names: string[] = [];
  for (const m of stripComments(source).matchAll(/(--[a-zA-Z0-9-]+)\s*:/gu)) {
    names.push(m[1] as string);
  }
  return names;
}

/**
 * 从 tokens.css 派生「必须被 globals.css 转发」的键集合。
 *
 * 只纳入**带过配对键的档位**：一个只有 `--text-<档位>` 而没有 `--line-height` /
 * `--font-weight` 的自定义字号不受此不变量约束（没有配对可漏）。
 */
export function requiredBridges(tokensSource: string): string[] {
  const declared = new Set(declaredCustomProps(tokensSource));
  const tiersWithPairs = new Set<string>();
  for (const name of declared) {
    const pair = PAIR_TEXT_KEY.exec(name);
    if (pair !== null) tiersWithPairs.add(pair[1] as string);
  }
  const required = new Set<string>();
  for (const tier of tiersWithPairs) {
    required.add(`--text-${tier}`);
    for (const suffix of ['line-height', 'font-weight'] as const) {
      const key = `--text-${tier}--${suffix}`;
      if (declared.has(key)) required.add(key);
    }
  }
  return [...required].sort();
}

/** 取出 globals.css 的 @theme 块里已转发的 theme 键。 */
export function themeForwardedKeys(globalsSource: string): string[] {
  const code = stripComments(globalsSource);
  const forwarded = new Set<string>();
  for (const block of code.matchAll(/@theme[^{]*\{([\s\S]*?)\}/gu)) {
    for (const m of (block[1] as string).matchAll(/(--[a-zA-Z0-9-]+)\s*:/gu)) {
      forwarded.add(m[1] as string);
    }
  }
  return [...forwarded];
}

/** 不变量：tokens 里带配对的每个 --text-* 键都必须在 @theme 里被转发。 */
export function findMissingBridges(tokensSource: string, globalsSource: string): string[] {
  const forwarded = new Set(themeForwardedKeys(globalsSource));
  return requiredBridges(tokensSource).filter((key) => !forwarded.has(key));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** 从 globals 源码里删掉某条转发声明 —— 注入式非空真证明用。 */
export function withoutBridge(globalsSource: string, key: string): string {
  return globalsSource.replace(new RegExp(`${escapeRe(key)}\\s*:\\s*[^;]+;`, 'u'), '');
}

const tokensCss = readFileSync(TOKENS_CSS, 'utf8');
const globalsCss = readFileSync(GLOBALS_CSS, 'utf8');
const REQUIRED = requiredBridges(tokensCss);

const TIERS = ['label', 'body', 'heading', 'display'] as const;

describe('主题桥接完整性：--text-* 配对键必须被 @theme 转发', () => {
  it('前提：四档字号各自带 --line-height 配对（真相源仍是 tokens.css）', () => {
    // 若这条变红，说明 tokens.css 的配对结构变了 —— 本守卫的适用前提变了，
    // 必须重新评估，而不是让下面的断言在一个空/变形集合上静默变绿。
    expect(REQUIRED).toEqual([
      '--text-body',
      '--text-body--line-height',
      '--text-display',
      '--text-display--line-height',
      '--text-heading',
      '--text-heading--line-height',
      '--text-label',
      '--text-label--line-height',
    ]);
  });

  it('前提：@theme 转发键解析非空（解析器失效必须可见，不得空真变绿）', () => {
    const forwarded = themeForwardedKeys(globalsCss);
    expect(forwarded.length).toBeGreaterThan(20);
    expect(forwarded).toContain('--text-label');
  });

  it('不变量：tokens.css 派生出的每个配对键都已在 globals.css 的 @theme 里转发', () => {
    expect(
      findMissingBridges(tokensCss, globalsCss),
      '以下 --text-* 键在 tokens.css 有定义（或配对）却在 @theme 里漏转发 —— ' +
        'Tailwind 会静默不生成对应样式，不报错',
    ).toEqual([]);
  });

  it.each(TIERS)('非空真（注入）：删掉 --text-%s 的行高转发必被判红', (tier) => {
    const key = `--text-${tier}--line-height`;
    expect(themeForwardedKeys(globalsCss)).toContain(key);
    const injected = withoutBridge(globalsCss, key);
    expect(themeForwardedKeys(injected)).not.toContain(key);
    expect(findMissingBridges(tokensCss, injected)).toContain(key);
  });

  it('非空真（注入）：删掉基准字号 --text-body 的转发同样判红', () => {
    const injected = withoutBridge(globalsCss, '--text-body');
    expect(themeForwardedKeys(injected)).not.toContain('--text-body');
    expect(findMissingBridges(tokensCss, injected)).toContain('--text-body');
  });

  it('负向控制：合法状态（真实文件）不得误报', () => {
    expect(findMissingBridges(tokensCss, globalsCss)).toEqual([]);
  });

  it('负向控制：没有配对键的档位不产生约束（不得凭空要求转发）', () => {
    expect(requiredBridges(':root { --text-plain: 14px; }')).toEqual([]);
  });

  it('负向控制：@theme 之外的 :root 声明不算「已转发」', () => {
    // 把转发写在 :root 里对 Tailwind 的 theme 命名空间无效 —— 必须判红，而不是
    // 因为字符串出现过就误判为已转发。
    const onlyInRoot = ':root { --text-label--line-height: var(--text-label--line-height); }';
    expect(findMissingBridges(tokensCss, onlyInRoot)).toContain('--text-label--line-height');
  });

  it('负向控制：合成 tokens 里带配对且 @theme 转发齐全时不得误报', () => {
    const tokens = ':root { --text-plain: 14px; --text-plain--font-weight: 700; }';
    const full =
      '@theme inline { --text-plain: var(--text-plain); ' +
      '--text-plain--font-weight: var(--text-plain--font-weight); }';
    expect(requiredBridges(tokens)).toEqual(['--text-plain', '--text-plain--font-weight']);
    expect(findMissingBridges(tokens, full)).toEqual([]);
    // 只转发基准键、漏配对键 —— 必须判红。
    expect(
      findMissingBridges(tokens, '@theme inline { --text-plain: var(--text-plain); }'),
    ).toEqual(['--text-plain--font-weight']);
  });

  it('globals.css 保留配对约定注释（让下一位读者不必重修一次）', () => {
    expect(globalsCss).toContain('--text-<档位>--line-height');
    expect(globalsCss).toContain('不生成 line-height');
  });
});
