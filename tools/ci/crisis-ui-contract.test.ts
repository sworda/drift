import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { REQUIRED_RESTRICTED_SYNTAX } from '../../eslint.config.js';
import { CONTACT_ATTEMPT_STATUSES, FALLBACK_HELP_RESOURCES } from '@drift/safety';

/**
 * 危机 UI 契约的静态断言（SAFE-01..05 / R1.24）。
 *
// 渲染层的 RTL 断言住在 apps/web/src/features/crisis/crisis-ui-contract.test.tsx
//（react 只装在 apps/web，从 tools/ci 解析不到 —— 01-09 的先例）。本文件负责
// 不需要渲染的那一半：目录级禁令（grep）、文案常量、两份兜底清单的相等性、
// 取值域三方一致性。
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CRISIS_DIR = join(REPO_ROOT, 'apps/web/src/features/crisis');

/** 递归收集 crisis 目录下的全部源文件（含测试 —— 禁令对测试同样生效）。 */
function crisisFiles(dir: string = CRISIS_DIR): string[] {
  if (!existsSync(dir)) throw new Error(`crisis 目录不存在：${dir}`);
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...crisisFiles(abs));
    } else if (/\.(ts|tsx)$/u.test(entry)) {
      out.push(abs);
    }
  }
  return out;
}

function readCrisisSources(): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of crisisFiles()) map.set(file, readFileSync(file, 'utf8'));
  return map;
}

describe('危机目录的组件层禁令（R1.24 / SAFE-04）', () => {
  // 「伪装成角色发言」与「法定告知走了会自动消失的 toast」是两个组件级错误，
  // grep 是它们在源码层的机械形式 —— 组件评审会漏，CI 不会。
  const FORBIDDEN = ['Bubble', 'BubbleContent', 'sonner'];

  it.each(FORBIDDEN)('crisis 目录内任何源文件都 grep 不到 %s', (needle) => {
    for (const [file, content] of readCrisisSources()) {
      expect(
        content.includes(needle),
        `${file} 含有 ${needle} —— 关怀卡片只能用 Alert 基座，法定告知不得用 toast`,
      ).toBe(false);
    }
  });

  it('crisis 目录内 grep 不到计时器调用 —— 超时权威在服务端（COMPLY-03 同一条原则）', () => {
    for (const [file, content] of readCrisisSources()) {
      expect(
        content.includes('setTimeout') || content.includes('setInterval'),
        `${file} 含前端计时器 —— 「界面说失败了但服务端还在 pending」的分叉就是它造成的`,
      ).toBe(false);
    }
  });
});

describe('文案常量（UI-SPEC ## Copywriting Contract 逐字）', () => {
  it('「我看到这些帮助方式了」在 copy.ts 中恰好出现一次', async () => {
    const { LEVEL2_CONFIRM_LABEL } = await import(
      '../../apps/web/src/features/crisis/copy.ts',
    );
    const copy = readFileSync(join(CRISIS_DIR, 'copy.ts'), 'utf8');
    const occurrences = copy.split(LEVEL2_CONFIRM_LABEL).length - 1;
    expect(occurrences).toBe(1);
  });

  it('pending 主行 + 13px 说明的拼接与 UI-SPEC 的 pending 行逐字相等', async () => {
    const { CONTACT_STATUS_COPY, PENDING_NOTE } = await import(
      '../../apps/web/src/features/crisis/copy.ts',
    );
    expect(CONTACT_STATUS_COPY.pending + PENDING_NOTE).toBe(
      '正在联系你填写的紧急联系人 {姓名}（{遮蔽后的联系方式}）。这需要一点时间，在此期间可以先看下面的帮助方式。',
    );
  });
});

describe('两份兜底清单与服务端逐值相等（分叉 = 各自兜底到不同号码）', () => {
  // 渲染层 resource-list.tsx 的常量与 safety 的 FALLBACK_HELP_RESOURCES 相等性在
  // apps/web 的 RTL 测试里断言（react 从 tools/ci 解析不到，且对 .tsx 的动态 import
  // 在 eslint 下是 any —— 01-09 同一条先例）。
  it('safety 的 FALLBACK_HELP_RESOURCES 恰好是 12356 与 120 两条', () => {
    expect(FALLBACK_HELP_RESOURCES.map((r) => r.phone)).toEqual(['12356', '120']);
  });
});

describe('四态取值域的三方一致性（分叉 = 某个分支静默渲染不出四态之一）', () => {
  it('web 的 CONTACT_STATUSES === safety 的 CONTACT_ATTEMPT_STATUSES', async () => {
    const { CONTACT_STATUSES } = await import('../../apps/web/src/features/crisis/copy.ts');
    expect([...CONTACT_STATUSES]).toEqual([...CONTACT_ATTEMPT_STATUSES]);
  });
});
describe('(f) crisis 目录的计时器 eslint 禁令（负向 fixture 非空真证明）', () => {
  async function lintFixture(relative: string): Promise<ESLint.LintResult> {
    // ignore:false —— fixture 目录在常规运行里被 ignores 排除，必须显式绕过
    //（与 eslint-config-meta.test.ts 同一条路径）。
    const eslint = new ESLint({ cwd: REPO_ROOT, ignore: false });
    const results = await eslint.lintFiles([relative]);
    const first = results[0];
    if (first === undefined) throw new Error(`fixture 未被 lint：${relative}`);
    return first;
  }

  it('crisis-settimeout.tsx 报出 no-restricted-syntax，且 message 指向服务端计时权威', async () => {
    const result = await lintFixture('tools/ci/fixtures/crisis-settimeout.tsx');
    const hits = result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    // 三处违规（window.setTimeout / 裸 setTimeout / setInterval）都要被抓到。
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.some((m) => m.message.includes('超时权威在服务端'))).toBe(true);
    expect(hits.some((m) => m.message.includes('下行事件驱动'))).toBe(true);
  });

  it('正向一半：crisis 目录内真实文件的有效配置带着这两条禁令（不是一堵墙）', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const config = (await eslint.calculateConfigForFile(
      join(CRISIS_DIR, 'contact-status-row.tsx'),
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
    expect(
      selectors.some((s) => s.includes('setTimeout')),
      'crisis 目录的有效配置必须含计时器禁令',
    ).toBe(true);
    expect(selectors.some((s) => s.includes('setInterval'))).toBe(true);
    // 必需的仓库级禁令同时还在（spread 没有被忘掉）。
    for (const required of REQUIRED_RESTRICTED_SYNTAX) {
      expect(selectors).toContain(required.selector);
    }
  });
});

describe('safety.contact_status 下行事件契约（T-08-03）', () => {
  it('载荷里不存在未遮蔽的手机号字段（contactPhone 等）', async () => {
    const ws = readFileSync(join(REPO_ROOT, 'packages/contract/src/ws.ts'), 'utf8');
    expect(ws.includes('contactPhone')).toBe(false);
    expect(ws.includes('contactMasked')).toBe(true);
  });

  it('contract 的 SafetyContactStatus === safety 的取值域 === web 的取值域（三方一致）', async () => {
    const { SafetyContactStatus } = await import('@drift/contract');
    const { CONTACT_STATUSES } = await import('../../apps/web/src/features/crisis/copy.ts');
    expect([...SafetyContactStatus.options]).toEqual([...CONTACT_ATTEMPT_STATUSES]);
    expect([...SafetyContactStatus.options]).toEqual([...CONTACT_STATUSES]);
  });
});
