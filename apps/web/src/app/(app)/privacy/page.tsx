// 隐私中心（PRIV-02 / PRIV-03 —— Phase 1 的四个分区里，「我们收集了什么」与
// 「同意管理」是本 plan 的交付；「导出」与「删除」的主流程属 Plan 11，此处只落
// UI-SPEC 要求的视觉锚点（导出主 CTA 吃 accent、删除入口是 destructive 文字按钮
// 不吃 accent）与如实的「还在建设中」占位说明 —— 比一个点了没反应的假按钮诚实。
//
// 页面本身只负责数据接驳与分区切换 —— 交互契约在 features/privacy/ 的组件里，那里
// 才是 RTL 断言的对象（同注册页的分工）。

'use client';

import { useCallback, useEffect, useState } from 'react';

import type { ConsentScope } from '@drift/contract';
import type { CollectedView } from '@drift/db/inventory';

import { Button } from '@/components/ui/button';

import { CollectedList } from '@/features/privacy/collected-list';
import { DeleteDialog } from '@/features/privacy/delete-dialog';
import { ExportPanel } from '@/features/privacy/export-panel';
import { ConsentSwitches, type ConsentSwitchItem } from '@/features/privacy/consent-switches';
import { PrivacyTabs, type PrivacyTabId } from '@/features/privacy/tabs';
import {
  COLLECTED_LOAD_ERROR,
  COLLECTED_LOAD_RETRY,
  COLLECTED_LOADING,
  TAB_COLLECTED,
  TAB_CONSENTS,
  TAB_DELETE,
  TAB_EXPORT,
} from '@/features/privacy/copy';

const API_ORIGIN = process.env['NEXT_PUBLIC_API_ORIGIN'] ?? 'http://127.0.0.1:3001';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ok'; readonly view: CollectedView; readonly consents: readonly ConsentSwitchItem[] };

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} returned ${String(response.status)}`);
  return (await response.json()) as T;
}

export default function PrivacyPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [tab, setTab] = useState<PrivacyTabId>('collected');

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [view, consents] = await Promise.all([
        fetchJson<CollectedView>('/me/collected'),
        fetchJson<{ consents: readonly ConsentSwitchItem[] }>('/me/consents'),
      ]);
      setState({ kind: 'ok', view, consents: consents.consents });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = useCallback(
    async (scope: ConsentScope, confirmationPhrase?: string): Promise<void> => {
      const response = await fetch(`${API_ORIGIN}/me/consents/${scope}/revoke`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(confirmationPhrase === undefined ? {} : { confirmationPhrase }),
      });
      // 409 = 必选项还缺一次人的确认 —— 界面上已由 AlertDialog 前置完成，走到这一步
      // 说明状态漂移了，按失败处理让用户重试（Switch 回弹）。
      if (!response.ok) throw new Error(`revoke returned ${String(response.status)}`);
      // 撤回成功后重读服务端状态 —— Switch 与「我们收集了什么」都必须反映服务端的真实
      // 状态，任何本地的乐观改写都在制造「以为停了其实没停」的机会（T-10-06）。
      await load();
    },
    [load],
  );

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px]">
      <PrivacyTabs active={tab} onChange={setTab} />

      {state.kind === 'loading' ? (
        <p className="px-md py-lg text-body text-text-secondary" role="status">
          {COLLECTED_LOADING}
        </p>
      ) : null}

      {state.kind === 'error' ? (
        <div className="px-md py-lg" role="alert">
          <p className="text-body text-destructive">{COLLECTED_LOAD_ERROR}</p>
          <Button variant="outline" size="sm" className="mt-md" onClick={() => void load()}>
            {COLLECTED_LOAD_RETRY}
          </Button>
        </div>
      ) : null}

      {/* 当前分区的标题是本屏唯一的 20px（UI-SPEC 视觉锚点契约：Tabs 置顶，选中分区的
          标题是本屏唯一 Heading 20px）。 */}
      {state.kind === 'ok' && tab === 'collected' ? (
        <section aria-label={TAB_COLLECTED}>
          <h2 className="px-md pt-lg text-heading font-semibold text-text-primary">{TAB_COLLECTED}</h2>
          <CollectedList view={state.view} />
        </section>
      ) : null}
      {state.kind === 'ok' && tab === 'consents' ? (
        <section aria-label={TAB_CONSENTS}>
          <h2 className="px-md pt-lg text-heading font-semibold text-text-primary">{TAB_CONSENTS}</h2>
          <ConsentSwitches consents={state.consents} onRevoke={revoke} />
        </section>
      ) : null}

      {tab === 'export' ? (
        <section aria-label={TAB_EXPORT}>
          <h2 className="px-md pt-lg text-heading font-semibold text-text-primary">{TAB_EXPORT}</h2>
          <ExportPanel />
        </section>
      ) : null}

      {tab === 'delete' ? (
        <section aria-label={TAB_DELETE}>
          <h2 className="px-md pt-lg text-heading font-semibold text-text-primary">{TAB_DELETE}</h2>
          <div className="px-md py-lg">
            {/* 删除入口（destructive 文字按钮，不吃 accent）+ AlertDialog + 短语解锁 +
                执行完成后跳转独立回执页 —— 全部在 DeleteDialog 里（PRIV-05）。 */}
            <DeleteDialog />
          </div>
        </section>
      ) : null}
    </main>
  );
}
