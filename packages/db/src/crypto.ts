// 紧急联系人联系方式的应用层加解密与遮蔽（T-09-03 / T-09-08）。
//
// ── 为什么是应用层加密而不是只靠库的访问控制 ────────────────────────────────
// 这一列存的是**第三方的个人信息**：用户代监护人 / 紧急联系人填了号码，而那个人
// 并没有同意我们展示它。库级权限保护不了备份文件、不保护 `pg_dump`、也不保护任何
// 一次 `select *` 的排障截图。应用层加密让「拿到库 ≠ 拿到号码」。
//
// ── 没有明文回退分支（T-09-08）────────────────────────────────────────────
// 密钥缺失时这里**抛错**，不写明文、不写占位串、不降级。一个「密钥没配就先存明文，
// 等配好了再加密」的分支在开发期看起来很合理，而它的结局是生产库里躺着一批明文
// 号码，且没有任何检查会发现 —— 因为读路径对两种形态都能工作。
// apps/api 侧另有一道更早的防线：CONTACT_ENCRYPTION_KEY 在 config/env.ts 里是必填，
// 缺失时进程直接 exit 1。这里的抛错是那道防线被绕过时（脚本、worker、测试）的兜底。
//
// ── 为什么是懒读而不是模块加载时读 ──────────────────────────────────────────
// packages/db 的 index.ts 被 tools/ci 的若干纯静态测试 import（它们不碰加密），
// 在模块加载期硬性要求这个密钥会让那些测试凭空需要一份密钥。懒读 + 缓存的语义是
// 「用到就必须有」，与「没有就存明文」是两件完全不同的事。

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AES-256-GCM。GCM 而不是 CBC：需要的是**带认证**的密文，改一个字节要能被发现。 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** 密文前缀。将来换算法时它是判据，而不是靠长度猜。 */
export const CONTACT_CIPHER_VERSION = 'v1';

export const CONTACT_ENCRYPTION_KEY_ENV = 'CONTACT_ENCRYPTION_KEY';

let cachedKey: Buffer | null = null;

export class ContactEncryptionKeyError extends Error {
  constructor(detail: string) {
    super(
      `${CONTACT_ENCRYPTION_KEY_ENV} ${detail}。紧急联系人的联系方式不允许明文入库，因此这里不提供任何回退分支。`,
    );
    this.name = 'ContactEncryptionKeyError';
  }
}

function encryptionKey(): Buffer {
  if (cachedKey !== null) return cachedKey;
  const raw = process.env[CONTACT_ENCRYPTION_KEY_ENV];
  if (raw === undefined || raw.length === 0) throw new ContactEncryptionKeyError('未设置');
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new ContactEncryptionKeyError('必须是 64 个十六进制字符（32 字节）');
  }
  cachedKey = Buffer.from(raw, 'hex');
  return cachedKey;
}

/**
 * 加密一个联系方式。返回 `v1:<iv>:<tag>:<密文>`（三段均为 base64url）。
 *
 * 同一个号码两次加密得到**不同**的密文（随机 IV）—— 这是刻意的：确定性密文等于
 * 一个可比对的指纹，会让「库里有没有这个号码」变成一次可离线穷举的查询。
 * 代价是没法按密文查重，而我们本来也不需要按号码查重。
 */
export function encryptContact(plain: string): string {
  if (plain.length === 0) throw new Error('联系方式为空，拒绝加密一个空值（它会伪装成一个有效记录）');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CONTACT_CIPHER_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/**
 * 解密。
 *
 * ⚠️ **导入受限**：eslint.config.js 只允许 `apps/api/src/modules/safety/**` 导入本函数
 * （危机流程要把号码遮蔽后显示给用户）。别处需要的是 `maskContact`，而不是明文。
 * 把这条限制写进 lint 而不是写进注释，是因为注释不会变红。
 */
export function decryptContact(stored: string): string {
  const parts = stored.split(':');
  const [version, ivPart, tagPart, dataPart] = parts;
  if (
    parts.length !== 4 ||
    version !== CONTACT_CIPHER_VERSION ||
    ivPart === undefined ||
    tagPart === undefined ||
    dataPart === undefined
  ) {
    throw new Error(`联系方式密文格式不是 ${CONTACT_CIPHER_VERSION}:<iv>:<tag>:<data>`);
  }
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('联系方式密文的 iv 或认证标签长度不对');
  }
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * 遮蔽：11 位手机号 → `138****1234`（UI-SPEC〔法定〕的 {遮蔽后的联系方式}）。
 *
 * 短于 7 位的输入整串打星 —— 保留前 3 后 4 对一个 8 位的号码等于只遮了 1 位，
 * 那不是遮蔽。这里宁可给出一个信息量为零的串。
 */
export function maskContact(plain: string): string {
  if (plain.length < 7) return '*'.repeat(plain.length);
  return `${plain.slice(0, 3)}${'*'.repeat(plain.length - 7)}${plain.slice(-4)}`;
}

/** 测试用：清掉缓存的密钥，让下一次调用重新读 env。 */
export function resetContactEncryptionKeyCache(): void {
  cachedKey = null;
}
