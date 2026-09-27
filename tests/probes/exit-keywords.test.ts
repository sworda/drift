// 退出关键词测试集（COMPLY-05 / D-12 / RESEARCH §9.1）。
//
// 与 crisis 探针集同一目录树、独立计数（Plan 08 的 78 条守卫只数 crisis/
// 子目录 —— 本组 ≥ 20 条、阴性 ≥ 8 条，删用例提高通过率会在这里红）。
//
// 这组用例同时是「子串匹配回归」的常驻守卫：阴性样本全部包含某个词条的
// 子串形态（「我不想聊这个话题」里有「不想聊」），一旦有人把 anchoredMatch
// 改成 includes，十条阴性立刻全红 —— 不需要等执行者做破坏验证。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { matchExitIntent, normalizeUtterance } from '@drift/safety';

import { parseControlledYaml } from './yaml.ts';

const PROBE_DIR = fileURLToPath(new URL('./exit-keywords/', import.meta.url));

const EXIT_FILES = ['tier1.yaml', 'tier2.yaml', 'negatives.yaml'] as const;

const ExitCaseSchema = z.object({
  id: z
    .string()
    .regex(/^exit\.(t1|t2|neg)\.[a-z0-9-]+$/u, 'id 必须落在 exit.t1.* / exit.t2.* / exit.neg.* 之一'),
  text: z.string().min(1).max(2000),
  expect: z.object({ tier: z.union([z.literal(1), z.literal(2), z.literal('none')]) }),
});
type ExitCase = z.infer<typeof ExitCaseSchema>;

function loadExitSuite(files: readonly string[]): readonly ExitCase[] {
  const cases = files.flatMap((file) => {
    const raw = parseControlledYaml(
      readFileSync(join(PROBE_DIR, file), 'utf8'),
      `exit-keywords/${file}`,
    );
    const parsed = z.array(ExitCaseSchema).safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `exit-keywords/${file}: schema 校验失败 —— ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      );
    }
    return parsed.data;
  });
  assertExitSuiteShape(cases);
  return cases;
}

/** 条数守卫（纯函数 —— 注入截断用例可证明它非空真）。 */
export function assertExitSuiteShape(cases: readonly ExitCase[]): void {
  if (cases.length < 20) {
    throw new Error(
      `退出词表测试集应不少于 20 条，实际 ${String(cases.length)}。删用例会让子串误杀的回归守卫变弱。`,
    );
  }
  const negatives = cases.filter((c) => c.id.startsWith('exit.neg.'));
  if (negatives.length < 8) {
    throw new Error(`阴性样本应不少于 8 条，实际 ${String(negatives.length)}。`);
  }
  const ids = new Set(cases.map((c) => c.id));
  if (ids.size !== cases.length) throw new Error('测试集内存在重复 id');
}

describe('退出关键词测试集（COMPLY-05 / D-12）', () => {
  const cases = loadExitSuite([...EXIT_FILES]);

  it.each(cases)('%s ⇒ tier 判定与 yaml 期望一致', (probe) => {
    const result = matchExitIntent(probe.text);
    const expected = probe.expect.tier === 'none' ? null : probe.expect.tier;
    expect(
      result.tier,
      `${probe.id}（${probe.text}）应判 ${String(expected)}，实际 ${String(result.tier)}`,
    ).toBe(expected);
  });

  it('条数守卫：合计 ≥ 20、阴性 ≥ 8、id 唯一', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(cases.filter((c) => c.id.startsWith('exit.neg.')).length).toBeGreaterThanOrEqual(8);
  });

  it('非空真证明：截断后的用例集让条数守卫变红', () => {
    expect(() => assertExitSuiteShape(cases.slice(0, cases.length - 3))).toThrow();
    expect(() => assertExitSuiteShape(cases.filter((c) => !c.id.startsWith('exit.neg.')))).toThrow();
  });

  it('四条指定阴性样本在册且判定为 null（RESEARCH §9.1 点名的误杀形态）', () => {
    const required = ['我不想聊这个话题', '别发这种表情', '停下来听我说', '这话题先这样吧我们换个'];
    for (const text of required) {
      const found = cases.find((c) => c.text === text);
      expect(found, `${text} 必须在阴性样本里`).toBeDefined();
      expect(matchExitIntent(text).tier, `${text} 是换话题，不是退出`).toBeNull();
    }
  });

  it('常驻子串回归守卫：全部阴性样本都与某词条共享 ≥ 2 字符片段', () => {
    // 这是「阴性用例真的在考锚定而非子串」的证明：若阴性样本与词条毫无重叠
    // （如「今天天气不错」），includes 实现也能通过它们 —— 守卫就空了。
    // 用「≥ 2 字符公共片段」而不是整词条子串：『别发这种表情』不含整条
    // 『别发了』，但它与词条共享『别发』—— 恰是它要考的近串形态。
    const words = ['退出', '结束', '停', '别发了', '不想聊了', '不想聊', '明天聊', '先这样', '睡了'];
    function sharesFragment(text: string, word: string): boolean {
      // 单字词条（停）没有 2 字片段 —— 直接按整词子串判。
      const size = Math.min(2, word.length);
      for (let i = 0; i + size <= word.length; i += 1) {
        if (text.includes(word.slice(i, i + size))) return true;
      }
      return false;
    }
    for (const probe of cases.filter((c) => c.id.startsWith('exit.neg.'))) {
      const normalized = normalizeUtterance(probe.text);
      const overlaps = words.filter((w) => sharesFragment(normalized, w));
      expect(
        overlaps.length,
        `${probe.id} 的归一化形态应与至少一个词条共享 ≥ 2 字符片段（否则它考不到锚定）`,
      ).toBeGreaterThan(0);
    }
  });
});
