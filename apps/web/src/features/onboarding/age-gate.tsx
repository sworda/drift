'use client';

// 18 岁门禁（COMPLY-07）—— 自填即信，未满即**法定终态拒绝**。
//
// ── 这个组件最重要的性质是它「没有」什么 ────────────────────────────────────
// 未满 18 时渲染的那个容器里**没有任何按钮、链接或「换个年龄再试」的出口**。
// 这是 UI-SPEC「错误文案必须含下一步」的唯一豁免：拒绝本身就是法律要求的终局结果，
// 任何「下一步」都在引导用户绕过年龄门槛 —— 提示「换个年龄再试」等于教人造假。
// tools/ci 与单元层各有一条断言盯着这个容器里的 button 与 a 数量为 0。
//
// ⚠️ 年龄**不校验真实性**（D-22：COMPLY-07 只要求「确认已满 18」，不要求核验）。
// 这里判的是用户自己填的那个日期，不是一次身份核验。

import { isAdult } from '@drift/contract';

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { AGE_GATE_REJECTION, BIRTH_DATE_LABEL } from './copy';

export const AGE_GATE_REJECTION_TESTID = 'age-gate-rejection';

export interface AgeGateProps {
  readonly birthDate: string;
  readonly onBirthDateChange: (value: string) => void;
  /** 注入以便断言生日当天的边界。生产里不传。 */
  readonly now?: Date | undefined;
  readonly disabled?: boolean | undefined;
}

/** 完整的 YYYY-MM-DD 才参与判定 —— 输入过程中不该闪出一次拒绝。 */
function isCompleteDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isRejectedByAgeGate(birthDate: string, now?: Date): boolean {
  return isCompleteDate(birthDate) && !isAdult(birthDate, now ?? new Date());
}

export function AgeGate({ birthDate, onBirthDateChange, now, disabled }: AgeGateProps) {
  const rejected = isRejectedByAgeGate(birthDate, now);

  if (rejected) {
    // 终态：整块替换掉输入，且**不**渲染任何出口。
    return (
      <div data-testid={AGE_GATE_REJECTION_TESTID} role="alert" className="flex flex-col gap-2">
        <p className="text-base text-text-primary">{AGE_GATE_REJECTION}</p>
      </div>
    );
  }

  return (
    <Field>
      <FieldLabel htmlFor="birth-date">{BIRTH_DATE_LABEL}</FieldLabel>
      <Input
        id="birth-date"
        name="birthDate"
        type="date"
        value={birthDate}
        disabled={disabled ?? false}
        onChange={(event) => {
          onBirthDateChange(event.target.value);
        }}
      />
      <FieldDescription className="text-[13px] text-text-secondary">
        我们只用它确认你已满 18 周岁，不做身份核验。
      </FieldDescription>
    </Field>
  );
}
