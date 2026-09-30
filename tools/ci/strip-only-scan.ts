// strip-only 不兼容语法的**纯扫描逻辑**（零依赖，跨行）。
//
// 被 tools/ci/strip-only-syntax.test.ts 复用，也可单独当 CLI 跑：
//     node tools/ci/strip-only-scan.ts [repoRoot]
// 命中即打印并 exit 1；干净则 exit 0。放进单独的模块是为了让「全仓复核」这件事
// 有一份可被命令行重放的机器证据，而不是一次性的 grep（见本 plan 的事故复盘）。
//
// ── 跨行的教训（必须记住）────────────────────────────────────────────────────
// 编排器第一版用**逐行 grep** 扫参数属性，漏掉了真实那一处 —— 因为构造函数与参数被
// 拆在多行上：
//     constructor(
//       readonly leaked: string,
//     ) {
// 所以这里是**先做跨行的括号配对**再判参数列表里的首个 token，而不是逐行匹配。
//
// 判断只看**屏蔽掉注释与字符串之后**的代码（maskNonCode）。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 裸 node 在缺标志、遇不兼容 TS 语法时打的错误码。断言只认这个串。 */
export const STRIP_ONLY_ERROR = 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX';

export interface StripOnlyFinding {
  readonly construct: string;
  readonly line: number;
  readonly excerpt: string;
}

export interface WalkOptions {
  readonly includeTests?: boolean;
  readonly includeDeclarations?: boolean;
}

const DECL_MODIFIERS = new Set(['public', 'private', 'protected', 'readonly']);

/**
 * 把注释与字符串字面量替换成空格（保留换行），使后续正则只在**代码**上匹配，
 * 且**偏移与原串一一对应**（于是能报出行号）。
 *
 * 为什么必须屏蔽注释：本仓的 JSDoc 里就写着 `constructor(readonly leaked: string)` 这句
 * 反面教材（alert.ts 的注释），不屏蔽就会把注释判成代码。
 *
 * 已知边界：模板字面量里的插值会被整段屏蔽，正则字面量不屏蔽。这两处都只会
 * 让我们**漏报**（不是误报），对本仓没有影响。
 */
export function maskNonCode(source: string): string {
  const out = source.split('');
  const n = source.length;
  let i = 0;
  const blank = (k: number): void => {
    if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < n) {
    const c = source[i] as string;
    const c2 = source[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && source[i] !== '\n') {
        blank(i);
        i += 1;
      }
      continue;
    }
    if (c === '/' && c2 === '*') {
      blank(i);
      blank(i + 1);
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        blank(i);
        i += 1;
      }
      if (i < n) {
        blank(i);
        blank(i + 1);
        i += 2;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '\u0060') {
      const quote = c;
      blank(i);
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          blank(i);
          i += 1;
          if (i < n) {
            blank(i);
            i += 1;
          }
          continue;
        }
        blank(i);
        i += 1;
      }
      if (i < n) {
        blank(i);
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out.join('');
}

function lineAt(masked: string, index: number): number {
  return masked.slice(0, index).split('\n').length;
}

/** 返回 openParen 处 '(' 的配对 ')' 之间的文本；没有配对返回 null。 */
function extractBalanced(masked: string, openParen: number): { text: string; start: number } | null {
  let depth = 0;
  for (let i = openParen; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { text: masked.slice(openParen + 1, i), start: openParen + 1 };
    }
  }
  return null;
}

/** 按顶层的逗号切分参数列表（括号 / 中括号 / 花括号内的逗号不算）。 */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** 读匹配位置之前最多两个单词（跳过空白），用于识别 export / declare / const 前缀。 */
function precedingWords(masked: string, index: number): string[] {
  const words: string[] = [];
  let j = index - 1;
  const skipSpace = (): void => {
    while (j >= 0 && /\s/u.test(masked[j] as string)) j -= 1;
  };
  for (let k = 0; k < 2; k += 1) {
    skipSpace();
    const end = j;
    while (j >= 0 && /[A-Za-z_$]/u.test(masked[j] as string)) j -= 1;
    if (end === j) break;
    words.push(masked.slice(j + 1, end + 1));
  }
  return words;
}

/** 该位置是否处在语句起始（行首 / ; / { / } 之后，或紧跟 export / declare / const）。 */
function isStatementStart(masked: string, index: number, prefixWords: readonly string[]): boolean {
  if (prefixWords.length > 0) {
    const first = prefixWords[0] as string;
    if (['export', 'declare', 'const'].includes(first)) return true;
  }
  let j = index - 1;
  while (j >= 0 && /\s/u.test(masked[j] as string)) j -= 1;
  if (j < 0) return true;
  return ';{}'.includes(masked[j] as string);
}

/** 扫一段源码，返回所有 strip-only 不兼容语法的命中。**跨行**。 */
export function scanStripOnlySyntax(source: string): StripOnlyFinding[] {
  const masked = maskNonCode(source);
  const findings: StripOnlyFinding[] = [];
  const add = (construct: string, index: number): void => {
    findings.push({
      construct,
      line: lineAt(masked, index),
      excerpt: (masked.slice(index, index + 60).split('\n')[0] ?? '').trim(),
    });
  };

  // 1) 参数属性：锚在 constructor 的括号内，跨行配对后再看首个 token 是不是修饰符。
  const ctorRe = /(?<![\w$.])constructor\s*\(/gu;
  for (let m = ctorRe.exec(masked); m !== null; m = ctorRe.exec(masked)) {
    const openParen = m.index + m[0].length - 1;
    const params = extractBalanced(masked, openParen);
    if (params === null) continue;
    for (const param of splitTopLevel(params.text)) {
      const firstToken = param.trim().split(/\s+/u)[0];
      if (firstToken === undefined) continue;
      const bare = firstToken.replace(/^\.\.\./u, '');
      if (DECL_MODIFIERS.has(bare)) {
        add('参数属性 (parameter property)', params.start + param.indexOf(firstToken));
      }
    }
  }

  // 2) TS enum（含 const enum）。declare enum 是环境声明，放行。
  const enumRe = /(?<![\w$.])(?:const\s+)?enum\s+[A-Za-z_$][\w$]*/gu;
  for (let m = enumRe.exec(masked); m !== null; m = enumRe.exec(masked)) {
    const words = precedingWords(masked, m.index);
    if (words.includes('declare')) continue;
    if (isStatementStart(masked, m.index, words)) add('TS enum 声明', m.index);
  }

  // 3) namespace / module 运行时声明。declare namespace / declare module 放行。
  const nsRe = /(?<![\w$.])(?:namespace|module)\s+[A-Za-z_$][\w$]*/gu;
  for (let m = nsRe.exec(masked); m !== null; m = nsRe.exec(masked)) {
    const words = precedingWords(masked, m.index);
    if (words.includes('declare')) continue;
    if (isStatementStart(masked, m.index, words)) add('namespace / module 声明', m.index);
  }

  // 4) import = / export =（CommonJS 风格 TS 语法）。
  const importEqualsRe = /(?<![\w$.])import\s+[A-Za-z_$][\w$]*\s*=/gu;
  for (let m = importEqualsRe.exec(masked); m !== null; m = importEqualsRe.exec(masked)) {
    add('import = 赋值', m.index);
  }
  const exportEqualsRe = /(?<![\w$.])export\s*=/gu;
  for (let m = exportEqualsRe.exec(masked); m !== null; m = exportEqualsRe.exec(masked)) {
    add('export = 赋值', m.index);
  }

  return findings;
}

/** 递归收集 dir 下的 .ts / .tsx（可选：是否包含测试文件与 .d.ts）。 */
export function walkSourceFiles(dir: string, out: string[], options: WalkOptions = {}): void {
  const { includeTests = false, includeDeclarations = false } = options;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['__tests__', '__snapshots__', 'node_modules', 'dist'].includes(entry.name)) continue;
      walkSourceFiles(abs, out, options);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.tsx?$/u.test(entry.name)) continue;
    if (!includeTests && /\.test\.tsx?$/u.test(entry.name)) continue;
    if (!includeDeclarations && /\.d\.ts$/u.test(entry.name)) continue;
    out.push(abs);
  }
}

/**
 * 扫描面 = apps/{api,web}/src + packages/<pkg>/src 的**非测试** .ts / .tsx。
 * 传 options.includeTests / includeDeclarations 可放宽（给全仓复核用）。
 */
export function collectScanTargets(repoRoot: string, options: WalkOptions = {}): string[] {
  const roots = ['apps/api/src', 'apps/web/src'];
  const packagesDir = join(repoRoot, 'packages');
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push('packages/' + entry.name + '/src');
    }
  }
  const files: string[] = [];
  for (const rel of roots) {
    const abs = join(repoRoot, rel);
    if (existsSync(abs)) walkSourceFiles(abs, files, options);
  }
  return files;
}

/** 对一组绝对路径做扫描，返回 '相对路径:行 [类型] 片段' 形式的字符串数组。 */
export function scanFiles(repoRoot: string, files: readonly string[]): string[] {
  const offenders: string[] = [];
  for (const abs of files) {
    const source = readFileSync(abs, 'utf8');
    for (const finding of scanStripOnlySyntax(source)) {
      const rel = abs.startsWith(repoRoot) ? abs.slice(repoRoot.length).replace(/^\//u, '') : abs;
      offenders.push(rel + ':' + finding.line + ' [' + finding.construct + '] ' + finding.excerpt);
    }
  }
  return offenders;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const isCli =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const repoRoot = process.argv[2] ?? process.cwd();
  const targets = collectScanTargets(repoRoot);
  const offenders = scanFiles(repoRoot, targets);
  if (offenders.length > 0) {
    process.stderr.write('strip-only 不兼容语法命中 ' + offenders.length + ' 处：\n');
    for (const line of offenders) process.stderr.write('  - ' + line + '\n');
    process.exit(1);
  }
  process.stdout.write('OK strip-only scan 干净（' + targets.length + ' 个文件）\n');
}
