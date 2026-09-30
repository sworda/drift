// 负向 type fixture（V.0 #1）—— GatedText 不可由外部构造。
//
// 对本文件单独跑 tsc **必须**退出码非 0 且至少 3 条 error TS。
// 如果它竟然编译通过，说明 packages/contract/src/brand.ts 的品牌类型已退化为
// 普通 string 别名 —— 这是本阶段最危险的静默失效：三个出口会在零报错的情况下
// 变成「接受任意 string」。
import type { GatedText, SyntheticText } from '@drift/contract';

declare function deliver(text: GatedText): void;
declare const rawFromModel: string;
declare const synthetic: SyntheticText;

// 违反 1：把裸 string 传给只接受 GatedText 的出口。
deliver(rawFromModel);

// 违反 2：把裸 string 直接赋给 GatedText。
export const escaped: GatedText = rawFromModel;

// 违反 3：伪造一个 GatedText 产出点（唯一合法产出点在 packages/safety）。
export function forge(): GatedText {
  return rawFromModel;
}

// 违反 4：两个品牌不可互换 —— SyntheticText 不是 GatedText。
deliver(synthetic);

// 下面两行 tsc **不会**报错：GatedText 是 string 的子类型，向下断言在类型系统里
// 合法。这正是 eslint.config.js 里两条 as GatedText 选择器必须存在的理由 ——
// 编译期挡不住断言，只有 lint 能挡。
export const byAssertion = rawFromModel as GatedText;
export const byDoubleAssertion = rawFromModel as unknown as GatedText;

// 违反 5：satisfies **不是**断言 —— 它要求类型真的成立，因此这一行必须报错。
// 这一条是有意加的：上面两行不报错，如果哪天品牌类型退化成 string 别名，
// 违反 1-4 会一起消失，而报错数阈值是本 fixture 唯一的信号。satisfies 让
// 「GatedText 确实不是任意 string」这句话多一个独立的报错源。
export const bySatisfies = rawFromModel satisfies GatedText;

// 违反 6：SyntheticText 同样不满足 GatedText（两个品牌互不相容）。
export const crossBrandSatisfies = synthetic satisfies GatedText;
