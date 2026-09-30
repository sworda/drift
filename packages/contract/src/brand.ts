// @drift/contract —— 品牌类型（brand types）
//
// 这两个类型是「出站文本不可绕过安全网关」与「境外通道只接受合成文本」两条
// 约束在编译期的全部载体。写法必须是下面这一种：unique symbol 只允许出现在
// `declare const` 声明上（写在类型字面量成员位置是 TS1335），再用计算属性键
// 放进交叉类型。
//
// ⚠️ 退化形态没有任何报错：把它改成 `type GatedText = string` 或普通字符串
// brand 之后，三个出口会静默变成「接受任意 string」，编译完全通过。
// 因此 tools/ci/type-fixtures/ 下的负向 type fixture 是这两行的唯一守卫。

declare const GATED: unique symbol;
declare const SYNTHETIC: unique symbol;

/** 已通过 packages/safety 出站网关的文本。全仓库唯一产出点是 safetyGateway()。 */
export type GatedText = string & { readonly [GATED]: true };

/** 合成文本（非真实用户原文）。境外通道的调用签名只接受它。 */
export type SyntheticText = string & { readonly [SYNTHETIC]: true };
