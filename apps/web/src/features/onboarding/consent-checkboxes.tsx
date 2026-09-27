'use client';

// 五个互不捆绑的同意项（PRIV-01〔法定〕，个保法第十四条）。
//
// ── 三条结构性约束 ─────────────────────────────────────────────────────────
//  1. **没有「全选」控件。** 不是「暂时没做」，是这个组件的 props 里没有任何能表达
//     它的东西：`onToggle` 的签名只吃一个 scope。要加全选就得先改签名，而那是一次
//     看得见的 diff。
//  2. **不导出任何批量 setter。** 状态转换的唯一实现是 consent-state.ts 的 setScope，
//     它是纯函数并被穷举断言（consent-state.test.ts）。
//  3. **必选项也不预勾。** 预勾的复选框不是同意，是默认。
//
// 五项的名称与说明从 @drift/contract 的 CONSENT_SCOPE_SPECS 读 —— 不在这里内联：
// 它同时是隐私政策与服务端写入的取值域，三处必须同源。

import { CONSENT_SCOPES, CONSENT_SCOPE_SPECS, type ConsentScope } from '@drift/contract';

import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';

import type { ConsentSelection } from './consent-state';

export interface ConsentCheckboxesProps {
  readonly selection: ConsentSelection;
  /** ⚠️ 只吃**一个** scope。捆绑同意在这个签名下不可表达。 */
  readonly onToggle: (scope: ConsentScope, value: boolean) => void;
  readonly disabled?: boolean;
}

export function ConsentCheckboxes({ selection, onToggle, disabled }: ConsentCheckboxesProps) {
  return (
    <div data-testid="consent-checkboxes" className="flex flex-col gap-4">
      {CONSENT_SCOPES.map((scope) => {
        const spec = CONSENT_SCOPE_SPECS[scope];
        const id = `consent-${scope}`;
        const describedBy = `${id}-description`;
        return (
          <Field key={scope} orientation="horizontal" data-consent-scope={scope}>
            <Checkbox
              id={id}
              name={id}
              checked={selection[scope]}
              disabled={disabled ?? false}
              aria-describedby={describedBy}
              // 已勾选状态吃 accent（UI-SPEC Accent 闭合清单第 4 项）—— 由 checkbox.tsx
              // 的 data-checked:bg-primary 提供，这里不再另外上色。
              onCheckedChange={(next) => {
                onToggle(scope, next === true);
              }}
            />
            <FieldContent>
              <FieldLabel htmlFor={id} className="text-base">
                {spec.label}
                {spec.required ? '（必选）' : null}
              </FieldLabel>
              {/* 13px 说明副行（UI-SPEC Typography 的 Label 档）。 */}
              <FieldDescription id={describedBy} className="text-[13px] text-text-secondary">
                {spec.description}
              </FieldDescription>
            </FieldContent>
          </Field>
        );
      })}
    </div>
  );
}
