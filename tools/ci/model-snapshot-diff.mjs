// resolved_model 的日 diff 告警（RESEARCH § Validation Architecture V.2 / Q4 的补偿措施）。
//
// ── 为什么需要它 ──────────────────────────────────────────────────────────────
// 厂商可以在不改 model id 的前提下把它背后的快照换掉，而 Anthropic 在官方文档里
// **书面承认**：即使权重一字未改，服务侧基础设施（请求路由器、安全分类器、采样
// 逻辑）的变更仍可能改变可观测行为。这类变化的频率未知（≥月级）、且不会让任何
// 测试变红。V.2 的采样论证因此要求「每次调用落 resolved_model + 每日 diff」——
// 连续采样对一个频率未知的信号是唯一诚实的做法。
//
// 本项目的 safety.classify 跑在一个**不可 pin**（alias-only）的模型上（Q4 的裁决），
// 所以这条告警不是可选的加固：它是那次裁决的成立条件。
//
// ── 三条刻意的设计约束 ────────────────────────────────────────────────────────
//  1. **本脚本不修改基线文件。** 更新基线必须是一次人工 commit。自动更新会让告警
//     自我消解 —— 第二天它就「没有变化」了，而模型已经换了。门禁变成装饰的标准
//     路径就是这一条。
//  2. **缺少判定条件时非零退出，不跳过。** 一条「条件不满足就当通过」的检查与一条
//     不存在的检查没有区别，区别只在于前者让 CI 一直是绿的。
//  3. **`--self-test` 的正确结果是非零退出。** 它喂一个人造的「出现新模型」输入，
//     证明这条告警在被违反时真的会失败。没有负向 fixture 的 tripwire 比没有更糟：
//     它提供虚假的安全感。
//
// 用法：
//   node tools/ci/model-snapshot-diff.mjs              # 连库，比对最近 24 小时
//   node tools/ci/model-snapshot-diff.mjs --dry-run    # 不连库，只校验基线文件格式
//   node tools/ci/model-snapshot-diff.mjs --self-test   # 负向 fixture，正确结果是非零

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASELINE_PATH = fileURLToPath(
  new URL('../../compliance/model-snapshot-baseline.json', import.meta.url),
);
const BASELINE_RELATIVE = 'compliance/model-snapshot-baseline.json';

const flags = new Set(process.argv.slice(2));
const DRY_RUN = flags.has('--dry-run');
const SELF_TEST = flags.has('--self-test');

function fail(lines) {
  for (const line of lines) process.stderr.write(`${line}\n`);
  process.exit(1);
}

/**
 * 读并校验基线。
 *
 * ⚠️ purpose 的取值域**不在这里重复一遍**：它的真相源是
 * packages/db/src/schema/audit.ts 的 LLM_PURPOSES（同时也是 llm_call 的 CHECK 约束）。
 * 在一个 CI 脚本里抄一份会立刻产生第二个真相源，而它的分叉没有任何检查会发现。
 * 所以这里只校验结构，不校验键名属于哪个枚举。
 */
function loadBaseline() {
  let text;
  try {
    text = readFileSync(BASELINE_PATH, 'utf8');
  } catch (error) {
    fail([
      `model-snapshot-diff: 读不到基线文件 ${BASELINE_RELATIVE}`,
      `  ${error instanceof Error ? error.message : String(error)}`,
      '  基线缺失时本脚本非零退出而不是跳过：没有基线就没有「变化」的定义。',
    ]);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail([
      `model-snapshot-diff: ${BASELINE_RELATIVE} 不是合法 JSON`,
      `  ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  const purposes = parsed?.purposes;
  if (typeof purposes !== 'object' || purposes === null || Array.isArray(purposes)) {
    fail([`model-snapshot-diff: ${BASELINE_RELATIVE} 缺少对象字段 "purposes"`]);
  }
  const entries = Object.entries(purposes);
  if (entries.length === 0) {
    fail([
      `model-snapshot-diff: ${BASELINE_RELATIVE} 的 purposes 为空 —— 空基线会让任何实际取值都成为「新值」或都不成为，取决于比较方向。`,
    ]);
  }
  const baseline = new Map();
  for (const [purpose, models] of entries) {
    if (!Array.isArray(models) || models.length === 0) {
      fail([`model-snapshot-diff: purposes["${purpose}"] 必须是非空数组`]);
    }
    for (const model of models) {
      if (typeof model !== 'string' || model.length === 0) {
        fail([`model-snapshot-diff: purposes["${purpose}"] 里有一个空的或非字符串的模型标识`]);
      }
    }
    baseline.set(purpose, new Set(models));
  }
  return baseline;
}

/**
 * 比较：出现任一 purpose 的**新** resolved_model 即漂移。
 *
 * 注意方向：基线里有、观测里没有**不是**漂移 —— 某个角色 24 小时内没被调用是正常的。
 * 反过来，观测里有、基线里没有一定是漂移，包括「这个 purpose 整个不在基线里」
 * （新角色上线时它的实际模型同样需要一次人工确认）。
 */
function diff(baseline, observed) {
  const drifts = [];
  for (const [purpose, models] of observed) {
    const known = baseline.get(purpose);
    for (const model of models) {
      if (known === undefined) {
        drifts.push({ purpose, model, reason: 'purpose 不在基线里' });
      } else if (!known.has(model)) {
        drifts.push({ purpose, model, reason: '基线里没有这个 resolved_model' });
      }
    }
  }
  return drifts;
}

function reportDrift(drifts, baseline) {
  for (const drift of drifts) {
    const known = [...(baseline.get(drift.purpose) ?? [])].join(', ');
    process.stdout.write(
      `DRIFT purpose=${drift.purpose} resolved_model=${drift.model} —— ${drift.reason}（基线：${known || '无'}）\n`,
    );
  }
  process.stdout.write(
    `DRIFT 共 ${String(drifts.length)} 项。厂商可能已把同一个 model id 背后的快照换掉 —— 对照组的可比性从此刻起已经断了。\n` +
      `确认之后**人工**修改 ${BASELINE_RELATIVE} 并作为一次 commit 提交；本脚本不会自己改它（自动更新会让告警自我消解）。\n`,
  );
}

async function observeFromDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    fail([
      'model-snapshot-diff: DATABASE_URL 未设置 —— 无法读取最近 24 小时的 llm_call。',
      '  缺少判定条件时非零退出而不是跳过：一条「连不上库就当通过」的告警等于不存在。',
    ]);
  }
  // postgres.js 已是仓库依赖（packages/db 用它）。**动态** import：--dry-run 与
  // --self-test 两条路径因此完全不依赖任何 npm 包，也不需要一个可连的数据库。
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    const rows = await sql`
      select purpose, coalesce(resolved_model, '<null>') as resolved_model, count(*)::int as n
      from llm_call
      where created_at >= now() - interval '24 hours'
      group by 1, 2
      order by 1, 2
    `;
    const observed = new Map();
    for (const row of rows) {
      const models = observed.get(row.purpose) ?? new Set();
      models.add(row.resolved_model);
      observed.set(row.purpose, models);
    }
    return observed;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const baseline = loadBaseline();

if (SELF_TEST) {
  // 负向 fixture：人造一个「某个 purpose 出现了基线里没有的 resolved_model」。
  const [purpose, known] = [...baseline.entries()][0];
  const injected = `${[...known][0]}-selftest-new-snapshot`;
  const positive = diff(baseline, new Map([[purpose, new Set([injected])]]));
  // 反方向同样要检查：把基线里的值原样喂回去必须**不**报漂移，否则这条告警
  // 会天天响，而天天响的告警等于被忽略的告警。
  const negative = diff(baseline, new Map([[purpose, new Set([...known])]]));

  if (positive.length === 0) {
    process.stdout.write(
      `SELF-TEST BROKEN: 人造的新模型 ${injected} 没有被判成漂移 —— 这条日 diff 告警是空真的。\n`,
    );
    process.exit(2);
  }
  if (negative.length > 0) {
    process.stdout.write(
      'SELF-TEST BROKEN: 基线里的既有取值被判成了漂移 —— 告警会天天响，而天天响的告警等于被忽略的告警。\n',
    );
    process.exit(2);
  }
  reportDrift(positive, baseline);
  process.stdout.write(
    'SELF-TEST OK: 告警在被违反时真的会失败（非零退出即本开关的正确结果）。\n',
  );
  process.exit(1);
}

if (DRY_RUN) {
  process.stdout.write(
    `OK no model drift in last 24h（--dry-run：未连库，只校验了 ${BASELINE_RELATIVE} 的格式，共 ${String(baseline.size)} 个 purpose）\n`,
  );
  process.exit(0);
}

const observed = await observeFromDatabase();
if (observed.size === 0) {
  // 24 小时内一次调用都没有：这不是「通过」，也不是「漂移」。它是一个应该被看见的
  // 状态（nightly 在一个没人用的环境上跑），所以打印出来但不失败。
  process.stdout.write(
    'OK no model drift in last 24h（最近 24 小时没有任何 llm_call 行 —— 没有可比对的观测值）\n',
  );
  process.exit(0);
}

const drifts = diff(baseline, observed);
if (drifts.length > 0) {
  reportDrift(drifts, baseline);
  process.exit(1);
}

const summary = [...observed.entries()]
  .map(([purpose, models]) => `${purpose}=[${[...models].join(', ')}]`)
  .join(' ');
process.stdout.write(`OK no model drift in last 24h（观测到 ${summary}）\n`);
