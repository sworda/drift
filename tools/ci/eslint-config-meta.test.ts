import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { REQUIRED_RESTRICTED_SYNTAX } from '../../eslint.config.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 三层出口防线里唯一能堵住 any 通道的一层，必须逐个包断言 severity 为 2。 */
const TYPE_AWARE_RULES = [
  '@typescript-eslint/no-unsafe-argument',
  '@typescript-eslint/no-unsafe-assignment',
  '@typescript-eslint/no-unsafe-return',
  '@typescript-eslint/no-explicit-any',
];

const PACKAGE_DIRS = ['contract', 'db', 'llm', 'safety', 'prompts'];

interface EffectiveConfig {
  rules?: Record<string, unknown> | undefined;
}

function firstTsFile(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      const nested = firstTsFile(abs);
      if (nested !== undefined) return nested;
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      return abs;
    }
  }
  return undefined;
}

/** 每个包、每个 app（Plan 03 起出现时自动纳入）与 tools/ci 各取一个代表文件。 */
function representativeFiles(): string[] {
  const files = PACKAGE_DIRS.map((name) => join(REPO_ROOT, 'packages', name, 'src', 'index.ts'));
  files.push(fileURLToPath(import.meta.url));
  const appsDir = join(REPO_ROOT, 'apps');
  if (existsSync(appsDir)) {
    for (const app of readdirSync(appsDir).sort()) {
      const found = firstTsFile(join(appsDir, app));
      if (found !== undefined) files.push(found);
    }
  }
  return files;
}

function severityOf(value: unknown): number | undefined {
  const raw: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
  if (raw === 2 || raw === 'error') return 2;
  if (raw === 1 || raw === 'warn') return 1;
  if (raw === 0 || raw === 'off') return 0;
  return undefined;
}

function restrictedSyntaxSelectors(config: EffectiveConfig): string[] {
  const value = config.rules?.['no-restricted-syntax'];
  if (!Array.isArray(value)) return [];
  return value
    .slice(1)
    .map((entry) =>
      typeof entry === 'object' && entry !== null && 'selector' in entry
        ? String((entry as { selector: unknown }).selector)
        : undefined,
    )
    .filter((selector): selector is string => selector !== undefined);
}

describe('eslint flat config 有效配置元测试', () => {
  const files = representativeFiles();

  it('代表文件列表覆盖五个包与 tools/ci', () => {
    expect(files.length).toBeGreaterThanOrEqual(PACKAGE_DIRS.length + 1);
    for (const file of files) expect(existsSync(file)).toBe(true);
  });

  it.each(files)('%s 的有效配置含全部必需的 no-restricted-syntax 条目', async (file) => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const config = (await eslint.calculateConfigForFile(file)) as EffectiveConfig;
    const selectors = restrictedSyntaxSelectors(config);
    // flat config 对同一规则的 options 是替换而非合并：任何子目录块不 spread
    // REQUIRED_RESTRICTED_SYNTAX 都会让下面这组断言变红。
    for (const required of REQUIRED_RESTRICTED_SYNTAX) {
      expect(selectors).toContain(required.selector);
    }
    expect(selectors.length).toBeGreaterThanOrEqual(REQUIRED_RESTRICTED_SYNTAX.length);
  });

  it.each(files)('%s 的四条 type-aware any 防线 severity 均为 2', async (file) => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const config = (await eslint.calculateConfigForFile(file)) as EffectiveConfig;
    for (const rule of TYPE_AWARE_RULES) {
      expect(severityOf(config.rules?.[rule]), `${rule} 必须是 error`).toBe(2);
    }
  });
});

describe('负向 lint fixture', () => {
  async function lintFixture(relative: string): Promise<ESLint.LintResult> {
    // ignore:false —— fixture 目录在常规运行里是被 ignores 排除的，元测试必须显式绕过。
    const eslint = new ESLint({ cwd: REPO_ROOT, ignore: false });
    const results = await eslint.lintFiles([relative]);
    const first = results[0];
    if (first === undefined) throw new Error(`fixture 未被 lint：${relative}`);
    return first;
  }

  it('bad-model-literal.ts 报出 no-restricted-syntax 且 message 含 AI Gateway', async () => {
    const result = await lintFixture('tools/ci/fixtures/bad-model-literal.ts');
    const hits = result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((m) => m.message.includes('AI Gateway'))).toBe(true);
  });

  it('dynamic-provider-import.ts 报出 no-restricted-syntax 的 ImportExpression 条目', async () => {
    const result = await lintFixture('tools/ci/fixtures/dynamic-provider-import.ts');
    const hits = result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((m) => m.message.includes('ImportExpression'))).toBe(true);
  });
});
