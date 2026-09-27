// 导出渲染 —— 三个承载对话文本的出站出口之一（D-15），也是 AI 明示标识的第四处落点
//（COMPLY-02：标识必须**随文件存活**，因此它必须写进文件正文，而不是靠查看器附加）。
//
// ⚠️ 本 plan 只定签名与最小实现；导出 worker、文件头三行元数据与 .json 形态在 Plan 11。
// 先定签名的理由是 egress 注册表：一个「以后再写」的出口不在注册表里，于是它落地那天
// 不会有任何检查提醒它该只接受 GatedText。
//
// ⚠️ 只渲染**角色消息**。用户消息的渲染是另一个函数（Plan 11），它不需要 —— 也不应该
// —— 要求 GatedText：用户原文从不经过出站网关，把它伪装成 GatedText 才是真正的绕过。

import type { GatedText } from '@drift/contract';

/**
 * 角色消息行的 AI 标识前缀（COMPLY-02）。
 *
 * 前缀而非后缀：导出文件可能被截断、被 grep、被只看前几列，前缀是唯一在所有这些读法
 * 下都还在的位置。
 */
export const EXPORT_AI_PREFIX = '[AI] ';

export interface ExportLineMeta {
  /** 角色名。导出文件里用它替代 sender_kind，读起来才像一段对话。 */
  readonly characterName: string;
  readonly createdAt: Date;
}

/**
 * 渲染一行角色消息的导出文本。**出口签名只接受 GatedText。**
 *
 * @param text 已由 packages/safety 的 safetyGateway() 产出的 GatedText。
 */
export function renderExportLine(text: GatedText, meta: ExportLineMeta): string {
  return `${EXPORT_AI_PREFIX}${meta.createdAt.toISOString()} ${meta.characterName}: ${text}`;
}
