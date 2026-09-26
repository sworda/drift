// @drift/llm —— Model Router。
// 包边界（不可协商）：本包是 @ai-sdk/* / openai / @anthropic-ai/* 的唯一导入者，
// 静态 import 与动态 import() 都只允许出现在这里。

export * from './types.ts';
export * from './router.ts';
export { mockProvider } from './providers/mock.ts';
