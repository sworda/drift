// policy_version 与隐私政策正文的绑定（L4，不连库、不读 env）。
//
// consent_event.policy_version 必须是 apps/web/content/legal/privacy.md 的**真实内容
// 哈希**。这条断言存在的理由不是「哈希算得对不对」，而是这一列的留证价值完全取决于
// 它指向的那份文本真的存在：一个默认值、一个 'unknown'、一个 try/catch 吞掉读文件失败
// 之后写进去的占位串，都会让每一条同意留证指向一份不存在的政策文本 —— 那比没有留证
// 更糟，因为它看起来像一份留证。
//
// 这里查的是**源码形态**（读的是哪个文件、有没有兜底分支）与**非空真**（改一个字符
// 哈希就变）。运行时相等（POLICY_VERSION === 那份文件的哈希）在 L5 的
// tests/integration/register.test.ts 里断言 —— 那一层才 import 得动 apps/api
// （apps/api/src/config/env.ts 在加载时校验环境变量并 exit 1）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { promptVersion } from '@drift/prompts';

const REPO_ROOT = new URL('../../', import.meta.url);
const PRIVACY_PATH = fileURLToPath(new URL('apps/web/content/legal/privacy.md', REPO_ROOT));
const REGISTER_PATH = fileURLToPath(
  new URL('apps/api/src/modules/auth/register.ts', REPO_ROOT),
);
const SKIPPED_CHECKS_PATH = fileURLToPath(new URL('SKIPPED_CHECKS.md', REPO_ROOT));

describe('policy_version 绑定隐私政策正文（Plan 09 Task 1）', () => {
  const privacy = readFileSync(PRIVACY_PATH, 'utf8');
  const register = readFileSync(REGISTER_PATH, 'utf8');

  it('privacy.md 存在且非空', () => {
    expect(privacy.trim().length).toBeGreaterThan(0);
  });

  it('register.ts 读的就是 privacy.md，且用 @drift/prompts 的 promptVersion 算哈希', () => {
    expect(register).toContain('web/content/legal/privacy.md');
    expect(register).toContain('promptVersion(readFileSync(');
    // 不得再写第二份 sha256：两份实现会在归一化规则上分叉，而分叉的那天不会变红。
    expect(register).not.toContain('createHash');
  });

  it('policy_version 的求值处没有任何兜底分支', () => {
    const line = register
      .split('\n')
      .find((l) => l.includes('export const POLICY_VERSION'));
    expect(line, '找不到 POLICY_VERSION 的定义行').toBeDefined();
    expect(line ?? '').not.toMatch(/catch|\?\?|\|\||'unknown'|"unknown"/);
    // 整个文件里也不该出现把读文件失败吞掉的形态。
    expect(register).not.toMatch(/catch[^\n]*\n[^\n]*POLICY_VERSION/);
  });

  it('改动 privacy.md 一个字符，哈希就变（这条检查不是空真的）', () => {
    expect(promptVersion(privacy + '。')).not.toBe(promptVersion(privacy));
    // 归一化只抹平行尾差异，不抹平内容差异 —— 同一份文本的 CRLF 版本仍应同值。
    expect(promptVersion(privacy.replaceAll('\n', '\r\n'))).toBe(promptVersion(privacy));
  });

  it('SKIPPED_CHECKS.md 里没有关于 policy_version 的登记行', () => {
    // 这条依赖由 Plan 15 前移到 wave 5 真正解决了，不是被推迟。留一行登记等于
    // 把一件已经做完的事记成欠账，而欠账清单一旦有假条目就没人再逐条看它。
    const skipped = readFileSync(SKIPPED_CHECKS_PATH, 'utf8');
    expect(skipped.toLowerCase()).not.toContain('policy_version');
  });
});
