// 步骤 0 字段判据的**纯函数**证明（无 DOM、无 React）。
//
// 这里守的是三件事：
//   1. firstInvalidAccountFieldId 对每个字段各自构造「只有它不通过」的输入，返回对应 id；
//   2. 「firstInvalid 返回 null ⟺ accountComplete 为真」—— 防的是两张判据表漂移；
//   3. accountFieldErrors 的每一行都含「下一步做什么」（至少含关键数字 / 动作词）。
//
// 注入式非空真证明照 constraints 的既有先例（tools/ci/ui-size-scale.test.ts、
// consent-state.test.ts）：把「一个漂移的第二份实现会被等价断言抓到」写成常驻用例，
// 而不是临时改源码跑一次。

import { describe, expect, it } from 'vitest';

import {
  accountComplete,
  accountFieldErrors,
  BIRTH_DATE_INPUT_ID,
  EMAIL_INPUT_ID,
  firstInvalidAccountFieldId,
  INITIAL_ACCOUNT,
  INVITE_CODE_INPUT_ID,
  MIN_PASSWORD_LENGTH,
  NAME_INPUT_ID,
  PASSWORD_INPUT_ID,
  type AccountFields,
} from './account-fields';
import {
  BIRTH_DATE_REQUIRED_ERROR,
  EMAIL_FORMAT_ERROR,
  INVITE_CODE_REQUIRED_ERROR,
  NAME_REQUIRED_ERROR,
  PASSWORD_TOO_SHORT_ERROR,
} from './copy';

const NOW = new Date('2026-09-27T00:00:00.000Z');

/** 六条判据全过的基线。 */
const VALID: AccountFields = {
  inviteCode: 'invite-1',
  email: 'a@example.invalid',
  password: 'correct-horse',
  name: '张三',
  birthDate: '1995-06-15',
};

const TWO_CHAR_PASSWORD = 'sixchr'; // 6 位，短于下限

describe('firstInvalidAccountFieldId 逐条覆盖六个条件', () => {
  it('全部通过 ⇒ null，且 accountComplete 为真、错误表为空', () => {
    expect(firstInvalidAccountFieldId(VALID, NOW)).toBeNull();
    expect(accountComplete(VALID, NOW)).toBe(true);
    expect(Object.keys(accountFieldErrors(VALID, NOW))).toEqual([]);
  });

  it.each<[string, AccountFields, string]>([
    ['邀请码为空', { ...VALID, inviteCode: '' }, INVITE_CODE_INPUT_ID],
    ['邀请码只有空白', { ...VALID, inviteCode: '   ' }, INVITE_CODE_INPUT_ID],
    ['邮箱不含 @', { ...VALID, email: 'no-at.example' }, EMAIL_INPUT_ID],
    ['密码短于 8 位', { ...VALID, password: TWO_CHAR_PASSWORD }, PASSWORD_INPUT_ID],
    ['密码恰好 7 位', { ...VALID, password: 'x'.repeat(7) }, PASSWORD_INPUT_ID],
    ['昵称为空', { ...VALID, name: '' }, NAME_INPUT_ID],
    ['昵称只有空白', { ...VALID, name: '  ' }, NAME_INPUT_ID],
    ['出生日期为空', { ...VALID, birthDate: '' }, BIRTH_DATE_INPUT_ID],
    ['出生日期是半截的', { ...VALID, birthDate: '1995-6-15' }, BIRTH_DATE_INPUT_ID],
    ['出生日期未满 18', { ...VALID, birthDate: '2015-06-15' }, BIRTH_DATE_INPUT_ID],
  ])('只有「%s」不通过时，返回对应的字段 id', (_label, account, expectedId) => {
    expect(firstInvalidAccountFieldId(account, NOW)).toBe(expectedId);
    expect(accountComplete(account, NOW)).toBe(false);
  });

  it('多项不通过时返回**渲染顺序里最靠前**的那一个', () => {
    const account: AccountFields = {
      inviteCode: '',
      email: 'no-at',
      password: TWO_CHAR_PASSWORD,
      name: '',
      birthDate: '',
    };
    expect(firstInvalidAccountFieldId(account, NOW)).toBe(INVITE_CODE_INPUT_ID);
    const emailFirst: AccountFields = { ...VALID, email: 'no-at', password: TWO_CHAR_PASSWORD };
    expect(firstInvalidAccountFieldId(emailFirst, NOW)).toBe(EMAIL_INPUT_ID);
  });

  it('初始空账号的六个字段全部不通过 ⇒ 焦点落点是邀请码', () => {
    expect(firstInvalidAccountFieldId(INITIAL_ACCOUNT, NOW)).toBe(INVITE_CODE_INPUT_ID);
  });
});

describe('判据一致性：firstInvalid === null ⟺ accountComplete', () => {
  /** 覆盖每条判据的通过 / 不通过两个取值，做全组合（2^6）。 */
  const inviteValues = ['invite-1', ''];
  const emailValues = ['a@example.invalid', 'no-at'];
  const passwordValues = ['correct-horse', TWO_CHAR_PASSWORD];
  const nameValues = ['张三', ''];
  const birthValues = ['1995-06-15', '2015-06-15', '1995-6-15', ''];

  function allAccounts(): AccountFields[] {
    const out: AccountFields[] = [];
    for (const inviteCode of inviteValues) {
      for (const email of emailValues) {
        for (const password of passwordValues) {
          for (const name of nameValues) {
            for (const birthDate of birthValues) {
              out.push({ inviteCode, email, password, name, birthDate });
            }
          }
        }
      }
    }
    return out;
  }

  it('32 种组合上，两个派生结论逐一对齐（枚举证明，不是抽样）', () => {
    const accounts = allAccounts();
    expect(accounts.length).toBeGreaterThanOrEqual(32);
    for (const account of accounts) {
      const complete = accountComplete(account, NOW);
      const firstInvalid = firstInvalidAccountFieldId(account, NOW);
      expect(
        firstInvalid === null,
        `等价性被打破：firstInvalid=${String(firstInvalid)} 而 accountComplete=${String(complete)}`,
      ).toBe(complete);
      // 同一个结论还应与「错误表为空」一致 —— 三者同源。
      expect(Object.keys(accountFieldErrors(account, NOW)).length === 0).toBe(complete);
    }
  });

  it('非空真证明：把密码下限抄成 6 的第二份实现会被等价断言抓到', () => {
    // 注入一个「漂移」的 firstInvalid：只抄了密码一条、且下限取 6。
    const driftedFirstInvalid = (account: AccountFields): string | null =>
      account.password.length >= 6 ? null : PASSWORD_INPUT_ID;

    const account: AccountFields = { ...VALID, password: TWO_CHAR_PASSWORD };
    expect(accountComplete(account, NOW)).toBe(false); // 真判据：不完整
    expect(driftedFirstInvalid(account)).toBeNull(); // 漂移实现：以为没问题
    // 等价断言（上面那条）在漂移实现上会变 false —— 这就是它作为防漂移守卫的价值。
    expect((driftedFirstInvalid(account) === null) === accountComplete(account, NOW)).toBe(false);
  });

  it('非空真证明：漏掉出生日期格式的第二份实现会在半截日期上分叉', () => {
    const driftedFirstInvalid = (account: AccountFields): string | null => {
      if (account.inviteCode.trim().length === 0) return INVITE_CODE_INPUT_ID;
      if (!account.email.includes('@')) return EMAIL_INPUT_ID;
      if (account.password.length < MIN_PASSWORD_LENGTH) return PASSWORD_INPUT_ID;
      if (account.name.trim().length === 0) return NAME_INPUT_ID;
      return null; // 漏了出生日期
    };
    const account: AccountFields = { ...VALID, birthDate: '1995-6-15' };
    expect(accountComplete(account, NOW)).toBe(false);
    expect(driftedFirstInvalid(account)).toBeNull();
    expect((driftedFirstInvalid(account) === null) === accountComplete(account, NOW)).toBe(false);
  });
});

describe('accountFieldErrors 的每一行都含「下一步做什么」', () => {
  it.each<[string, AccountFields, string, readonly string[]]>([
    ['邀请码', { ...VALID, inviteCode: '' }, INVITE_CODE_INPUT_ID, ['请填写', '邀请码']],
    ['邮箱', { ...VALID, email: 'no-at' }, EMAIL_INPUT_ID, ['请填写', '邮箱']],
    [
      '密码',
      { ...VALID, password: TWO_CHAR_PASSWORD },
      PASSWORD_INPUT_ID,
      // 密码必须说得出可执行的下限（用户当前最可能踩到的那条）。
      ['至少', String(MIN_PASSWORD_LENGTH), '位'],
    ],
    ['昵称', { ...VALID, name: '' }, NAME_INPUT_ID, ['请填写', '昵称']],
    [
      '出生日期',
      { ...VALID, birthDate: '' },
      BIRTH_DATE_INPUT_ID,
      ['请选择', '出生日期'],
    ],
  ])('%s 的错误文案非空且含关键动作/数字', (_label, account, id, keywords) => {
    const errors = accountFieldErrors(account, NOW);
    const message = errors[id];
    expect(typeof message).toBe('string');
    expect((message ?? '').length).toBeGreaterThan(0);
    for (const keyword of keywords) {
      expect(message, `「${_label}」的错误文案缺少关键要素：${keyword}`).toContain(keyword);
    }
  });

  it('文案常量与判据共用同一下限数字（8 不在两处各写一遍）', () => {
    expect(PASSWORD_TOO_SHORT_ERROR).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('五条文案两两不同 —— 不是把同一句话抄了五遍', () => {
    const all = [
      INVITE_CODE_REQUIRED_ERROR,
      EMAIL_FORMAT_ERROR,
      PASSWORD_TOO_SHORT_ERROR,
      NAME_REQUIRED_ERROR,
      BIRTH_DATE_REQUIRED_ERROR,
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});
