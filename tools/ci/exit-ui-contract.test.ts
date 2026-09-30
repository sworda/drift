// 硬退出与提醒文案的静态契约断言（COMPLY-03/04/05 / Plan 12 Task 3）。
//
// 渲染层的 RTL 断言在 apps/web/src/features/chat/exit-ui-contract.test.tsx。
// 本文件负责不需要渲染的那一半：文案与 UI-SPEC 逐字比对（运行时提取，不抄
// 进常量）、退出过滤器的结构性禁令、rule_id 与 DB CHECK 的取值域一致性。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EXIT_SYSTEM_CARD_COPY } from '@drift/contract';
import { EXIT_TIER1, EXIT_TIER2, matchExitIntent } from '@drift/safety';

// 相对路径 import（storage-registry.test.ts 的先例）：@drift/db 的包入口会拉进
// client.ts —— 模块加载即读 DATABASE_URL，ci:fast 不能依赖它。
import { DEPENDENCY_RULE_IDS as DB_RULE_IDS } from '../../packages/db/src/schema/audit.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const UI_SPEC = readFileSync(
  `${REPO_ROOT}.planning/phases/01-compliance-safety-chat-skeleton/01-UI-SPEC.md`,
  'utf8',
);

/** 从 UI-SPEC 的表格行提取第二个单元格；提取不到即抛错（不宽松匹配）。 */
function copywritingCell(linePrefix: string): string {
  const line = UI_SPEC.split('\n').find((l) => l.startsWith(linePrefix));
  if (line === undefined) {
    throw new Error(`UI-SPEC 的 Copywriting Contract 里找不到以「${linePrefix}」开头的行`);
  }
  const cells = line.split('|').map((c) => c.trim());
  // | label | copy | → split 后 ['', label, copy, '']
  const cell = cells[2];
  if (cell === undefined || cell.length === 0) throw new Error(`${linePrefix} 的文案单元格为空`);
  return cell;
}

function extractQuoted(source: string, marker: string): string {
  // 词条可以在引号内的任意位置（含开头），两侧都用 * —— 用 + 会让「以词条开头
  // 的引号句」（如卡片正文）提取不到。
  const match = new RegExp(`「([^「」]*${marker}[^「」]*)」`).exec(source);
  if (match === null) throw new Error(`从 UI-SPEC 提取 ${marker} 失败`);
  return match[1] ?? '';
}

describe('文案常量与 UI-SPEC 逐字一致（运行时提取，不抄第二份）', () => {
  it('2 小时提醒正文', async () => {
    const { USAGE_REMINDER_COPY } = await import('../../apps/web/src/features/chat/copy.ts');
    expect(USAGE_REMINDER_COPY).toBe(copywritingCell('| 2 小时时长提醒（COMPLY-03）'));
  });

  it('过度依赖提醒正文', async () => {
    const { DEPENDENCY_NOTICE_COPY } = await import('../../apps/web/src/features/chat/copy.ts');
    expect(DEPENDENCY_NOTICE_COPY).toBe(copywritingCell('| 过度依赖动态提醒（COMPLY-04）'));
  });

  it('SAFE-14 情感边界引导（唯一定义在 crisis/copy.ts）', async () => {
    const { EMOTIONAL_BOUNDARY_COPY } = await import('../../apps/web/src/features/crisis/copy.ts');
    expect(EMOTIONAL_BOUNDARY_COPY).toBe(copywritingCell('| 情感边界引导（SAFE-14）'));
  });

  it('2 小时提醒两个按钮', async () => {
    const { USAGE_REMINDER_PRIMARY, USAGE_REMINDER_SECONDARY } = await import(
      '../../apps/web/src/features/chat/copy.ts'
    );
    const line = copywritingCell('| 2 小时时长提醒按钮（COMPLY-03）');
    expect(line).toContain(`「**${USAGE_REMINDER_PRIMARY}**」`);
    expect(line).toContain(`「${USAGE_REMINDER_SECONDARY}」`);
  });

  it('依赖告知唯一按钮', async () => {
    const { DEPENDENCY_NOTICE_BUTTON } = await import('../../apps/web/src/features/chat/copy.ts');
    const line = copywritingCell('| 过度依赖动态提醒按钮（COMPLY-04）');
    expect(line).toContain(`**${DEPENDENCY_NOTICE_BUTTON}**`);
  });

  it('硬退出系统卡片正文与占位符（## 硬退出呈现契约）', async () => {
    const section = UI_SPEC.slice(UI_SPEC.indexOf('## 硬退出呈现契约'));
    expect(EXIT_SYSTEM_CARD_COPY).toBe(extractQuoted(section, '已停止本次会话'));
    const { EXIT_INPUT_PLACEHOLDER } = await import('../../apps/web/src/features/chat/copy.ts');
    expect(EXIT_INPUT_PLACEHOLDER).toBe('本次会话已结束');
    expect(section).toContain('「本次会话已结束」');
    const { END_SESSION_LABEL } = await import('../../apps/web/src/features/chat/copy.ts');
    expect(END_SESSION_LABEL).toBe('结束本次会话');
    expect(section).toContain('「结束本次会话」');
  });
});

describe('退出过滤器的结构性禁令（D-12 / RESEARCH §9.1）', () => {
  const FILTER = readFileSync(`${REPO_ROOT}packages/safety/src/exit-filter.ts`, 'utf8');

  it('不存在子串匹配（includes / indexOf 做词条判定）', () => {
    // endsWith 是整句锚定的一部分；includes/indexOf 是被否决的子串形态。
    expect(FILTER.includes('.includes('), '子串匹配会在「我不想聊这个话题」上误杀整个会话').toBe(false);
    expect(FILTER.includes('.indexOf(')).toBe(false);
  });

  it('不存在对 Model Router 或 LLM 的任何调用（退出意图判定不走模型）', () => {
    expect(FILTER.includes('@drift/llm')).toBe(false);
    expect(FILTER.includes('routed')).toBe(false);
    expect(FILTER.includes('callFrontier')).toBe(false);
  });

  it('两档词表逐字等于 D-12（第一档 6 词 / 第二档 3 词）', () => {
    expect([...EXIT_TIER1]).toEqual(['退出', '结束', '停', '别发了', '不想聊了', '不想聊']);
    expect([...EXIT_TIER2]).toEqual(['明天聊', '先这样', '睡了']);
  });

  it('「我不想聊这个话题」判 null（换话题不是退出 —— 最关键的误杀防线）', () => {
    expect(matchExitIntent('我不想聊这个话题').tier).toBeNull();
    expect(matchExitIntent('我要退出').tier).toBe(1);
  });
});

describe('系统卡片与 UI 的 care 色隔离（UI-SPEC ## 硬退出呈现契约）', () => {
  it('exit-system-card.tsx 不引用任何 care 色 token（退出不是危机）', () => {
    const source = readFileSync(
      `${REPO_ROOT}apps/web/src/features/chat/exit-system-card.tsx`,
      'utf8',
    );
    // 断言的是**样式 token 引用**而不是字面 'care'（注释里的「不用 care 色」
    // 是文档，不是样式）。类名/变量层引用 care 调色板才是被禁止的形态。
    expect(/--care|care-(surface|border|text)|bg-care|text-care|border-care/u.test(source)).toBe(
      false,
    );
  });
});

describe('rule_id 取值域三方一致（DB CHECK / 阈值模块）', () => {
  it('thresholds.ts 的 DEPENDENCY_RULE_IDS === packages/db 的 DEPENDENCY_RULE_IDS', async () => {
    const { DEPENDENCY_RULE_IDS } = await import('../../apps/api/src/modules/usage/thresholds.ts');
    expect([...DEPENDENCY_RULE_IDS]).toEqual([...DB_RULE_IDS]);
  });
});

describe('WS 下行事件契约（usage.reminder / dependency.notice / conversation.ended）', () => {
  it('contract 的下行 union 含全部三个事件', () => {
    const ws = readFileSync(`${REPO_ROOT}packages/contract/src/ws.ts`, 'utf8');
    expect(ws.includes("z.literal('usage.reminder')")).toBe(true);
    expect(ws.includes("z.literal('dependency.notice')")).toBe(true);
    expect(ws.includes("z.literal('conversation.ended')")).toBe(true);
  });
});
