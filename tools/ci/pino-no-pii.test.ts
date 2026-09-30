// pino 日志不含个人信息 —— 「设计上不含」的运行时证明（RESEARCH §2.3 / §7.1，
// STORAGE_LOCATIONS 里 pino.log 登记为 containsPersonalInfo: false 的兑现）。
//
// 本文件属 **integration** 层（L5）：完整 turn 需要真实 PostgreSQL。vitest.config.ts
// 把它从 contract 的 include 里排除、加进 integration 的 include。
//
// 手法：spawn 一个子进程（--experimental-transform-types，strip-only 模式对
// apps/api 的参数属性语法直接 SyntaxError —— 实测），里面跑一个真实 turn，pino
// 写到 stdout（fd 1 的 sonic-boom，同进程拦截不到，只能跨进程抓）。父进程对
// 全部输出断言：
//   1. 不含消息正文（特征串）的任何 ≥6 字子串 —— 「6 字」是 RESEARCH §7.1 的口径：
//      一个 6-gram 恰好长到不可能偶然出现在无关文本里，又短到拆词绕不过；
//   2. 不含 11 位连续数字（手机号格式）。
//
// 非空真证明（handout #28 的惯例）：对合成的坏输出跑同一个扫描函数，断言它**能**
// 抓到 —— 证明「没抓到」是真的检查过了，而不是空输出或恒等比较。

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CHILD = fileURLToPath(new URL('../../tests/integration/pino-turn-child.ts', import.meta.url));

/** 与子进程的导出逐字一致 —— 两份定义会漂移，这里钉住它。 */
const FEATURE = '企鹅量子薄荷糖纸鹤夹克旋涡标本';
const FAKE_PHONE = '19912345678';

/** 全部 ≥6 字滑窗子串（对 CJK，一个字就是一个码位）。 */
function sixGrams(text: string): readonly string[] {
  const grams: string[] = [];
  for (let i = 0; i + 6 <= [...text].length; i += 1) {
    grams.push([...text].slice(i, i + 6).join(''));
  }
  return grams;
}

/** 扫描：返回命中的泄漏子串 / 手机号（空数组 = 干净）。 */
function scanForPii(output: string, feature: string): readonly string[] {
  const hits: string[] = [];
  for (const gram of sixGrams(feature)) {
    if (output.includes(gram)) hits.push(gram);
  }
  if (/\d{11}/u.test(output)) hits.push('11 位连续数字');
  return hits;
}

/** 跑子进程，抓全部输出。退出码非 0 视为测试失败（turn 没跑成就谈不上断言）。 */
function runTurnChild(): { readonly stdout: string; readonly stderr: string } {
  const run = spawnSync(
    process.execPath,
    ['--experimental-transform-types', CHILD],
    {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, LOG_LEVEL: 'trace' },
    },
  );
  if (run.status !== 0) {
    throw new Error(
      `pino-turn-child 退出码 ${String(run.status)}：\n${run.stdout ?? ''}\n${run.stderr ?? ''}`,
    );
  }
  return { stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

describe('pino 日志不含个人信息（STORAGE_LOCATIONS 登记的运行时证明）', () => {
  it('一个完整 turn 的全部 pino 输出：无正文 6-gram、无 11 位手机号', () => {
    const { stdout, stderr } = runTurnChild();
    // 先证明真的抓到了日志 —— 空输出会让下面的断言变成恒绿。
    expect(stdout).toContain('"service":"drift-api"');
    expect(stdout).toContain('turn.completed');
    const hits = scanForPii(`${stdout}\n${stderr}`, FEATURE);
    expect(hits, `pino 输出泄漏了：${hits.join('、')}`).toEqual([]);
  });

  it('非空真：同一个扫描函数对坏输出（含特征串与手机号的合成行）能抓到', () => {
    const badOutput = '{"event":"evil.log","text":"' + FEATURE + ' ' + FAKE_PHONE + '"}';
    const hits = scanForPii(badOutput, FEATURE);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContain('11 位连续数字');
    // 而 6-gram 断言对单个汉字的噪声不误报（一枚字不会命中 6 字窗口）。
    expect(scanForPii('旋', FEATURE)).toEqual([]);
  });

  it('子进程脚本的特征串与这里的定义逐字一致（两份定义会漂移）', () => {
    // ⚠️ 不能 import 子进程脚本（它 import 即执行 turn 并 process.exit(0)，会把
    // 测试进程一起带走）—— 读源码文本比对字面量。
    const source = readFileSync(CHILD, 'utf8');
    expect(source).toContain("'企鹅量子薄荷糖纸鹤夹克旋涡标本'");
    expect(source).toContain("'19912345678'");
  });
});
