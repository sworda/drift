// PRIV-06 的否定式源码扫描（规则 1–4）+ 归一化 + 负向 fixture（RESEARCH §11.3）。
//
// 三重检查的分工：本文件守**源码层**（apps/web 下全部文案来源）；渲染层在
// apps/web/src/features/privacy/banned-render.test.tsx（react 只装在 apps/web，从
// tools/ci 解析不到 —— 01-09 的先例）；正向存在性（文件非空 / 章节 / 必需句）由
// Plan 15 的 legal-required-sentences.test.ts 守，本 plan 改写正文后必须复跑它。
//
// ⚠️ 词表与扫描函数定义在 packages/safety/src/banned-terms.ts —— 一份定义、两个
// 消费者（本文件与渲染层断言）。测试文件 import 另一个测试文件会让 vitest 把被引
// 文件的用例在本项目里再跑一遍，所以核心不能住在这里。
//
// 非空真策略：每个否定式都配注入式反例（含「匿名」的 fixture、拆空格的词、全角
// 字符、注释剥离的两侧证明）—— 只断言「真实文件没有命中」的扫描永远无法证明自己
// 还活着。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BANNED_TERMS, scanBannedTerms } from '../../packages/safety/src/banned-terms.ts';
// 规则 2 的词表直接从它的唯一定义处 import —— banned-terms.ts 只消费它，不转发它。
import { RETENTION_PHRASES } from '../../packages/safety/src/retention-words.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB_ROOT = join(REPO_ROOT, 'apps/web');
const FIXTURE_PATH = join(REPO_ROOT, 'tools/ci/fixtures/legal-with-anonymous.md');

/**
 * 去注释（同 consent-ui-contract.test.ts 的 codeOf）。文件头的说明本身就要写出被禁
 * 的那些词来解释规则 —— 不剥注释，这类扫描只会逼人删说明，用检查换沉默。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/u, ''))
    .join('\n');
}

/** 收集 apps/web 下的文案来源文件。排除 node_modules / .next / dist（构建与依赖产物）。 */
function walkCopySources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      walkCopySources(abs, out);
    } else if (/\.(ts|tsx|json|md)$/u.test(abs)) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * 测试文件不扫（同 consent-ui-contract 的先例）：断言文件必须能引用规则本身（「含
 * 匿名的 fixture 必须被抓住」这句话里的那个词），扫它们只会逼人删掉非空真证明 ——
 * 而那正是这些断言的价值。渲染层断言（banned-render.test.tsx）同理不扫。
 */
const COPY_SOURCES = walkCopySources(WEB_ROOT).filter(
  (file) => !/\.test\.tsx?$/u.test(file),
);

describe('scanBannedTerms 纯函数（含归一化）', () => {
  it('规则 1 的词表逐词命中，报告带规则号与词本身', () => {
    for (const term of BANNED_TERMS) {
      const hits = scanBannedTerms(`这段文案里出现了${term}这个词。`);
      expect(hits.some((hit) => hit.rule === 1 && hit.term === term), `词「${term}」未被抓住`).toBe(true);
    }
  });

  it('大小写变体由归一化统一覆盖：Anonymous / ANONYMOUS 都命中同一个 anonymous 项', () => {
    expect(scanBannedTerms('Anonymous identifier').some((hit) => hit.term === 'anonymous')).toBe(true);
    expect(scanBannedTerms('ANONYMOUS identifier').some((hit) => hit.term === 'anonymous')).toBe(true);
  });

  it('规则 2 的词表来自 RETENTION_PHRASES 的 import —— 逐词命中，不是本文件里的第二份清单', () => {
    // 挽留词表的唯一定义在 packages/safety/src/retention-words.ts（运行时出站断言与
    // 本扫描共用）。这里逐词验证扫描真的会抓它们。
    for (const phrase of RETENTION_PHRASES) {
      const hits = scanBannedTerms(`角色说：${phrase}。`);
      expect(hits.some((hit) => hit.rule === 2 && hit.term === phrase), `挽留词「${phrase}」未被抓住`).toBe(true);
    }
  });

  it('规则 3 与规则 4 的短语命中', () => {
    expect(scanBannedTerms('我们是研究平台所以不适用本办法。').some((hit) => hit.rule === 3)).toBe(true);
    expect(scanBannedTerms('你可以在设置里关闭 AI 提示。').some((hit) => hit.rule === 4)).toBe(true);
  });

  it('归一化生效：拆空格与全角字符都绕不过（RESEARCH §11.3 的第二个静默失效）', () => {
    expect(scanBannedTerms('匿 名').some((hit) => hit.term === '匿名')).toBe(true);
    expect(scanBannedTerms('ａnonymous').some((hit) => hit.term === 'anonymous')).toBe(true);
    expect(scanBannedTerms('别 走').some((hit) => hit.term === '别走')).toBe(true);
    expect(scanBannedTerms('你确定 要离开吗').some((hit) => hit.term === '确定要离开吗')).toBe(true);
  });

  it('干净文案返回空命中', () => {
    expect(scanBannedTerms('我们保留了一份去标识化的行为特征，它仍然属于你的个人信息。')).toEqual([]);
  });
});

describe('(a) 源码层否定式扫描（apps/web 全部文案来源）', () => {
  it('扫描范围非空：≥ 20 个文件，且包含两份法务正文', () => {
    expect(COPY_SOURCES.length).toBeGreaterThanOrEqual(20);
    expect(COPY_SOURCES.some((f) => f.endsWith('content/legal/privacy.md'))).toBe(true);
    expect(COPY_SOURCES.some((f) => f.endsWith('content/legal/terms.md'))).toBe(true);
    // 边界写死在 walk 的根上：只扫 apps/web 之下 —— .planning/ 与 tools/ci/fixtures/
    // 天然在界外（UI-SPEC 规则 1 的唯一例外就是规划文档对规则本身的引述）。这条
    // 断言把「scope = apps/web」从注释变成机械事实。
    expect(COPY_SOURCES.every((f) => f.startsWith(WEB_ROOT))).toBe(true);
    expect(COPY_SOURCES.some((f) => f.includes('.planning') || f.includes('tools/ci/fixtures'))).toBe(false);
  });

  it('每个文件去注释归一化后无任何规则 1–4 命中', () => {
    const violations: string[] = [];
    for (const file of COPY_SOURCES) {
      const raw = readFileSync(file, 'utf8');
      // 注释剥离只对代码文件做 —— Markdown 与 JSON 的正文就是文案本身。
      const subject = /\.tsx?$/u.test(file) ? stripComments(raw) : raw;
      const hits = scanBannedTerms(subject);
      if (hits.length > 0) {
        violations.push(`${file}: ${hits.map((hit) => `规则${String(hit.rule)}「${hit.term}」`).join('、')}`);
      }
    }
    expect(violations, `禁用词命中：\n${violations.join('\n')}`).toEqual([]);
  });

  it('去注释这件事非空真：代码位置的命中仍在，注释位置的被剥掉', () => {
    const commentOnly = stripComments('const a = 1; // 别走');
    expect(scanBannedTerms(commentOnly)).toEqual([]);
    const codePosition = stripComments('const s = "别走";');
    expect(scanBannedTerms(codePosition).some((hit) => hit.term === '别走')).toBe(true);
  });
});

describe('(c) 负向 fixture：含禁用词的假文案必须被抓住', () => {
  it('legal-with-anonymous.md 命中规则 1 的三个词（匿名 / 无法关联到你 / 不可追溯到你）', () => {
    const fixture = readFileSync(FIXTURE_PATH, 'utf8');
    const terms = scanBannedTerms(fixture).filter((hit) => hit.rule === 1).map((hit) => hit.term);
    expect(terms).toContain('匿名');
    expect(terms).toContain('无法关联到你');
    expect(terms).toContain('不可追溯到你');
  });
});
