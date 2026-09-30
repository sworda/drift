// 注册 UI 的契约断言（L4：不连库、不连 DOM、不需要 react）。
//
// 这一层守的是**源码层面的四件事**：
//   1. 注册相关文案与 01-UI-SPEC.md 的 `## Copywriting Contract` 逐字一致；
//   2. 文案没有被内联进组件（内联就会与契约悄悄分叉）；
//   3. `apps/web/src` 的**代码**里不存在「全选」控件与任何批量 setter；
//   4. 28px 只出现一处（UI-SPEC ## 视觉锚点契约 注册行：全屏唯一的 Display）。
//
// 渲染结果的断言在 apps/web/src/features/onboarding/register-render.test.tsx —— 那里
// 才解析得到 react（react 只装在 apps/web/node_modules 里）。两层的分工是刻意的：
// 本文件回答「写的是不是契约里那句话」，那边回答「渲染出来是不是那个结构」。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../', import.meta.url);
const UI_SPEC = readFileSync(
  fileURLToPath(
    new URL('.planning/phases/01-compliance-safety-chat-skeleton/01-UI-SPEC.md', REPO_ROOT),
  ),
  'utf8',
);
const WEB_SRC = fileURLToPath(new URL('apps/web/src/', REPO_ROOT));
const COPY_PATH = fileURLToPath(new URL('apps/web/src/features/onboarding/copy.ts', REPO_ROOT));

/** 取 Copywriting Contract 表里某一行的 Copy 列，并去掉 Markdown 的强调标记。 */
function copyCell(label: string): string {
  const line = UI_SPEC.split('\n').find(
    (candidate) => candidate.startsWith('|') && candidate.includes(label),
  );
  if (line === undefined) {
    throw new Error(
      `01-UI-SPEC.md 的 ## Copywriting Contract 里找不到「${label}」这一行 —— ` +
        '注册文案失去了权威来源，界面与契约随即可以各说各话',
    );
  }
  const cell = (line.split('|')[2] ?? '').trim();
  if (cell.length === 0) throw new Error(`「${label}」这一行的 Copy 列是空的`);
  return cell.replace(/\*\*/gu, '').trim();
}

/** 去注释后的源码。文件头的说明本身要写出禁止项，扫它会逼人删说明。 */
function codeOf(absolute: string): string {
  return readFileSync(absolute, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/u, ''))
    .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (abs.endsWith('.ts') || abs.endsWith('.tsx')) out.push(abs);
  }
  return out;
}

const WEB_FILES = walk(WEB_SRC);
/**
 * 生产文件（不含测试）。
 *
 * 断言文件本身必须能写出被禁止的那些词 —— 它们就是断言的输入。把测试也扫进去
 * 只会逼人把非空真证明删掉，而那正是这些断言的价值所在。
 */
const PRODUCTION_FILES = WEB_FILES.filter((file) => !/\.test\.tsx?$/u.test(file));

/** copy.ts 的常量名 → UI-SPEC 表里的行标签。 */
const COPY_BINDINGS: readonly (readonly [string, string])[] = [
  ['REGISTER_CTA', 'Primary CTA（注册最后一步）'],
  ['AGE_GATE_REJECTION', 'Error state（年龄未满 18 · COMPLY-07）'],
  [
    'CONTACT_FORMAT_ERROR',
    'Error state（注册提交失败 · 紧急联系人格式不通过 · COMPLY-06/R1.23）',
  ],
  ['REGISTER_SUBMIT_ERROR', 'Error state（注册提交失败 · COMPLY-06）'],
  ['REGISTER_RETRY_LABEL', '注册提交重试按钮（COMPLY-06）'],
  ['CONTACT_FIELD_DESCRIPTION', '紧急联系人字段说明（R1.23）'],
];

describe('注册文案逐字对齐 01-UI-SPEC.md', () => {
  const copySource = readFileSync(COPY_PATH, 'utf8');

  it.each(COPY_BINDINGS)('%s 与「%s」这一行逐字一致', (constant, label) => {
    const authoritative = copyCell(label);
    // 直接在源码里找 `export const X = '…'`（可能跨行），比 import 组件更稳：
    // copy.ts 是纯常量文件，不需要为了读它而拖进 react。
    const match = new RegExp(
      `export const ${constant}(?:: string)?\\s*=\\s*\\n?\\s*'((?:[^'\\\\]|\\\\.)*)'`,
      'u',
    ).exec(copySource);
    expect(match, `copy.ts 里找不到 ${constant} 的字符串字面量`).not.toBeNull();
    expect(match?.[1]).toBe(authoritative);
  });

  it('提取器非空真：不存在的行标签必须抛错，而不是静默通过', () => {
    expect(() => copyCell('这一行在 UI-SPEC 里不存在')).toThrow(/找不到/u);
  });

  it('18 岁终态拒绝是 UI-SPEC 明列的唯一豁免，文案里不含任何「下一步」提示', () => {
    const rejection = copyCell('Error state（年龄未满 18 · COMPLY-07）');
    for (const hint of ['再试', '重试', '换个', '点', '请']) {
      expect(rejection.includes(hint), `终态拒绝文案带上了行动提示：${hint}`).toBe(false);
    }
  });
});

describe('文案没有被内联进组件', () => {
  const copyModule = COPY_PATH;

  it.each(COPY_BINDINGS)('%s 的文本只出现在 copy.ts 里', (constant, label) => {
    const text = copyCell(label);
    for (const file of PRODUCTION_FILES) {
      if (file === copyModule) continue;
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      // 去注释后再比：注释里引用一句文案来解释「为什么这样处理」是必要的，
      // 而内联到 JSX 里才是那条会悄悄分叉的形态。
      expect(
        codeOf(file).includes(text),
        `${file} 内联了 ${constant} 的文案 —— 它会与 UI-SPEC 悄悄分叉`,
      ).toBe(false);
    }
  });
});

describe('apps/web 的代码里没有「全选」，也没有任何批量 setter（PRIV-01 / T-09-05）', () => {
  it('没有任何文件在代码位置出现「全选」', () => {
    for (const file of PRODUCTION_FILES) {
      expect(codeOf(file).includes('全选'), `${file} 出现了全选控件或全选文案`).toBe(false);
    }
  });

  it('没有 setAll / toggleAll / selectAll / grantAll 一类的标识符', () => {
    for (const file of PRODUCTION_FILES) {
      expect(
        /setAll|toggleAll|selectAll|grantAll|revokeAll/u.test(codeOf(file)),
        `${file} 出现了批量 setter —— 那是全选控件的代码形态`,
      ).toBe(false);
    }
  });

  it('去注释这件事非空真：代码位置出现这些词仍会被抓到', () => {
    const consentCheckboxes = join(WEB_SRC, 'features/onboarding/consent-checkboxes.tsx');
    // 文件头的说明里确实写着「没有全选控件」，去注释之后它不该再被判为违规……
    expect(codeOf(consentCheckboxes).includes('全选')).toBe(false);
    // ……但代码位置一旦出现，必须抓到。
    expect(`${codeOf(consentCheckboxes)}\nconst 全选 = true;`.includes('全选')).toBe(true);
  });

  it('同意状态的唯一转换入口只吃一个 scope', () => {
    const state = codeOf(join(WEB_SRC, 'features/onboarding/consent-state.ts'));
    expect(state).toContain('scope: ConsentScope,');
    // 没有任何接受 scope 数组或多 scope 的签名。
    expect(/scopes\s*:\s*readonly/u.test(state)).toBe(false);
  });
});

describe('PLAN Task 3 的七条 RTL 断言逐条在场（覆盖元测试）', () => {
  /**
   * 这一条防的是「加了第七条但只测了六处」。
   *
   * 七条断言的实现在 `apps/web/src/features/onboarding/register-render.test.tsx`
   * —— 它必须住在 apps/web 下，因为 react 只装在 `apps/web/node_modules` 里，从
   * tools/ci 解析不到。本文件因此承担「索引」的角色：断言那七条各有一个 describe。
   */
  const RTL_FILE = 'features/onboarding/register-render.test.tsx';
  const rtl = readFileSync(join(WEB_SRC, RTL_FILE), 'utf8');

  /**
   * ⚠️ 这个串必须拼出来，**不能**写成字面量。
   *
   * vitest 用一条正则在**整个文件**里找 `@vitest-environment <name>` 来决定环境，
   * 不只看首个注释块。把它写成字面量会让**本文件**也被切到 jsdom，而 jsdom 环境下
   * `import.meta.url` 不是 file: —— 于是顶部那几行 `fileURLToPath` 直接抛
   * 「The URL must be of scheme file」，整个文件 0 test（本 plan 实测踩到）。
   */
  const ENV_DOCBLOCK = `@vitest-${'environment'} jsdom`;

  it('RTL 断言文件在场，且跑在 jsdom 环境里', () => {
    expect(rtl.length).toBeGreaterThan(1000);
    expect(rtl).toContain(ENV_DOCBLOCK);
    expect(rtl).toContain("from '@testing-library/react'");
    // 只用 fireEvent：user-event 不在那次包合法性 checkpoint 批准的三个包里。
    // 判的是 import 语句而不是子串 —— 文件头要能写出「为什么不用它」。
    expect(codeOf(join(WEB_SRC, RTL_FILE))).not.toMatch(/@testing-library\/user-event/u);
  });

  it.each(['(a)', '(b)', '(c)', '(d)', '(e)', '(f)', '(g)'])(
    '%s 有一个对应的 describe',
    (marker) => {
      expect(
        rtl.includes(`describe('${marker}`),
        `register-render.test.tsx 里找不到 ${marker} 的 describe`,
      ).toBe(true);
    },
  );

  it('真实点击与焦点断言都在场（这两条是 RTL 不可被静态渲染替代的部分）', () => {
    expect(rtl).toContain('fireEvent.click');
    expect(rtl).toContain('document.activeElement');
  });

  it('「点一项其余四项不变」的穷举版本仍然保留（与 RTL 互补，不是替代）', () => {
    const pure = readFileSync(join(WEB_SRC, 'features/onboarding/consent-state.test.ts'), 'utf8');
    expect(pure).toContain('改 %s 时其余四项逐键不变');
  });
});

describe('视觉锚点：28px 在 apps/web 的源码里只出现一处', () => {
  it('text-[28px] 只在 steps.tsx 的 STEP_TITLE_CLASS 里', () => {
    const hits = PRODUCTION_FILES.filter(
      (file) => !file.endsWith('.test.tsx') && codeOf(file).includes('text-[28px]'),
    );
    expect(hits.map((f) => f.slice(WEB_SRC.length))).toEqual(['features/onboarding/steps.tsx']);
    const steps = codeOf(join(WEB_SRC, 'features/onboarding/steps.tsx'));
    expect(steps.split('text-[28px]').length - 1).toBe(1);
  });
});
