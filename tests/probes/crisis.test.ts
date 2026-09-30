// 危机探针集的 vitest 入口（L6 · RESEARCH §4.6 / 成功标准 2）。
//
// ── 三个部分 ─────────────────────────────────────────────────────────────
//  1. 形状守卫（离线）：总数 78 / 阴性恰好 15 / id 唯一 —— 删用例提高通过率是
//     SAFE-15 的直接反例，这几条让它变成红灯而不是统计。
//  2. 非空真证明（离线，打真库）：「永远返回 crisis」的桩分类器必须让 15 条阴性
//     对照**全部失败** —— 若它反而全绿，探针集就是空真的；分类器故障注入的
//     3 条用真实管道验证 fail-closed 到 elevated。
//  3. 真实 safety.classify（需 ZHIPU_API_KEY）：78 条 × N=3 全绿。无 key 时**不
//     静默跳过** —— 有一条守卫断言 SKIPPED_CHECKS 里存在登记（probes-real-
//     classify-not-run），登记被删掉而 key 仍然缺失时它会变红。
//
// ⚠️ 环境变量必须在动态 import 之前设置：runner 的静态依赖链会加载 env.ts，
// 而它在模块加载期校验环境（缺变量直接 exit 1）。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'probe-suite-operator-token-0123456789';
process.env['BETTER_AUTH_SECRET'] ??= 'probe-suite-better-auth-secret-0123456789';
process.env['CONTACT_ENCRYPTION_KEY'] ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

const runner = await import('./runner.ts');

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ZHIPU_KEY_PRESENT =
  typeof process.env['ZHIPU_API_KEY'] === 'string' && process.env['ZHIPU_API_KEY'].length > 0;

describe('探针集形状守卫（离线可证明）', () => {
  it('六个文件合计恰好 78 条、阴性对照恰好 15 条、id 唯一', () => {
    const cases = runner.loadProbeSuite(runner.PROBE_FILES);
    runner.assertSuiteShape(cases);
    expect(cases.length).toBe(78);
  });

  it('非空真：删掉 3 条后条数守卫变红（防止「悄悄删用例提高通过率」）', () => {
    const cases = runner.loadProbeSuite(runner.PROBE_FILES);
    const truncated = cases.slice(0, cases.length - 3);
    expect(() => runner.assertSuiteShape(truncated)).toThrow();
  });

  it('非空真：阴性对照不足 15 条时守卫同样变红', () => {
    const cases = runner.loadProbeSuite(runner.PROBE_FILES);
    const withoutNegatives = cases.filter((c) => !c.id.startsWith('crisis.neg.'));
    expect(() => runner.assertSuiteShape(withoutNegatives)).toThrow();
  });

  it('expect=none 的用例文本不命中入站规则层与挽留词表（它们考的是分类器，不是词表）', async () => {
    const { scanInbound } = await import('@drift/safety');
    const { hitsRetentionPhrase } = await import('@drift/safety');
    const cases = runner.loadProbeSuite(runner.PROBE_FILES);
    const ruleFree = cases.filter((c) => c.expect.level === 'none');
    // 15 条阴性对照 + 4 条 suppress-ai。
    expect(ruleFree.length).toBe(19);
    for (const probe of ruleFree) {
      const scan = scanInbound(probe.text);
      expect(scan.hits, probe.id).toHaveLength(0);
      expect(scan.suggestedLevel, probe.id).toBe('none');
      expect(hitsRetentionPhrase(probe.text), probe.id).toHaveLength(0);
    }
  });
});

describe('非空真证明（桩分类器 + 真实管道，离线可跑）', () => {
  it(
    '「永远返回 crisis」的桩 ⇒ 15 条阴性对照全部失败（探针集不是空真的）',
    { timeout: 120_000 },
    async () => {
      const result = await runner.runProbeSuite(runner.alwaysCrisisClassifyInvoke(), {
        files: ['crisis/negative-controls.yaml'],
        repeats: 1,
      });
      expect(result.total).toBe(15);
      expect(result.failures).toHaveLength(15);
      for (const failure of result.failures) {
        expect(failure.caseId.startsWith('crisis.neg.')).toBe(true);
        expect(failure.checks.length).toBeGreaterThan(0);
      }

      // T-08-07：失败输出只含 id、轮次与结构化事实 —— 不含任何用例正文。
      const serialized = JSON.stringify(result.failures);
      for (const probe of runner.loadProbeSuite(['crisis/negative-controls.yaml'])) {
        expect(serialized.includes(probe.text)).toBe(false);
      }
    },
  );

  it(
    '分类器三类故障注入 ⇒ 全部 fail-closed 到 elevated（真实管道，SAFE-05）',
    { timeout: 120_000 },
    async () => {
      // 故障注入本身就是分类来源，因此这组用例离线可跑、且结果是确定性的。
      // （runProbeSuite 的 classifyInvoke 参数在这组用例上不会被用到 —— 它们的
      //   inject.classify 覆盖了来源；传 always-crisis 仅为类型占位。）
      const result = await runner.runProbeSuite(runner.alwaysCrisisClassifyInvoke(), {
        files: ['crisis/classifier-failure.yaml'],
        repeats: 1,
      });
      expect(result.total).toBe(3);
      expect(result.failures).toHaveLength(0);
    },
  );
});

describe('危机探针集 · 真实 safety.classify（L6，glm-4.7-flash，temperature 0）', () => {
  it.runIf(ZHIPU_KEY_PRESENT)(
    '78 条 × N=3 全部通过',
    { timeout: 1_800_000 },
    async () => {
      const result = await runner.runProbeSuite(runner.zhipuClassifyInvoke(), {
        files: runner.PROBE_FILES,
        repeats: 3,
      });
      if (result.failures.length > 0) {
        // 逐条列出结构化事实的差异 —— 没有正文，没有模型输出（T-08-07）。
        const lines = result.failures.map(
          (f) =>
            f.caseId +
            '（第 ' +
            String(f.repeat) +
            ' 轮）：' +
            f.checks
              .map((c) => c.check + ' 期望 ' + c.expected + '，实际 ' + c.actual)
              .join('；'),
        );
        throw new Error(
          '探针失败 ' +
            String(result.failures.length) +
            '/' +
            String(result.total) +
            '：\n' +
            lines.join('\n'),
        );
      }
      expect(result.total).toBe(78 * 3);
    },
  );

  it.skipIf(ZHIPU_KEY_PRESENT)(
    'ZHIPU_API_KEY 缺失 ⇒ 显式挂起必须登记在 SKIPPED_CHECKS（否则这是静默跳过）',
    () => {
      const skipped = readFileSync(join(REPO_ROOT, 'SKIPPED_CHECKS.md'), 'utf8');
      expect(skipped.includes('probes-real-classify-not-run')).toBe(true);
      // probes 层已有被测对象 —— L6-no-subject 那一行必须已被本 plan 删除。
      expect(skipped.includes('L6-no-subject')).toBe(false);
    },
  );
});