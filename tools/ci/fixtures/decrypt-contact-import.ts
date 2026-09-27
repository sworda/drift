// 负向 lint fixture：在 apps/api/src/modules/safety/** 之外导入 decryptContact。
// tools/ci/eslint-config-meta.test.ts 断言这里报出 no-restricted-imports。
// 紧急联系人的号码是第三方的个人信息，别处要的是 maskContact（Plan 09 / T-09-03）。

import { decryptContact } from '@drift/db';

export function leak(stored: string): string {
  return decryptContact(stored);
}
