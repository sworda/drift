// 提示词版本 = 内容哈希（PLAT-08：真相源在 git，不在数据库、不在可观测性平台）。
//
// 为什么是内容哈希而不是手写版本号：手写版本号会忘了改，而「忘了改」的表现是
// llm_call.prompt_version 指向一份已经不是当时那份的提示词 —— 归因链在这里断掉，
// 而没有任何断言能发现它。更具体地说，提示词改动不记录会让漂移分析把它误判成
// 人格演化，进而伪造 PROJECT.md 的核心成功指标。内容变了哈希就变，忘不掉。

import { createHash } from 'node:crypto';

/**
 * 归一化：统一行尾 + 去首尾空白。
 *
 * 为什么必须归一化：同一份提示词在 Windows 检出（CRLF）与 Linux 检出（LF）下字节
 * 不同。不归一化的话，同一次 commit 在两台机器上会算出两个 prompt_version，
 * 于是「版本变了」与「换了台机器」在数据里长得一模一样 —— 归因能力直接作废。
 */
export function normalizePromptText(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
}

/**
 * 提示词版本。形如 `pv_` + 16 个小写 hex（64 bit）。
 *
 * 碰撞概率在本项目的提示词数量级上可忽略，而短哈希在日志与 SQL 里读得完。
 * 纯函数：不读盘、不读环境、无副作用 —— 它必须对同一段文本恒返回同一个值。
 */
export function promptVersion(text: string): string {
  const digest = createHash('sha256').update(normalizePromptText(text), 'utf8').digest('hex');
  return `pv_${digest.slice(0, 16)}`;
}

/**
 * 输入哈希 —— 进 llm_call.input_hash。**不存 prompt 正文**，见 audit.ts 的说明。
 *
 * ⚠️ 这里刻意**不**归一化：input_hash 要回答的是「当时喂进去的是不是逐字节同一段
 * 输入」，把行尾差异抹平会让两段实际不同的输入看起来相同。它与 promptVersion 的
 * 判据不同，所以前缀也不同（`sha256:`），避免两者在日志里被混读。
 */
export function inputHash(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32)}`;
}
