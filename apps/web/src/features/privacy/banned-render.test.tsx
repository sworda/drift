// @vitest-environment jsdom

// PRIV-06 禁用词三重检查的**渲染层**（RESEARCH §11.3 的第四个静默失效）。
//
// 只扫源码扫不到渲染结果：组件可能拼接、改写、截断文案 —— 渲染出来的 textContent 才
// 是用户真正看到的。本文件渲染两份法务正文（Plan 10 Task 2 的被测对象；隐私中心页
// 由 Task 3 补进同一文件），对 textContent 跑与源码层**同一张词表**（都来自
// packages/safety/src/banned-terms.ts —— 一份定义、两个消费者，这就是核心不能定义
// 在 tools/ci/banned-terms.test.ts 里的原因：react 只装在 apps/web，从 tools/ci 解析
// 不到它，而 import 另一个测试文件会让 vitest 把被引文件的用例再跑一遍）。
//
// ⚠️ 本文件被 tools/ci/banned-terms.test.ts 的源码扫描**刻意排除**（同 consent
// 系断言的先例）：非空真注入需要写出被禁的词，扫断言文件只会逼人删掉证明。

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { scanBannedTerms } from '@drift/safety';

import { LegalDocPage } from '@/app/(app)/legal/[doc]/page';
import PrivacyPage from '@/app/(app)/privacy/page';
import { buildCollectedView, DATA_INVENTORY } from '@drift/db/inventory';
import type { CollectedView } from '@drift/db/inventory';
import { CONSENT_SCOPES, type ConsentScope } from '@drift/contract';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// jsdom 环境下 import.meta.url 不是 file: URL（01-09 实测），而 vitest 的 cwd 是
// 调用者所在目录（根 vitest.config 下通常是仓库根）。从 cwd 向上找 pnpm-workspace.yaml
// 定位仓库根 —— 从仓库根或 apps/web 里起跑都成立。
function repoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('pnpm-workspace.yaml 未找到 —— 无法定位仓库根');
    dir = parent;
  }
}

const PRIVACY_MD = readFileSync(join(repoRoot(), 'apps/web/content/legal/privacy.md'), 'utf8');
const TERMS_MD = readFileSync(join(repoRoot(), 'apps/web/content/legal/terms.md'), 'utf8');

describe('两份法务正文的渲染层禁用词断言（PRIV-06）', () => {
  it('隐私政策渲染结果的 textContent 归一化后无任何规则 1–4 命中', () => {
    const { getByTestId } = render(
      <LegalDocPage title="Drift 隐私政策" markdown={PRIVACY_MD} />,
    );
    // 渲染非空真：正文真的渲染出来了（表格、必需句都在 DOM 里），而不是一个空壳。
    const text = (getByTestId('legal-doc-content').textContent ?? '');
    expect(text.length).toBeGreaterThan(1000);
    expect(text).toContain('去标识化');
    expect(text).toContain('保存多久');
    const hits = scanBannedTerms(text);
    expect(hits, `渲染命中：${JSON.stringify(hits)}`).toEqual([]);
  });

  it('服务协议渲染结果同上', () => {
    const { getByTestId } = render(<LegalDocPage title="Drift 服务协议" markdown={TERMS_MD} />);
    const text = (getByTestId('legal-doc-content').textContent ?? '');
    expect(text.length).toBeGreaterThan(500);
    expect(scanBannedTerms(text)).toEqual([]);
  });

  it('渲染层非空真：注入含禁用词的 markdown 后必须被抓住', () => {
    // 拼出来而不是写成字面量 —— 即便如此本文件仍被源码扫描排除（断言文件要能引用规则
    // 本身），这里的双重处理只是让「为什么测试文件不扫」的理由更难被误读。
    const bannedWord = ['匿', '名'].join('');
    const { getByTestId } = render(
      <LegalDocPage title="负向" markdown={`## 我们收集什么\n\n我们把你的数据做成了${bannedWord}化的数据集。`} />,
    );
    const text = (getByTestId('legal-doc-content').textContent ?? '');
    expect(scanBannedTerms(text).some((hit) => hit.term === bannedWord)).toBe(true);
  });

  it('渲染层不截断：容器与全部段落都没有 line-clamp / text-ellipsis', () => {
    const { container } = render(<LegalDocPage title="Drift 隐私政策" markdown={PRIVACY_MD} />);
    const offenders = [...container.querySelectorAll('[class*="line-clamp"], [class*="text-ellipsis"], [class*="truncate"]')];
    expect(offenders).toEqual([]);
  });

  it('隐私中心页（第三个渲染目标）渲染结果的 textContent 无任何规则 1–4 命中', async () => {
    // 用真实 DATA_INVENTORY 构造 /me/collected 的响应 —— 渲染出来的清单就是用户会看到的。
    const granted: Record<ConsentScope, boolean> = {
      basic_service: true,
      sensitive_pi: true,
      research_l0: true,
      research_l1: true,
      persona_evolution: true,
    };
    const view: CollectedView = buildCollectedView(DATA_INVENTORY, granted);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/me/collected')) {
          return new Response(JSON.stringify(view), { status: 200 });
        }
        if (url.endsWith('/me/consents')) {
          return new Response(
            JSON.stringify({
              consents: CONSENT_SCOPES.map((scope) => ({
                scope,
                label: scope,
                description: `${scope} 说明`,
                required: scope === 'basic_service' || scope === 'sensitive_pi',
                granted: true,
              })),
            }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    render(<PrivacyPage />);
    await screen.findByTestId('collected-list');
    const text = document.body.textContent ?? '';
    expect(text.length).toBeGreaterThan(200);
    const hits = scanBannedTerms(text);
    expect(hits, `渲染命中：${JSON.stringify(hits)}`).toEqual([]);
  });
});
