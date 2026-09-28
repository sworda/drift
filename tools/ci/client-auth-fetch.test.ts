// 客户端鉴权头完整性守卫（Plan 01-14 走查修复 / client-bearer-auth）。
//
// ── 缺陷 ────────────────────────────────────────────────────────────────────
// 浏览器侧到达**需鉴权端点**的调用没有携带 Authorization: Bearer。而服务的身份解析
// 唯一入口是 Authorization: Bearer <token> → session 表的一行
// （apps/api/src/modules/auth/session.ts，不认 cookie）。于是隐私中心整片 401 ——
// 加载「我们收集了什么」、逐项撤回、导出轮询、发起导出、下载字节、删除轮询、发起删除。
//
// 一处已被实测证明：/me/export/:id/download 带 Bearer → 200（响应体首行
// 「本文件全部角色消息由 AI 生成」）；不带（即 <a href> 唯一可能的形态）→ 401。
//
// ── 测试为什么没抓到 ────────────────────────────────────────────────────────
// integration 是**服务端直连**、自己带 Bearer，所以全绿；浏览器路径从来没有过断言。
//
// ── 本守卫守什么 ────────────────────────────────────────────────────────────
// 不变量（**从源码派生**，不硬编码文件清单）：apps/web/src 下任何指向 ${API_ORIGIN}
// 的 fetch 调用，必须要么走 authedFetch（它在 lib/session.ts 里附 Bearer 头），要么
// 在一个**显式白名单**里且每条写清为什么不需要 Bearer。此外禁三种形态：
//   ① <a href> / window.location 指向 ${API_ORIGIN}（浏览器导航不经过 fetch，无法带头）；
//   ② credentials: 'include' 却未走 authedFetch（「以为 cookie 能鉴权」的形态）；
//   ③ 任何未登记的裸 ${API_ORIGIN} fetch。
//
// 白名单**双向**成立：既不许有「未登记的裸 fetch」（会产生新缺陷），也不许有
// 「悬空白名单条目」（会给未来埋一个可以随手塞东西的洞）。
//
// ── 非空真证明（照 01-05 / 01-14 先例，写成常驻用例）──────────────────────
// 合成输入里：裸 fetch / <a href> / window.location / 只写 credentials:'include' /
// 白名单条目悬空 —— 逐一判红；合法状态（白名单三项 + authedFetch 调用）零误报。
// 零 docker 依赖，进 ci:fast。
//
// 局限（如实登记）：扫描是源码层文本派生，不执行浏览器。变量间接（先把 URL 存进
// 变量再 fetch(url)）与跨多行书写的 href 属性不在覆盖内；<a>/window.location 的
// 真实浏览器触发由 01-14 人工走查记录。真正拦不住的那一类由本文件的两条白名单/
// 裸 fetch 断言兜住，因为任何一种新写法最终都要么以 ${API_ORIGIN} 字面出现、
// 要么走 authedFetch。

import { readdirSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB_SRC = `${REPO_ROOT}apps/web/src`;

/** authedFetch 的实现所在文件（相对 apps/web/src）—— 唯一被允许直连 API_ORIGIN 的落点。 */
export const AUTH_WRAPPER_FILE = 'lib/session.ts';

export interface SourceFile {
  readonly path: string;
  readonly source: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 文本手术：去注释（**保留长度** —— 每个被去掉的字符换成空格、换行保留）——
// 这样 fetch 调用的偏移量与原文一致，可直接换算行号。
// ─────────────────────────────────────────────────────────────────────────────

function skipString(src: string, start: number, quote: string): number {
  let i = start + 1;
  const len = src.length;
  while (i < len) {
    if (src[i] === '\\') {
      i += 2;
      continue;
    }
    if (src[i] === quote) return i + 1;
    i += 1;
  }
  return len;
}

function skipTemplate(src: string, start: number): number {
  let i = start + 1;
  const len = src.length;
  while (i < len) {
    if (src[i] === '\\') {
      i += 2;
      continue;
    }
    if (src[i] === '`') return i + 1;
    i += 1;
  }
  return len;
}

/** 去注释，保留字符串 / 模板字面量内容（注释里会写出被检查的模式来解释规则本身）。 */
export function stripComments(source: string): string {
  const out = source.split('');
  const len = source.length;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < len) {
    const ch = source[i] as string;
    const next = source[i + 1];
    if (ch === '"' || ch === "'") {
      i = skipString(source, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(source, i);
      continue;
    }
    if (ch === '/' && next === '/') {
      let j = i;
      while (j < len && source[j] !== '\n') j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < len && !(source[j] === '*' && source[j + 1] === '/')) j += 1;
      const end = Math.min(j + 2, len);
      blank(i, end);
      i = end;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// fetch 调用派生（平衡括号扫描，认字符串 / 模板 / 嵌套括号）
// ─────────────────────────────────────────────────────────────────────────────

/** 从 openIdx（'(' 的下标）起，返回匹配的 ')' 下标；找不到返回 -1。 */
function matchParen(code: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  const len = code.length;
  while (i < len) {
    const ch = code[i] as string;
    if (ch === '"' || ch === "'") {
      i = skipString(code, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(code, i);
      continue;
    }
    if (ch === '(') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
      i += 1;
      continue;
    }
    i += 1;
  }
  return -1;
}

/** 取 fetch( 的第一个实参原文（在顶层逗号处截断）。 */
function firstTopLevelArg(code: string, start: number, end: number): string {
  let i = start;
  let depth = 0;
  while (i < end) {
    const ch = code[i] as string;
    if (ch === '"' || ch === "'") {
      i = skipString(code, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(code, i);
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      i += 1;
      continue;
    }
    if (ch === ',' && depth === 0) break;
    i += 1;
  }
  return code.slice(start, i).trim();
}

export interface FetchCall {
  readonly index: number;
  readonly url: string;
  readonly callText: string;
}

/** 派生一段源码里所有 fetch(...) 调用（去注释后），提取 URL 实参与整段调用文本。 */
export function collectFetchCalls(source: string): FetchCall[] {
  const code = stripComments(source);
  const calls: FetchCall[] = [];
  for (const m of code.matchAll(/\bfetch\s*\(/gu)) {
    const identStart = m.index;
    const openIdx = identStart + m[0].length - 1;
    const closeIdx = matchParen(code, openIdx);
    if (closeIdx < 0) continue;
    calls.push({
      index: identStart,
      url: firstTopLevelArg(code, openIdx + 1, closeIdx),
      callText: code.slice(identStart, closeIdx + 1),
    });
  }
  return calls;
}

function lineOf(source: string, index: number): number {
  let line = 1;
  const upto = Math.min(index, source.length);
  for (let i = 0; i < upto; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

// ─────────────────────────────────────────────────────────────────────────────
// 白名单（从源码侧维护，每条带理由）
// ─────────────────────────────────────────────────────────────────────────────

export interface WhitelistEntry {
  readonly path: string;
  readonly reason: string;
}

/** 未鉴权 / 非 session 的合法 \${API_ORIGIN} fetch。每条都要写清为什么不需要 Bearer。 */
export const UNAUTHENTICATED_API_FETCHES: readonly WhitelistEntry[] = [
  {
    path: '/auth/register',
    reason:
      '注册本身是「获取身份」的入口 —— 调用时还没有 sessionToken 可附。API 侧是未鉴权端点的显式白名单。',
  },
  {
    path: '/telemetry/error',
    reason:
      '前端错误上报必须能在身份缺失 / 会话损坏时发出（否则崩溃现场无记录）。API 侧按 IP 匿名限流，是匿名端点。',
  },
  {
    path: '/privacy-receipts/',
    reason:
      '删除回执的刻意无 session 路径：账号与 session 行已随删除消失，凭 POST /me/delete 返回的一次性不可枚举 token 查询参数读取。',
  },
];

const CREDENTIALS_INCLUDE_RE = /credentials\s*:\s*['"]include['"]/u;

// ─────────────────────────────────────────────────────────────────────────────
// 不变量
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiFetchOccurrence {
  readonly path: string;
  readonly line: number;
  readonly url: string;
}

export interface UnregisteredApiFetch extends ApiFetchOccurrence {
  readonly credentialsInclude: boolean;
}

export interface ApiOriginNavigation {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface ClientAuthGaps {
  readonly unregisteredFetches: UnregisteredApiFetch[];
  readonly credentialsIncludeWithoutAuthedFetch: UnregisteredApiFetch[];
  readonly apiOriginNavigation: ApiOriginNavigation[];
  readonly staleWhitelistEntries: string[];
  readonly ambiguousWhitelistMatches: ApiFetchOccurrence[];
}

/** <a href> / window.location 指向 API_ORIGIN —— 浏览器导航带不了 header。 */
export function findApiOriginNavigation(source: string): Array<{ line: number; text: string }> {
  const code = stripComments(source);
  const out: Array<{ line: number; text: string }> = [];
  code.split('\n').forEach((line, i) => {
    if (!line.includes('API_ORIGIN')) return;
    if (/\bhref\b/u.test(line) || /window\s*\.\s*location/u.test(line)) {
      out.push({ line: i + 1, text: line.trim() });
    }
  });
  return out;
}

function isWrapperFile(path: string): boolean {
  return path === AUTH_WRAPPER_FILE || path.endsWith(`/${AUTH_WRAPPER_FILE}`);
}

/** 从源码派生全部缺口。真实文件应全空；合成输入用于证明每条规则非空真。 */
export function findClientAuthGaps(files: readonly SourceFile[]): ClientAuthGaps {
  const unregistered: UnregisteredApiFetch[] = [];
  const ambiguous: ApiFetchOccurrence[] = [];
  const navigation: ApiOriginNavigation[] = [];
  const matchedPaths = new Set<string>();

  for (const file of files) {
    for (const call of collectFetchCalls(file.source)) {
      if (!call.url.includes('API_ORIGIN')) continue;
      const line = lineOf(file.source, call.index);
      if (isWrapperFile(file.path)) continue;
      const matches = UNAUTHENTICATED_API_FETCHES.filter((entry) =>
        call.url.includes(entry.path),
      );
      if (matches.length > 1) {
        ambiguous.push({ path: file.path, line, url: call.url });
        continue;
      }
      if (matches.length === 1) {
        matchedPaths.add((matches[0] as WhitelistEntry).path);
        continue;
      }
      unregistered.push({
        path: file.path,
        line,
        url: call.url,
        credentialsInclude: CREDENTIALS_INCLUDE_RE.test(call.callText),
      });
    }
    for (const item of findApiOriginNavigation(file.source)) {
      navigation.push({ path: file.path, line: item.line, text: item.text });
    }
  }

  return {
    unregisteredFetches: unregistered,
    credentialsIncludeWithoutAuthedFetch: unregistered.filter((c) => c.credentialsInclude),
    apiOriginNavigation: navigation,
    staleWhitelistEntries: UNAUTHENTICATED_API_FETCHES.map((e) => e.path).filter(
      (path) => !matchedPaths.has(path),
    ),
    ambiguousWhitelistMatches: ambiguous,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 真实文件
// ─────────────────────────────────────────────────────────────────────────────

function listWebSourceFiles(): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/u.test(entry.name)) {
        out.push({ path: relative(WEB_SRC, path), source: readFileSync(path, 'utf8') });
      }
    }
  };
  walk(WEB_SRC);
  return out;
}

const realFiles = listWebSourceFiles();

describe('客户端鉴权头完整性（Bearer-only）', () => {
  it('前提：apps/web/src 确实有 API_ORIGIN 的 fetch 调用（否则断言在空集上通过）', () => {
    const apiFetches = realFiles.flatMap((f) =>
      collectFetchCalls(f.source).filter((c) => c.url.includes('API_ORIGIN')),
    );
    expect(apiFetches.length).toBeGreaterThan(0);
  });

  it('前提：白名单每条都带非空理由', () => {
    expect(UNAUTHENTICATED_API_FETCHES.length).toBeGreaterThan(0);
    for (const entry of UNAUTHENTICATED_API_FETCHES) {
      expect(entry.path.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it('前提：authedFetch 的实现确实设置 Authorization: Bearer 头（否则豁免它是个洞）', () => {
    const wrapper = realFiles.find((f) => isWrapperFile(f.path));
    expect(wrapper).toBeTruthy();
    const code = stripComments(wrapper?.source ?? '');
    expect(code).toMatch(/headers\.set\(\s*['"]authorization['"]/u);
    expect(code).toContain('Bearer ${token}');
  });

  it('不变量：每个指向 API_ORIGIN 的 fetch 要么走 authedFetch，要么在白名单里；三类禁形全空', () => {
    const gaps = findClientAuthGaps(realFiles);
    expect(
      gaps.unregisteredFetches.map((c) => `${c.path}:${String(c.line)} ${c.url}`),
      '以下裸 fetch 指向 API_ORIGIN 却未登记 —— 浏览器里会因缺 Bearer 而 401',
    ).toEqual([]);
    expect(
      gaps.credentialsIncludeWithoutAuthedFetch,
      "以下调用只写了 credentials:'include' 却没走 authedFetch —— cookie 不参与鉴权",
    ).toEqual([]);
    expect(
      gaps.apiOriginNavigation,
      '<a href> / window.location 指向 API_ORIGIN —— 浏览器导航无法携带 Authorization 头',
    ).toEqual([]);
    expect(
      gaps.staleWhitelistEntries,
      '以下白名单条目在源码里已无对应调用 —— 悬空条目会给未来留一个可随手塞东西的洞',
    ).toEqual([]);
    expect(gaps.ambiguousWhitelistMatches).toEqual([]);
  });

  it('双向集合相等：发现的未鉴权调用集合 === 登记的未鉴权调用集合', () => {
    const gaps = findClientAuthGaps(realFiles);
    // unregistered===[] ⇒ 没有「发现而未登记」；stale===[] ⇒ 没有「登记而未发现」。
    expect(gaps.unregisteredFetches).toEqual([]);
    expect(gaps.staleWhitelistEntries).toEqual([]);
  });

  // ── 注入式非空真 ──────────────────────────────────────────────────────────

  it('注入式非空真（裸 fetch）：合成输入里的裸 API_ORIGIN fetch 判红', () => {
    const files: SourceFile[] = [
      { path: 'lib/bad.ts', source: 'export const x = () => fetch(`${API_ORIGIN}/me/xxx`);\n' },
    ];
    const gaps = findClientAuthGaps(files);
    expect(gaps.unregisteredFetches).toHaveLength(1);
    expect(gaps.unregisteredFetches[0]?.url).toContain('/me/xxx');
    expect(gaps.unregisteredFetches[0]?.line).toBe(1);
  });

  it('注入式非空真（<a href> 导航）：指向 API_ORIGIN 的 href 判红', () => {
    const files: SourceFile[] = [
      {
        path: 'lib/bad.tsx',
        source: 'export const X = () => <a href={`${API_ORIGIN}/me/xxx`}>x</a>;\n',
      },
    ];
    const gaps = findClientAuthGaps(files);
    expect(gaps.apiOriginNavigation).toHaveLength(1);
    expect(gaps.apiOriginNavigation[0]?.text).toContain('API_ORIGIN');
  });

  it('注入式非空真（window.location 导航）：指向 API_ORIGIN 的跳转判红', () => {
    const files: SourceFile[] = [
      { path: 'lib/bad.ts', source: 'window.location.href = `${API_ORIGIN}/me/xxx`;\n' },
    ];
    expect(findClientAuthGaps(files).apiOriginNavigation).toHaveLength(1);
  });

  it("注入式非空真（credentials:'include' 而未走 authedFetch）：判红且归类为该形态", () => {
    const files: SourceFile[] = [
      {
        path: 'lib/bad.ts',
        source: "fetch(`${API_ORIGIN}/me/xxx`, { credentials: 'include' });\n",
      },
    ];
    const gaps = findClientAuthGaps(files);
    expect(gaps.unregisteredFetches).toHaveLength(1);
    expect(gaps.credentialsIncludeWithoutAuthedFetch).toHaveLength(1);
  });

  it('注入式非空真（悬空白名单）：白名单条目无对应调用时判红', () => {
    const files: SourceFile[] = [
      { path: 'lib/only-register.ts', source: 'fetch(`${API_ORIGIN}/auth/register`, {});\n' },
    ];
    const gaps = findClientAuthGaps(files);
    expect(gaps.staleWhitelistEntries).toContain('/telemetry/error');
    expect(gaps.staleWhitelistEntries).toContain('/privacy-receipts/');
    expect(gaps.staleWhitelistEntries).not.toContain('/auth/register');
  });

  it('负向控制：合法状态（authedFetch + 白名单三项）零误报', () => {
    const files: SourceFile[] = [
      {
        path: 'lib/session.ts',
        source: 'export const authedFetch = (p: string) => fetch(`${API_ORIGIN}${p}`);\n',
      },
      { path: 'a.ts', source: 'fetch(`${API_ORIGIN}/auth/register`, { method: "POST" });\n' },
      { path: 'b.ts', source: 'fetch(`${API_ORIGIN}/telemetry/error`, { method: "POST" });\n' },
      {
        path: 'c.ts',
        source: 'fetch(`${API_ORIGIN}/privacy-receipts/${id}?token=${t}`);\n',
      },
      {
        path: 'd.ts',
        source: "import { authedFetch } from './session';\nauthedFetch('/me/collected');\n",
      },
    ];
    expect(findClientAuthGaps(files)).toEqual({
      unregisteredFetches: [],
      credentialsIncludeWithoutAuthedFetch: [],
      apiOriginNavigation: [],
      staleWhitelistEntries: [],
      ambiguousWhitelistMatches: [],
    });
  });

  it('负向控制：注释里的 fetch / href 不得计数', () => {
    const files: SourceFile[] = [
      {
        path: 'x.ts',
        source:
          '// fetch(`${API_ORIGIN}/me/ghost`)\n// <a href={`${API_ORIGIN}/me/x`}>x</a>\nconst y = 1;\n',
      },
    ];
    const gaps = findClientAuthGaps(files);
    expect(gaps.unregisteredFetches).toEqual([]);
    expect(gaps.apiOriginNavigation).toEqual([]);
  });

  it('负向控制：串里的 http:// 不被误当行注释（去注释保留长度）', () => {
    const source = "const s = 'http://127.0.0.1:3001';\nfetch(`${API_ORIGIN}/me/xxx`);\n";
    expect(stripComments(source)).toHaveLength(source.length);
    expect(findClientAuthGaps([{ path: 'lib/bad.ts', source }]).unregisteredFetches).toHaveLength(1);
  });
});
