import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * 法定语义色的机械断言（UI-SPEC ## Color〔法定〕/ RESEARCH §13 / T-03-06）。
 *
 * 守的是两件不同的事，缺任一条都会让另一条变成空真：
 *
 *  1. **值对得上**：tokens.css 里六个值必须与 01-UI-SPEC.md ## Color 表逐个相等。
 *     真相源是 UI-SPEC 而不是这个测试文件里的常量 —— 否则改 UI-SPEC 时测试不会变红，
 *     而「绑定到过时契约的断言在测试全绿时不会被任何人发现」正是 Plan 01 要消灭的。
 *  2. **值是独立的**：六个值不得写成 var(...)。实现为对 Border / Neutral token 的
 *     引用之后，将来调一次通用描边就会静默改掉一个法定标识的可感知性，而不会有
 *     任何检查变红 —— 这是本断言存在的全部理由。
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TOKENS_PATH = `${REPO_ROOT}apps/web/src/styles/tokens.css`;
const UI_SPEC_PATH = `${REPO_ROOT}.planning/phases/01-compliance-safety-chat-skeleton/01-UI-SPEC.md`;

const tokensCss = readFileSync(TOKENS_PATH, 'utf8');
const uiSpec = readFileSync(UI_SPEC_PATH, 'utf8');

/** tokens.css 里某个自定义属性的原始值（未做任何归一化）。 */
function tokenValue(name: string): string {
  const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(tokensCss);
  if (match?.[1] === undefined) throw new Error(`tokens.css 里找不到 ${name}`);
  return match[1].trim();
}

/**
 * 从 UI-SPEC ## Color 表里那一行取出三个十六进制值（顺序：面 / 描边 / 文字）。
 * 只认以 `| **<role>` 开头的**表格行**，避免把对比度声明表里的同一个色值当成来源。
 */
function specTriple(role: string): readonly [string, string, string] {
  const line = uiSpec
    .split('\n')
    .find((candidate) => candidate.startsWith(`| **${role}`));
  if (line === undefined) throw new Error(`UI-SPEC ## Color 表里找不到 ${role} 这一行`);
  const hexes = [...line.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0].toUpperCase());
  if (hexes.length !== 3) {
    throw new Error(`${role} 这一行应当恰好有 3 个色值，实际 ${String(hexes.length)} 个`);
  }
  return [hexes[0] as string, hexes[1] as string, hexes[2] as string];
}

const LEGAL_TOKENS = [
  { role: 'AI-label', prefix: '--ai-label' },
  { role: 'Care', prefix: '--care' },
] as const;

const SUFFIXES = ['surface', 'border', 'text'] as const;

describe('法定语义色 token（UI-SPEC ## Color〔法定〕）', () => {
  it.each(LEGAL_TOKENS)('$role 的三个值与 UI-SPEC ## Color 表逐个相等', ({ role, prefix }) => {
    const expected = specTriple(role);
    SUFFIXES.forEach((suffix, index) => {
      const name = `${prefix}-${suffix}`;
      expect(tokenValue(name).toUpperCase(), `${name} 必须等于 UI-SPEC 的 ${expected[index]}`).toBe(
        expected[index],
      );
    });
  });

  it.each(LEGAL_TOKENS)('$role 的三个值是字面色值，不是对别的 token 的引用', ({ prefix }) => {
    for (const suffix of SUFFIXES) {
      const name = `${prefix}-${suffix}`;
      const value = tokenValue(name);
      // 一旦写成 var(--border)，通用描边的每次调整都会静默改变一个法定标识的对比度。
      expect(value.startsWith('var('), `${name} 不得实现为 var(...) 引用`).toBe(false);
      expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('AI-label 的面色与描边都不等于通用 Border 的值', () => {
    const border = tokenValue('--border').toUpperCase();
    expect(tokenValue('--ai-label-surface').toUpperCase()).not.toBe(border);
    expect(tokenValue('--ai-label-border').toUpperCase()).not.toBe(border);
  });

  it('AI 常驻条高度固定为 32px〔法定：不得压到 32px 以下〕', () => {
    // 聊天页用 h-ai-bar（→ --spacing-ai-bar → --size-ai-bar）渲染那条 32px 的
    // 常驻条。把这个值也钉住，否则「32px 常驻条」这条硬约束只活在一段 CSS 类名里。
    expect(tokenValue('--size-ai-bar')).toBe('32px');
  });

  it('layout.tsx 不加载任何网络字体（UI-SPEC：系统字体栈，零网络字体开销）', () => {
    // 这条不是洁癖：`shadcn init` 每次跑都会把一个 next/font 的字体加载重新注入
    // layout.tsx（本 plan 内实际发生过一次）。没有断言的话它会安静地回来。
    const layout = readFileSync(`${REPO_ROOT}apps/web/src/app/layout.tsx`, 'utf8');
    const code = layout.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('next/font');
    expect(tokensCss).toContain('--font-sans: -apple-system');
  });

  it('聊天页的 AI 常驻条是 sticky top-0 且不带任何可关闭交互', () => {
    const chatPage = readFileSync(
      `${REPO_ROOT}apps/web/src/app/(app)/chat/[conversationId]/page.tsx`,
      'utf8',
    );

    // 断言范围是**常驻条那一个元素的开标签**，不是整个文件：文件里的散文（含本
    // 约束自身的说明注释）会让全文件子串扫描变成一条会误报的断言，而一条会误报
    // 的断言迟早会被人放宽成永不报。
    const openTag = /<div\b[^>]*\bh-ai-bar\b[^>]*>/.exec(chatPage);
    expect(openTag, 'AI 常驻条必须是一个带 h-ai-bar 的元素').not.toBeNull();
    const tag = openTag?.[0] ?? '';

    expect(tag).toContain('sticky top-0');
    // 不可关闭、不可折叠、不随滚动消失：开标签上不得有任何交互或可见性控制属性。
    for (const forbidden of [
      'onClick',
      'onDismiss',
      'onClose',
      'aria-expanded',
      'aria-hidden',
      'hidden',
      'tabIndex',
      'role="button"',
    ]) {
      expect(tag, `常驻条不得带 ${forbidden}`).not.toContain(forbidden);
    }
  });
});
