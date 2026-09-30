// 可 pin 性显式表（RESEARCH §5.1 / STACK §15.9）。
//
// ⚠️ 这张表**必须**逐个模型手写。不得用模式匹配或命名约定推断：同一厂商的命名
// 规则按世代变化，推断会在换代时静默判错，而错的方向是「把别名当快照 pin 住」——
// 最坏的那个方向（历史对比的尺子在某天被换掉，而数据看起来完全正常）。
// 这条要求有一条机器断言守着：tools/ci/llm-router-contract.test.ts 读本文件源码，
// 断言里面不出现任何模式匹配 API 的名字。
//
// `alias-only` 的模型**不得做 baseline / 不得走 pinned 模式**：provider 会在某天把
// 它重新解析到另一组权重上，而那时历史对比数据的尺子已无从查证。routed 模式下
// 可以用（Q4 的裁决），但必须在 routes.ts 里写下一条 aliasOnlyWaiver 理由，并由
// resolved_model 日 diff 告警补偿。

import { configuredPinnabilityOf } from './config.ts';
import type { ModelSnapshot, Pinnability } from './types.ts';

export const PINNABLE = {
  'doubao-seed-character-251128': 'snapshot',
  'qwen3.8-max-0902': 'snapshot',
  'claude-sonnet-5': 'snapshot',
  'claude-sonnet-4-5': 'alias-only',
  'deepseek-flash': 'alias-only',
  'glm-4.7-flash': 'alias-only',
} as const satisfies Record<ModelSnapshot, Pinnability>;
// 上表逐条依据（模型名刻意不在注释里重复，否则 grep 断言读到的行会含两种取值）：
//  - doubao-seed-*：model id 自带版本号（火山方舟模型详情页标注）。
//  - qwen3.8-max-0902：百炼提供「查看快照版本」。
//  - claude-sonnet-5：4.6 世代及之后，无日期 ID 本身就是固定快照（Anthropic 官方原文）。
//  - claude-sonnet-4-5：4.6 之前的无日期短名是指向最新快照的别名。
//  - deepseek-flash：model 参数只接受两个无版本名，文档里的 MODEL VERSION 不可传。
//  - 智谱 flash 分类器：未找到带日期的快照 ID（STACK §15.9，Confidence MEDIUM）。
//    Q4 的裁决是「如实标成不可 pin，并用每日 resolved_model diff 告警补偿」，
//    而不是「先当成快照用着」—— 后者会让厂商静默换模型时探针通过率的变化被归因错。

/**
 * 查某个模型的可 pin 性。
 *
 * 查找顺序：内置表 PINNABLE → 配置文件声明的模型（config.ts，启动时已强制
 * 显式登记 pinnability）。两边都未登记的模型返回 `undefined`，调用方必须把它
 * 当失败处理 —— **不得**默认成 snapshot。默认成 snapshot 等于让一个没人核实过
 * 的模型直接进 pinned 路径；配置模型少写 pinnability 字段在解析阶段就炸了。
 */
export function pinnabilityOf(model: string): Pinnability | undefined {
  const builtin = (PINNABLE as Readonly<Record<string, Pinnability>>)[model];
  if (builtin !== undefined) return builtin;
  return configuredPinnabilityOf(model);
}
