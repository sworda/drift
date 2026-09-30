// 裸键尺寸 utility 劫持守卫（Plan 01-14 checkpoint 修复 / layout-scale-collision）。
//
// ── 缺陷 ────────────────────────────────────────────────────────────────────
// apps/web/src/app/globals.css 把 UI-SPEC 的 --space-* 逐个桥接进 Tailwind 的
// --spacing-* 命名空间（px-md / gap-sm 这类间距 utility 全仓 216 处依赖它，不能改名，
// 见 01-UI-SPEC.md ## Spacing Scale）。
//
// 副作用：Tailwind 4 的**宽度族** utility 按 ["--<family>", "--spacing", "--container"]
// 的顺序取第一个命中的 theme key —— --spacing 排在 --container 之前。于是项目桥接的
// --spacing-xl(32px) 会遮蔽 stock Tailwind 的 --container-xl(36rem)：
//
//     stock tailwind@4.3.3:   .max-w-xl { max-width: var(--container-xl) }   = 36rem
//     本项目（桥接 --spacing）: .max-w-xl { max-width: var(--space-xl) }       = 32px
//
// 注册页 main 是 `mx-auto flex max-w-xl flex-col gap-6 p-6`：32px 再减掉 p-6 的左右
// 各 24px，内容盒宽度为负被浏览器钳到 0；中文可在任意字符间断行，于是「每行一个汉字」，
// w-full 的输入框跟着塌成小胶囊。
//
// ── 为什么不是「补 --container-*」────────────────────────────────────────────
// 实测（tailwindcss@4.3.3，**重新构建镜像后的产物 CSS**）：在 @theme 里显式声明
// --container-xs..3xl 之后，产物里 .max-w-xl 仍是 max-width:var(--space-xl)、
// .max-w-sm 仍是 var(--space-sm)、.max-w-lg 仍是 var(--space-lg)；并且这些
// --container-* 变量因无人解析而根本不会被 emit。即：容器刻度**赢不过** --spacing，
// 因为优先级由 family 的 themeKeys 顺序决定，与声明顺序无关。
// 唯一在源码层可行的修法是**不使用裸键**：写显式任意值或项目命名 token。
//
// ── 本护栏守什么 ────────────────────────────────────────────────────────────
// 扫描 apps/web/src 的每个类名候选，禁止下列**宽度族**与「项目间距刻度里同时是
// Tailwind 标准容器键」的裸键组合：
//     max-w / min-w / w / basis / inline / min-inline / max-inline
//
// 为什么恰是这七个 family（证据：tailwindcss@4.3.3 dist/lib.mjs）：
//   这七个 family 的 themeKeys 含 --spacing，且其标准键在 stock Tailwind 里解析到
//   --container-*（36rem / 24rem / …）。两者相撞 → 标准语义被静默改写。
//   h / min-h / max-h / size 的 themeKeys 只有 --height / --size / --spacing（没有
//   --container），stock Tailwind 里根本没有 h-xl / size-xl 这种键 —— 项目桥接只是
//   「新启用」了一个非标准裸键，不是把标准语义改写掉，故不在本禁令内。
//
// ── 非空真证明（照 01-05 先例，写成常驻用例）────────────────────────────────
// 下面既跑真实扫描，也把「注入一条裸键必被判红」与「显式值 / 命名 token 不得误报」
// 写成常驻用例 —— 零构建依赖，ci:fast 即可跑。
//
// ⚠️ 产物 CSS 的验收（.max-w-* 规则不得含 var(--space-）依赖 docker 构建，不进
//    ci:fast；它由 01-14 走查记录里的「docker build + curl 产物 CSS」人工完成。

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB_SRC = `${REPO_ROOT}apps/web/src`;
const GLOBALS_CSS = `${WEB_SRC}/app/globals.css`;

/** stock Tailwind v4 有裸键刻度的容器键（默认 --container-3xs..7xl）。 */
export const TAILWIND_CONTAINER_KEYS = [
  '3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl',
] as const;

/**
 * themeKeys 里 --spacing 排在 --container 之前、且 stock 语义是容器宽度的宽度族。
 * 这些 family 的裸键会被项目桥接的 --spacing-<key> 改写语义。
 */
export const SHADOWED_WIDTH_FAMILIES = [
  'max-w', 'min-w', 'w', 'basis', 'inline', 'min-inline', 'max-inline',
] as const;

/** 去注释：本说明与 globals.css 的禁令注释要能写出被禁模式来解释规则本身。 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/u, ''))
    .join('\n');
}

/**
 * 从 globals.css（已去注释）里取出项目为 --spacing-* 桥接的键，再与 Tailwind 的
 * 容器键求交 —— 交集就是「会被 --spacing-* 遮蔽」的键集合。真相源是 globals.css，
 * 不是本文件的常量：改了桥接，扫描范围跟着变。
 */
export function collisionKeysFromGlobals(globalsCode: string): string[] {
  const bridged = new Set<string>();
  for (const m of globalsCode.matchAll(/--spacing-([a-z0-9-]+)\s*:/gu)) bridged.add(m[1] as string);
  return TAILWIND_CONTAINER_KEYS.filter((k) => bridged.has(k));
}

interface SizeUtilityHit {
  readonly token: string;
  readonly family: string;
  readonly key: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * 在已去注释的源码里找「被 --spacing-* 遮蔽的裸键尺寸 utility」。
 * 边界：family 前不能是 [A-Za-z0-9_-]（避免把 foo-w-xl 的子串判红），
 * key 后不能是 [A-Za-z0-9_-]（避免把 w-xl2 的前缀判红）。
 */
export function findShadowedSizeUtilities(code: string, keys: readonly string[]): SizeUtilityHit[] {
  if (keys.length === 0) return [];
  const family = SHADOWED_WIDTH_FAMILIES.map(escapeRe).join('|');
  const keyAlt = [...keys].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  const re = new RegExp(`(?<![A-Za-z0-9_-])(${family})-(${keyAlt})(?![A-Za-z0-9_-])`, 'gu');
  const hits: SizeUtilityHit[] = [];
  for (const m of code.matchAll(re)) {
    hits.push({ token: m[0], family: m[1] as string, key: m[2] as string });
  }
  return hits;
}

/** 递归列出 apps/web/src 下所有 .ts/.tsx/.css（Tailwind 的扫描范围）。 */
function listWebSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|css)$/u.test(entry.name)) out.push(path);
    }
  };
  walk(WEB_SRC);
  return out;
}

const globalsCss = readFileSync(GLOBALS_CSS, 'utf8');
const globalsCode = stripComments(globalsCss);
const COLLISION_KEYS = collisionKeysFromGlobals(globalsCode);

const rel = (p: string): string => p.replace(REPO_ROOT, '');

describe('裸键尺寸 utility 劫持守卫（--spacing-* 遮蔽 --container-*）', () => {
  it('前提：globals.css 仍在桥接 --spacing-*，且碰撞键集合非空', () => {
    // 若这条变红，说明桥接被移除/改名 —— 那本守卫的适用前提变了，必须重新评估，
    // 而不是让下面那条扫描在空集合上静默变绿。
    expect(globalsCode).toContain('--spacing-xl: var(--space-xl);');
    expect(COLLISION_KEYS).toEqual(['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']);
  });

  it('不变量：apps/web/src 里不存在被遮蔽的裸键尺寸 utility', () => {
    const files = listWebSourceFiles();
    expect(files.length, '没有扫到源文件 —— 扫描范围失效，断言会空真').toBeGreaterThan(50);

    const violations: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const hit of findShadowedSizeUtilities(code, COLLISION_KEYS)) {
        violations.push(`${rel(file)}: ${hit.token}`);
      }
    }

    expect(
      violations,
      `以下裸键尺寸 utility 会被 --spacing-* 劫持（应为显式值或项目命名 token）：\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it.each([
    ['<main className="mx-auto max-w-xl flex flex-col gap-6 p-6">', 'max-w-xl', 'max-w', 'xl'],
    ['<div className="sm:max-w-lg">', 'max-w-lg', 'max-w', 'lg'],
    ['<div className="w-xl">', 'w-xl', 'w', 'xl'],
    ['<div className="min-w-sm">', 'min-w-sm', 'min-w', 'sm'],
    ['<div className="hover:basis-2xl">', 'basis-2xl', 'basis', '2xl'],
    ['<div className="max-w-md">', 'max-w-md', 'max-w', 'md'],
    ['<div className="max-inline-lg">', 'max-inline-lg', 'max-inline', 'lg'],
  ])('非空真（注入）：合成源码里的 %s 必被判红', (snippet, token, family, key) => {
    const hits = findShadowedSizeUtilities(snippet, COLLISION_KEYS);
    expect(hits.map((h) => h.token)).toContain(token);
    expect(hits[0]).toMatchObject({ family, key });
  });

  it('非空真（键集合为空时守卫失效这一前提本身可被观察）', () => {
    // 空集合下 finder 恒返回 [] —— 这正是「碰撞键集合必须非空」那条前提用例存在的理由。
    expect(findShadowedSizeUtilities('<div className="max-w-xl">', [])).toEqual([]);
  });

  it.each([
    'max-w-[36rem]', // 显式任意值：本次修复采用的写法
    'max-w-[480px]',
    'max-w-[calc(100%-2rem)]',
    'max-w-full',
    'max-w-[80%]',
    'w-full',
    'w-3/4',
    'h-full',
    'min-w-0',
    'gap-sm', // 间距 family 合法：--spacing-sm 就是它想要的 8px
    'p-md',
    'text-lg',
    'rounded-lg',
    'h-ai-bar', // 项目命名 token，非裸键
    'size-touch',
    'max-h-[40vh]',
    'inline-flex',
    'inline-block',
    'w-xl2', // 尾部边界：不得把更长 token 的前缀判红
    'foo-w-xl', // 前缀边界：不得把更长标识符的子串判红
  ])('负向控制：%s 不得被 finder 判红', (token) => {
    expect(findShadowedSizeUtilities(`className="${token}"`, COLLISION_KEYS)).toEqual([]);
  });

  it('正向存在：6 处原缺陷点已改用显式值（否则上面的零命中可能是「改错了文件」）', () => {
    const steps = readFileSync(`${WEB_SRC}/features/onboarding/steps.tsx`, 'utf8');
    const sheet = readFileSync(`${WEB_SRC}/components/ui/sheet.tsx`, 'utf8');
    const dialog = readFileSync(`${WEB_SRC}/components/ui/dialog.tsx`, 'utf8');
    expect(steps.match(/max-w-\[36rem\]/gu)).toHaveLength(3); // max-w-xl × 3
    expect(sheet.match(/max-w-\[24rem\]/gu)).toHaveLength(2); // max-w-sm × 2
    expect(dialog.match(/sm:max-w-\[32rem\]/gu)).toHaveLength(1); // sm:max-w-lg × 1
  });

  it('globals.css 保留禁令注释（让下一位读者不必重修一次）', () => {
    expect(globalsCss).toContain('裸键尺寸 utility 禁令');
    expect(globalsCss).toContain('补 --container-* 无效');
  });
});
