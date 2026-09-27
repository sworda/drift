import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { REQUIRED_RESTRICTED_SYNTAX } from '../../eslint.config.js';

/**
 * chat 目录的前端计时器禁令（COMPLY-03 / UI-SPEC ## 交互契约）。
 *
 * 计时权威在服务端（usage_segment 按 user_id 归集 + pg-boss 到点作业）——
 * 前端 setTimeout 会在刷新与重登录时清零，使「连续使用满 2 小时」永不触发，
 * 而界面上看不出任何异常。禁令的机械形式是 eslint no-restricted-syntax，
 * 这里同时断言：真实文件的有效配置带着禁令（不是一堵墙）、负向 fixture
 * 会被抓红（不是空真）、目录内 grep 不到计时器调用（回归守卫）。
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CHAT_DIR = join(REPO_ROOT, 'apps/web/src/features/chat');

function chatFiles(dir: string = CHAT_DIR): string[] {
  if (!existsSync(dir)) throw new Error(`chat 目录不存在：${dir}`);
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...chatFiles(abs));
    } else if (/\.(ts|tsx)$/u.test(entry)) {
      out.push(abs);
    }
  }
  return out;
}

describe('chat 目录的前端计时器禁令（COMPLY-03）', () => {
  it('目录内任何源文件都 grep 不到 setTimeout / setInterval 调用', () => {
    for (const file of chatFiles()) {
      const content = readFileSync(file, 'utf8');
      expect(
        /\bsetTimeout\b|\bsetInterval\b/u.test(content),
        `${file} 含前端计时器 —— 计时权威在服务端（usage_segment），前端计时器刷新即清零（COMPLY-03）`,
      ).toBe(false);
    }
  });

  it('负向 fixture：chat-settimeout.tsx 报出 no-restricted-syntax，且 message 指向服务端计时权威', async () => {
    // ignore:false —— fixture 目录在常规运行里被 ignores 排除，必须显式绕过
    //（crisis-ui-contract.test.ts 同一条路径）。
    const eslint = new ESLint({ cwd: REPO_ROOT, ignore: false });
    const results = await eslint.lintFiles(['tools/ci/fixtures/chat-settimeout.tsx']);
    const first = results[0];
    if (first === undefined) throw new Error('fixture 未被 lint');
    const hits = first.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    // 三处违规（window.setTimeout / 裸 setTimeout / setInterval）都要被抓到。
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.some((m) => m.message.includes('计时权威在服务端'))).toBe(true);
    expect(hits.some((m) => m.message.includes('下行事件驱动'))).toBe(true);
  });

  it('正向一半：chat 目录内真实文件的有效配置带着这两条禁令（不是一堵墙）', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const config = (await eslint.calculateConfigForFile(
      join(CHAT_DIR, 'usage-reminder-dialog.tsx'),
    )) as { rules?: Record<string, unknown> };
    const value = config.rules?.['no-restricted-syntax'];
    const selectors = Array.isArray(value)
      ? value
          .slice(1)
          .map((entry) =>
            typeof entry === 'object' && entry !== null && 'selector' in entry
              ? String((entry as { selector: unknown }).selector)
              : undefined,
          )
          .filter((s): s is string => s !== undefined)
      : [];
    expect(selectors.some((s) => s.includes('setTimeout')), 'chat 目录的有效配置必须含计时器禁令').toBe(true);
    expect(selectors.some((s) => s.includes('setInterval'))).toBe(true);
    // 必需的仓库级禁令同时还在（spread 没有被忘掉）。
    for (const required of REQUIRED_RESTRICTED_SYNTAX) {
      expect(selectors).toContain(required.selector);
    }
  });
});
