// @drift/safety —— 出站安全网关。
// 包边界（不可协商）：本包是 GatedText 的唯一产出者，全仓库仅此一处允许把
// string 提升为 GatedText。

export * from './gateway.ts';
export * from './egress.ts';
