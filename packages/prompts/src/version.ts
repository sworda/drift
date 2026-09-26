// 提示词版本 = 内容哈希（PLAT-08：真相源在 git，不在数据库）。
//
// 为什么是内容哈希而不是手写版本号：手写版本号会忘了改，而「忘了改」的表现是
// llm_call.prompt_version 指向一份已经不是当时那份的提示词 —— 归因链在这里断掉，
// 而没有任何断言能发现它。内容变了哈希就变，忘不掉。

import { createHash } from 'node:crypto';

/** 前 16 个 hex 字符（64 bit）。碰撞概率在本项目的提示词数量级上可忽略，而短哈希在日志与 SQL 里读得完。 */
export function promptVersion(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)}`;
}

/** 输入哈希 —— 进 llm_call.input_hash。**不存 prompt 正文**，见 audit.ts 的说明。 */
export function inputHash(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32)}`;
}
