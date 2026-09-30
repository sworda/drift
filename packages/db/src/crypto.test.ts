// 紧急联系人加解密与遮蔽的单元断言（L3，不连库）。
//
// 这一层要证明的是三件事：往返正确、**同一明文两次加密不同**（没有可比对的指纹）、
// 以及密文被改一个字节就解不开（GCM 的认证标签真的起作用，而不是只是长在那里）。

import { beforeAll, describe, expect, it } from 'vitest';

import {
  CONTACT_ENCRYPTION_KEY_ENV,
  ContactEncryptionKeyError,
  decryptContact,
  encryptContact,
  maskContact,
  resetContactEncryptionKeyCache,
} from './crypto.ts';

const TEST_KEY = '0123456789abcdef'.repeat(4);

beforeAll(() => {
  process.env[CONTACT_ENCRYPTION_KEY_ENV] = TEST_KEY;
  resetContactEncryptionKeyCache();
});

describe('encryptContact / decryptContact', () => {
  it('往返得到原文', () => {
    expect(decryptContact(encryptContact('13800001234'))).toBe('13800001234');
  });

  it('同一明文两次加密得到不同密文（随机 IV，不留可比对的指纹）', () => {
    expect(encryptContact('13800001234')).not.toBe(encryptContact('13800001234'));
  });

  it('密文里不出现明文，也不出现 11 位连续数字', () => {
    const stored = encryptContact('13800001234');
    expect(stored).not.toContain('13800001234');
    expect(/\d{11}/.test(stored)).toBe(false);
    expect(stored.startsWith('v1:')).toBe(true);
  });

  it('密文被改动后解不开（GCM 认证标签生效）', () => {
    const parts = encryptContact('13800001234').split(':');
    const data = Buffer.from(parts[3] ?? '', 'base64url');
    data[0] = (data[0] ?? 0) ^ 0xff;
    parts[3] = data.toString('base64url');
    expect(() => decryptContact(parts.join(':'))).toThrow();
  });

  it('格式不对的串抛错，而不是返回一个看起来像号码的东西', () => {
    expect(() => decryptContact('13800001234')).toThrow(/格式/);
    expect(() => decryptContact('v1:a:b')).toThrow(/格式/);
  });

  it('密钥缺失时抛错 —— 不存在任何明文回退分支（T-09-08）', () => {
    const saved = process.env[CONTACT_ENCRYPTION_KEY_ENV];
    try {
      delete process.env[CONTACT_ENCRYPTION_KEY_ENV];
      resetContactEncryptionKeyCache();
      expect(() => encryptContact('13800001234')).toThrow(ContactEncryptionKeyError);
      process.env[CONTACT_ENCRYPTION_KEY_ENV] = 'not-hex';
      resetContactEncryptionKeyCache();
      expect(() => encryptContact('13800001234')).toThrow(ContactEncryptionKeyError);
    } finally {
      if (saved !== undefined) process.env[CONTACT_ENCRYPTION_KEY_ENV] = saved;
      resetContactEncryptionKeyCache();
    }
  });
});

describe('maskContact', () => {
  it('11 位手机号留头三尾四', () => {
    expect(maskContact('13800001234')).toBe('138****1234');
  });

  it('短于 7 位的整串遮蔽 —— 留头三尾四会等于几乎没遮', () => {
    expect(maskContact('123456')).toBe('******');
    expect(maskContact('')).toBe('');
  });
});
