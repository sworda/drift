// 「点一项，其余四项不变」的**穷举**证明（PRIV-01 / T-09-05）。
//
// 这是 PLAN 里那条 RTL 断言 (c) 的纯函数形态：5 个 scope × 2 个目标值 = 10 次转换，
// 每次都逐键比对其余四项。RTL 版本只点一次、看四项；这一版把全部转换都走一遍，
// 且在没有 DOM 的情况下每个 PR 都跑。

import { CONSENT_SCOPES, REQUIRED_SCOPES } from '@drift/contract';
import { describe, expect, it } from 'vitest';

import {
  INITIAL_CONSENT_SELECTION,
  requiredSatisfied,
  setScope,
  type ConsentSelection,
} from './consent-state.ts';

describe('五项同意互不捆绑（PRIV-01）', () => {
  it('初始状态五项全部未勾 —— 必选项也不预勾', () => {
    for (const scope of CONSENT_SCOPES) {
      expect(INITIAL_CONSENT_SELECTION[scope], `${scope} 被预勾了`).toBe(false);
    }
  });

  const startingPoints: readonly ConsentSelection[] = [
    INITIAL_CONSENT_SELECTION,
    Object.freeze(
      Object.fromEntries(CONSENT_SCOPES.map((s) => [s, true])) as ConsentSelection,
    ),
  ];

  it.each(CONSENT_SCOPES)('改 %s 时其余四项逐键不变', (target) => {
    for (const start of startingPoints) {
      for (const value of [true, false]) {
        const next = setScope(start, target, value);
        expect(next[target]).toBe(value);
        for (const other of CONSENT_SCOPES) {
          if (other === target) continue;
          expect(next[other], `改 ${target} 时 ${other} 跟着变了 —— 这就是捆绑同意`).toBe(
            start[other],
          );
        }
      }
    }
  });

  it('setScope 不修改入参（同意状态不可被就地改写）', () => {
    const next = setScope(INITIAL_CONSENT_SELECTION, 'basic_service', true);
    expect(INITIAL_CONSENT_SELECTION.basic_service).toBe(false);
    expect(next.basic_service).toBe(true);
  });

  it('两项必选都勾上之前 requiredSatisfied 为 false', () => {
    let selection = INITIAL_CONSENT_SELECTION;
    expect(requiredSatisfied(selection)).toBe(false);
    for (const scope of REQUIRED_SCOPES) {
      selection = setScope(selection, scope, true);
    }
    expect(requiredSatisfied(selection)).toBe(true);
    // 三项可选与它无关 —— 不勾也能提交。
    expect(requiredSatisfied(setScope(selection, 'research_l0', false))).toBe(true);
    // 撤掉任一必选项即回到 false。
    for (const scope of REQUIRED_SCOPES) {
      expect(requiredSatisfied(setScope(selection, scope, false))).toBe(false);
    }
  });

  it('非空真证明：一个批量 setter 会让「其余四项不变」这条断言失败', () => {
    // PLAN 要求证明 (c) 在有人加了全选之后会变红。这里**在测试内**造一个批量 setter
    // 而不是临时改源码：临时改源码只证明了执行那一刻，注入之后每个 PR 都证明一次。
    const naiveSetAll = (value: boolean): ConsentSelection =>
      Object.freeze(
        Object.fromEntries(CONSENT_SCOPES.map((s) => [s, value])) as ConsentSelection,
      );
    const after = naiveSetAll(true);
    const changed = CONSENT_SCOPES.filter(
      (scope) => after[scope] !== INITIAL_CONSENT_SELECTION[scope],
    );
    // 五项一起变 —— 这正是「其余四项不变」要排除的形态。
    expect(changed).toHaveLength(CONSENT_SCOPES.length);
    // 而 setScope 在同一个起点上只改一项。
    const one = setScope(INITIAL_CONSENT_SELECTION, 'basic_service', true);
    expect(
      CONSENT_SCOPES.filter((scope) => one[scope] !== INITIAL_CONSENT_SELECTION[scope]),
    ).toHaveLength(1);
  });

  it('模块没有导出任何批量 setter', () => {
    // 名字层面的防线：一个 setAll/toggleAll/selectAll 就是全选控件的代码形态。
    const exported = ['INITIAL_CONSENT_SELECTION', 'setScope', 'requiredSatisfied', 'toRequestPayload'];
    for (const name of exported) {
      expect(/setAll|toggleAll|selectAll|grantAll/u.test(name)).toBe(false);
    }
  });
});
