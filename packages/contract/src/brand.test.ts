import { describe, expect, it } from 'vitest';

import * as contract from './index.js';
import * as brand from './brand.js';

/**
 * L3 单元层：品牌类型在运行时必须是**空的**。
 *
 * GatedText / SyntheticText 的全部约束力来自编译期；一旦 packages/contract 导出了
 * 任何能把 string 提升为品牌类型的值（工厂函数、断言 helper、常量），
 * 「packages/safety 是 GatedText 的唯一产出者」这条包边界就在零报错的情况下失效。
 * 这条断言与 tools/ci/type-fixtures 的编译期负向 fixture 是同一条防线的两端。
 */
describe('@drift/contract 的品牌类型在运行时不可构造', () => {
  it('包入口不导出任何运行时值', () => {
    expect(Object.keys(contract)).toEqual([]);
  });

  it('brand.ts 不导出任何函数', () => {
    const functions = Object.entries(brand).filter(([, value]) => typeof value === 'function');
    expect(functions).toEqual([]);
  });
});
