import { describe, expect, it } from 'vitest';

import * as brand from './brand.ts';
import * as contract from './index.ts';

/**
 * L3 单元层：品牌类型在运行时必须**无法被构造**。
 *
 * GatedText / SyntheticText 的全部约束力来自编译期；一旦 packages/contract 导出了
 * 任何能把 string 提升为品牌类型的值（工厂函数、断言 helper、常量），
 * 「packages/safety 是 GatedText 的唯一产出者」这条包边界就在零报错的情况下失效。
 * 这条断言与 tools/ci/type-fixtures 的编译期负向 fixture 是同一条防线的两端。
 *
 * ⚠️ 本文件原先断言「包入口不导出任何运行时值」。Plan 04 之后那条断言不再成立也
 * 不再正确：contract 现在合法地导出 zod envelope、事件 topic 与 AI 标识文案常量
 * （它们**必须**在这里，因为跨端唯一真相源就是这个包）。直接删掉那条断言会让整条
 * 防线只剩编译期一端，所以改成下面两条更窄但仍然非空真的形式：
 *   1. brand.ts 在运行时完全是空的；
 *   2. 包入口导出的**函数**必须在允许清单里 —— 新增任何函数都会让这条变红，
 *      从而强迫作者回答「它会不会产出一个品牌类型」。
 */

/**
 * 允许出现在 @drift/contract 运行时出口的函数。
 * 新增一项的门槛：它不得返回（也不得能被用来构造）GatedText / SyntheticText。
 */
const ALLOWED_RUNTIME_FUNCTIONS = [
  'isWsTopic',
  // Plan 09：前两个返回 boolean，第三个返回一段界面文案 —— 三者都不返回也无法
  // 用来构造任何品牌类型（GatedText 的唯一产出点在 packages/safety）。
  'isRequiredScope',
  'isValidContactPhone',
  'revokeConfirmationCopy',
  'isAdult',
] as const;

describe('@drift/contract 的品牌类型在运行时不可构造', () => {
  it('brand.ts 在运行时完全是空的', () => {
    // 品牌类型文件里只允许有 declare const 与 type —— 两者都不会留下运行时痕迹。
    expect(Object.keys(brand)).toEqual([]);
  });

  it('包入口导出的函数都在允许清单里', () => {
    const functions = Object.entries(contract)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    expect(functions).toEqual([...ALLOWED_RUNTIME_FUNCTIONS].sort());
  });

  it('包入口没有任何名字暗示品牌构造的导出', () => {
    const suspicious = Object.keys(contract).filter((name) =>
      /gated|synthetic|asBrand|brand/i.test(name),
    );
    expect(suspicious, `可疑导出：${suspicious.join(', ')}`).toEqual([]);
  });
});
