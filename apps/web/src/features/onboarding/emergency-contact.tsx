'use client';

// 监护人 / 紧急联系人二选一（COMPLY-06 / R1.23）。
//
// ── 三条不可协商 ───────────────────────────────────────────────────────────
//  1. **二选一，填一个即完整。** kind 是单选，不是两组各自必填的字段。
//  2. **说明文字在 Field 的 description 行，不是 placeholder。** 占位符在用户开始
//     输入之后就消失了，而「我们会在什么情况下联系这个人」是一条需要持续可读的告知
//     —— 它说明的是我们会在什么情况下动用**第三方**的个人信息。
//  3. **超长姓名单行 truncate，完整值保留在 title 与可访问名称里。** 截断只发生在
//     视觉层，读屏与悬停仍拿得到全名。

import { EMERGENCY_CONTACT_KINDS, type EmergencyContactKind, isValidContactPhone } from '@drift/contract';

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

import {
  CONTACT_FIELD_DESCRIPTION,
  CONTACT_FORMAT_ERROR,
  CONTACT_NAME_PLACEHOLDER,
  CONTACT_PHONE_PLACEHOLDER,
  EMERGENCY_CONTACT_KIND_LABELS,
} from './copy';

export const CONTACT_PHONE_INPUT_ID = 'emergency-contact-phone';
export const CONTACT_NAME_INPUT_ID = 'emergency-contact-name';
export const CONTACT_DESCRIPTION_ID = 'emergency-contact-description';

export interface EmergencyContactValue {
  readonly kind: EmergencyContactKind;
  readonly name: string;
  readonly phone: string;
}

export const INITIAL_EMERGENCY_CONTACT: EmergencyContactValue = Object.freeze({
  kind: 'emergency',
  name: '',
  phone: '',
});

/** 填一个即完整：kind 恒有值，所以只看 name 与 phone。 */
export function isEmergencyContactComplete(value: EmergencyContactValue): boolean {
  return value.name.trim().length > 0 && isValidContactPhone(value.phone);
}

/** 第一个出错的字段 id —— 提交失败时焦点移到它（UI-SPEC 交互契约）。 */
export function firstInvalidContactFieldId(value: EmergencyContactValue): string | null {
  if (value.name.trim().length === 0) return CONTACT_NAME_INPUT_ID;
  if (!isValidContactPhone(value.phone)) return CONTACT_PHONE_INPUT_ID;
  return null;
}

export interface EmergencyContactFieldProps {
  readonly value: EmergencyContactValue;
  readonly onChange: (next: EmergencyContactValue) => void;
  /** 只在提交尝试过之后才展示格式错误 —— 边打字边报错是在催促，不是在帮忙。 */
  readonly showErrors?: boolean;
  readonly disabled?: boolean;
}

export function EmergencyContactField({
  value,
  onChange,
  showErrors,
  disabled,
}: EmergencyContactFieldProps) {
  const phoneInvalid = (showErrors ?? false) && !isValidContactPhone(value.phone);

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="emergency-contact-kind">这位联系人是</FieldLabel>
        <RadioGroup
          id="emergency-contact-kind"
          value={value.kind}
          disabled={disabled ?? false}
          onValueChange={(next) => {
            const kind = EMERGENCY_CONTACT_KINDS.find((candidate) => candidate === next);
            if (kind !== undefined) onChange({ ...value, kind });
          }}
          className="flex flex-row gap-6"
        >
          {EMERGENCY_CONTACT_KINDS.map((kind) => (
            <div key={kind} className="flex items-center gap-2">
              <RadioGroupItem id={`contact-kind-${kind}`} value={kind} />
              <FieldLabel htmlFor={`contact-kind-${kind}`} className="text-base">
                {EMERGENCY_CONTACT_KIND_LABELS[kind]}
              </FieldLabel>
            </div>
          ))}
        </RadioGroup>
      </Field>

      <Field>
        <FieldLabel htmlFor={CONTACT_NAME_INPUT_ID}>称呼</FieldLabel>
        <Input
          id={CONTACT_NAME_INPUT_ID}
          name="emergencyContactName"
          value={value.name}
          placeholder={CONTACT_NAME_PLACEHOLDER}
          disabled={disabled ?? false}
          maxLength={64}
          // 超长姓名：视觉上单行截断，完整值留在 title（悬停）与 value（读屏）里。
          title={value.name}
          className="truncate"
          onChange={(event) => {
            onChange({ ...value, name: event.target.value });
          }}
        />
      </Field>

      <Field data-invalid={phoneInvalid ? true : undefined}>
        <FieldLabel htmlFor={CONTACT_PHONE_INPUT_ID}>联系方式</FieldLabel>
        <Input
          id={CONTACT_PHONE_INPUT_ID}
          name="emergencyContactPhone"
          inputMode="numeric"
          value={value.phone}
          placeholder={CONTACT_PHONE_PLACEHOLDER}
          disabled={disabled ?? false}
          maxLength={11}
          aria-invalid={phoneInvalid}
          aria-describedby={CONTACT_DESCRIPTION_ID}
          onChange={(event) => {
            onChange({ ...value, phone: event.target.value });
          }}
        />
        {/* 说明在 description 行 —— 与 placeholder 是两件事，文本也不相同。 */}
        <FieldDescription id={CONTACT_DESCRIPTION_ID} className="text-[13px] text-text-secondary">
          {CONTACT_FIELD_DESCRIPTION}
        </FieldDescription>
        {phoneInvalid ? <FieldError>{CONTACT_FORMAT_ERROR}</FieldError> : null}
      </Field>
    </div>
  );
}
