import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// 按路径 import 而不经包边界：@drift/llm 的包入口会拖进 router.ts → @drift/db，而后者在
// 模块加载时读 DATABASE_URL 并构造连接池。本条断言必须能在 ci:fast（不连任何数据库）里跑，
// 而 routes.ts 本身是纯配置。同 tools/ci/compliance-docs.test.ts 的理由。
import { ROUTES } from '../../packages/llm/src/routes.ts';

/**
 * PRIV-06 的**正向**存在性断言（L4）。
 *
 * 这一层守的不是「政策里写了不该写的词」，而是 RESEARCH §11.3 列为最严重的那一条静默
 * 失效：**文件缺失或为空时，否定式 grep 照样通过** —— 「没有隐私政策」比「隐私政策写了
 * 匿名」更糟，而缺失版能通过全部否定式断言。四层正向断言逐层收紧：
 *
 *   文件存在且 size > 0 → 字符数下限 → 必需章节标题 → 四条必需句逐字在场
 *
 * 四条必需句的**权威来源是 01-UI-SPEC.md 的 ## Copywriting Contract**，不是这个文件里的
 * 常量：把句子抄进测试等于制造第二处定义，改 UI-SPEC 时测试不会变红（同
 * tools/ci/design-tokens.test.ts 的理由）。PRIV-10 那一条的 {受托方清单} 占位符按
 * packages/llm/src/routes.ts 的 ROUTES 填充，引导句其余部分逐字不动。
 *
 * ⚠️ 本文件**不**实现禁用词的完整三重扫描（否定式 + 渲染层 + 归一化 + 规则 2/3/4）——
 * 那是 Plan 10 Task 2 的范围，它需要 RETENTION_PHRASES 与前端渲染目标。这里只有一条最小
 * 自查，把「wave 5 就已经写进正文的虚假陈述」拦在 wave 5。
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PRIVACY_PATH = `${REPO_ROOT}apps/web/content/legal/privacy.md`;
const TERMS_PATH = `${REPO_ROOT}apps/web/content/legal/terms.md`;
const UI_SPEC_PATH = `${REPO_ROOT}.planning/phases/01-compliance-safety-chat-skeleton/01-UI-SPEC.md`;
const FIXTURE_PATH = `${REPO_ROOT}tools/ci/fixtures/legal-missing-sentence.md`;

/** privacy.md 的九个必需章节（Plan 15 Task 1 的章节契约）。 */
const PRIVACY_HEADINGS = [
  '我们是谁与适用范围',
  '我们收集什么',
  '为什么收集',
  '保存多久',
  '我们会把它给谁',
  '危机情况下会通知谁',
  '人格是怎么来的',
  '你可以做什么',
  '怎么联系我们与申诉',
] as const;

const PRIVACY_MIN_CHARS = 3000;
const TERMS_MIN_CHARS = 1500;

/** UI-SPEC 的 PRIV-10 引导句里唯一允许被替换的东西。 */
const TRUSTEE_PLACEHOLDER = '{受托方清单}';

/**
 * 〔禁用〕Banned-term rules 规则 1 的词表（UI-SPEC）。
 * 唯一定义在 UI-SPEC；这里是 wave 5 的最小自查副本，Plan 10 Task 2 接管完整扫描。
 */
const BANNED_TERMS = ['匿名', 'anonymous', '无法关联到你', '无法关联到您', '不可追溯到你'] as const;

export interface RequiredSentencesSpec {
  readonly minChars: number;
  readonly requiredHeadings: readonly string[];
  readonly requiredSentences: readonly string[];
}

export interface RequiredSentencesResult {
  readonly ok: boolean;
  readonly missing: readonly string[];
}

function toHalfWidth(ch: string): string {
  const code = ch.codePointAt(0);
  if (code === undefined) return ch;
  return String.fromCodePoint(code - 0xfee0);
}

/**
 * 匹配前归一化（RESEARCH §11.3 的第二条静默失效：词被拆开或夹了空白/全角）。
 * 去全部空白 → 全角转半角 → 统一小写。幂等，因此归一化后的片段可以再次喂给它。
 */
export function normalizeCopy(text: string): string {
  return text
    .replace(/[\uff01-\uff5e]/gu, toHalfWidth)
    .replace(/\u3000/gu, '')
    .replace(/\s+/gu, '')
    .toLowerCase();
}

/**
 * **纯函数** —— 不读盘、不连库、不连网，所以负向 fixture 可以直接喂输入。
 *
 * `missing` 的每一项都点名缺的是什么（哪一条句子、哪一个章节），而不是只说「不匹配」：
 * 一条说不出缺了什么的断言，在变红时无法指导修复。
 */
export function checkRequiredSentences(
  text: string,
  spec: RequiredSentencesSpec,
): RequiredSentencesResult {
  const missing: string[] = [];

  if (text.length < spec.minChars) {
    missing.push(`字符数不足：实际 ${String(text.length)}，要求不少于 ${String(spec.minChars)}`);
  }

  const normalized = normalizeCopy(text);
  for (const heading of spec.requiredHeadings) {
    if (!normalized.includes(normalizeCopy(`## ${heading}`))) {
      missing.push(`缺少章节标题：${heading}`);
    }
  }
  for (const sentence of spec.requiredSentences) {
    if (!normalized.includes(normalizeCopy(sentence))) {
      missing.push(`缺少必需句：${sentence}`);
    }
  }

  return { ok: missing.length === 0, missing };
}

const uiSpec = readFileSync(UI_SPEC_PATH, 'utf8');

/** 取 ## Copywriting Contract 表里某一行的 Copy 列。找不到即抛错 —— 不静默当成通过。 */
function copyCell(label: string): string {
  const line = uiSpec
    .split('\n')
    .find((candidate) => candidate.startsWith('|') && candidate.includes(label));
  if (line === undefined) {
    throw new Error(
      `01-UI-SPEC.md 的 ## Copywriting Contract 里找不到「${label}」这一行 —— ` +
        '必需句失去了权威来源，隐私政策与界面文案随即可以各说各话',
    );
  }
  const copy = (line.split('|')[2] ?? '').trim();
  if (copy.length === 0) throw new Error(`「${label}」这一行的 Copy 列是空的`);
  return copy;
}

const L0_SENTENCE = copyCell('L0 层说明（PRIV-06 作用域）');
const PERSONA_SENTENCE = copyCell('人格派生物披露（PRIV-07）');
const OPERATOR_SENTENCE = copyCell('危机事件通知运营者披露（PRIV-11）');
const TRUSTEE_TEMPLATE = copyCell('受托方清单引导句（PRIV-10）');

const [TRUSTEE_HEAD = '', TRUSTEE_TAIL = ''] = TRUSTEE_TEMPLATE.split(TRUSTEE_PLACEHOLDER);

/** 路由表里的受托方（mock 不是受托方，它不出境也不接收任何真实内容）。 */
const ROUTED_PROVIDERS = [
  ...new Set(
    Object.values(ROUTES)
      .map((route) => route.provider)
      .filter((provider) => provider !== 'mock'),
  ),
].sort();

/**
 * 从文档里取出 PRIV-10 引导句被填进去的那段受托方清单（已归一化）。
 *
 * 前后两截都必须逐字在场才取得到 —— 于是「引导句被润色过」与「引导句整段缺失」都会在这里
 * 抛错，而不是退化成一次宽松的关键词匹配。
 */
function trusteeListIn(doc: string, label: string): string {
  const normalized = normalizeCopy(doc);
  const head = normalizeCopy(TRUSTEE_HEAD);
  const tail = normalizeCopy(TRUSTEE_TAIL);
  const start = normalized.indexOf(head);
  if (start < 0) {
    throw new Error(`${label} 里找不到 PRIV-10 引导句的前半截（占位符之前的部分）`);
  }
  const from = start + head.length;
  const end = normalized.indexOf(tail, from);
  if (end < 0) {
    throw new Error(`${label} 里找不到 PRIV-10 引导句的后半截（占位符之后的部分）`);
  }
  return normalized.slice(from, end);
}

/**
 * 某份文档应当含有的四条必需句。
 *
 * 第 4 条按「占位符已填充、其余逐字不动」这一条判：清单取自文档自身，引导句的其余部分则
 * 来自 UI-SPEC。清单内容对不对由下面的集合相等断言单独负责 —— 两件事分开断言，各自的
 * 失败信息才说得清。
 */
function requiredSentencesFor(doc: string, label: string): readonly string[] {
  return [
    L0_SENTENCE,
    PERSONA_SENTENCE,
    OPERATOR_SENTENCE,
    TRUSTEE_HEAD + trusteeListIn(doc, label) + TRUSTEE_TAIL,
  ];
}

const privacy = readFileSync(PRIVACY_PATH, 'utf8');
const terms = readFileSync(TERMS_PATH, 'utf8');

/**
 * privacy.md 该满足的全部条件。破坏验证复用同一份 spec，只换输入。
 *
 * ⚠️ 写成函数而不是模块级常量：privacy.md 被清空时 requiredSentencesFor 会抛错，而模块级
 * 常量会让这次抛错发生在**收集阶段**，于是 (a) 的「size 大于 0」永远没机会跑 —— 报错信息
 * 就成了「找不到引导句前半截」，而真正的原因是文件是 0 字节。惰性求值让每一层各自报各自的账。
 */
function privacySpec(): RequiredSentencesSpec {
  return {
    minChars: PRIVACY_MIN_CHARS,
    requiredHeadings: PRIVACY_HEADINGS,
    requiredSentences: requiredSentencesFor(privacy, 'privacy.md'),
  };
}

describe('(a) 两份法务正文存在且非空', () => {
  // ⚠️ 断言 size > 0 而不是 existsSync：一个 0 字节的 privacy.md 能通过 existsSync、
  // 能通过全部否定式 grep，而 Plan 09 的 policy_version 会对它算出一个指向空文本的哈希。
  it.each([
    ['privacy.md', PRIVACY_PATH],
    ['terms.md', TERMS_PATH],
  ])('%s 可读且 size 大于 0', (label, filePath) => {
    expect(statSync(filePath).size, `${label} 是 0 字节 —— 这正是 PRIV-06 最严重的静默失效`).toBeGreaterThan(0);
  });
});

describe('(b) 字符数下限', () => {
  it('privacy.md 不少于 3000 字符', () => {
    expect(privacy.length).toBeGreaterThanOrEqual(PRIVACY_MIN_CHARS);
  });

  it('terms.md 不少于 1500 字符', () => {
    expect(terms.length).toBeGreaterThanOrEqual(TERMS_MIN_CHARS);
  });
});

describe('(c)(d) privacy.md 的章节与四条必需句', () => {
  it('九个必需章节标题与四条必需句全部在场', () => {
    const result = checkRequiredSentences(privacy, privacySpec());
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('正文里不残留 {受托方清单} 占位符', () => {
    // 整行照抄 UI-SPEC 而不填充，等于拿一个占位符当受托方清单告知用户。
    expect(privacy).not.toContain(TRUSTEE_PLACEHOLDER);
  });

  it('受托方清单里的 provider 集合等于路由表里 mock 之外的 provider 集合', () => {
    const listed = trusteeListIn(privacy, 'privacy.md');
    const ids = [...listed.matchAll(/\(([a-z0-9.-]+)\)/gu)]
      .map((match) => match[1] ?? '')
      .sort();
    expect(ids).toEqual(ROUTED_PROVIDERS);
    // 逐项计数：多出一个没有括号标注的受托方同样是一次错误的告知。
    expect(listed.split('、')).toHaveLength(ROUTED_PROVIDERS.length);
  });
});

describe('(e) 负向 fixture：缺一条必需句必须判失败', () => {
  it('缺 PRIV-11 那一条时 ok 为 false，且 missing 恰好点名这一条', () => {
    const fixture = readFileSync(FIXTURE_PATH, 'utf8');
    // 同一个纯函数，只是 spec 换成 fixture 这份最小片段该满足的（无章节要求、非空即可）。
    const result = checkRequiredSentences(fixture, {
      minChars: 1,
      requiredHeadings: [],
      requiredSentences: requiredSentencesFor(fixture, 'legal-missing-sentence.md'),
    });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([`缺少必需句：${OPERATOR_SENTENCE}`]);
  });

  // 下面两条是**测试内注入**的破坏验证，而不是执行者手上跑过一次的临时改文件：
  // 「改坏它会变红」这件事因此每个 PR 都被证明一次，而不是只在 wave 5 被证明过一次。
  it('privacy.md 被清空时，同一份 spec 逐层判失败（字符数 + 九个章节 + 四条必需句）', () => {
    const result = checkRequiredSentences('', privacySpec());
    expect(result.ok).toBe(false);
    expect(result.missing[0]).toContain('字符数不足');
    expect(result.missing).toHaveLength(1 + PRIVACY_HEADINGS.length + 4);
  });

  it('删掉 privacy.md 里的 PRIV-11 必需句后判失败，且报错点名这一条', () => {
    const damaged = privacy.replace(OPERATOR_SENTENCE, '');
    expect(damaged, 'PRIV-11 必需句必须真的从副本里被删掉，否则这条破坏验证是空真的').not.toBe(
      privacy,
    );
    const result = checkRequiredSentences(damaged, privacySpec());
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([`缺少必需句：${OPERATOR_SENTENCE}`]);
  });
});

describe('(f) 最小自查：两份正文不含规则 1 的禁用词', () => {
  it.each([
    ['privacy.md', privacy],
    ['terms.md', terms],
  ])('%s 归一化后不含「匿名 / anonymous / 无法关联到你」', (label, source) => {
    const normalized = normalizeCopy(source);
    for (const term of BANNED_TERMS) {
      expect(normalized.includes(normalizeCopy(term)), `${label} 出现禁用词「${term}」——` +
        ' L0 配有 ID 映射表，属去标识化而非匿名化，写「匿名」是一次虚假陈述').toBe(false);
    }
  });
});
