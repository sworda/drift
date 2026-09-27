// @vitest-environment jsdom

// 隐私中心 UI 契约的 RTL 断言 (a)–(e)（PRIV-03 / PRIV-02 / RES-02 呈现面）。
//
// ⚠️ 本文件住在 apps/web/src 而不是 tools/ci：react 只装在 apps/web（01-09 先例）。
// 静态侧（文案绑定 / 不硬编码 / 路由挂载）在 tools/ci/privacy-ui-contract.test.ts。
//
// (a) 的方向由**真实 DATA_INVENTORY** 派生（经 buildCollectedView —— 与服务端 /me/collected
// 同一条构造路径），因此 Phase 7 研究管道落地（给注册表加 l0 条目）时这条断言的方向
// 会自动翻转并提醒改文案 —— 注入式翻转证明它真的在读注册表，而不是在读测试常量。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONSENT_SCOPES, type ConsentScope } from '@drift/contract';
import { buildCollectedView, DATA_INVENTORY } from '@drift/db/inventory';

import type { CollectedView } from '@drift/db/inventory';

import { CollectedList } from '@/features/privacy/collected-list';
import { ConsentSwitches, type ConsentSwitchItem } from '@/features/privacy/consent-switches';
import { NOT_YET_COLLECTING_COPY, REVOKE_FAILED_COPY, TAB_COLLECTED } from '@/features/privacy/copy';

import PrivacyPage from '@/app/(app)/privacy/page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ALL_GRANTED: Record<ConsentScope, boolean> = {
  basic_service: true,
  sensitive_pi: true,
  research_l0: true,
  research_l1: true,
  persona_evolution: true,
};

const REAL_VIEW: CollectedView = buildCollectedView(DATA_INVENTORY, ALL_GRANTED);

/**
 * 注入用的 research_l0 条目（与 tools/ci/fixtures/inventory-l0-vector.ts 的那条同形状；
 * buildCollectedView 只读清单不读 schema，所以这里只需要条目本身）。humanLabel 带后缀，
 * 让断言能区分「注入的条目」与真实注册表里的任何标签。
 */
const INJECTED_L0_ENTRY = {
  table: 'fake_research_l0',
  column: 'embedding',
  humanLabel: 'L0 行为特征（fixture）',
  purpose: '注入式翻转证明',
  consentScope: 'research_l0',
  containsPersonalInfo: true,
  isSensitive: false,
  layer: 'l0',
  retention: { kind: 'fixed', days: 730 },
} as const;

/** 与 /me/consents 响应同形状的五个开关（全部已授权）。 */
const ALL_GRANTED_ITEMS: readonly ConsentSwitchItem[] = CONSENT_SCOPES.map((scope) => ({
  scope,
  label: scope,
  description: `${scope} 的说明`,
  required: scope === 'basic_service' || scope === 'sensitive_pi',
  granted: true,
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function stubFetch(responses: { collected: CollectedView; consents: readonly ConsentSwitchItem[] }): {
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/me/collected')) return jsonResponse(responses.collected);
    if (url.endsWith('/me/consents')) return jsonResponse({ consents: responses.consents });
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock };
}

async function renderPrivacyPage(
  responses: { collected: CollectedView; consents: readonly ConsentSwitchItem[] },
): Promise<ReturnType<typeof render>> {
  stubFetch(responses);
  const view = render(<PrivacyPage />);
  // 等「我们收集了什么」分区真的渲染出来（fetch 是异步的）。
  await screen.findByRole('heading', { name: TAB_COLLECTED, level: 2 });
  return view;
}

describe('(a) 第三态的方向由真实 DATA_INVENTORY 派生', () => {
  it('真实注册表 ⇒ 三个研究 scope 渲染「尚未开始收集」，有数据流的两个 scope 渲染真实条目', async () => {
    await renderPrivacyPage({ collected: REAL_VIEW, consents: ALL_GRANTED_ITEMS });

    const thirdStates = screen.getAllByTestId('not-yet-collecting');
    expect(thirdStates).toHaveLength(3);

    // 三个研究 scope 的标签各出现在一个第三态块里。
    const thirdStateText = thirdStates.map((node) => (node.textContent ?? '')).join('\n');
    expect(thirdStateText).toContain('L0 行为特征研究');
    expect(thirdStateText).toContain('L1 原文研究授权');
    expect(thirdStateText).toContain('人格演化贡献');
    expect(thirdStates.every((node) => (node.textContent ?? '').includes(NOT_YET_COLLECTING_COPY))).toBe(true);

    // 有数据流的 scope 渲染真实条目，而不是第三态。
    const listText = (screen.getByTestId('collected-list').textContent ?? '');
    expect(listText).toContain('紧急联系人');
    expect(listText).toContain('聊天原文');
    expect(listText).toContain('模型调用记录');
  });

  it('注入式翻转：给注册表加一条 research_l0 条目 ⇒ 该 scope 从第三态变为真实清单', async () => {
    // 「临时给 DATA_INVENTORY 加 research_l0 条目后断言 (a) 变红」的可执行形态 ——
    // 这正是 Phase 7 接研究管道时会自动发生的事。
    const injectedView = buildCollectedView([...DATA_INVENTORY, INJECTED_L0_ENTRY], ALL_GRANTED);
    await renderPrivacyPage({ collected: injectedView, consents: ALL_GRANTED_ITEMS });

    const thirdStates = screen.getAllByTestId('not-yet-collecting');
    expect(thirdStates).toHaveLength(2);
    const thirdStateText = thirdStates.map((node) => (node.textContent ?? '')).join('\n');
    expect(thirdStateText).not.toContain('L0 行为特征研究');
    // research_l0 的条目现在出现在清单里。
    expect(screen.getByTestId('collected-list').textContent ?? '').toContain('L0 行为特征（fixture）');
  });
});

describe('(b) 撤回后条目从清单消失（不是置灰）', () => {
  it('sensitive_pi 撤回后：紧急联系人与危机相关记录从 DOM 消失，无 aria-disabled 残留', async () => {
    const grantedView = buildCollectedView(DATA_INVENTORY, ALL_GRANTED);
    const revokedView = buildCollectedView(DATA_INVENTORY, { ...ALL_GRANTED, sensitive_pi: false });
    const { rerender } = render(<CollectedList view={grantedView} />);
    expect(screen.getByText('紧急联系人')).toBeDefined();

    rerender(<CollectedList view={revokedView} />);
    expect(screen.queryByText('紧急联系人')).toBeNull();
    expect(screen.queryByText('危机相关记录')).toBeNull();

    // 不存在置灰残留：整个清单里没有 aria-disabled 的元素，也没有同名条目。
    const disabledRemnants = screen
      .queryAllByTestId('collected-list')[0]
      ?.querySelectorAll('[aria-disabled="true"]');
    expect(disabledRemnants ?? []).toHaveLength(0);
  });

  it('端到端：撤回成功后页面重读服务端状态，清单跟着变', async () => {
    // 第一次加载全部授权；撤回请求成功；之后 /me/collected 返回撤回后的视图。
    const revokedView = buildCollectedView(DATA_INVENTORY, { ...ALL_GRANTED, sensitive_pi: false });
    let revoked = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/me/consents/sensitive_pi/revoke')) {
        revoked = true;
        return jsonResponse({ scope: 'sensitive_pi', deletionJobId: 'job-1', enteredDeletion: true });
      }
      if (url.endsWith('/me/collected')) {
        return jsonResponse(revoked ? revokedView : REAL_VIEW);
      }
      if (url.endsWith('/me/consents')) {
        return jsonResponse({
          consents: revoked
            ? ALL_GRANTED_ITEMS.map((item) => (item.scope === 'sensitive_pi' ? { ...item, granted: false } : item))
            : ALL_GRANTED_ITEMS,
        });
      }
      void init;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PrivacyPage />);
    await screen.findByText('紧急联系人');

    // 撤回必选项：先切到「同意管理」分区，再点开关 → AlertDialog → 逐字输入短语 → 确认。
    fireEvent.click(screen.getByRole('tab', { name: '同意管理' }));
    fireEvent.click(screen.getByRole('switch', { name: '撤回「sensitive_pi」的开关' }));
    const input = await screen.findByLabelText('删除确认短语输入');
    fireEvent.change(input, { target: { value: '删除我的全部数据' } });
    fireEvent.click(screen.getByText('确认删除'));

    await waitFor(() => {
      expect(revoked).toBe(true);
      expect(screen.queryByText('紧急联系人')).toBeNull();
    });
  });
});

describe('(c) 撤回失败 ⇒ Switch 回弹到服务端真实状态 + 错误文案', () => {
  it('失败的撤回让 Switch 保持 checked，并渲染含「仍在继续」的文案', async () => {
    const onRevoke = vi.fn(async (): Promise<void> => {
      throw new Error('revoke returned 503');
    });
    render(<ConsentSwitches consents={ALL_GRANTED_ITEMS} onRevoke={onRevoke} />);

    const researchSwitch = screen.getByRole('switch', { name: '撤回「research_l0」的开关' });
    expect(researchSwitch.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(researchSwitch);
    await screen.findByRole('alert');

    // Switch 回弹（回读服务端真实状态 —— granted: true），错误文案含「仍在继续」。
    expect(researchSwitch.getAttribute('aria-checked')).toBe('true');
    const alertText = screen.getByRole('alert').textContent ?? '';
    expect(alertText.replace(/\*\*/gu, '')).toContain('仍在继续');
    expect(alertText.replace(/\*\*/gu, '')).toContain(REVOKE_FAILED_COPY.replace(/\*\*/gu, ''));
  });
});

describe('(d) 视觉锚点：当前分区标题是本屏唯一 20px，导出 CTA 是本屏唯一 accent', () => {
  it('每个分区恰好一个 text-heading 元素；导出分区恰好一个 bg-primary，删除入口不吃 accent', async () => {
    const { container } = await renderPrivacyPage({ collected: REAL_VIEW, consents: ALL_GRANTED_ITEMS });

    const countHeadings = (): number => container.querySelectorAll('.text-heading').length;
    expect(countHeadings()).toBe(1);

    // 切到同意管理 / 导出 / 删除分区：标题仍然恰好一个。
    for (const tabName of ['同意管理', '导出', '删除']) {
      fireEvent.click(screen.getByRole('tab', { name: tabName }));
      expect(countHeadings(), `${tabName} 分区应有且仅有一个 20px 标题`).toBe(1);
    }

    // 导出分区：CTA 是本屏唯一吃 accent（bg-primary）的元素。
    fireEvent.click(screen.getByRole('tab', { name: '导出' }));
    const accentElements = container.querySelectorAll('.bg-primary');
    expect(accentElements).toHaveLength(1);
    expect(accentElements[0]?.getAttribute('data-testid')).toBe('export-cta');

    // 删除入口是 destructive 文字按钮：不吃 accent（计算类里没有 bg-primary / text-primary）。
    fireEvent.click(screen.getByRole('tab', { name: '删除' }));
    const deleteEntry = screen.getByTestId('delete-entry');
    expect(deleteEntry.className.includes('bg-primary')).toBe(false);
    expect(deleteEntry.className.includes('text-primary')).toBe(false);
    expect(deleteEntry.className.includes('text-destructive')).toBe(true);
  });
});

describe('(e) 长隐私说明不被 truncate', () => {
  it('清单条目与第三态说明上没有 line-clamp / text-ellipsis / truncate 类', async () => {
    const { container } = await renderPrivacyPage({ collected: REAL_VIEW, consents: ALL_GRANTED_ITEMS });
    const offenders = container.querySelectorAll('[class*="line-clamp"], [class*="text-ellipsis"], [class*="truncate"]');
    expect([...offenders].map((node) => node.className)).toEqual([]);
  });
});
