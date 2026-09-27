// registered_users 日对账的 CI 入口（COMPLY-10 / D-23，RESEARCH §10.2）。
//
// 真相源在 git，现实在数据库。**对账方向是告警，不是自动写回。** 本脚本因此没有任何写
// 文件能力，也不动版本库 —— 自动写回会绕过 D-08 的签字机制，把公开性门禁变成装饰：脚本
// 自己把数字改对了，于是「有人重新逐条裁决过那六条合规条目吗」这个问题永远答不出来。
// tools/ci/compliance-docs.test.ts 有一条断言守着这一点。
//
// 判定与实现只有一份：对账逻辑、载荷渲染、投递全部来自
// apps/api/src/worker/jobs/publicness-reconcile.ts（那里也是 pg-boss schedule 的登记处）。
// 第二份实现会分叉，分叉之后 nightly 告警的内容与运行时作业发出的就不是一回事。
//
// 用法：
//   node tools/ci/publicness-reconcile.mjs              连库对账，需要 DATABASE_URL；
//                                                       不相等或超上限时发 IM 告警并非零退出
//   node tools/ci/publicness-reconcile.mjs --dry-run    只判定、不投递
//   node tools/ci/publicness-reconcile.mjs --actual 7   注入实际计数（不连库，用于验证判定）

import { pathToFileURL } from 'node:url';

import {
  REGISTERED_USERS_CAP,
  buildReconcileReport,
  deliverReconcileAlert,
  needsAlert,
  renderReconcileContent,
} from '../../apps/api/src/worker/jobs/publicness-reconcile.ts';
import { readPublicness } from './publicness.mjs';

/** invite_code 中 used_by 非空的计数 —— COMPLY-10 的「注册用户数」唯一可信来源（D-23）。 */
export const COUNT_SQL = 'select count(*)::int as used from invite_code where used_by is not null';

/**
 * git 内声明的 registered_users。
 *
 * @returns {number}
 */
export function readDeclaredUsers() {
  const declared = readPublicness()['registered_users'];
  if (typeof declared !== 'number' || !Number.isInteger(declared)) {
    throw new Error(
      'compliance/publicness.json 的 registered_users 不是整数：' + String(declared),
    );
  }
  return declared;
}

/**
 * 数据库侧计数。
 *
 * @param {string} databaseUrl
 * @returns {Promise<number>}
 */
export async function countUsedInviteCodes(databaseUrl) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const rows = await sql.unsafe(COUNT_SQL);
    const used = rows[0]?.['used'];
    if (typeof used !== 'number') {
      throw new Error('invite_code 计数返回了非数字：' + String(used));
    }
    return used;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * 一次对账判定的可打印形态。
 *
 * @param {{ declared: number, actual: number, basis: string }} input
 * @returns {{ report: ReturnType<typeof buildReconcileReport>, lines: string[], exitCode: number }}
 */
export function describeReconcile({ declared, actual, basis }) {
  const report = buildReconcileReport(declared, actual);
  /** @type {string[]} */
  const lines = [];
  const suffix = '（实际计数来源：' + basis + '）';
  if (report.matches && report.withinCap) {
    lines.push(
      'OK registered_users reconciled：声明 ' +
        String(report.declared) +
        ' = 实际 ' +
        String(report.actual) +
        suffix,
    );
    return { report, lines, exitCode: 0 };
  }
  if (!report.matches) {
    lines.push(
      'MISMATCH registered_users：声明 ' +
        String(report.declared) +
        ' ≠ 实际 ' +
        String(report.actual) +
        suffix +
        ' —— 请核实后**人工**更新 compliance/publicness.json 并新增一份逐条裁决的 CHECKLIST',
    );
  }
  if (!report.withinCap) {
    lines.push(
      'OVER_CAP registered_users：实际 ' +
        String(report.actual) +
        ' 超过上限 ' +
        String(REGISTERED_USERS_CAP) +
        ' —— 下一次 CI 由 USERS_WITHIN_CAP 阻断发布',
    );
  }
  return { report, lines, exitCode: 1 };
}

/** @param {readonly string[]} argv */
async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const actualFlag = argv.indexOf('--actual');
  const declared = readDeclaredUsers();

  /** @type {number} */
  let actual;
  /** @type {string} */
  let basis;

  if (actualFlag >= 0) {
    const raw = argv[actualFlag + 1];
    const parsed = Number(raw);
    if (raw === undefined || !Number.isInteger(parsed) || parsed < 0) {
      process.stderr.write('--actual 需要一个非负整数\n');
      return 2;
    }
    actual = parsed;
    basis = '--actual 注入';
  } else {
    const databaseUrl = process.env['DATABASE_URL'];
    if (databaseUrl === undefined || databaseUrl.length === 0) {
      if (!dryRun) {
        process.stderr.write(
          'FAIL 缺少 DATABASE_URL —— 连库对账无法进行。不连库就没有「现实」这一侧，判定会退化成拿声明值与自己比\n',
        );
        return 1;
      }
      // --dry-run 且没有库：如实说明实际计数取的是声明值，于是这一次判定必然相等。这不是
      // 一次真的对账 —— 它验证的是判定逻辑与输出形态；真的对账在 nightly（带 DATABASE_URL）。
      actual = declared;
      basis = '未连库（DATABASE_URL 未设置），退回声明值 —— 本次不构成真实对账';
    } else {
      actual = await countUsedInviteCodes(databaseUrl);
      basis = 'invite_code 中 used_by 非空的计数';
    }
  }

  const { report, lines, exitCode } = describeReconcile({ declared, actual, basis });
  for (const line of lines) {
    process.stdout.write(line + '\n');
  }

  if (!needsAlert(report)) return exitCode;

  if (dryRun) {
    process.stdout.write('DRY-RUN 未投递告警。告警正文将是：\n');
    for (const line of renderReconcileContent(report).split('\n')) {
      process.stdout.write('    ' + line + '\n');
    }
    return exitCode;
  }

  const webhookUrl = process.env['WECOM_WEBHOOK_URL'];
  if (webhookUrl === undefined || webhookUrl.length === 0) {
    process.stderr.write(
      'FAIL 对账不通过但 WECOM_WEBHOOK_URL 未配置，告警未发出 —— 静默不投递比不对账更糟\n',
    );
    return 1;
  }
  const delivery = await deliverReconcileAlert(report, { webhookUrl });
  if (delivery.delivered) {
    process.stdout.write('已投递 IM 告警（HTTP ' + String(delivery.httpStatus) + '）\n');
  } else {
    process.stderr.write(
      'FAIL IM 告警投递失败：' +
        delivery.reason +
        '（HTTP ' +
        String(delivery.httpStatus) +
        '，errcode ' +
        String(delivery.errcode) +
        '）\n',
    );
  }
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
