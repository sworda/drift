// 负向 fixture（V.0 #3）—— 一个接受 GatedText 却**未登记**在 EGRESS_POINTS 的新出口。
//
// 它存在的唯一目的：证明 tools/ci/egress-registry.test.ts 的集合相等断言不是空真通过
// 的。把本文件纳入扫描范围后那条断言**必须**变红，且错误信息里必须出现
// sendSomewhereElse —— 否则「新增出口必须登记」这条防线是不存在的。
import type { GatedText } from '@drift/contract';

export function sendSomewhereElse(text: GatedText): number {
  return text.length;
}
