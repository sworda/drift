'use client';

// 18 岁门禁（COMPLY-07）—— 自填即信，未满即**法定终态拒绝**。
//
// ── 这个模块里有「输入」与「终态拒绝」两块，它们各自独立 ──────────────────────
// `AgeGate` 只渲染出生日期输入，**不**因为日期未满 18 就自我替换成拒绝。原因：原生
// `<input type="date">` 的上下箭头是一个「微调器」，它能在用户什么都没输入的情况下直接
// 吐出一个完整日期（例如当天）。若在那一刻就把输入换掉，用户既没做错什么、也再没法把
// 日期改回去 —— 那正是「点了日历上箭头就再也回不到输入界面」这个缺陷的根。
// 终态由 `AgeGateRejection` 表达，是否进入它由步骤层（steps.tsx）在用户**明确点
// 「下一步」/提交**时决定。
//
// 那个终态容器里**没有任何按钮、链接或「换个年龄再试」的出口**。这是 UI-SPEC「错误
// 文案必须含下一步」的唯一豁免：拒绝本身就是法律要求的终局结果，任何「下一步」都在
// 引导用户绕过年龄门槛 —— 提示「换个年龄再试」等于教人造假。tools/ci 与单元层各有一条
// 断言盯着这个容器里的 button 与 link 数量为 0（顶层调用点还要盯整页为 0）。
//
// ⚠️ 年龄**不校验真实性**（D-22：COMPLY-07 只要求「确认已满 18」，不要求核验）。
// 这里判的是用户自己填的那个日期，不是一次身份核验。服务端对未满 18 一律 403，
// 前端这一层只是礼貌呈现。

import { isAdult } from '@drift/contract';

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { AGE_GATE_REJECTION, BIRTH_DATE_LABEL } from './copy';

export const AGE_GATE_REJECTION_TESTID = 'age-gate-rejection';

export interface AgeGateProps {
  readonly birthDate: string;
  readonly onBirthDateChange: (value: string) => void;
  readonly disabled?: boolean | undefined;
}

/** 完整的 YYYY-MM-DD 才参与判定 —— 输入过程中不该闪出一次拒绝。 */
function isCompleteDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isRejectedByAgeGate(birthDate: string, now?: Date): boolean {
  return isCompleteDate(birthDate) && !isAdult(birthDate, now ?? new Date());
}

/** 出生日期输入。**始终可编辑** —— 未满 18 的终态由步骤层决定何时进入。 */
export function AgeGate({ birthDate, onBirthDateChange, disabled }: AgeGateProps) {
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

/**
 * 未满 18 的法定终态拒绝 —— 容器里没有任何出口（见文件头说明）。
 * 只应由步骤层在用户明确尝试继续之后渲染。
 */
export function AgeGateRejection() {
  return (
    <div data-testid={AGE_GATE_REJECTION_TESTID} role="alert" className="flex flex-col gap-2">
      <p className="text-base text-text-primary">{AGE_GATE_REJECTION}</p>
    </div>
  );
}
