// COMPLY-08 审核纯函数的单元测试（L3）+ 3 个种子角色的过审断言（L4 性质）。
//
// ⚠️ 只测通过的那一半是**空真**的：一个 `return { ok: true }` 的实现能 100% 通过
// 全部阳性用例。所以三条应拒绝的用例是这个测试文件存在的主要理由。

import { describe, expect, it } from 'vitest';

import {
  AI_NON_DENIAL_BOUNDARY,
  reviewCharacterConcept,
  SEED_CHARACTERS,
  SEED_MODEL_SNAPSHOT,
} from './characters.ts';

describe('reviewCharacterConcept（COMPLY-08）', () => {
  it.each([
    ['像我妈一样温柔、会催我吃饭的角色', '亲属'],
    ['模仿我前女友的说话方式，尤其是她生气时的语气', '亲属'],
    ['做成周杰伦那样的角色，口吻要像他本人', '真人'],
    ['我奶奶去世了，想做一个像她的角色跟我说话', '逝者亲属'],
    ['还原一位真实存在的人，我同事张姐', '真人'],
  ])('必须拒绝：%s', (concept) => {
    const review = reviewCharacterConcept(concept);
    expect(review.ok, `本该拒绝却通过了：${concept}`).toBe(false);
    expect(review.reason ?? '').not.toHaveLength(0);
  });

  it.each([
    ['开旧书店的中年人，话说得慢，习惯把一句讲完整'],
    ['独立乐队的鼓手，说话短，爱用拟声词'],
    ['夜班急诊护士，说话直，不绕弯子'],
    ['喜欢在雨天散步的园艺师，对植物比对人耐心'],
  ])('必须通过：%s', (concept) => {
    const review = reviewCharacterConcept(concept);
    expect(review.ok, `本该通过却被拒绝：${concept} -> ${review.reason ?? ''}`).toBe(true);
    expect(review.reason).toBeUndefined();
  });
});

describe('3 个种子角色', () => {
  it('恰好 3 个，id 与 name 不重复', () => {
    expect(SEED_CHARACTERS).toHaveLength(3);
    expect(new Set(SEED_CHARACTERS.map((c) => c.id)).size).toBe(3);
    expect(new Set(SEED_CHARACTERS.map((c) => c.name)).size).toBe(3);
  });

  it('每个角色的 blurb 与 dossier 都过 COMPLY-08 审核', () => {
    for (const character of SEED_CHARACTERS) {
      for (const [field, text] of [
        ['blurb', character.blurb],
        ['dossier', character.dossier.markdown],
      ] as const) {
        const review = reviewCharacterConcept(text);
        expect(review.ok, `${character.name} 的 ${field} 未过审：${review.reason ?? ''}`).toBe(true);
      }
    }
  });

  it('每个角色的 hardBoundaries 都含「不否认自己是 AI」那一条', () => {
    for (const character of SEED_CHARACTERS) {
      expect(character.core.hardBoundaries, character.name).toContain(AI_NON_DENIAL_BOUNDARY);
    }
  });

  it('traits 的 14 个维度都是 0-100 的整数（PERS-03：定点整数，不是浮点）', () => {
    for (const character of SEED_CHARACTERS) {
      const values = [
        ...Object.values(character.traits.bigFive),
        ...Object.values(character.traits.social),
      ];
      expect(values).toHaveLength(14);
      for (const value of values) {
        expect(Number.isInteger(value), `${character.name}: ${String(value)}`).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('model_snapshot 是快照标识而不是别名（PERS-10）', () => {
    expect(SEED_MODEL_SNAPSHOT).not.toContain('latest');
    expect(SEED_MODEL_SNAPSHOT.endsWith('-alias')).toBe(false);
    // 带日期后缀的快照 ID：doubao-seed-character-251128
    expect(SEED_MODEL_SNAPSHOT).toMatch(/-\d{6}$/);
  });
});
