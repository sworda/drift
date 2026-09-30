import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TSC = join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');

describe('负向 type fixture（V.0 #1）', () => {
  it('对 tools/ci/type-fixtures 跑 tsc 必须失败，且至少 4 条 error TS', () => {
    const run = spawnSync(TSC, ['--noEmit', '-p', 'tools/ci/type-fixtures/tsconfig.json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    // 退出码为 0 意味着 GatedText 已退化为普通 string 别名 —— 本阶段最危险的静默失效。
    expect(run.status, `tsc 竟然通过了负向 fixture：\n${output}`).not.toBe(0);
    const errorLines = output.split('\n').filter((line) => /error TS\d+/.test(line));
    // 阈值随报错源增加而抬：Plan 06 给 gated-text-escape.ts 追加了两处 satisfies 违反
    // （4 → 6 个来源），Plan 09 又加了 consent-ticket-escape.ts 的四处违反。停在旧阈值
    // 等于给「少掉一半报错源」留一条不会变红的路。
    expect(errorLines.length, `error TS 行数不足：\n${output}`).toBeGreaterThanOrEqual(8);
    // 每个 fixture 各自都必须有报错 —— 只看总数的话，一个 fixture 整个失效可以被
    // 另一个的报错数掩盖过去。（Plan 14 追加 empty-or-error-escape.ts 的四处违反。）
    for (const fixture of [
      'gated-text-escape.ts',
      'consent-ticket-escape.ts',
      'empty-or-error-escape.ts',
    ]) {
      expect(
        errorLines.some((line) => line.includes(fixture)),
        `${fixture} 一条 error TS 都没有 —— 它守的那条约束已经失效：\n${output}`,
      ).toBe(true);
    }
  });
});
