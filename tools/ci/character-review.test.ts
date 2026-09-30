// COMPLY-08 审核纯函数 + 种子数据过审断言（Plan 14 Task 3）。
//
// 纯函数本体在 packages/db/src/seed/characters.ts（Plan 04 交付，Phase 4 自建角色
// 入口直接复用同一个函数）。这里断言：
//   1. 三条应拒绝的样本（像我妈 / 模仿我前女友 / 做成某位真人姓名）—— ok=false
//      且 reason 非空（fail-closed：拒绝必须带原因，它直接进人工复核队列）
//   2. 三条普通性格描述通过
//   3. 3 个种子角色的 core 与 blurb 各跑一次全部通过
//   4. 每个种子角色的 hardBoundaries 含一条「不否认自己是 AI」（COMPLY-01 人格层）
//
// ⚠️ 相对路径直连 TS 源（tools/ci 的先例）：@drift/db 包入口会在模块加载期建
// 连接池并校验 DATABASE_URL，契约层不连库。

import { describe, expect, it } from 'vitest';

import {
  AI_NON_DENIAL_BOUNDARY,
  SEED_CHARACTERS,
  reviewCharacterConcept,
} from '../../packages/db/src/seed/characters.ts';

describe('reviewCharacterConcept（COMPLY-08）', () => {
  it('三条指向现实亲属/真人的样本被拒绝，且 reason 非空', () => {
    const rejections = [
      '说话像我妈妈，语气也像她',
      '模仿我前女友的口吻跟我聊天',
      '做成某位真人姓名的人',
    ];
    for (const sample of rejections) {
      const result = reviewCharacterConcept(sample);
      expect(result.ok, `${sample} 应被拒绝`).toBe(false);
      expect(result.reason ?? '', `${sample} 的拒绝必须带原因（人工复核队列的输入）`).not.toBe('');
    }
  });

  it('三条普通性格描述通过（误报率可控：fail-closed 不等于全拒）', () => {
    const passes = [
      '一个开旧书店的角色，说话慢，习惯把一句讲完整',
      '独立乐队的鼓手，句子短，爱用拟声词',
      '夜班急诊护士，先给结论再说理由',
    ];
    for (const sample of passes) {
      const result = reviewCharacterConcept(sample);
      expect(result.ok, `${sample} 不应被误拒：${result.reason ?? ''}`).toBe(true);
    }
  });

  it('3 个种子角色的 core 与 blurb 各过审一次', () => {
    expect(SEED_CHARACTERS.length).toBe(3);
    for (const character of SEED_CHARACTERS) {
      const coreText = JSON.stringify(character.core);
      const coreReview = reviewCharacterConcept(coreText);
      expect(
        coreReview.ok,
        `${character.name} 的 core 未过审：${coreReview.reason ?? ''}`,
      ).toBe(true);
      const blurbReview = reviewCharacterConcept(character.blurb);
      expect(
        blurbReview.ok,
        `${character.name} 的 blurb 未过审：${blurbReview.reason ?? ''}`,
      ).toBe(true);
    }
  });

  it('每个种子角色的 hardBoundaries 含一条「不否认自己是 AI」（COMPLY-01 人格层）', () => {
    for (const character of SEED_CHARACTERS) {
      expect(
        character.core.hardBoundaries.some((boundary) => boundary === AI_NON_DENIAL_BOUNDARY),
        `${character.name} 的硬边界缺「不否认自己是 AI」`,
      ).toBe(true);
    }
  });
});
