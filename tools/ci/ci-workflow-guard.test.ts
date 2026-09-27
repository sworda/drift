import { existsSync, readFileSync } from 'node:fs';
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

  it('nightly 直接调用已落地的 publicness-reconcile，且不留占位分支', () => {
    const text = workflow('nightly.yml');
    // Plan 13 落地了脚本，于是占位分支必须**消失**：留着 `[ -f ]` 判断等于保留一条
    // 「将来某次改名把文件弄丢了也照样绿」的路径（与 model-snapshot-diff 同一理由）。
    expect(
      text.includes('[ -f tools/ci/publicness-reconcile.mjs ]'),
      'publicness-reconcile.mjs 已落地，nightly 不该再用「文件存在才跑」的占位分支',
    ).toBe(false);
    expect(text).toContain('node tools/ci/publicness-reconcile.mjs');
    expect(existsSync(`${REPO_ROOT}tools/ci/publicness-reconcile.mjs`)).toBe(true);
  });

  it('对账脚本不会自己改写公开性状态（自动写回会绕过 D-08 的签字机制）', () => {
    const script = readFileSync(`${REPO_ROOT}tools/ci/publicness-reconcile.mjs`, 'utf8');
    for (const mutator of ['writeFile', 'writeFileSync', 'appendFile', 'git commit']) {
      expect(
        script.includes(mutator),
        `对账脚本含 ${mutator} —— 它可能会自动改写 publicness.json 或自动提交`,
      ).toBe(false);
    }
  });

  it('nightly 直接调用已落地的 model-snapshot-diff，且该步骤没有容错开关', () => {
    const text = workflow('nightly.yml');
    // Plan 05 落地了脚本，于是占位分支必须**消失**：留着 `[ -f ]` 判断等于保留
    // 一条「将来某次改名把文件弄丢了也照样绿」的路径。
    expect(
      text.includes('[ -f tools/ci/model-snapshot-diff.mjs ]'),
      'model-snapshot-diff.mjs 已落地，nightly 不该再用「文件存在才跑」的占位分支',
    ).toBe(false);
    expect(text).toContain('node tools/ci/model-snapshot-diff.mjs');
    expect(existsSync(`${REPO_ROOT}tools/ci/model-snapshot-diff.mjs`)).toBe(true);
    // nightly 允许不阻断合并，但脚本失败必须让 job 红。
    for (const token of BYPASS_TOKENS) {
      expect(text.includes(token), `nightly.yml 出现了 "${token}"`).toBe(false);
    }
  });

  it('日 diff 的基线文件在仓库里，且脚本不会自己改它', () => {
    // 基线必须是一个**人工** commit 的产物：自动更新会让告警在第二天自我消解。
    expect(existsSync(`${REPO_ROOT}compliance/model-snapshot-baseline.json`)).toBe(true);
    const script = readFileSync(`${REPO_ROOT}tools/ci/model-snapshot-diff.mjs`, 'utf8');
    expect(script).toContain('model-snapshot-baseline');
    for (const mutator of ['writeFile', 'writeFileSync', 'appendFile']) {
      expect(script.includes(mutator), `日 diff 脚本含 ${mutator} —— 它可能会自动改写基线`).toBe(
        false,
      );
    }
  });
});
