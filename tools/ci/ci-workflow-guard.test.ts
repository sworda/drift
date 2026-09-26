import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * CI 拓扑的阻断规则断言（RESEARCH § Validation Architecture V.4 / T-03-03）。
 *
 * T-03-03 是本 plan 威胁表里唯一一条 **critical**：integration job 被 skip 之后
 * PR 仍然合入。它的缓解措施原本只是「执行时 grep 一次为 0」—— 而一条只在写代码
 * 那天跑过的 grep，与一条不存在的检查没有区别。这里把它搬进 ci:fast，让它在
 * 每个 PR 上都成立。
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function workflow(name: string): string {
  return readFileSync(`${REPO_ROOT}.github/workflows/${name}`, 'utf8');
}

/**
 * 「允许失败 / 失败后仍然放行」的 YAML 构造。integration.yml 里出现任何一个
 * ——**包括出现在注释里**——都算违反：注释里的引用会让这条断言无法作为一次
 * 字面扫描存在，而一条需要解析 YAML 才能判定的断言迟早会被放宽。
 */
const BYPASS_TOKENS = ['continue-on-error', 'if: always()', 'if: success() ||', '|| true'];

describe('CI 阻断规则（V.4）', () => {
  it('integration job 跑在 self-hosted runner 上', () => {
    expect(workflow('integration.yml')).toContain('runs-on: self-hosted');
  });

  it('integration.yml 不含任何放行构造（T-03-03，critical）', () => {
    const text = workflow('integration.yml');
    for (const token of BYPASS_TOKENS) {
      expect(
        text.includes(token),
        `integration.yml 出现了 "${token}" —— runner 不可用时必须阻断而不是跳过。` +
          '「探针跑不了就先合」是 Phase 1 成功标准 2 的直接反例。',
      ).toBe(false);
    }
  });

  it('integration.yml 真的跑 L5 与 L6 两层', () => {
    const text = workflow('integration.yml');
    expect(text).toContain('pnpm run test:integration');
    expect(text).toContain('pnpm run test:probes');
  });

  it('fast job 跑在托管 runner 上且不碰任何境内凭据', () => {
    const text = workflow('fast.yml');
    // self-hosted runner 掉线时这条防线必须还在，所以它不能依赖境内资源。
    expect(text).toContain('runs-on: ubuntu-latest');
    expect(/secrets\.(WECOM_|LLM_)/.test(text), 'fast job 不得引用境内凭据类 secret').toBe(false);
    expect(text).toContain('pnpm run ci:fast');
  });

  it('所有 workflow 都设了 corepack 的非交互开关', () => {
    // corepack 首次会交互式询问是否下载 pnpm。不设这个变量的话 job 会挂在
    // 提示符上直到超时 —— 一个没有任何错误信息的失败。
    for (const name of ['fast.yml', 'integration.yml', 'nightly.yml']) {
      expect(workflow(name), name).toContain("COREPACK_ENABLE_DOWNLOAD_PROMPT: '0'");
    }
  });

  it('nightly 对两个尚未落地的脚本是「缺失即失败」，不是跳过', () => {
    const text = workflow('nightly.yml');
    for (const script of ['tools/ci/model-snapshot-diff.mjs', 'tools/ci/publicness-reconcile.mjs']) {
      expect(text).toContain(`[ -f ${script} ]`);
    }
    // 两个 else 分支各有一条 exit 1。
    expect(text.match(/exit 1/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
