// 步骤 0（账号信息）的字段级校验 —— **纯函数**，不依赖 React、不依赖 DOM。
//
// ── 为什么把判据提成一张表 ──────────────────────────────────────────────────
// 之前 accountComplete 是 steps.tsx 里一个多项 `&&` 的长表达式，「下一步」按钮直接
// 吃它做 `disabled`。于是出现一个死结：校验不通过 → 按钮 disabled → 点不动 →
// onSubmit 不执行 → 没有任何字段级错误行 → 用户看不出还差什么、焦点也不会移动。
//
// 现在把每条判据写成**一张有序的字段规格表**，由它同时派生三样东西：
//   - accountComplete：每一项都通过；
//   - firstInvalidAccountFieldId：第一项不通过的字段 id（点击时的焦点落点）；
//   - accountFieldErrors：每个不通过字段对应的一行「下一步做什么」。
// 三者同源，所以「firstInvalid 返回 null ⟺ accountComplete 为真」是**结构性**成立的，
// 而不是靠两处逻辑恰好写得一致（account-fields.test.ts 用穷举 + 注入证明盯着这条等价）。
//
// ⚠️ 出生日期那一项覆盖两个失败原因：「未填成完整日期」与「未满 18」。后者在整页会被
// age-gate 的终态拒绝接管（steps.tsx 提前 return），用户看不到它的字段行；把它列在这里
// 是为了让 accountComplete 与 firstInvalid 对「未满 18」也给出同一结论，否则等价断言会
// 在未成年输入上分叉。年龄判据复用 age-gate 的 `isRejectedByAgeGate` —— 单一来源。

import {
  BIRTH_DATE_REQUIRED_ERROR,
  EMAIL_FORMAT_ERROR,
  INVITE_CODE_REQUIRED_ERROR,
  NAME_REQUIRED_ERROR,
  PASSWORD_TOO_SHORT_ERROR,
} from './copy';
import { isRejectedByAgeGate } from './age-gate';

export interface AccountFields {
  readonly inviteCode: string;
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly birthDate: string;
}

export const INITIAL_ACCOUNT: AccountFields = Object.freeze({
  inviteCode: '',
  email: '',
  password: '',
  name: '',
  birthDate: '',
});

/** 字段的 input id。焦点移动与错误渲染都按它定位。 */
export const INVITE_CODE_INPUT_ID = 'invite-code';
export const EMAIL_INPUT_ID = 'email';
export const PASSWORD_INPUT_ID = 'password';
export const NAME_INPUT_ID = 'display-name';
export const BIRTH_DATE_INPUT_ID = 'birth-date';

/** 密码下限。错误文案里的数字与判据共用它，避免两处各写一个 8。 */
export const MIN_PASSWORD_LENGTH = 8;

/** 完整 YYYY-MM-DD。半截日期在 age-gate 里不参与年龄判定，也不构成「填好了」。 */
function hasCompleteBirthDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

interface AccountFieldSpec {
  readonly id: string;
  readonly isValid: (account: AccountFields, now: Date | undefined) => boolean;
}

/**
 * 步骤 0 的判据，**唯一**定义处，顺序即表单的渲染顺序，也就是「第一个出错字段」的
 * 优先级。
 */
const ACCOUNT_FIELD_SPECS: readonly AccountFieldSpec[] = [
  {
    id: INVITE_CODE_INPUT_ID,
    isValid: (account) => account.inviteCode.trim().length > 0,
  },
  {
    id: EMAIL_INPUT_ID,
    isValid: (account) => account.email.includes('@'),
  },
  {
    id: PASSWORD_INPUT_ID,
    isValid: (account) => account.password.length >= MIN_PASSWORD_LENGTH,
  },
  {
    id: NAME_INPUT_ID,
    isValid: (account) => account.name.trim().length > 0,
  },
  {
    id: BIRTH_DATE_INPUT_ID,
    // 「完整日期」与「未被年龄门拒绝」两件事：前者挡住空 / 半截日期，后者挡住未满 18。
    isValid: (account, now) =>
      hasCompleteBirthDate(account.birthDate) && !isRejectedByAgeGate(account.birthDate, now),
  },
];

/** 字段 id → 错误文案。文案本身住在 copy.ts。 */
const ACCOUNT_FIELD_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  [INVITE_CODE_INPUT_ID]: INVITE_CODE_REQUIRED_ERROR,
  [EMAIL_INPUT_ID]: EMAIL_FORMAT_ERROR,
  [PASSWORD_INPUT_ID]: PASSWORD_TOO_SHORT_ERROR,
  [NAME_INPUT_ID]: NAME_REQUIRED_ERROR,
  [BIRTH_DATE_INPUT_ID]: BIRTH_DATE_REQUIRED_ERROR,
};

/** 步骤 0 是否可以前进。**由 ACCOUNT_FIELD_SPECS 派生**，不是第二份逻辑。 */
export function accountComplete(account: AccountFields, now?: Date): boolean {
  return ACCOUNT_FIELD_SPECS.every((spec) => spec.isValid(account, now));
}

/** 第一个不通过的字段 id —— 点击「下一步」时焦点移到它。全部通过返回 null。 */
export function firstInvalidAccountFieldId(account: AccountFields, now?: Date): string | null {
  return ACCOUNT_FIELD_SPECS.find((spec) => !spec.isValid(account, now))?.id ?? null;
}

/**
 * 每个不通过字段 → 一行「下一步做什么」的错误文案。
 *
 * 只包含当前不通过的字段 —— 修正一个字段后它对应那行自动消失，不需要清状态。
 */
export function accountFieldErrors(
  account: AccountFields,
  now?: Date,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const spec of ACCOUNT_FIELD_SPECS) {
    if (!spec.isValid(account, now)) errors[spec.id] = ACCOUNT_FIELD_ERROR_MESSAGES[spec.id] ?? '';
  }
  return Object.freeze(errors);
}
