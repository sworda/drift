// strip-only 不兼容语法的断言 —— apps/api 启动即崩（2026-09-28）那一整类成因的钉子。
//
// ── 事故 ──────────────────────────────────────────────────────────────────────
// apps/api 的启动命令是**裸 node、零转换标志**（apps/api/Dockerfile 的 CMD 与
// apps/api/package.json 的 start 都是 `node src/index.ts`）。Node 24 的原生 TS 支持是
// **纯类型擦除**（strip-only）：它只会删类型，**不做任何代码生成**。任何需要生成代码的
// TS 语法都会在**模块加载期**直接抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`，进程起不来。
// 命中的是 src/modules/safety/alert.ts 里一个参数属性
// `constructor(readonly leaked: string)`（参数属性要生成 `this.leaked = leaked`）。该
// 模块在入口的 import 图里，于是 API 容器启动即崩。
//
// ── 为什么此前所有门禁都放了它过去 ─────────────────────────────────────────────
//   - `tsc --build`：合法 TS，编译通过；
//   - ESLint：与语法无关；
//   - vitest（unit / contract / integration）：用 esbuild 转换 TS，参数属性工作正常；
//   - 连 `node --check alert.ts` 都返回 0 —— 实测过，--check 不套用 strip-only 的
//     语义（它只做 JS 层语法检查）。
// 换句话说，**没有任何一层用真实的裸 node 加载过 apps/api 的模块图**。本文件的 (b)
// 那一组就是补上这一层：用真实的裸 node import 真实模块，退出码与 stderr 都断言。
//
// 静态扫描逻辑住在 ./strip-only-scan.mjs（纯函数，也能当 CLI 跑），本文件只负责
// 断言与注入式非空真证明。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  collectScanTargets,
  scanFiles,
  scanStripOnlySyntax,
  STRIP_ONLY_ERROR,
} from './strip-only-scan.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// 真实运行时探针（裸 node，零转换标志）
// ─────────────────────────────────────────────────────────────────────────────

interface BareRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * 用**真实的裸 node**（process.execPath，零转换标志）动态 import 一个模块。
 * env 默认给空对象：让任何读环境变量的模块尽快停在它自己的校验上，
 * 而**模块图在求值之前就已全部解析完毕**，语法错误必然先于运行期错误浮出来。
 */
function importWithBareNode(absPath: string, env: NodeJS.ProcessEnv = {}): BareRun {
  const href = pathToFileURL(absPath).href;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', 'await import(' + JSON.stringify(href) + ')'],
    { cwd: REPO_ROOT, env: { ...env }, encoding: 'utf8', timeout: 30_000 },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** 把若干合成文件写进一个一次性临时目录（含 type:module 的 package.json）。 */
function withTempModules(files: Readonly<Record<string, string>>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'drift-strip-only-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, name), body);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) 静态扫描
// ─────────────────────────────────────────────────────────────────────────────

describe('(a) 静态扫描：非测试源码里不得出现 strip-only 不兼容语法', () => {
  it('扫描面非空，且锚点文件 alert.ts 在扫描面里（否则断言是在空集上通过）', () => {
    const targets = collectScanTargets(REPO_ROOT);
    expect(targets.length).toBeGreaterThan(50);
    const relTargets = targets.map((abs) => relative(REPO_ROOT, abs));
    expect(relTargets).toContain(join('apps', 'api', 'src', 'modules', 'safety', 'alert.ts'));
  });

  it('apps/{api,web}/src 与 packages/<pkg>/src 无参数属性 / enum / namespace / import= / export=', () => {
    const offenders = scanFiles(REPO_ROOT, collectScanTargets(REPO_ROOT));
    expect(
      offenders,
      '这些语法在 Node 的 strip-only（裸 node 启动）下会抛 ' +
        STRIP_ONLY_ERROR +
        '，让 API 容器启动即崩。改成显式字段 + 赋值，或改用 interface / const 对象：\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('注入式非空真证明：跨行参数属性 / enum / namespace / import= 逐个判红', () => {
    // 这段跨行构造形状就是让逐行 grep 漏掉、让整仓启动崩掉的那一处。
    const paramProperty =
      'export class A {\n  constructor(\n    /** 注释里的 constructor(readonly x: string) 不应影响判定 */\n    readonly leaked: string,\n  ) {\n    super();\n  }\n}\n';
    const paramPropertyMixed =
      'export class B {\n  constructor(private readonly x: number, public y: string, z: boolean) {}\n}\n';
    const enumDecl = 'export enum Color {\n  Red,\n  Blue,\n}\n';
    const constEnum = 'const enum Speed { Fast, Slow }\n';
    const namespaceDecl = 'export namespace Foo {\n  export const x = 1;\n}\n';
    const importEquals = "import fs = require('node:fs');\n";
    const exportEquals = 'export = { a: 1 };\n';

    expect(scanStripOnlySyntax(paramProperty).map((f) => f.construct)).toEqual([
      '参数属性 (parameter property)',
    ]);
    expect(scanStripOnlySyntax(paramPropertyMixed).length).toBe(2);
    expect(scanStripOnlySyntax(enumDecl).map((f) => f.construct)).toEqual(['TS enum 声明']);
    expect(scanStripOnlySyntax(constEnum).map((f) => f.construct)).toEqual(['TS enum 声明']);
    expect(scanStripOnlySyntax(namespaceDecl).map((f) => f.construct)).toEqual([
      'namespace / module 声明',
    ]);
    expect(scanStripOnlySyntax(importEquals).map((f) => f.construct)).toEqual(['import = 赋值']);
    expect(scanStripOnlySyntax(exportEquals).map((f) => f.construct)).toEqual(['export = 赋值']);
  });

  it('注入式非空真证明：合法代码不得误报（含 declare namespace / declare 字段 / enum 子串）', () => {
    const legit = [
      'export class C {\n  readonly y: string;\n  declare z: number;\n  constructor(y: string) { this.y = y; }\n}\n',
      // declare namespace / declare module 是环境声明，只擦除，必须放行。
      'declare namespace Ambient { const x: number; }\n',
      "declare module 'some-pkg' { export const v: string; }\n",
      // enum / namespace 只是标识符或属性名的一部分，不是声明。
      'export const MyEnum = { A: 1 } as const;\n',
      'const notNamespace = 1;\n',
      'const obj = { namespace: "x", module: "y" };\n',
      'export type T = MyEnum;\n',
      'function f(readonlyish: string): void {}\n',
      // 注释与字符串里的禁用词不得计数。
      '// constructor(private x) 只是注释\nconst s = "namespace Foo";\nconst t = \u0060enum Bar\u0060;\n',
    ].join('');
    expect(scanStripOnlySyntax(legit)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) 真实运行时模块图加载
// ─────────────────────────────────────────────────────────────────────────────

describe('(b) 真实裸 node 加载模块图（零转换标志）', () => {
  it('alert.ts —— 本次事故的那一处 —— 在裸 node 下退出码 0', () => {
    const run = importWithBareNode(join(REPO_ROOT, 'apps/api/src/modules/safety/alert.ts'));
    expect(run.stderr).not.toContain(STRIP_ONLY_ERROR);
    expect(run.stderr, run.stderr).toBe('');
    expect(run.status).toBe(0);
  });

  it('apps/api 入口（src/index.ts）的完整模块图在裸 node 下无 strip-only 语法错误', () => {
    const entry = join(REPO_ROOT, 'apps/api/src/index.ts');
    expect(existsSync(entry)).toBe(true);
    // 空 env：模块图**全部解析/链接完成后**才会进入求值，求值会在环境变量校验或建库
    // 处停下（退出码非 0）——那是预期的运行期失败。这里只断言语法层面不崩。
    const run = importWithBareNode(entry);
    expect(run.stderr).not.toContain(STRIP_ONLY_ERROR);
    // 防止路径写错导致“什么都没加载”也变绿：模块解析失败会带 ERR_MODULE_NOT_FOUND。
    expect(run.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(run.status === 0 || run.stderr.length > 0, '入口探针既没成功也没留下任何 stderr —— 探针可疑').toBe(
      true,
    );
  });

  it('注入式非空真证明：同一探针在合成模块图上判红 / 判绿', () => {
    withTempModules(
      {
        'bad.ts': 'export class A {\n  constructor(\n    readonly x: string,\n  ) {}\n}\n',
        'good.ts': 'export class B {\n  readonly y: string;\n  constructor(y: string) { this.y = y; }\n}\n',
        'entry-bad.ts': "import { A } from './bad.ts';\nexport const a = new A('x');\n",
        'entry-good.ts': "import { B } from './good.ts';\nexport const b = new B('y');\n",
      },
      (dir) => {
        const bad = importWithBareNode(join(dir, 'entry-bad.ts'));
        expect(bad.stderr).toContain(STRIP_ONLY_ERROR);

        const good = importWithBareNode(join(dir, 'entry-good.ts'));
        expect(good.stderr).not.toContain(STRIP_ONLY_ERROR);
        expect(good.status).toBe(0);
      },
    );
  });
});
