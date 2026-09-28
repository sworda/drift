// NEXT_PUBLIC_* 构建期注入完整性守卫（Plan 01-14 走查修复 / next-public-build-arg）。
//
// ── 缺陷 ────────────────────────────────────────────────────────────────────
// Next 会把 process.env 上的 NEXT_PUBLIC_* 读取在**构建期**内联进客户端 bundle
// （DefinePlugin 语义）。apps/web/src 有 5 处这样的读取，都写成
//     process.env['NEXT_PUBLIC_API_ORIGIN'] ?? 'http://127.0.0.1:3001'
// 但 apps/web/Dockerfile 里**没有**声明 NEXT_PUBLIC_API_ORIGIN 的 ARG/ENV，
// docker-compose.yml 的 web 服务也**没有** build.args。于是 next build 期间
// process.env.NEXT_PUBLIC_API_ORIGIN 是 undefined，五处一律内联成回退值
// http://127.0.0.1:3001 —— 也就是「浏览器所在的用户自己机器上的 3001 端口」。
// 运行时往容器 environment 塞这个变量**改不动已构建的产物**，所以注册提交、
// 导出、删除、隐私回执全部永久打到一个不存在的地址。
//
// ── 本守卫守什么 ────────────────────────────────────────────────────────────
// 不变量（从源码**派生**，不硬编码变量名列表）：对 apps/web/src 里每一次
// NEXT_PUBLIC_* 读取 ——
//   1. apps/web/Dockerfile 必须在 next build **之前**声明 ARG NEXT_PUBLIC_<X>；
//   2. 且必须在 next build 之前用 ENV NEXT_PUBLIC_<X>=$... 把它转成构建期环境
//      变量（ARG 只进 docker build 参数表，不自动进 RUN 的 process.env，而 Next
//      读的是后者 —— 只声明 ARG 是**静默失败**的常见形态）；
//   3. docker-compose.yml 的 **web 服务**必须在 build.args 里把同一变量传进来。
// 三条缺一，产物就会悄悄烧进回退值。这就是「客户端读了构建期变量但镜像没注入」
// 这一整类成因的钉子。
//
// ── 非空真证明（照 01-05 / 01-14 先例，写成常驻用例）───────────────────────
// 合成输入里：删掉 ARG 声明 / 把 ARG 挪到 build 之后 / 删掉 compose 的
// build.args —— 三种都必须判红；合法状态零误报。零 docker 依赖，进 ci:fast。
//
// ⚠️ 产物层面的验收（新 bundle 里 http://127.0.0.1:3001 计数为 0、真实 origin
//    计数 > 0）需要 docker build，不进 ci:fast；由 01-14 走查的
//    「docker compose build web + grep 产物」完成，并在记录里留计数。

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB_SRC = `${REPO_ROOT}apps/web/src`;
const WEB_DOCKERFILE = `${REPO_ROOT}apps/web/Dockerfile`;
const COMPOSE = `${REPO_ROOT}docker-compose.yml`;

/** 去注释：本说明与源文件注释里都会写出被检查的模式来解释规则本身。 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/u, ''))
    .join('\n');
}

/**
 * 从一段源码里派生所有被读取的 NEXT_PUBLIC_* 变量名（去注释后，去重排序）。
 * 同时认 process.env['X'] 与 process.env.X 两种写法 —— 真相源是源码本身。
 */
export function collectPublicEnvReads(source: string): string[] {
  const code = stripComments(source);
  const found = new Set<string>();
  for (const m of code.matchAll(
    /process\.env\s*(?:\[\s*['"](NEXT_PUBLIC_[A-Z0-9_]+)['"]\s*\]|\.\s*(NEXT_PUBLIC_[A-Z0-9_]+))/gu,
  )) {
    found.add((m[1] ?? m[2]) as string);
  }
  return [...found].sort();
}

/** 递归列出 apps/web/src 下所有 .ts/.tsx（构建期内联的读取只可能在这些文件里）。 */
function listWebSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/u.test(entry.name)) out.push(path);
    }
  };
  walk(WEB_SRC);
  return out;
}

/** 汇总 apps/web/src 全部源码里的 NEXT_PUBLIC_* 读取点。 */
export function collectWebPublicEnvReads(
  files: ReadonlyArray<{ path: string; source: string }>,
): string[] {
  const found = new Set<string>();
  for (const file of files) {
    for (const name of collectPublicEnvReads(file.source)) found.add(name);
  }
  return [...found].sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Dockerfile 解析（按行，ARG/ENV 都必须出现在 next build 之前）
// ─────────────────────────────────────────────────────────────────────────────

/** next build 在 Dockerfile 里的行号；-1 表示找不到（前提断言会先拦住）。 */
export function dockerfileBuildLineIndex(dockerfile: string): number {
  return stripComments(dockerfile)
    .split('\n')
    .findIndex((line) => /\bnext\s+build\b/u.test(line));
}

export interface DockerfileInjection {
  /** next build 之前声明的 ARG NEXT_PUBLIC_* 变量。 */
  readonly beforeBuildArgs: string[];
  /** next build 之前被 ENV 转成构建期环境变量的 NEXT_PUBLIC_* 变量。 */
  readonly beforeBuildEnvs: string[];
  /** next build **之后**才声明的 ARG（迟到的注入 —— 对产物无效）。 */
  readonly afterBuildArgs: string[];
}

/** 解析 Dockerfile 的注入面，严格区分 next build 之前 / 之后。 */
export function parseDockerfileInjection(dockerfile: string): DockerfileInjection {
  const lines = stripComments(dockerfile).split('\n');
  const buildIdx = dockerfileBuildLineIndex(dockerfile);
  const beforeBuildArgs: string[] = [];
  const beforeBuildEnvs: string[] = [];
  const afterBuildArgs: string[] = [];

  lines.forEach((line, i) => {
    const arg = /^\s*ARG\s+(NEXT_PUBLIC_[A-Z0-9_]+)\s*$/u.exec(line);
    if (arg !== null) {
      (buildIdx >= 0 && i < buildIdx ? beforeBuildArgs : afterBuildArgs).push(arg[1] as string);
    }
    // ENV A=1 B=$B —— 一条 ENV 可同时给多个键赋值，逐个收。
    if (/^\s*ENV\s/u.test(line) && (buildIdx < 0 || i < buildIdx)) {
      for (const m of line.matchAll(/(NEXT_PUBLIC_[A-Z0-9_]+)\s*=/gu)) {
        beforeBuildEnvs.push(m[1] as string);
      }
    }
  });

  return { beforeBuildArgs, beforeBuildEnvs, afterBuildArgs };
}

// ─────────────────────────────────────────────────────────────────────────────
// docker-compose 解析（按缩进定位 web 服务的 build.args）
// ─────────────────────────────────────────────────────────────────────────────

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isSkippable(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

/** 取一个以 headerIdx 为头、父级缩进为 parentIndent 的块（含头行）。 */
function sliceBlock(lines: string[], headerIdx: number, parentIndent: number): string[] {
  const out: string[] = [lines[headerIdx] as string];
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (isSkippable(line)) {
      out.push(line);
      continue;
    }
    if (indentOf(line) <= parentIndent) break;
    out.push(line);
  }
  return out;
}

/** web 服务块的原文；找不到返回空串。 */
export function composeWebBlock(compose: string): string {
  const lines = compose.split('\n');
  const idx = lines.findIndex((line) => /^ {2}web:\s*$/u.test(line));
  if (idx < 0) return '';
  return sliceBlock(lines, idx, 2).join('\n');
}

/** web 服务 build.args 的键列表（不含值）。 */
export function composeWebBuildArgs(compose: string): string[] {
  const web = composeWebBlock(compose);
  if (web === '') return [];
  const lines = web.split('\n');
  const buildIdx = lines.findIndex((line) => /^ {4}build:\s*$/u.test(line));
  if (buildIdx < 0) return [];
  const buildLines = sliceBlock(lines, buildIdx, 4);
  const argsIdx = buildLines.findIndex((line) => /^ {6}args:\s*$/u.test(line));
  if (argsIdx < 0) return [];
  const keys: string[] = [];
  for (const line of sliceBlock(buildLines, argsIdx, 6).slice(1)) {
    const m = /^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*:/u.exec(line);
    if (m !== null) keys.push(m[1] as string);
  }
  return keys;
}

// ─────────────────────────────────────────────────────────────────────────────
// 不变量
// ─────────────────────────────────────────────────────────────────────────────

export interface InjectionGaps {
  readonly dockerfileMissingArg: string[];
  readonly dockerfileMissingEnv: string[];
  readonly composeMissingArg: string[];
}

/** 对每个读取点，检查在 Dockerfile(next build 之前) 与 compose(web build.args) 里都注入过。 */
export function findInjectionGaps(
  reads: readonly string[],
  dockerfile: string,
  compose: string,
): InjectionGaps {
  const injected = parseDockerfileInjection(dockerfile);
  const argSet = new Set(injected.beforeBuildArgs);
  const envSet = new Set(injected.beforeBuildEnvs);
  const composeSet = new Set(composeWebBuildArgs(compose));
  return {
    dockerfileMissingArg: reads.filter((v) => !argSet.has(v)),
    dockerfileMissingEnv: reads.filter((v) => !envSet.has(v)),
    composeMissingArg: reads.filter((v) => !composeSet.has(v)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 注入式证明用的文本手术（不用多行正则，避免把「删整块」写成易错模式）
// ─────────────────────────────────────────────────────────────────────────────

/** 删掉第一行匹配 removeRe 的行。 */
function withoutLine(text: string, removeRe: RegExp): string {
  const lines = text.split('\n');
  const idx = lines.findIndex((line) => removeRe.test(line));
  if (idx < 0) return text;
  return [...lines.slice(0, idx), ...lines.slice(idx + 1)].join('\n');
}

/** 删掉 compose 里 web.build 的整个 args 块（连同其子行）。 */
function withoutBuildArgsBlock(text: string): string {
  const lines = text.split('\n');
  const argsIdx = lines.findIndex((line) => /^ {6}args:\s*$/u.test(line));
  if (argsIdx < 0) return text;
  let end = argsIdx + 1;
  while (
    end < lines.length &&
    ((lines[end] as string).trim() === '' || indentOf(lines[end] as string) > 6)
  ) {
    end += 1;
  }
  return [...lines.slice(0, argsIdx), ...lines.slice(end)].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 真实文件
// ─────────────────────────────────────────────────────────────────────────────

const realReads = collectWebPublicEnvReads(
  listWebSourceFiles().map((path) => ({ path, source: readFileSync(path, 'utf8') })),
);
const dockerfile = readFileSync(WEB_DOCKERFILE, 'utf8');
const compose = readFileSync(COMPOSE, 'utf8');

describe('NEXT_PUBLIC_* 构建期注入完整性', () => {
  it('前提：apps/web/src 确实有 NEXT_PUBLIC_* 读取（否则断言在空集上通过）', () => {
    expect(realReads.length).toBeGreaterThan(0);
    expect(realReads).toContain('NEXT_PUBLIC_API_ORIGIN');
  });

  it('前提：apps/web/Dockerfile 有 next build 步骤，且 compose 能定位到 web 服务块', () => {
    expect(dockerfileBuildLineIndex(dockerfile)).toBeGreaterThanOrEqual(0);
    expect(composeWebBlock(compose)).not.toBe('');
  });

  it('前提：解析器对真实文件非空（ARG/ENV 与 build.args 都解析得到，不得空真变绿）', () => {
    const injected = parseDockerfileInjection(dockerfile);
    expect(injected.beforeBuildArgs.length).toBeGreaterThan(0);
    expect(injected.beforeBuildEnvs.length).toBeGreaterThan(0);
    expect(composeWebBuildArgs(compose).length).toBeGreaterThan(0);
  });

  it('不变量：每个 NEXT_PUBLIC_* 读取都在 Dockerfile(next build 之前) 与 compose(web build.args) 里注入', () => {
    const gaps = findInjectionGaps(realReads, dockerfile, compose);
    expect(
      gaps.dockerfileMissingArg,
      '以下变量在客户端源码被读，但 apps/web/Dockerfile 未在 next build 之前声明 ARG —— 产物会内联成回退值',
    ).toEqual([]);
    expect(
      gaps.dockerfileMissingEnv,
      '以下变量声明了 ARG 却未在 next build 之前转成 ENV —— ARG 不进 process.env，Next 读不到',
    ).toEqual([]);
    expect(
      gaps.composeMissingArg,
      '以下变量未在 docker-compose.yml 的 web.build.args 里传入 —— 构建期拿不到值',
    ).toEqual([]);
  });

  it('防静默回退：API_ORIGIN 的注入是非空转发（ENV X=$X），不是写死空值', () => {
    // Dockerfile 里必须是 ENV NEXT_PUBLIC_API_ORIGIN=$NEXT_PUBLIC_API_ORIGIN。
    // 若写成 ENV NEXT_PUBLIC_API_ORIGIN=，ARG 形同虚设，产物仍烧回退值 —— 判红。
    expect(dockerfile).toMatch(/^\s*ENV\s+NEXT_PUBLIC_API_ORIGIN=\$NEXT_PUBLIC_API_ORIGIN\s*$/mu);
  });

  it('注入式非空真（删 ARG）：删掉 ARG 声明必被判红', () => {
    const injected = withoutLine(dockerfile, /^\s*ARG\s+NEXT_PUBLIC_API_ORIGIN\s*$/u);
    expect(injected).not.toBe(dockerfile);
    expect(parseDockerfileInjection(injected).beforeBuildArgs).not.toContain(
      'NEXT_PUBLIC_API_ORIGIN',
    );
    expect(findInjectionGaps(realReads, injected, compose).dockerfileMissingArg).toContain(
      'NEXT_PUBLIC_API_ORIGIN',
    );
  });

  it('注入式非空真（删 ENV）：删掉 ENV 转发必被判红', () => {
    const injected = withoutLine(dockerfile, /^\s*ENV\s+NEXT_PUBLIC_API_ORIGIN=/u);
    expect(injected).not.toBe(dockerfile);
    expect(parseDockerfileInjection(injected).beforeBuildEnvs).not.toContain(
      'NEXT_PUBLIC_API_ORIGIN',
    );
    expect(findInjectionGaps(realReads, injected, compose).dockerfileMissingEnv).toContain(
      'NEXT_PUBLIC_API_ORIGIN',
    );
  });

  it('注入式非空真（ARG 迟到）：把 ARG 挪到 next build 之后必被判红', () => {
    const withoutArg = withoutLine(dockerfile, /^\s*ARG\s+NEXT_PUBLIC_API_ORIGIN\s*$/u);
    const late = withoutArg + '\nARG NEXT_PUBLIC_API_ORIGIN\n';
    const parsed = parseDockerfileInjection(late);
    expect(parsed.afterBuildArgs).toContain('NEXT_PUBLIC_API_ORIGIN');
    expect(parsed.beforeBuildArgs).not.toContain('NEXT_PUBLIC_API_ORIGIN');
    expect(findInjectionGaps(realReads, late, compose).dockerfileMissingArg).toContain(
      'NEXT_PUBLIC_API_ORIGIN',
    );
  });

  it('注入式非空真（删 compose args 的键）：必被判红', () => {
    const injected = withoutLine(
      compose,
      /^ {8}NEXT_PUBLIC_API_ORIGIN:\s*\$\{NEXT_PUBLIC_API_ORIGIN:-\}\s*$/u,
    );
    expect(injected).not.toBe(compose);
    expect(composeWebBuildArgs(injected)).not.toContain('NEXT_PUBLIC_API_ORIGIN');
    expect(findInjectionGaps(realReads, dockerfile, injected).composeMissingArg).toContain(
      'NEXT_PUBLIC_API_ORIGIN',
    );
  });

  it('注入式非空真（整块删 build.args）：删掉 args 块同样判红', () => {
    const injected = withoutBuildArgsBlock(compose);
    expect(injected).not.toBe(compose);
    expect(composeWebBuildArgs(injected)).not.toContain('NEXT_PUBLIC_API_ORIGIN');
    expect(findInjectionGaps(realReads, dockerfile, injected).composeMissingArg).toContain(
      'NEXT_PUBLIC_API_ORIGIN',
    );
  });

  it('负向控制：合法状态（真实文件）零误报', () => {
    expect(findInjectionGaps(realReads, dockerfile, compose)).toEqual({
      dockerfileMissingArg: [],
      dockerfileMissingEnv: [],
      composeMissingArg: [],
    });
  });

  it('负向控制：完全合成分（含 dot 写法）齐全时不得误报', () => {
    const reads = collectPublicEnvReads(
      "const a = process.env['NEXT_PUBLIC_FOO'] ?? 'x';\nconst b = process.env.NEXT_PUBLIC_BAR;",
    );
    expect(reads).toEqual(['NEXT_PUBLIC_BAR', 'NEXT_PUBLIC_FOO']);
    const df = [
      'FROM node:24',
      'ARG NEXT_PUBLIC_FOO',
      'ENV NEXT_PUBLIC_FOO=$NEXT_PUBLIC_FOO',
      'ARG NEXT_PUBLIC_BAR',
      'ENV NEXT_PUBLIC_BAR=$NEXT_PUBLIC_BAR',
      'RUN pnpm exec next build',
    ].join('\n');
    const comp = [
      'services:',
      '  web:',
      '    build:',
      '      context: .',
      '      dockerfile: apps/web/Dockerfile',
      '      args:',
      '        NEXT_PUBLIC_FOO: foo-default',
      '        NEXT_PUBLIC_BAR: bar-default',
      '  caddy:',
      '    image: caddy:2',
    ].join('\n');
    expect(findInjectionGaps(reads, df, comp)).toEqual({
      dockerfileMissingArg: [],
      dockerfileMissingEnv: [],
      composeMissingArg: [],
    });
  });

  it('负向控制：注释里的读取 / 注释里的 ARG 都不得计数', () => {
    expect(
      collectPublicEnvReads("// process.env['NEXT_PUBLIC_GHOST']\nconst x = 1;"),
    ).toEqual([]);
    const df = 'FROM node:24\n# ARG NEXT_PUBLIC_GHOST\nRUN pnpm exec next build';
    expect(parseDockerfileInjection(df).beforeBuildArgs).toEqual([]);
  });

  it('负向控制：compose 里其他服务（非 web）的 build.args 不算注入', () => {
    const comp = [
      'services:',
      '  api:',
      '    build:',
      '      context: .',
      '      args:',
      '        NEXT_PUBLIC_API_ORIGIN: x',
      '  web:',
      '    build:',
      '      context: .',
      '      dockerfile: apps/web/Dockerfile',
      '    restart: unless-stopped',
    ].join('\n');
    expect(composeWebBuildArgs(comp)).toEqual([]);
  });
});
