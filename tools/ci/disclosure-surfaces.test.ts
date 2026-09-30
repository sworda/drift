// 四处 AI 明示标识的覆盖元测试（COMPLY-01/02 / RESEARCH §8.3 / T-14-04 / T-14-07）。
//
// 防的是一个具体的失效：**加了第四处但只测了三处**。这份元测试按 testId 反查每个
// surface 的断言位（文件级登记表），新增一处 surface 而不登记 ⇒ 红；登记的文件被
// 删 / 改名 ⇒ 红；断言位不再引用该 testId ⇒ 红。
//
// ⚠️ 本文件守契约层（不连 DB、不渲染 —— react 只装在 apps/web，01-09 先例）。
// 渲染层的四处断言分别在：conversations/conversation-list.test.tsx、
// chat/chat-client.test.tsx（含空态）、characters/character-detail.test.tsx（含
// loading 骨架）、tests/integration/export.test.ts（导出产物 [AI] 前缀）。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  AI_BADGE_TEXT,
  DISCLOSURE_SURFACES,
  type DisclosureSurfaceId,
} from '../../packages/contract/src/disclosure.ts';
import { AI_LABEL_OFF_PHRASES, scanBannedTerms } from '../../packages/safety/src/banned-terms.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB_SRC = join(REPO_ROOT, 'apps/web/src');

function read(rel: string): string {
  const path = join(REPO_ROOT, rel);
  expect(existsSync(path), `${rel} 不存在 —— 断言位被删或改名`).toBe(true);
  return readFileSync(path, 'utf8');
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/u, ''))
    .join('\n');
}

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      walkSources(abs, out);
    } else if (/\.(ts|tsx)$/u.test(abs)) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * 覆盖登记表：每个 surface 的 testId / 标志串必须出现在哪个测试文件里。
 * **新加 surface 而不登记 ⇒ 下面的元断言红**（负向 fixture 的注入点）。
 */
const SURFACE_ASSERTION_SITES: Record<
  DisclosureSurfaceId,
  { readonly file: string; readonly marker: string }
> = {
  conversation_list: {
    file: 'apps/web/src/features/conversations/conversation-list.test.tsx',
    marker: 'ai-badge-conversation-list',
  },
  chat_banner: {
    file: 'apps/web/src/features/chat/chat-client.test.tsx',
    marker: 'ai-banner-chat',
  },
  character_detail: {
    file: 'apps/web/src/features/characters/character-detail.test.tsx',
    marker: 'ai-badge-character-detail',
  },
  export_file: {
    file: 'tests/integration/export.test.ts',
    marker: '[AI] ',
  },
};

describe('四处标识的覆盖（COMPLY-01/02 · T-14-04）', () => {
  it('(a) DISCLOSURE_SURFACES 恰好 4 项，id 唯一且每项带非空 testId', () => {
    expect(DISCLOSURE_SURFACES.length).toBe(4);
    const ids = DISCLOSURE_SURFACES.map((surface) => surface.id);
    expect(new Set(ids).size).toBe(4);
    for (const surface of DISCLOSURE_SURFACES) {
      expect(surface.testId.length).toBeGreaterThan(0);
    }
  });

  it('(b) 覆盖元测试：每个 surface 的断言位真实存在且引用该 surface 的标志串', () => {
    // 登记表面与注册表**恰好**相等 —— 注册表多一项（第五处）而没有登记 ⇒ 红。
    const registered = new Set(Object.keys(SURFACE_ASSERTION_SITES));
    for (const surface of DISCLOSURE_SURFACES) {
      expect(
        registered.has(surface.id),
        `${surface.id} 在 DISCLOSURE_SURFACES 里但覆盖登记表没有它 —— 加了第 N 处但只测了 N-1 处，正是这份元测试要防的失效`,
      ).toBe(true);
    }
    for (const surface of DISCLOSURE_SURFACES) {
      const site = SURFACE_ASSERTION_SITES[surface.id];
      const source = read(site.file);
      expect(
        source.includes(site.marker),
        `${site.file} 不再包含「${site.marker}」—— ${surface.id} 的断言位失效`,
      ).toBe(true);
    }
  });

  it('(c) AI 标识两段文案在全仓各只有一处定义且被 as const 冻结', () => {
    // 拼接而不是字面量：design-tokens.test.ts 的同名断言用裸 grep 扫全仓字面，
    // 本文件写出字面量「XXX_TEXT =」会被它数进定义里。
    const badgeNeedle = ['AI_BADGE', '_TEXT'].join('') + ' =';
    const bannerNeedle = ['AI_BANNER', '_TEXT'].join('') + ' =';
    const badgeDefs: string[] = [];
    const bannerDefs: string[] = [];
    for (const dir of ['packages', 'apps', 'tools'] as const) {
      for (const file of walkSources(join(REPO_ROOT, dir))) {
        // 测试文件不扫（banned-terms 的先例）：断言文件必须能引用规则本身。
        if (/\.test\.(ts|tsx)$/u.test(file)) continue;
        const source = stripComments(readFileSync(file, 'utf8'));
        if (source.includes(badgeNeedle)) badgeDefs.push(file);
        if (source.includes(bannerNeedle)) bannerDefs.push(file);
      }
    }
    expect(badgeDefs, 'AI 标识徽标文案的定义必须恰好一处').toHaveLength(1);
    expect(bannerDefs, 'AI 常驻条文案的定义必须恰好一处').toHaveLength(1);
    // 冻结：定义行必须带 as const（运行时与类型层都不可被改写）。
    const disclosure = read('packages/contract/src/disclosure.ts');
    expect(new RegExp(`export const ${badgeNeedle}[^\\n]*as const`, 'u').test(disclosure)).toBe(
      true,
    );
    expect(new RegExp(`export const ${bannerNeedle}[^\\n]*as const`, 'u').test(disclosure)).toBe(
      true,
    );
  });

  it('(d) AiBadge 的 props 类型不含 text 与 children（覆写文案在类型层不可表达）', () => {
    const source = read('apps/web/src/components/ai-badge.tsx');
    const block = /export interface AiBadgeProps\s*\{[^}]*\}/su.exec(source);
    expect(block, 'AiBadgeProps 接口块未找到').not.toBeNull();
    const props = block?.[0] ?? '';
    expect(props).not.toMatch(/\btext\b/u);
    expect(props).not.toMatch(/\bchildren\b/u);
  });

  it('(e) 徽标与常驻条的渲染条件只依赖 counterpart_kind / is_ai（COMPLY-02）', () => {
    const ALLOWED = /(isAi|counterpartKind|is_ai|counterpart_kind)/u;
    const FORBIDDEN = /(persona|preference|userSetting|hideLabel|showBadge|labelVisible)/u;
    for (const file of walkSources(WEB_SRC)) {
      if (file.endsWith('.test.tsx') || file.endsWith('.test.ts')) continue;
      const source = readFileSync(file, 'utf8');
      for (const tag of ['<AiBadge', '<AiBanner']) {
        let index = source.indexOf(tag);
        while (index !== -1) {
          // 条件提取：从标签回溯到最近的 '{'，取**首个**三元 '? '/逻辑 '&&' 之前的
          // 片段作为谓词（'? ' 带空白 —— 避开 optional chaining 的 '?.'）。
          const before = source.slice(Math.max(0, index - 400), index);
          const brace = before.lastIndexOf('{');
          const between = brace === -1 ? '' : before.slice(brace + 1);
          const operator = /\?\s|&&/u.exec(between);
          if (operator !== null) {
            const condition = between.slice(0, operator.index);
            expect(
              ALLOWED.test(condition),
              `${file} 里 ${tag} 的渲染条件依赖了白名单之外的谓词（${condition.trim()}）—— 标识显隐不得由人格/配置/设置驱动`,
            ).toBe(true);
            expect(FORBIDDEN.test(condition), `${file} 的标识渲染条件含禁用谓词`).toBe(false);
          }
          index = source.indexOf(tag, index + 1);
        }
      }
    }
  });

  it('(f) AI-label 三色是字面 hex，不是对 Border/Neutral 的 var() 引用（交叉复核）', () => {
    const tokens = read('apps/web/src/styles/tokens.css');
    for (const token of ['--ai-label-surface', '--ai-label-border', '--ai-label-text']) {
      const match = new RegExp(`${token}:\\s*([^;]+);`, 'u').exec(tokens);
      expect(match, `${token} 未定义`).not.toBeNull();
      const value = match?.[1]?.trim() ?? '';
      expect(value, `${token} 不得是 var() 引用（与 Plan 03 design-tokens 断言同源）`).not.toContain(
        'var(',
      );
      expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/u);
    }
  });

  it('(g) 徽标自身含文字「AI」—— tooltip 不是名称的唯一来源（触屏不可 hover）', () => {
    const badge = read('apps/web/src/components/ai-badge.tsx');
    // 渲染的是常量本身，不是 title/aria 描述的替代物。
    expect(badge).toContain('{AI_BADGE_TEXT}');
    expect(AI_BADGE_TEXT).toBe('AI');
    const banner = read('apps/web/src/components/ai-banner.tsx');
    expect(banner).toContain('{AI_BANNER_TEXT}');
  });

  it('(h) 用户可见文案不含「关闭 AI 提示」类标识控制文案（规则 4 交叉复核）', () => {
    // 复用 banned-terms 的同一张词表（AI_LABEL_OFF_PHRASES），扫描 apps/web 文案源
    // 的源码层 —— 与 banned-terms.test.ts 的规则 4 同一条，这里作为四处标识元
    // 测试的交叉复核，不复制词表。
    const hits: string[] = [];
    for (const file of walkSources(join(REPO_ROOT, 'apps/web'))) {
      if (/\.test\.(ts|tsx)$/u.test(file)) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      const found = scanBannedTerms(source).filter((hit) => hit.rule === 4);
      if (found.length > 0) hits.push(`${file}: ${found.map((f) => f.term).join(',')}`);
    }
    expect(hits, `出现针对 AI 标识的控制文案（规则 4）: ${hits.join('; ')}`).toEqual([]);
    // 非空真证明：词表本身能抓住注入样本（剥离注释后）。
    const injected = scanBannedTerms(`${AI_LABEL_OFF_PHRASES[0]} 一律停用`);
    expect(injected.some((hit) => hit.rule === 4)).toBe(true);
  });
});
