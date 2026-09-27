'use client';

// 注册三步（COMPLY-06 / COMPLY-07 / PRIV-01）。
//
// ── 五条交互契约，逐条落在下面的代码里 ──────────────────────────────────────
//  1. **跨步骤保留已填内容** —— 状态在本组件顶层，切步骤只换渲染。
//  2. **未完成不得提交：禁用主 CTA，而不是提交后报错。** 两项必选未全勾时按钮是
//     disabled 态；「先让点、再报错」把一次可以避免的失败变成一次真实的失败。
//  3. **提交中按钮进入 pending 并禁用**（防重复提交），**不加全屏遮罩** —— 遮罩会
//     让用户以为整页失去响应。
//  4. **提交失败保留已填内容**，渲染「注册没有完成」那一行 + 「重试提交」按钮。
//  5. **字段级不通过时把焦点移到第一个出错字段。**
//
// ⚠️ 当前步骤标题是全屏唯一的 Display 28px（UI-SPEC ## 视觉锚点契约 注册行）。
// 页面里不得再出现第二个 28px 元素。

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import { type ConsentScope } from '@drift/contract';

import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { API_ORIGIN, saveSessionToken } from '@/lib/session';

import { AgeGate, isRejectedByAgeGate } from './age-gate';
import { ConsentCheckboxes } from './consent-checkboxes';
import {
  INITIAL_CONSENT_SELECTION,
  requiredSatisfied,
  setScope,
  toRequestPayload,
  type ConsentSelection,
} from './consent-state';
import {
  EMAIL_LABEL,
  INVITE_CODE_LABEL,
  NAME_LABEL,
  NEXT_STEP_LABEL,
  PASSWORD_LABEL,
  REGISTER_CTA,
  REGISTER_DONE_BODY,
  REGISTER_DONE_TITLE,
  REGISTER_RETRY_LABEL,
  REGISTER_SUBMIT_ERROR,
  STEP_TITLES,
} from './copy';
import {
  EmergencyContactField,
  INITIAL_EMERGENCY_CONTACT,
  firstInvalidContactFieldId,
  isEmergencyContactComplete,
  type EmergencyContactValue,
} from './emergency-contact';

/** 全屏唯一的 28px（Display）。写成常量是为了让「只有一处」可被断言。 */
export const STEP_TITLE_CLASS = 'text-[28px] leading-[1.2] font-semibold text-text-primary';

export const SUBMIT_ERROR_TESTID = 'register-submit-error';

export interface AccountFields {
  readonly inviteCode: string;
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly birthDate: string;
}

const INITIAL_ACCOUNT: AccountFields = Object.freeze({
  inviteCode: '',
  email: '',
  password: '',
  name: '',
  birthDate: '',
});

export interface RegisterRequest {
  readonly inviteCode: string;
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly birthDate: string;
  readonly consents: Record<ConsentScope, boolean>;
  readonly emergencyContact: EmergencyContactValue;
}

export interface OnboardingStepsProps {
  /** 注入以便在不起服务的情况下断言提交行为。生产里走默认的 fetch。 */
  readonly submit?: ((request: RegisterRequest) => Promise<void>) | undefined;
  readonly now?: Date | undefined;
  /** 初始步骤。仅测试与静态渲染用。 */
  readonly initialStep?: 0 | 1 | 2 | undefined;
  readonly initialAccount?: AccountFields | undefined;
  readonly initialContact?: EmergencyContactValue | undefined;
  readonly initialConsents?: ConsentSelection | undefined;
}

// 注册成功后的去向（成功标准 1 的走查顺序：注册 → 角色库 → 会话）。
export const REGISTER_DONE_TESTID = 'register-done';
export const REGISTER_DONE_GOTO = '去角色库挑一个角色';

async function defaultSubmit(request: RegisterRequest): Promise<void> {
  // 直连 API（跨源）。相对路径会打到 Next 自己身上 —— compose 栈里 Caddy 只把
  // /ws /telemetry /healthz 交给 api，其余全部是 web，相对路径 /auth/register 在
  // 浏览器里永远 404（Plan 14 实测定稿；注册走查曾在这里卡死的原因）。
  const response = await fetch(`${API_ORIGIN}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`register failed: ${String(response.status)}`);
  // 会话载体：服务的身份解析只认 Authorization: Bearer（auth/session.ts），不认
  // cookie —— 存下 token，后续页面的 authedFetch 才有身份可附。
  const body = (await response.json()) as { sessionToken: string };
  saveSessionToken(body.sessionToken);
}

export function OnboardingSteps({
  submit,
  now,
  initialStep,
  initialAccount,
  initialContact,
  initialConsents,
}: OnboardingStepsProps) {
  const [step, setStep] = useState<0 | 1 | 2>(initialStep ?? 0);
  const [account, setAccount] = useState<AccountFields>(initialAccount ?? INITIAL_ACCOUNT);
  const [contact, setContact] = useState<EmergencyContactValue>(
    initialContact ?? INITIAL_EMERGENCY_CONTACT,
  );
  const [consents, setConsents] = useState<ConsentSelection>(
    initialConsents ?? INITIAL_CONSENT_SELECTION,
  );
  const [showContactErrors, setShowContactErrors] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [done, setDone] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const rejected = isRejectedByAgeGate(account.birthDate, now);

  const toggleConsent = useCallback((scope: ConsentScope, value: boolean) => {
    // ⚠️ 唯一的同意状态转换入口，且只吃一个 scope。
    setConsents((current) => setScope(current, scope, value));
  }, []);

  const accountComplete = useMemo(
    () =>
      account.inviteCode.trim().length > 0 &&
      account.email.includes('@') &&
      account.password.length >= 8 &&
      account.name.trim().length > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(account.birthDate) &&
      !rejected,
    [account, rejected],
  );
  const contactComplete = isEmergencyContactComplete(contact);
  const canSubmit = accountComplete && contactComplete && requiredSatisfied(consents);

  const focusFirstInvalid = useCallback(() => {
    const id = firstInvalidContactFieldId(contact);
    if (id === null) return;
    formRef.current?.querySelector<HTMLInputElement>(`#${id}`)?.focus();
  }, [contact]);

  const onSubmit = useCallback(async () => {
    if (!canSubmit || pending) return;
    setPending(true);
    setSubmitFailed(false);
    try {
      await (submit ?? defaultSubmit)({
        ...account,
        consents: toRequestPayload(consents),
        emergencyContact: contact,
      });
      setDone(true);
    } catch {
      // 已填内容一个字段都不清 —— 文案明说「你填的内容都还在」。
      setSubmitFailed(true);
      setShowContactErrors(true);
      focusFirstInvalid();
    } finally {
      setPending(false);
    }
  }, [account, canSubmit, consents, contact, focusFirstInvalid, pending, submit]);

  // 注册成功：落点是角色库（成功标准 1 的走查顺序）。仍是同一颗主 CTA 的语义 ——
  // 「完成注册，开始使用」之后的「开始使用」。
  if (done) {
    return (
      <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
        <h1 className={STEP_TITLE_CLASS}>{REGISTER_DONE_TITLE}</h1>
        <p className="text-base text-text-secondary">{REGISTER_DONE_BODY}</p>
        <Link
          href="/characters"
          data-testid={REGISTER_DONE_TESTID}
          className="inline-flex h-11 w-fit items-center justify-center rounded-lg bg-primary px-md text-base text-primary-foreground"
        >
          {REGISTER_DONE_GOTO}
        </Link>
      </main>
    );
  }

  // 18 岁终态拒绝：整页只剩那段文案，**没有**任何出口（含本组件的下一步按钮）。
  if (rejected) {
    return (
      <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
        <h1 className={STEP_TITLE_CLASS}>{STEP_TITLES[0]}</h1>
        <AgeGate
          birthDate={account.birthDate}
          now={now ?? undefined}
          onBirthDateChange={(birthDate) => {
            setAccount((current) => ({ ...current, birthDate }));
          }}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      {/* 全屏唯一的 28px。 */}
      <h1 className={STEP_TITLE_CLASS}>{STEP_TITLES[step]}</h1>

      <form
        ref={formRef}
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        {step === 0 ? (
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="invite-code">{INVITE_CODE_LABEL}</FieldLabel>
              <Input
                id="invite-code"
                name="inviteCode"
                value={account.inviteCode}
                onChange={(event) => {
                  setAccount((current) => ({ ...current, inviteCode: event.target.value }));
                }}
              />
              <FieldDescription className="text-[13px] text-text-secondary">
                邀请码是一次性的，用过就不能再用。
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="email">{EMAIL_LABEL}</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                value={account.email}
                onChange={(event) => {
                  setAccount((current) => ({ ...current, email: event.target.value }));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">{PASSWORD_LABEL}</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                value={account.password}
                onChange={(event) => {
                  setAccount((current) => ({ ...current, password: event.target.value }));
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="display-name">{NAME_LABEL}</FieldLabel>
              <Input
                id="display-name"
                name="name"
                value={account.name}
                onChange={(event) => {
                  setAccount((current) => ({ ...current, name: event.target.value }));
                }}
              />
            </Field>
            <AgeGate
              birthDate={account.birthDate}
              now={now ?? undefined}
              onBirthDateChange={(birthDate) => {
                setAccount((current) => ({ ...current, birthDate }));
              }}
            />
          </div>
        ) : null}

        {step === 1 ? (
          <EmergencyContactField
            value={contact}
            onChange={setContact}
            showErrors={showContactErrors}
          />
        ) : null}

        {step === 2 ? (
          <ConsentCheckboxes selection={consents} onToggle={toggleConsent} disabled={pending} />
        ) : null}

        {submitFailed ? (
          <div data-testid={SUBMIT_ERROR_TESTID} role="alert" className="flex flex-col gap-2">
            <p className="text-base text-destructive">{REGISTER_SUBMIT_ERROR}</p>
            <Button
              type="submit"
              variant="outline"
              disabled={pending}
              className="w-fit"
            >
              {REGISTER_RETRY_LABEL}
            </Button>
          </div>
        ) : null}

        <div className="flex flex-row gap-3">
          {step > 0 ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStep((current) => (current === 0 ? 0 : ((current - 1) as 0 | 1)));
              }}
            >
              上一步
            </Button>
          ) : null}
          {step < 2 ? (
            // ⚠️ 紧急联系人那一步的「下一步」**不禁用**，这是刻意的：UI-SPEC 为这一步
            // 定了一条专门的错误文案（「这个联系方式我们没法识别，请填写 11 位手机号……」）
            // 并要求把焦点移到第一个出错字段。如果按钮在格式不通过时是 disabled，那条
            // 文案与那次焦点移动**永远不可达** —— 一条到不了的法定告知比一个多余的禁用态
            // 更糟。第一步仍然禁用：它没有对应的错误文案，空字段本身就是可见的。
            //
            // 「未完成不得提交」这条契约指的是**主 CTA**（下面那个，由两项必选同意把关），
            // 不是每个中间步骤的翻页按钮。
            <Button
              type="button"
              disabled={step === 0 ? !accountComplete : false}
              onClick={() => {
                if (step === 1 && !contactComplete) {
                  setShowContactErrors(true);
                  focusFirstInvalid();
                  return;
                }
                setStep((current) => (current === 2 ? 2 : ((current + 1) as 1 | 2)));
              }}
            >
              {NEXT_STEP_LABEL}
            </Button>
          ) : (
            // 主 CTA：两项必选未全勾时 **disabled**，不是提交后报错。
            <Button type="submit" disabled={!canSubmit || pending} aria-busy={pending}>
              {REGISTER_CTA}
            </Button>
          )}
        </div>
      </form>
    </main>
  );
}
