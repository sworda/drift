// egress 注册表的三条绑定断言（RESEARCH §3.4，L4 契约层）。
//
//  1. **集合相等**：AST 扫全仓取出所有「参数类型解析后含 GatedText」的导出函数，
//     断言其集合恰好等于 EGRESS_POINTS 中 carriesUserText 不为 false 的项。
//     这一条堵的是 branded type 方案唯一的结构性缺口（新增出口接受 string）。
//  2. **COMPLY-11 绑定**：compliance/no-unlabeled-output.md 的 egress_hash 与
//     EGRESS_POINTS 的规范化 sha256 一致 —— 出口集合变了就必须重新复核那份登记。
//  3. **告警载荷不含对话文本**（SAFE-16）：acute 告警的实际 webhook 载荷里不得出现
//     触发消息的任何片段。
//
// 为什么断言 1 不是空真的：两个负向 fixture 各自证明它的一个方向能失败 ——
// unregistered-egress.ts 证明「多一项」会红，注入式的 diff 用例证明「少一项」会红。
// 没有这两条，一个恒返回空集的扫描器会让这条断言永远绿。

import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { EGRESS_POINTS, TEXT_CARRYING_EGRESS_POINTS } from '@drift/safety';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * 扫描范围 = 生产源码。
 *
 * 刻意包含 apps/web：GatedText 的类型定义在 @drift/contract，前端同样 import 得到它，
 * 于是「前端加了一个接受 GatedText 的函数」也必须被这条断言看见。
 * 刻意排除 dist（编译产物里的 .d.ts 会让同一个出口被数两次）与 *.test.ts（测试里的
 * 辅助函数不是出口）。
 */
const SCAN_PATTERNS = ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts', 'apps/*/src/**/*.tsx'];

/**
 * TS 给 unique symbol 成员生成的内部名字前缀。
 *
 * GatedText = string & { readonly [GATED]: true }，其中 GATED 是 declare const 的
 * unique symbol，因此该交叉类型的属性名会是 '__@GATED@<id>'。检测这个前缀，而不是
 * 检测类型别名叫不叫 GatedText —— 后者在「换个别名重新导出」时就失效了。
 */
const GATED_BRAND_PREFIX = '__@GATED';

interface ScannedEgress {
  /** 声明该函数的文件（不是 re-export 它的文件），仓库相对 posix 路径。 */
  readonly module: string;
  readonly fn: string;
}

function toPosixRelative(absolute: string): string {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
}

function productionFiles(): string[] {
  const found = new Set<string>();
  for (const pattern of SCAN_PATTERNS) {
    for (const rel of globSync(pattern, { cwd: REPO_ROOT })) {
      const posix = rel.split(path.sep).join('/');
      if (posix.includes('/dist/')) continue;
      if (posix.endsWith('.test.ts') || posix.endsWith('.test.tsx')) continue;
      found.add(path.join(REPO_ROOT, rel));
    }
  }
  return [...found].sort();
}

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  // 跨包 import 写的是 .ts specifier（Node 24 不会把 ./x.js 改写成 ./x.ts）。
  allowImportingTsExtensions: true,
  noEmit: true,
  skipLibCheck: true,
  jsx: ts.JsxEmit.ReactJSX,
  types: ['node'],
};

/** 递归判断一个类型里是否出现 GatedText（含嵌在对象参数的属性里、联合/交叉里）。 */
function containsGatedText(
  checker: ts.TypeChecker,
  type: ts.Type,
  depth = 0,
  seen: Set<ts.Type> = new Set(),
): boolean {
  // 深度上限：类型图可以是递归的，seen 挡住环，depth 挡住指数爆炸。
  if (depth > 5 || seen.has(type)) return false;
  seen.add(type);

  if (type.aliasSymbol?.name === 'GatedText') return true;

  const properties = checker.getPropertiesOfType(type);
  if (properties.some((property) => property.escapedName.toString().startsWith(GATED_BRAND_PREFIX))) {
    return true;
  }

  if (type.isUnionOrIntersection()) {
    if (type.types.some((member) => containsGatedText(checker, member, depth + 1, seen))) return true;
  }

  for (const property of properties) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (declaration === undefined) continue;
    const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
    if (containsGatedText(checker, propertyType, depth + 1, seen)) return true;
  }

  for (const argument of checker.getTypeArguments(type as ts.TypeReference)) {
    if (containsGatedText(checker, argument, depth + 1, seen)) return true;
  }

  return false;
}

function declaredName(declaration: ts.Declaration, fallback: string): string {
  // 用**声明处**的名字而不是导出名：export { deliver as send } 不该被算成新出口。
  const named = declaration as ts.NamedDeclaration;
  const name = named.name;
  return name !== undefined && ts.isIdentifier(name) ? name.text : fallback;
}

/**
 * 扫出所有「导出函数且至少一个参数类型解析后含 GatedText」的 { module, fn }。
 *
 * @param extraFiles 额外纳入扫描范围的绝对路径（负向 fixture 用）。
 */
function scanGatedTextEgress(extraFiles: readonly string[] = []): ScannedEgress[] {
  const files = [...productionFiles(), ...extraFiles];
  const inScope = new Set(files);
  const program = ts.createProgram(files, COMPILER_OPTIONS);
  const checker = program.getTypeChecker();
  const found = new Map<string, ScannedEgress>();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (!inScope.has(sourceFile.fileName)) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) continue;

    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const declaration = exported.valueDeclaration ?? exported.declarations?.[0];
      if (declaration === undefined) continue;
      const type = checker.getTypeOfSymbolAtLocation(exported, declaration);
      const signatures = type.getCallSignatures();
      if (signatures.length === 0) continue;

      const carriesGatedText = signatures.some((signature) =>
        signature.getParameters().some((parameter) => {
          const parameterDeclaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
          if (parameterDeclaration === undefined) return false;
          return containsGatedText(
            checker,
            checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration),
          );
        }),
      );
      if (!carriesGatedText) continue;

      const entry: ScannedEgress = {
        module: toPosixRelative(declaration.getSourceFile().fileName),
        fn: declaredName(declaration, exported.getName()),
      };
      found.set(`${entry.module}::${entry.fn}`, entry);
    }
  }

  return [...found.values()].sort((a, b) =>
    `${a.module}::${a.fn}`.localeCompare(`${b.module}::${b.fn}`),
  );
}

interface EgressDiff {
  /** 扫到了但注册表里没有 —— 新增了接受 GatedText 的导出函数却没登记。 */
  readonly unregistered: readonly string[];
  /** 注册表里有但扫不到 —— 通常是参数类型从 GatedText 改回了 string。 */
  readonly missing: readonly string[];
}

function diffEgress(
  scanned: readonly ScannedEgress[],
  registry: readonly { readonly id: string; readonly module: string; readonly fn: string }[],
): EgressDiff {
  const registryKeys = new Map(registry.map((point) => [`${point.module}::${point.fn}`, point.id]));
  const scannedKeys = new Set(scanned.map((entry) => `${entry.module}::${entry.fn}`));
  return {
    unregistered: [...scannedKeys].filter((key) => !registryKeys.has(key)).sort(),
    missing: [...registryKeys.entries()]
      .filter(([key]) => !scannedKeys.has(key))
      .map(([key, id]) => `${id} (${key})`)
      .sort(),
  };
}

/**
 * 失配信息**必须分两类列出**。一句「集合不相等」会让读它的人分不清该登记一个新出口，
 * 还是该把某个出口的参数类型改回 GatedText —— 而这两件事的修法完全相反。
 */
function formatEgressMismatch(diff: EgressDiff): string {
  const parts = ['出站出口集合与 EGRESS_POINTS 不相等：'];
  parts.push(
    diff.unregistered.length === 0
      ? '  未登记的出口函数：（无）'
      : [
          '  未登记的出口函数（新增了接受 GatedText 的导出函数但没登记进 EGRESS_POINTS）：',
          ...diff.unregistered.map((key) => `    - ${key}`),
        ].join('\n'),
  );
  parts.push(
    diff.missing.length === 0
      ? '  注册表中已不存在的项：（无）'
      : [
          '  注册表中已不存在的项（登记了但扫不到 —— 通常是参数类型从 GatedText 改成了 string）：',
          ...diff.missing.map((key) => `    - ${key}`),
        ].join('\n'),
  );
  parts.push(
    '  ⚠️ 不要为了让这条断言变绿而从注册表里删项 —— 删注册表项与修出口是两件完全不同的事。',
  );
  return parts.join('\n');
}

/** program 构造 ~1-3s，三个用例共用同一次生产扫描。 */
let productionScan: ScannedEgress[] | undefined;
function scanProductionOnce(): ScannedEgress[] {
  productionScan ??= scanGatedTextEgress();
  return productionScan;
}

describe('EGRESS_POINTS 注册表（RESEARCH §3.4）', () => {
  it('恰好四项，id 与承载文本标记如实', () => {
    expect(EGRESS_POINTS.map((point) => point.id)).toEqual([
      'ws.deliver',
      'db.insertCharacterMessage',
      'export.renderLine',
      'alert.acuteWebhook',
    ]);
    // acute 告警是出口但不承载对话文本（SAFE-16），因此不参与 GatedText 集合相等。
    expect(TEXT_CARRYING_EGRESS_POINTS.map((point) => point.id)).toEqual([
      'ws.deliver',
      'db.insertCharacterMessage',
      'export.renderLine',
    ]);
  });
});

describe('绑定断言 1：GatedText 出口集合 = 注册表（V.0 #3）', () => {
  it('生产源码扫描结果与注册表集合相等', () => {
    const scanned = scanProductionOnce();
    const diff = diffEgress(scanned, [...TEXT_CARRYING_EGRESS_POINTS]);
    expect(diff, formatEgressMismatch(diff)).toEqual({ unregistered: [], missing: [] });
  }, 120_000);

  it('扫描器真的看得见 GatedText —— 三个出口都被扫到（防止恒返回空集的空真通过）', () => {
    const scanned = scanProductionOnce().map((entry) => `${entry.module}::${entry.fn}`);
    expect(scanned).toContain('apps/api/src/ws/server.ts::deliver');
    expect(scanned).toContain('packages/db/src/message.ts::insertCharacterMessage');
    expect(scanned).toContain('apps/api/src/modules/export/render.ts::renderExportLine');
  }, 120_000);

  it('把未登记的负向 fixture 纳入扫描后，集合相等失败且错误信息点名 sendSomewhereElse', () => {
    const fixture = path.join(REPO_ROOT, 'tools/ci/fixtures/unregistered-egress.ts');
    const scanned = scanGatedTextEgress([fixture]);
    const diff = diffEgress(scanned, [...TEXT_CARRYING_EGRESS_POINTS]);
    expect(diff.unregistered).toContain('tools/ci/fixtures/unregistered-egress.ts::sendSomewhereElse');
    const message = formatEgressMismatch(diff);
    expect(message).toContain('sendSomewhereElse');
    expect(message).toContain('未登记的出口函数');
  }, 120_000);

  it('某个出口的参数从 GatedText 改回 string 时，失配信息把它归到「注册表中已不存在的项」', () => {
    // 破坏验证写成测试内注入而不是临时改文件：这样「改坏出口签名会红」这件事每个 PR
    // 都在跑，而不是只在某个执行器手里跑过一次。
    const scannedWithoutDeliver = scanProductionOnce().filter(
      (entry) => entry.module !== 'apps/api/src/ws/server.ts',
    );
    const diff = diffEgress(scannedWithoutDeliver, [...TEXT_CARRYING_EGRESS_POINTS]);
    expect(diff.missing).toContain('ws.deliver (apps/api/src/ws/server.ts::deliver)');
    const message = formatEgressMismatch(diff);
    expect(message).toContain('注册表中已不存在的项');
    expect(message).toContain('ws.deliver');
    // 两类必须分开列，不能只说不相等。
    expect(message).toContain('未登记的出口函数');
  }, 120_000);
});

describe('三层防线之二：any 通道（V.0 #2）', () => {
  it('对 any-into-egress.ts 跑 eslint 必须报出 no-unsafe-argument', async () => {
    // ignore:false 是必需的：tools/ci/fixtures/** 被全局 ignores 排除出常规 lint，
    // 否则 pnpm run lint 会因为这个故意违规的 fixture 而整体失败。
    const eslint = new ESLint({ cwd: REPO_ROOT, ignore: false, cache: false });
    const results = await eslint.lintFiles([
      path.join(REPO_ROOT, 'tools/ci/fixtures/any-into-egress.ts'),
    ]);
    const ruleIds = results.flatMap((result) => result.messages.map((message) => message.ruleId));
    expect(ruleIds, `实际报出的规则：${ruleIds.join(', ')}`).toContain(
      '@typescript-eslint/no-unsafe-argument',
    );
  }, 120_000);
});

describe('三层防线之一：as GatedText 只允许出现在唯一产出点', () => {
  it('全仓 as GatedText 只命中 packages/safety/src/gateway.ts', () => {
    const grep = spawnSync('grep', ['-rn', 'as GatedText', 'packages', 'apps', '--include=*.ts'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    const hits = (grep.stdout ?? '')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      // dist 里的 .d.ts 不是源码；--include=*.ts 抓不到 .d.ts 之外的产物，这里再兜一层。
      .filter((line) => !line.includes('/dist/'))
      // 注释里对这条禁令本身的引述不是一次断言 —— 数它会让这条检查变成「不许提它」。
      .filter((line) => {
        const code = line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1);
        const commentAt = code.indexOf('//');
        const assertionAt = code.indexOf('as GatedText');
        return commentAt === -1 || assertionAt < commentAt;
      });
    expect(hits.length, `命中行：\n${hits.join('\\n')}`).toBe(1);
    expect(hits[0]).toContain('packages/safety/src/gateway.ts');
  });
});
