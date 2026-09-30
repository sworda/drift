// EGRESS_POINTS 的规范化 sha256 —— COMPLY-11 登记与出口集合之间的机械绑定（D-21）。
//
// 为什么需要一个哈希：compliance/no-unlabeled-output.md 登记的结论是「Phase 1 所有对外
// 提供路径都带标识，故《标识办法》第九条的留存义务对象为空集」。这个结论只在**当时的
// 出口集合**上成立。出口集合变了而那份登记没被重读，结论就从「已核实」退化成「曾经
// 核实过」—— 而没有任何人会注意到这次退化。哈希把「出口变了就要重新确认无未标识
// 输出」变成一次会失败的检查。
//
// ⚠️ **本脚本不写文件。** 自动更新 egress_hash 会绕过那次人工复核动作，把 COMPLY-11
// 的登记变成装饰：CI 自己把哈希改对了，于是「有人重新读过这份登记吗」这个问题永远
// 答不出来。egress-registry.test.ts 有一条断言守着这一点：本文件的源码里不得出现任何
// fs 写入 API 的名字（断言里列的就是那几个名字，这里刻意不重复写出来 —— 写出来会让
// 那条 grep 断言被自己的注释命中）。
//
// ⚠️ **算法只有这一份实现。** fast.yml 跑 --check，人工更新登记跑 --print，vitest 里的
// 绑定断言用 spawn 驱动同一个 CLI。第二份实现会分叉，分叉之后哈希守的就不是真的出口
// 集合。
//
// 注册表由 Node 的类型擦除直接 import（packages/safety/src/egress.ts 因此刻意零依赖）。

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { EGRESS_POINTS } from '../../packages/safety/src/egress.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** COMPLY-11 的登记文件。front-matter 的 egress_hash 是本脚本的比对对象。 */
export const REGISTRY_DOC = 'compliance/no-unlabeled-output.md';

export const HASH_MISMATCH_MESSAGE =
  '出口集合已变更但 compliance/no-unlabeled-output.md 未重新复核 —— 请复核该登记并用 node tools/ci/egress-hash.mjs --print 更新 egress_hash';

/**
 * @typedef {{ id: string, module: string, fn: string, carriesUserText?: boolean }} EgressPointLike
 */

/**
 * 规范化：按 id 排序、每项只取四个键、键按固定顺序、无空白 JSON。
 *
 * carriesUserText 省略时显式补 true，而不是省略该键：否则同一份出口集合写成
 * carriesUserText: true 与省略两种形态会得到两个不同的哈希，于是一次纯格式改动就会
 * 要求一次人工复核 —— 而无意义的红是这条检查最终被关掉的原因。
 *
 * @param {readonly EgressPointLike[]} points
 */
export function normalizeEgressPoints(points) {
  return [...points]
    .map((point) => ({
      id: point.id,
      module: point.module,
      fn: point.fn,
      carriesUserText: point.carriesUserText ?? true,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 返回 sha256:<hex>。
 *
 * @param {readonly EgressPointLike[]} [points]
 * @returns {string}
 */
export function computeEgressHash(points = EGRESS_POINTS) {
  const canonical = JSON.stringify(normalizeEgressPoints(points));
  return 'sha256:' + createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * 从登记文件的 front-matter 里读 egress_hash。缺失即抛错 —— 不静默当成通过。
 *
 * @param {string} [docPath]
 * @returns {string}
 */
export function readRegisteredHash(docPath = path.join(REPO_ROOT, REGISTRY_DOC)) {
  const source = readFileSync(docPath, 'utf8');
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(source);
  if (frontMatter === null) {
    throw new Error(REGISTRY_DOC + ' 没有 front-matter —— COMPLY-11 的登记与出口集合失去绑定');
  }
  const hash = /^egress_hash:\s*(\S+)\s*$/mu.exec(frontMatter[1]);
  if (hash === null) {
    throw new Error(REGISTRY_DOC + ' 的 front-matter 缺少 egress_hash —— ' + HASH_MISMATCH_MESSAGE);
  }
  return hash[1];
}

/**
 * 比对。expected 省略时从登记文件读，points 省略时用真实注册表。
 *
 * 两个参数都可注入，是为了让「给注册表加一项而不改哈希会红」这件事能写成一条测试内
 * 注入的用例，而不是一次执行器手里的临时改文件。
 *
 * @param {{ points?: readonly EgressPointLike[], expected?: string }} [options]
 * @returns {{ ok: boolean, actual: string, expected: string, message: string }}
 */
export function checkEgressHash({ points = EGRESS_POINTS, expected } = {}) {
  const actual = computeEgressHash(points);
  const target = expected ?? readRegisteredHash();
  const ok = actual === target;
  return {
    ok,
    actual,
    expected: target,
    message: ok
      ? 'egress_hash 一致：' + actual
      : HASH_MISMATCH_MESSAGE + '\n  登记值：' + target + '\n  实际值：' + actual,
  };
}

function main(argv) {
  const [flag, value] = argv;
  if (flag === '--print') {
    process.stdout.write(computeEgressHash() + '\n');
    return 0;
  }
  if (flag === '--check') {
    const result = checkEgressHash(value === undefined ? {} : { expected: value });
    if (result.ok) {
      process.stdout.write(result.message + '\n');
      return 0;
    }
    process.stderr.write(result.message + '\n');
    return 1;
  }
  process.stderr.write('用法：node tools/ci/egress-hash.mjs --print | --check [expected]\n');
  return 2;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
