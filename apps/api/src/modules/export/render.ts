// 导出渲染 —— 三个承载对话文本的出站出口之一（D-15），也是 AI 明示标识的第四处落点
//（COMPLY-02：标识必须**随文件存活**，因此它必须写进文件正文，而不是靠查看器附加）。
//
// ⚠️ 前缀与文件头都由这里注入，前端不参与拼装（COMPLY-09 的同一原则）—— 新增出口
// 会漏标识，而「标识在管道里统一注入」让漏掉它成为一次编译错误而不是一次疏忽。
//
// ⚠️ renderExportLine 只渲染**角色消息**。用户消息的渲染是 renderExportUserLine ——
// 它不需要也不应该要求 GatedText：用户原文从不过出站网关，把它伪装成 GatedText 才是
// 真正的绕过（出口注册表的集合相等断言因此只认 GatedText 签名的 renderExportLine）。

import type { GatedText } from '@drift/contract';

/**
 * 角色消息行的 AI 标识前缀（COMPLY-02）。
 *
 * 前缀而非后缀：导出文件可能被截断、被 grep、被只看前几列，前缀是唯一在所有这些读法
 * 下都还在的位置。
 */
export const EXPORT_AI_PREFIX = '[AI] ';

/** 文件头三行元数据块的第二行（法定标识句，COMPLY-02 / 标识办法第四条）。 */
export const EXPORT_DISCLOSURE_LINE = '本文件全部角色消息由 AI 生成';

export interface ExportLineMeta {
  /** 角色名。导出文件里用它替代 sender_kind，读起来才像一段对话。 */
  readonly characterName: string;
  readonly createdAt: Date;
}

/**
 * 渲染一行角色消息的导出文本。**出口签名只接受 GatedText。**
 *
 * @param text 已由 packages/safety 的 safetyGateway() 产出的 GatedText —— 从库里读回的
 *             历史消息经 gatedFromStoredCharacterMessage（disclosure 留证）恢复。
 */
export function renderExportLine(text: GatedText, meta: ExportLineMeta): string {
  return `${EXPORT_AI_PREFIX}${meta.createdAt.toISOString()} ${meta.characterName}: ${text}`;
}

/**
 * 渲染一行**用户**消息的导出文本 —— 不带 [AI] 前缀（它不是 AI 生成的内容，标了
 * 才是虚假陈述），签名也因此不接受 GatedText（见文件头）。
 */
export function renderExportUserLine(text: string, meta: { readonly createdAt: Date }): string {
  return `${meta.createdAt.toISOString()} 你: ${text}`;
}

/** 文件头三行元数据块：服务名 / 法定标识句 / 导出时间（COMPLY-02，双格式共用）。 */
export function renderExportHeader(exportedAt: Date): string {
  return ['Drift', EXPORT_DISCLOSURE_LINE, `导出时间：${exportedAt.toISOString()}`].join('\n');
}
