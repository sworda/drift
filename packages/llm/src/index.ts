// @drift/llm —— Model Router。
// 包边界（不可协商）：本包是 @ai-sdk/* / openai / @anthropic-ai/* 的唯一导入者，
// 静态 import 与动态 import() 都只允许出现在这里。

export * from './types.ts';
export * from './pinnability.ts';
export * from './hosts.ts';
export * from './routes.ts';
export * from './events.ts';
export * from './startup-assertions.ts';
export * from './router.ts';
export { mockProvider, providerMode, resolveProvider } from './providers/index.ts';
// zhipuProvider：L6 危机探针（tests/probes）在 LLM_PROVIDER_MODE=mock 的进程里直连
// 真实分类器（chat.reply 必须留在 mock 上以保证候选回复确定），拿不到实例就只能
// 把整个进程切 live —— 那会让探针的输入方差失控。除探针外无人直接消费它。
export { zhipuProvider } from './providers/index.ts';
