// 负向 fixture（V.0 #4）—— 故意违反 PLAT-06：给 model 传字符串字面量。
// 对本文件跑 eslint **必须**报出 no-restricted-syntax，否则该禁令已静默失效。
// 本文件被 eslint.config.js 的 ignores 与根 tsconfig 的 exclude 排除出常规范围。
import { streamText } from 'ai';

export const bad = streamText({ model: 'deepseek/deepseek-flash', prompt: 'hi' });
