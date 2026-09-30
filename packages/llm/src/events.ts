// Router 的告警事件。
//
// ── 为什么不是直接 import apps/api 的 logger ────────────────────────────────────
// packages/llm 不能依赖 apps/api（方向相反，且 packages 不该知道自己跑在哪个进程里）。
// 所以这里定义一个极窄的 sink，由 apps/api 在加载 logger 时注册一次
// （apps/api/src/obs/logger.ts 的尾部）—— logger 是 apps/api 里唯一被**所有**入口
// 加载的模块（HTTP / WS / worker / 集成测试直接 import app.ts），把注册放在那里
// 意味着没有任何一个入口会漏掉这条 warn 事件。
//
// ⚠️ `fields` 只有三个键，且全部是模型标识与枚举 —— **不含任何对话内容**。
// 这条约束有断言守着（tools/ci/llm-router-contract.test.ts 断言事件序列化后不含
// 提示词正文的任何 6 字以上子串）。日志文件是一个不能按行删除的存储位置，
// 一键删除（PRIV-05）级联不到它，所以唯一诚实的姿态是让它从设计上不含个人信息。

import type { SemanticRole } from './types.ts';

export interface LlmAliasResolvedEvent {
  readonly event: 'llm.model_alias_resolved';
  readonly level: 'warn';
  readonly fields: {
    readonly purpose: SemanticRole;
    readonly requestedModel: string;
    readonly resolvedModel: string;
  };
}

export type LlmEventSink = (event: LlmAliasResolvedEvent) => void;

const NO_OP_SINK: LlmEventSink = () => {
  /* 默认丢弃：packages/llm 不自带日志实现，也不该往 stdout 里写东西。 */
};

let sink: LlmEventSink = NO_OP_SINK;

export function setLlmEventSink(next: LlmEventSink): void {
  sink = next;
}

export function emitLlmEvent(event: LlmAliasResolvedEvent): void {
  sink(event);
}

/**
 * 「别名被解析」事件（STACK §15.9 第 3 条）。
 *
 * 两者一致 ⇒ 返回 null（没有事件）。不一致 ⇒ 一条 warn：provider 把我们要求的
 * 模型标识解析到了另一个模型上，此刻起「这一行数据是哪把尺子量出来的」已经变了。
 */
export function aliasResolvedEvent(input: {
  readonly purpose: SemanticRole;
  readonly requestedModel: string;
  readonly resolvedModel: string;
}): LlmAliasResolvedEvent | null {
  if (input.resolvedModel === input.requestedModel) return null;
  return {
    event: 'llm.model_alias_resolved',
    level: 'warn',
    fields: {
      purpose: input.purpose,
      requestedModel: input.requestedModel,
      resolvedModel: input.resolvedModel,
    },
  };
}
