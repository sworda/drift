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
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { EGRESS_POINTS, TEXT_CARRYING_EGRESS_POINTS, safetyGateway } from '@drift/safety';

// 第四个出口的实现。直接按路径 import 而不经包边界：它住在 apps/api 里，而注册表
// 指的就是那个路径。alert.ts 刻意不 import config/env.ts 与 obs/logger.ts —— 后者在
// 模块加载时校验环境变量并 exit 1，那会让本条断言无法在 ci:fast 里跑。
import {
  ACUTE_ALERT_FIELDS,
  ACUTE_ALERT_FIELDS_MATCH_TYPE,
  MIN_LEAK_LENGTH,
  findLeakedSubstring,
  notifyOperator,
  type AcuteAlert,
} from '../../apps/api/src/modules/safety/alert.ts';

// 哈希算法只有一份实现：这里 import 它，fast.yml 跑它的 CLI，人工更新登记也跑它。
import { checkEgressHash, HASH_MISMATCH_MESSAGE } from './egress-hash.mjs';

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
  it('恰好五项，id 与承载文本标记如实', () => {
    expect(EGRESS_POINTS.map((point) => point.id)).toEqual([
      'ws.deliver',
      'db.insertCharacterMessage',
      'export.renderLine',
      'alert.acuteWebhook',
      'reconcile.publicnessWebhook',
    ]);
    // 两条运营者告警是出口但不承载对话文本（SAFE-16 / D-23），因此不参与 GatedText 集合相等。
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

describe('三层防线之一：as GatedText 只允许出现在两个受控产出点', () => {
  it('全仓 as GatedText 只命中 gateway.ts（产出）与 stored-gated.ts（历史恢复）', () => {
    // Plan 11 起有两处受控提升：gateway.ts 是唯一**产出**点（网关），stored-gated.ts
    // 是历史角色消息的**恢复**通道（导出渲染需要 GatedText，合法性来源是
    // message.disclosure 的留证 —— 它不产生新的可投递文本）。这条断言的强度不变：
    // 除这两处外，任何新的 as GatedText 都会在这里红。
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
    expect(hits.length, `命中行：\n${hits.join('\\n')}`).toBe(2);
    expect(hits.some((line) => line.includes('packages/safety/src/gateway.ts'))).toBe(true);
    expect(hits.some((line) => line.includes('packages/safety/src/stored-gated.ts'))).toBe(true);
  });

  it('没有任何调用点用非空断言跳过网关返回值的收窄', () => {
    // safetyGateway 的返回是可判别联合，只有 gated 那一支带 text。用 `!.text` 把它
    // 断言出来等于绕过收窄 —— 那正是「turn 外层 catch 里降级为直接下发」的写法形态。
    const grep = spawnSync(
      'grep',
      ['-rn', '-e', '!\\.text', '-e', 'gated!', 'packages', 'apps', 'tests', '--include=*.ts'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    const hits = (grep.stdout ?? '')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .filter((line) => !line.includes('/dist/'))
      .filter((line) => {
        const code = line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1);
        return !code.trimStart().startsWith('//');
      });
    expect(hits, `出现了对网关返回值的非空断言：\n${hits.join('\\n')}`).toEqual([]);
  });
});

describe('绑定断言 2：COMPLY-11 登记与出口集合的 egress_hash 绑定（D-21）', () => {
  const script = path.join(REPO_ROOT, 'tools/ci/egress-hash.mjs');

  it('--print 输出单行 sha256', () => {
    const run = spawnSync(process.execPath, [script, '--print'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);
    const lines = (run.stdout ?? '').split('\n').filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^sha256:[0-9a-f]{64}$/u);
  }, 60_000);

  it('--check 与登记文件一致（出口集合没变 ⇒ 不要求重新复核）', () => {
    const run = spawnSync(process.execPath, [script, '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(
      run.status,
      `egress_hash 与 EGRESS_POINTS 不一致：\n${run.stdout}${run.stderr}`,
    ).toBe(0);
  }, 60_000);

  it('给注册表加一项而不改 egress_hash ⇒ 变红，且错误信息含「未重新复核」', () => {
    // 破坏验证写成注入而不是临时改文件：checkEgressHash 接受 points，于是「出口集合
    // 变了而登记没被重读会红」这件事每个 PR 都在跑。
    const mutated = [
      ...EGRESS_POINTS,
      { id: 'zz.newEgress', module: 'apps/api/src/modules/zz/new.ts', fn: 'sendZz' },
    ];
    const result = checkEgressHash({ points: mutated });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('未重新复核');
    expect(result.message).toContain('compliance/no-unlabeled-output.md');
    expect(HASH_MISMATCH_MESSAGE).toContain('egress-hash.mjs --print');
  });

  it('--check 传一个错的期望值 ⇒ 非零退出并打印复核指引', () => {
    const run = spawnSync(process.execPath, [script, '--check', 'sha256:deadbeef'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain('未重新复核');
  }, 60_000);

  it('哈希脚本不得自动改写登记文件（自动更新会绕过人工复核动作）', () => {
    const source = readFileSync(script, 'utf8');
    for (const forbidden of ['writeFile', 'writeFileSync', 'appendFile', 'createWriteStream']) {
      expect(source, `egress-hash.mjs 出现了 ${forbidden} —— COMPLY-11 的人工复核动作被绕过`).not.toContain(
        forbidden,
      );
    }
  });

  it('登记文件的 front-matter 三个键齐全，正文含空集结论与第九条引注', () => {
    const doc = readFileSync(path.join(REPO_ROOT, 'compliance/no-unlabeled-output.md'), 'utf8');
    for (const key of ['egress_hash:', 'reviewed_at:', 'reviewed_by:']) {
      expect(doc).toContain(key);
    }
    expect(doc).toContain('空集');
    expect(doc).toContain('第九条');
    // 四条对外提供路径逐条覆盖 —— 少一条就说明有一个出口没被复核过。
    for (const point of EGRESS_POINTS) {
      expect(doc, `登记文件没有逐条覆盖出口 ${point.id}`).toContain(point.id);
    }
  });
});

describe('绑定断言 3：acute 告警载荷不含对话文本（SAFE-16 / T-06-04）', () => {
  /**
   * 特征串：一段不会自然出现在任何模板、日志或 id 里的中文。
   * 它是本条断言的「示踪剂」—— 只要它出现在 webhook 载荷里，就说明有人把对话内容
   * 接进了告警。
   */
  const TRACER = '霁蘅黟饕餮氤氲魍魎彧翾黼黻';
  // ⚠️ 子串检查器**只有一份实现**：Plan 07 把它挪进了
  // apps/api/src/modules/safety/alert.ts（notifyOperator 的构造期自检要用它），
  // 这里 import 那一份。测试里再复制一份的后果是两处分叉，而分叉之后这条断言守的
  // 不再是生产代码实际使用的那个检查器。

  it('子串检查器自身有效 —— 一个故意泄漏的载荷必须被抓到（防止空真通过）', () => {
    const leaky = JSON.stringify({ msgtype: 'text', text: { content: `触发消息：${TRACER}` } });
    expect(findLeakedSubstring(leaky, TRACER, MIN_LEAK_LENGTH)).not.toBeNull();
    // 一段与特征串无关的载荷不该被误判。
    expect(findLeakedSubstring('{"a":"无关内容"}', TRACER, MIN_LEAK_LENGTH)).toBeNull();
  });

  it('走完 acute 流程到 notifyOperator 的载荷构造点，载荷不含触发消息的任何 6 字以上子串', async () => {
    // ① 触发消息带着特征串进入网关，分类为 crisis。
    const candidateText = `我撑不住了，${TRACER}。`;
    const gated = await safetyGateway({
      candidateText,
      classification: { classifierStatus: 'ok', level: 'crisis' },
      conversationStatus: 'active',
      // Plan 07：escalated 分支现在**必须**写一条 safety_event 并返回它的 id
      // （crisis 分支的 contact_attempt 以 safety_event_id 为外键）。这里返回一个
      // 固定 id —— 本条断言的对象是告警载荷，不是落库。
      recordSafetyEvent: () => 'sev_egress_binding',
      // crisis ⇒ 网关会走联络通道（Plan 07）。本条断言的对象是告警载荷，不是四态，
      // 所以这里返回一个固定的 unavailable —— 真实的四态推进在 L5。
      contactChannel: () => ({ status: 'unavailable', contactName: null, maskedContact: null }),
    });
    // ② crisis ⇒ 不产出 GatedText，走 acute 告警这一条出口。
    expect(gated.outcome).toBe('escalated');
    if (gated.outcome !== 'escalated') return;
    expect(gated.level).toBe('crisis');

    // ③ 构造告警载荷并投递（webhook 用 mock 拦截，不出网）。
    const alert: AcuteAlert = {
      userId: 'usr_tracer',
      conversationId: 'cnv_tracer',
      riskLevel: 'crisis',
      occurredAt: new Date('2026-09-27T10:00:00.000Z'),
      safetyEventId: 'sev_tracer',
    };
    let capturedBody = '';
    const fetchImpl: typeof fetch = (_input, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : String(init?.body ?? '');
      return Promise.resolve(
        new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
    const result = await notifyOperator(
      alert,
      {
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test',
        mentionedList: ['@all'],
        fetchImpl,
      },
      // Plan 07：第三个参数是构造期自检的针。传真正的触发消息 —— 传空串会让自检
      // 静默跳过，于是这条断言只剩「事后检查序列化结果」一层。
      { triggeringMessage: candidateText },
    );
    expect(result.delivered).toBe(true);

    // ④ 断言：整段载荷里没有触发消息的任何 6 字以上片段。
    expect(capturedBody.length).toBeGreaterThan(0);
    const leaked = findLeakedSubstring(capturedBody, candidateText, MIN_LEAK_LENGTH);
    expect(leaked, `告警载荷泄漏了对话片段：${leaked ?? ''}\n载荷：${capturedBody}`).toBeNull();
    // 特征串本身也单独查一次（上面的窗口扫描已覆盖，这一行是给读失败信息的人看的）。
    expect(capturedBody).not.toContain(TRACER);
  });

  it('AcuteAlert 恰好五个字段，类型体里不存在任何对话文本字段', () => {
    expect([...ACUTE_ALERT_FIELDS]).toEqual([
      'userId',
      'conversationId',
      'riskLevel',
      'occurredAt',
      'safetyEventId',
    ]);
    expect(ACUTE_ALERT_FIELDS).toHaveLength(5);
    // ACUTE_ALERT_FIELDS_MATCH_TYPE 是编译期断言（给类型加字段而不改清单 ⇒ tsc 报错）；
    // 这里确认它确实是 true，即那条编译期断言没有被改成一个恒真的形状。
    expect(ACUTE_ALERT_FIELDS_MATCH_TYPE).toBe(true);

    const source = readFileSync(
      path.join(REPO_ROOT, 'apps/api/src/modules/safety/alert.ts'),
      'utf8',
    );
    const body = /export interface AcuteAlert \{([\s\S]*?)\n\}/u.exec(source);
    expect(body, 'alert.ts 里找不到 AcuteAlert 的类型体').not.toBeNull();
    const typeBody = body?.[1] ?? '';
    for (const forbidden of ['text', 'content', 'message', 'reply', 'snippet']) {
      expect(
        typeBody.toLowerCase(),
        `AcuteAlert 的类型体出现了 ${forbidden} —— 告警不得携带对话内容（SAFE-16）`,
      ).not.toContain(forbidden);
    }
    // 字段数 = 类型体里的 readonly 行数。
    const fieldLines = typeBody.split('\n').filter((line) => line.includes('readonly '));
    expect(fieldLines).toHaveLength(5);
  });

  it('投递失败如实返回（SAFE-16：失败直接进 unavailable，不经 pending）', async () => {
    const alert: AcuteAlert = {
      userId: 'usr_x',
      conversationId: 'cnv_x',
      riskLevel: 'crisis',
      occurredAt: new Date('2026-09-27T10:00:00.000Z'),
      safetyEventId: 'sev_x',
    };
    const transport = { webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x' };
    // 本条用例的被测对象是投递结果的判定，不是构造期自检 —— 一条与告警字段无关的
    // 触发消息让自检必然通过（下面那一组断言才是自检本身的被测点）。
    const guard = { triggeringMessage: '这一句与告警载荷没有任何共同片段。' } as const;

    // 企业微信对无效 webhook 同样返回 200 —— 业务码非 0 必须算失败，否则状态机会把
    // 一次没送到的告警置成 pending，然后等一个永远不会来的运营者确认。
    const businessError = await notifyOperator(
      alert,
      {
        ...transport,
        fetchImpl: () =>
          Promise.resolve(
            new Response(JSON.stringify({ errcode: 93_000, errmsg: 'invalid webhook url' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          ),
      },
      guard,
    );
    expect(businessError).toEqual({
      delivered: false,
      reason: 'business_error',
      httpStatus: 200,
      errcode: 93_000,
    });

    const httpError = await notifyOperator(
      alert,
      { ...transport, fetchImpl: () => Promise.resolve(new Response('nope', { status: 500 })) },
      guard,
    );
    expect(httpError.delivered).toBe(false);

    const networkError = await notifyOperator(
      alert,
      { ...transport, fetchImpl: () => Promise.reject(new Error('ECONNRESET')) },
      guard,
    );
    expect(networkError).toEqual({
      delivered: false,
      reason: 'network_error',
      httpStatus: null,
      errcode: null,
    });
  });

  it('两条告警出口都不参与 GatedText 集合相等（约束是「不含对话文本」，不是「只接受 GatedText」）', () => {
    for (const id of ['alert.acuteWebhook', 'reconcile.publicnessWebhook']) {
      const point = EGRESS_POINTS.find((candidate) => candidate.id === id);
      expect(point, `注册表里没有 ${id}`).toBeDefined();
      expect(point && 'carriesUserText' in point ? point.carriesUserText : true).toBe(false);
      expect(TEXT_CARRYING_EGRESS_POINTS.map((candidate) => candidate.id)).not.toContain(id);
    }
  });
});

describe('注册表指向的模块与函数真实存在', () => {
  it('每一项的 module 都在磁盘上，且该文件里出现了这个 fn 名', () => {
    for (const point of EGRESS_POINTS) {
      const absolute = path.join(REPO_ROOT, point.module);
      const source = readFileSync(absolute, 'utf8');
      expect(
        source,
        `EGRESS_POINTS 的 ${point.id} 指向的 ${point.module} 里没有 ${point.fn}`,
      ).toContain(point.fn);
    }
  });
});
