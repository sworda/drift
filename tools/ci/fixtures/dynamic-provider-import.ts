// 负向 fixture（V.0 #5）—— 故意用动态 import() 绕过「packages/llm 是 provider SDK
// 唯一导入者」这条包边界。no-restricted-imports 看不见 ImportExpression，只有
// no-restricted-syntax 的 ImportExpression 选择器能抓到它。
// 对本文件跑 eslint **必须**报出 no-restricted-syntax。
export const provider = await import('@ai-sdk/openai');
