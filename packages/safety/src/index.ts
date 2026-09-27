// @drift/safety —— 出站安全网关 + 双层危机检测。
//
// 包边界（不可协商）：
//   1. 本包是 GatedText 的唯一产出者，全仓库仅此一处允许把 string 提升为 GatedText。
//   2. 本包**不连数据库、不出网**。依赖只有 @drift/contract 与 @drift/prompts（两个
//      零业务依赖的叶子包）。理由是执行点的位置：Plan 06 的出口注册表集合相等断言住在
//      L4 契约层，而 fast workflow 不得依赖任何数据库或境内资源 —— 一旦本包拖进
//      @drift/db（模块加载时读 DATABASE_URL），那条断言就跑不起来。
//      落库与模型调用都以窄端口从参数进来（SafetyEventRecorder / ClassifyInvoke）。

export * from './risk.ts';
export * from './rules.ts';
export * from './classify.ts';
export * from './care-cards.ts';
export * from './gateway.ts';
export * from './egress.ts';
export * from './retention-words.ts';
export * from './banned-terms.ts';
