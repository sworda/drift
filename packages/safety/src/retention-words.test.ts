// 挽留词表的单元测试（L3）。
//
// 七个词各一条阳性用例 + 三条阴性用例是 UI-SPEC〔禁用〕规则 2 的最小充分覆盖：
// 少一个阳性用例，那个词就可以被从词表里删掉而没有任何检查变红；少了阴性用例，
// 一个恒返回全部词的实现也会全绿。

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  RETENTION_PHRASES,
  hitsRetentionPhrase,
  normalizeForRetentionMatch,
} from './retention-words.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('RETENTION_PHRASES（UI-SPEC〔禁用〕规则 2）', () => {
  it('逐字等于契约里的七个词', () => {
    expect([...RETENTION_PHRASES]).toEqual([
      '别走',
      '再陪我',
      '再聊一会',
      '你要离开我了吗',
      '我会想你的',
      '确定要离开吗',
      '不要走',
    ]);
  });

  it('全仓库只有一处定义（复制成第二份之后两处会分叉，而分叉那天不会有检查变红）', () => {
    // 只数**定义**：测试文件里当然会出现这些词，它们不是第二份词表。
    const grep = spawnSync(
      'grep',
      ['-rln', '别走', 'packages', 'apps', '--include=*.ts', '--include=*.tsx'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    const files = (grep.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.includes('/dist/'))
      .filter((line) => !line.endsWith('.test.ts') && !line.endsWith('.test.tsx'));
    expect(files, `挽留词表出现在多处：\n${files.join('\\n')}`).toEqual([
      'packages/safety/src/retention-words.ts',
    ]);
  });
});

describe('hitsRetentionPhrase', () => {
  for (const phrase of RETENTION_PHRASES) {
    it(`拦截「${phrase}」`, () => {
      expect(hitsRetentionPhrase(`你先别急，${phrase}好不好`)).toContain(phrase);
    });
  }

  // 阴性：这三条不是挽留语义，拦下它们会让角色变成一个动不动就不说话的东西。
  it.each([
    ['走', '他站起来走了'],
    ['聊一会天气', '我们刚刚聊一会天气'],
    ['你要离开公司了吗', '所以你要离开公司了吗'],
  ])('不误拦「%s」', (_label, text) => {
    expect(hitsRetentionPhrase(text)).toEqual([]);
  });

  it('空白、零宽字符与标点的插入不能躲过匹配（触发率恒为 0 而不是低）', () => {
    // 用 RETENTION_PHRASES 取词而不是再写一遍字面量：字面量重复会让「全仓只有一处
    // 定义」那条 grep 断言越来越难读，而这里要的只是「变形体也命中」。
    const first = RETENTION_PHRASES[0];
    expect(hitsRetentionPhrase('别 走')).toContain(first);
    expect(hitsRetentionPhrase('别，走')).toContain(first);
    expect(hitsRetentionPhrase('别\u200b走')).toContain(first);
    expect(hitsRetentionPhrase('我　会想你的')).toContain('我会想你的');
  });

  it('归一化把全角 ASCII 转半角并去掉标点，但不动中文字形', () => {
    expect(normalizeForRetentionMatch('ＡＢ，ｃ')).toBe('abc');
    expect(normalizeForRetentionMatch(RETENTION_PHRASES[0])).toBe(RETENTION_PHRASES[0]);
  });

  it('无命中时返回空数组（不是 null，也不是全部词）', () => {
    expect(hitsRetentionPhrase('今天天气不错。')).toEqual([]);
  });

  it('本包的词表文件不含任何 import —— 它是 Plan 10 源码 grep 与本处运行时断言的共同真相源', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./retention-words.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toContain('from \'@drift/');
  });
});
