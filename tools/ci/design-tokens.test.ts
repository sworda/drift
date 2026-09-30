import { execSync } from 'node:child_process';
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

  it('AI 常驻条是 sticky top-0 且不带任何可关闭交互', () => {
    // 常驻条在 Plan 04 从聊天页搬进了自己的组件（全仓唯一定义，文案与 32px/sticky
    // 的硬约束收在一处）。断言跟着组件走 —— 继续扫聊天页会让这条检查在搬家之后
    // 悄悄失去被测对象，而那正是「空真断言」的标准形态。
    const banner = readFileSync(`${REPO_ROOT}apps/web/src/components/ai-banner.tsx`, 'utf8');

    // 断言范围是**常驻条那一个元素的开标签**，不是整个文件：文件里的散文（含本
    // 约束自身的说明注释）会让全文件子串扫描变成一条会误报的断言，而一条会误报
    // 的断言迟早会被人放宽成永不报。
    const openTag = /<div\b[^>]*\bh-ai-bar\b[^>]*>/s.exec(banner);
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

  it('聊天页确实挂载了常驻条组件（否则上一条断言测的是一个没人用的组件）', () => {
    // Plan 14 起聊天页是薄壳，渲染搬进 features/chat/chat-client.tsx（客户端编排，
    // 因为消息流与 WS 事件需要浏览器身份）。断言跟组件搬家 —— 与上面「断言跟着
    // 组件走」同一条先例：继续扫薄壳页会让这条检查失去被测对象（空真）。
    const chatClient = readFileSync(
      `${REPO_ROOT}apps/web/src/features/chat/chat-client.tsx`,
      'utf8',
    );
    // 无条件渲染：没有三元、没有 &&。一个只在某些情况下出现的法定告知等于没告知。
    expect(chatClient).toContain('<AiBanner />');
  });

  it('AI 标识文案在全仓各只有一处定义（不可被分叉、不由服务端下发）', () => {
    const hits = (pattern: RegExp): string[] =>
      execSync(
        `grep -rn --include=*.ts --include=*.tsx -E '${pattern.source}' ${REPO_ROOT} --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next || true`,
        { encoding: 'utf8' },
      )
        .split('\n')
        .filter((line) => line.trim().length > 0);

    expect(hits(/AI_BADGE_TEXT\s*=/), 'AI_BADGE_TEXT 有多于一处定义').toHaveLength(1);
    expect(hits(/AI_BANNER_TEXT\s*=/), 'AI_BANNER_TEXT 有多于一处定义').toHaveLength(1);
  });

  it('徽标组件的 props 类型不含 text / children（用类型阻止文案覆写）', () => {
    const badge = readFileSync(`${REPO_ROOT}apps/web/src/components/ai-badge.tsx`, 'utf8');
    const propsBlock = /export interface AiBadgeProps \{([\s\S]*?)\n\}/.exec(badge)?.[1] ?? '';
    expect(propsBlock, 'AiBadgeProps 未找到').not.toHaveLength(0);
    const code = propsBlock.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, 'AiBadgeProps 不得有 text 键').not.toMatch(/\btext\s*\??\s*:/);
    expect(code, 'AiBadgeProps 不得有 children 键').not.toMatch(/\bchildren\s*\??\s*:/);
  });

  it('BubbleContent 在聊天视图里被覆写为 text-base，且不出现 text-sm', () => {
    const chatView = readFileSync(`${REPO_ROOT}apps/web/src/features/chat/chat-view.tsx`, 'utf8');
    const bubbleContent = /<BubbleContent[^>]*>/.exec(chatView)?.[0] ?? '';
    expect(bubbleContent, 'chat-view 里没有 BubbleContent').not.toHaveLength(0);
    expect(bubbleContent, 'BubbleContent 必须覆写为 text-base（16px）').toContain('text-base');
    const code = chatView.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, '聊天视图不得出现 text-sm').not.toContain('text-sm');
  });

  it('全仓不存在流式下发路径（D-24 明确否决）', () => {
    const hits = execSync(
      `grep -rn --include=*.ts --include=*.tsx -E 'streamText|streamObject' ${REPO_ROOT}packages ${REPO_ROOT}apps || true`,
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter((line) => line.trim().length > 0 && !line.includes('/node_modules/') && !line.includes('/dist/'));
    // chunk 没有 seq 会与 CHAT-07 冲突（重连补拉拿不到半条消息），且逐 token 流出
    // 绕过了出站安全网关 —— 成功标准 2 要求证明不存在此路径。
    expect(hits, `出现了流式调用：\n${hits.join('\n')}`).toHaveLength(0);
  });
});
