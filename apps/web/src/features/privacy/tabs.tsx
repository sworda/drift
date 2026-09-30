// 隐私中心的四个分区 Tabs（UI-SPEC ## 交互契约 + E9 overflow 行）。
//
// 两条契约：
//   - Tabs 过多时**横向滚动**，不折叠为「更多」—— 隐私分区不得被藏起来；
//   - Tab 按钮**不吃 accent** —— Accent 闭合清单里没有「激活态 Tab」这一项，而本屏
//     唯一的 accent 已经给了「导出我的全部数据」。激活态用底色加粗表达。

'use client';

import { cn } from 'cn';

import { TAB_COLLECTED, TAB_CONSENTS, TAB_DELETE, TAB_EXPORT } from './copy';

export type PrivacyTabId = 'collected' | 'consents' | 'export' | 'delete';

export interface PrivacyTabDescriptor {
  readonly id: PrivacyTabId;
  readonly label: string;
}

export const PRIVACY_TABS: readonly PrivacyTabDescriptor[] = [
  { id: 'collected', label: TAB_COLLECTED },
  { id: 'consents', label: TAB_CONSENTS },
  { id: 'export', label: TAB_EXPORT },
  { id: 'delete', label: TAB_DELETE },
];

export interface PrivacyTabsProps {
  readonly active: PrivacyTabId;
  readonly onChange: (id: PrivacyTabId) => void;
}

export function PrivacyTabs({ active, onChange }: PrivacyTabsProps) {
  return (
    <div role="tablist" aria-label="隐私中心分区" className="flex gap-sm overflow-x-auto border-b border-border px-md">
      {PRIVACY_TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              // shrink-0 保证横向滚动而不是被压扁 —— 折叠为「更多」被 UI-SPEC 明文禁止。
              'shrink-0 rounded-t-lg border-b-2 px-md py-sm text-label transition-colors',
              selected
                ? 'border-border bg-card font-semibold text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
