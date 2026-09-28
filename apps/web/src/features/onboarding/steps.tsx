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

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';

import { CONSENT_SCOPE_SPECS, type ConsentScope } from '@drift/contract';

import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { API_ORIGIN, saveSessionToken } from '@/lib/session';

import {
  accountComplete,
  accountFieldErrors,
  BIRTH_DATE_INPUT_ID,
  EMAIL_INPUT_ID,
  firstInvalidAccountFieldId,
  INITIAL_ACCOUNT,
  INVITE_CODE_INPUT_ID,
  NAME_INPUT_ID,
  PASSWORD_INPUT_ID,
  type AccountFields,
} from './account-fields';
import { AgeGate, isRejectedByAgeGate } from './age-gate';
import { ConsentCheckboxes } from './consent-checkboxes';
import {
  INITIAL_CONSENT_SELECTION,
  missingRequiredScopes,
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
  MISSING_REQUIRED_CONSENT_NOTE,
  MISSING_REQUIRED_PLACEHOLDER,
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

/** 主 CTA 禁用时那行「还差什么」的测试锚点。 */
export const MISSING_REQUIRED_TESTID = 'register-missing-required';

// AccountFields / INITIAL_ACCOUNT 已移到 account-fields.ts，与字段判据同源；这里
// re-export 类型，让既有消费方（register-render.test.tsx）的 import 路径不变。
export type { AccountFields } from './account-fields';

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
  const [showAccountErrors, setShowAccountErrors] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [done, setDone] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const rejected = isRejectedByAgeGate(account.birthDate, now);

  const toggleConsent = useCallback((scope: ConsentScope, value: boolean) => {
    // ⚠️ 唯一的同意状态转换入口，且只吃一个 scope。
    setConsents((current) => setScope(current, scope, value));
  }, []);

  // 判据的唯一来源是 account-fields.ts 的规格表；这里只做调用。
  const accountReady = accountComplete(account, now);
  const contactComplete = isEmergencyContactComplete(contact);
  const canSubmit = accountReady && contactComplete && requiredSatisfied(consents);
  // 主 CTA 禁用时那行「还差什么」的数据来源。
  const missingRequired = missingRequiredScopes(consents);
  // 只在校验尝试过之后才展示字段错误 —— 边打字边报错是在催促，不是在帮忙。
  const accountErrors: Readonly<Record<string, string>> = showAccountErrors
    ? accountFieldErrors(account, now)
    : {};
  const accountErrorFor = (id: string): string | undefined => accountErrors[id];

  const focusFirstInvalid = useCallback(() => {
    const id = firstInvalidContactFieldId(contact);
    if (id === null) return;
    formRef.current?.querySelector<HTMLInputElement>(`#${id}`)?.focus();
  }, [contact]);

  const focusFirstInvalidAccount = useCallback(() => {
    const id = firstInvalidAccountFieldId(account, now);
    if (id === null) return;
    formRef.current?.querySelector<HTMLInputElement>(`#${id}`)?.focus();
  }, [account, now]);

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
      <main className="mx-auto flex max-w-[36rem] flex-col gap-6 p-6">
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
      <main className="mx-auto flex max-w-[36rem] flex-col gap-6 p-6">
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
    <main className="mx-auto flex max-w-[36rem] flex-col gap-6 p-6">
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
            <Field
              data-invalid={
                accountErrorFor(INVITE_CODE_INPUT_ID) !== undefined ? true : undefined
              }
            >
              <FieldLabel htmlFor={INVITE_CODE_INPUT_ID}>{INVITE_CODE_LABEL}</FieldLabel>
              <Input
                id={INVITE_CODE_INPUT_ID}
                name="inviteCode"
                value={account.inviteCode}
                aria-invalid={accountErrorFor(INVITE_CODE_INPUT_ID) !== undefined}
                onChange={(event) => {
                  setAccount((current) => ({ ...current, inviteCode: event.target.value }));
                }}
              />
              <FieldDescription className="text-[13px] text-text-secondary">
                邀请码是一次性的，用过就不能再用。
              </FieldDescription>
              {accountErrorFor(INVITE_CODE_INPUT_ID) !== undefined ? (
                <FieldError>{accountErrorFor(INVITE_CODE_INPUT_ID)}</FieldError>
              ) : null}
            </Field>
            <Field
              data-invalid={accountErrorFor(EMAIL_INPUT_ID) !== undefined ? true : undefined}
            >
              <FieldLabel htmlFor={EMAIL_INPUT_ID}>{EMAIL_LABEL}</FieldLabel>
              <Input
                id={EMAIL_INPUT_ID}
                name="email"
                type="email"
                value={account.email}
                aria-invalid={accountErrorFor(EMAIL_INPUT_ID) !== undefined}
                onChange={(event) => {
                  setAccount((current) => ({ ...current, email: event.target.value }));
                }}
              />
              {accountErrorFor(EMAIL_INPUT_ID) !== undefined ? (
                <FieldError>{accountErrorFor(EMAIL_INPUT_ID)}</FieldError>
              ) : null}
            </Field>
            <Field
              data-invalid={accountErrorFor(PASSWORD_INPUT_ID) !== undefined ? true : undefined}
            >
              <FieldLabel htmlFor={PASSWORD_INPUT_ID}>{PASSWORD_LABEL}</FieldLabel>
              <Input
                id={PASSWORD_INPUT_ID}
                name="password"
                type="password"
                value={account.password}
                aria-invalid={accountErrorFor(PASSWORD_INPUT_ID) !== undefined}
                onChange={(event) => {
                  setAccount((current) => ({ ...current, password: event.target.value }));
                }}
              />
              {accountErrorFor(PASSWORD_INPUT_ID) !== undefined ? (
                <FieldError>{accountErrorFor(PASSWORD_INPUT_ID)}</FieldError>
              ) : null}
            </Field>
            <Field
              data-invalid={accountErrorFor(NAME_INPUT_ID) !== undefined ? true : undefined}
            >
              <FieldLabel htmlFor={NAME_INPUT_ID}>{NAME_LABEL}</FieldLabel>
              <Input
                id={NAME_INPUT_ID}
                name="name"
                value={account.name}
                aria-invalid={accountErrorFor(NAME_INPUT_ID) !== undefined}
                onChange={(event) => {
                  setAccount((current) => ({ ...current, name: event.target.value }));
                }}
              />
              {accountErrorFor(NAME_INPUT_ID) !== undefined ? (
                <FieldError>{accountErrorFor(NAME_INPUT_ID)}</FieldError>
              ) : null}
            </Field>
            <AgeGate
              birthDate={account.birthDate}
              now={now ?? undefined}
              onBirthDateChange={(birthDate) => {
                setAccount((current) => ({ ...current, birthDate }));
              }}
            />
            {accountErrorFor(BIRTH_DATE_INPUT_ID) !== undefined ? (
              <FieldError>{accountErrorFor(BIRTH_DATE_INPUT_ID)}</FieldError>
            ) : null}
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

        {/* 主 CTA 的禁用是契约强制的（UI-SPEC 401/479），所以「还差什么」必须显式说出
            来，否则 389 那条「禁止只描述问题」在结构上无法被满足。两项必选都勾上后消失。 */}
        {step === 2 && missingRequired.length > 0 ? (
          <p data-testid={MISSING_REQUIRED_TESTID} className="text-[13px] text-text-secondary">
            {MISSING_REQUIRED_CONSENT_NOTE.replace(
              MISSING_REQUIRED_PLACEHOLDER,
              missingRequired.map((scope) => CONSENT_SCOPE_SPECS[scope].label).join('、'),
            )}
          </p>
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
            // ⚠️ 两个翻页「下一步」都**不禁用**，这是刻意的。
            //
            // 紧急联系人那一步：UI-SPEC 为它定了一条专门的错误文案（「这个联系方式我们
            // 没法识别，请填写 11 位手机号……」）并要求把焦点移到第一个出错字段。如果
            // 按钮在格式不通过时是 disabled，那条文案与那次焦点移动**永远不可达** ——
            // 一条到不了的法定告知比一个多余的禁用态更糟。
            //
            // 步骤 0 有完全相同的可达性问题，而它的禁用从来不是 UI-SPEC 强制的 ——
            // 401/479 说的都是**主 CTA**，不是翻页按钮。之前它 disabled 的代价是一个
            // 死结：密码短于 8 位 / 出生日期没填成完整日期的用户「看起来全填了」，按钮
            // 却点不动且零解释。现在改为：点得动，点下去如不完整则渲染字段级错误行并把
            // 焦点移到第一个出错字段，且**不前进**。
            <Button
              type="button"
              onClick={() => {
                if (step === 0) {
                  if (!accountReady) {
                    setShowAccountErrors(true);
                    focusFirstInvalidAccount();
                    return;
                  }
                  setStep(1);
                  return;
                }
                // step === 1
                if (!contactComplete) {
                  setShowContactErrors(true);
                  focusFirstInvalid();
                  return;
                }
                setStep(2);
              }}
            >
              {NEXT_STEP_LABEL}
            </Button>
          ) : (
            // 主 CTA：两项必选未全勾时 **disabled**，不是提交后报错（UI-SPEC 401/479）。
            // 禁用原因由上面那行「还差必选同意项：…」显式说出。
            <Button type="submit" disabled={!canSubmit || pending} aria-busy={pending}>
              {REGISTER_CTA}
            </Button>
          )}
        </div>
      </form>
    </main>
  );
}
