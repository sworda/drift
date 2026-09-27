// 紧急联系人的取值域与格式判据（COMPLY-06 / R1.23）。
//
// 为什么在 @drift/contract：注册页的「监护人 / 紧急联系人」二选一与手机号格式校验在
// apps/web，写入与加密在 apps/api + packages/db。**apps/web 不能 import @drift/db**
// —— 后者在模块加载时就要 DATABASE_URL 并构造连接池。两侧各写一份正则的后果是
// 前端放行的格式后端拒绝（或反过来），而那在集成测试里看不见。

/** 两种角色。未满 18 的监护人与成年用户自填的紧急联系人不是同一件事。 */
export const EMERGENCY_CONTACT_KINDS = ['guardian', 'emergency'] as const;
export type EmergencyContactKind = (typeof EMERGENCY_CONTACT_KINDS)[number];

/**
 * 11 位境内手机号。
 *
 * 只做格式判断，**不做可达性判断** —— D-22 明确 R1.23 的可达性在 Phase 1 一律记为
 * `unconfirmed`，因为我们没有任何手段证明一个号码真的打得通，而写成 confirmed 就是
 * 陈述一件未发生的事。这条正则回答的是「这串东西看起来是不是一个手机号」，仅此而已。
 */
export const CONTACT_PHONE_PATTERN = /^1[3-9]\d{9}$/;

export function isValidContactPhone(value: string): boolean {
  return CONTACT_PHONE_PATTERN.test(value);
}
