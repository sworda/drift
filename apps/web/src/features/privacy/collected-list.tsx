// 「我们收集了什么」清单（PRIV-03 / RESEARCH §6.5 / UI-SPEC E9 populated 行）。
//
// 三条不可协商：
//   - 条数与内容**全部来自服务端**（/me/collected 由 DATA_INVENTORY 生成）—— 本文件
//     不出现任何 humanLabel 字面量，UI 不硬编码（tools/ci/privacy-ui-contract.test.ts
//     断言这件事，注入式非空真）；
//   - 撤回的 scope 整组消失，**不是置灰** —— 置灰仍在陈述一项已停止的收集（(b) 的
//     RTL 断言盯 DOM 层，aria-disabled 残留即失败）；
//   - 已授权但无数据流的 scope 渲染第三态（authorizedButNotCollecting）—— 把 5 项
//     同意直接渲染成 5 组「我们收集了…」就是披露尚未发生的收集（T-10-03）。

'use client';

import { CONSENT_SCOPE_SPECS } from '@drift/contract';
import type { CollectedGroup, CollectedView } from '@drift/db/inventory';

import { CONTRACT_NECESSARY_GROUP_LABEL, NOT_YET_COLLECTING_COPY } from './copy';

/** 组头文案：'none' = 合同履行必要；其余取同意项名称（同一份定义，@drift/contract）。 */
function groupLabel(scope: CollectedGroup['scope']): string {
  return scope === 'none' ? CONTRACT_NECESSARY_GROUP_LABEL : CONSENT_SCOPE_SPECS[scope].label;
}

export interface CollectedListProps {
  readonly view: CollectedView;
}

export function CollectedList({ view }: CollectedListProps) {
  return (
    <div data-testid="collected-list" className="overflow-y-auto px-md pb-lg">
      {view.collected.map((group) => (
        <section key={group.scope} aria-label={groupLabel(group.scope)} className="mt-lg">
          <h3 className="text-body font-semibold text-text-primary">{groupLabel(group.scope)}</h3>
          <ul className="mt-sm space-y-md">
            {group.items.map((item) => (
              <li key={item.humanLabel} className="rounded-lg border border-border bg-card px-md py-sm">
                {/* 换行显示，不 truncate —— 截断隐私说明等于未告知（E9 long-text）。 */}
                <p className="whitespace-normal break-words text-body font-medium text-text-primary">
                  {item.humanLabel}
                </p>
                <p className="mt-xs whitespace-normal break-words text-label leading-relaxed text-text-secondary">
                  {item.purpose}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {view.authorizedButNotCollecting.map((scope) => (
        <section
          key={scope}
          aria-label={CONSENT_SCOPE_SPECS[scope].label}
          data-testid="not-yet-collecting"
          className="mt-lg rounded-lg border border-dashed border-border px-md py-sm"
        >
          <h3 className="text-body font-semibold text-text-primary">{CONSENT_SCOPE_SPECS[scope].label}</h3>
          <p className="mt-xs whitespace-normal break-words text-label leading-relaxed text-text-secondary">
            {NOT_YET_COLLECTING_COPY}
          </p>
        </section>
      ))}
    </div>
  );
}
