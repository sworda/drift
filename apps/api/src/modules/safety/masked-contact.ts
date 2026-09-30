// 紧急联系人遮蔽的公共读取（Plan 11 / T-09-03）—— 供危机流程之外唯一的合法消费
//（导出）使用。本模块目录是全仓唯一允许 import decryptContact 的区域：这里只产出
// 遮蔽形态，明文不出这个文件。

import { decryptContact, maskContact } from '@drift/db';

/** 解密并遮蔽（138****1234）—— 导出面板与危机卡片共用的唯一形态。 */
export function maskedContactOf(contactRefEncrypted: string): string {
  return maskContact(decryptContact(contactRefEncrypted));
}
