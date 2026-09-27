// @drift/prompts —— 提示词与内容哈希版本（PLAT-08）。
//
// 包边界：本包是提示词正文的唯一定义处，且**不依赖任何会读库或出网的包** ——
// 真相源在 git 这条要求它是一个叶子包。

export * from './version.ts';
export * from './chat-reply.ts';
export * from './safety-classify.ts';
export * from './registry.ts';
