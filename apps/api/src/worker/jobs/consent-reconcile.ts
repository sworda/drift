// 残缺账号的日对账（T-09-02 / RESEARCH §6.1 检查 ②）。
//
// 判据一句话：**每个 user 必须恰好有 CONSENT_SCOPES.length 行 consent**。
// 不等即告警。
//
// ── 为什么需要它，既然注册已经是单事务 ──────────────────────────────────────
// 事务保证的是「注册这条路径不会产生残缺账号」。它保证不了别的路径：一次手工
// INSERT、一次半路失败的数据迁移、将来某个 plan 新增的第二条建号入口。而残缺账号的
// 危险恰恰在于**它看起来完全正常** —— 在「缺失视为未授权」的读取逻辑下，一个缺同意行
// 的账号既可以读成「必选项未授权、应当拒绝服务」，也可以读成「还没走完 onboarding」。
// 没有这条对账，它可以在库里躺很久。
//
// ── 告警载荷里没有 userId（T-09-03 同一条理由）────────────────────────────
// 只有三个整数与一个布尔。列出「哪些用户缺同意」在排障时确实更方便，但那会让一条
// 日常告警变成一份用户名单，而告警是会被转发、会被截图、会留在 IM 历史里的东西。
// 要查是谁，去库里查 —— 那条路径有访问控制。
//
// ── 为什么本文件零 env 依赖 ──────────────────────────────────────────────────
// 不 import config/env.ts 也不 import obs/logger.ts（后者 import 前者）。env.ts 在模块
// 加载时校验环境变量并 exit 1，于是任何 import 它的模块都无法在不带凭据的 L4 契约测试
// 进程里被加载。执行器与观察点都从参数进来（与 contact-attempt-timeout.ts 同一手法）。

import { sql } from 'drizzle-orm';

import { CONSENT_SCOPES } from '@drift/contract';
import { consent, type Executor, user } from '@drift/db';

import type { PgBoss } from 'pg-boss';

/** pg-boss 队列名，同时是 schedule 名。 */
export const CONSENT_RECONCILE_QUEUE = 'consent-reconcile';

/** 18:15 UTC = 次日 02:15 Asia/Shanghai。错开 publicness-reconcile 的 18:30。 */
export const CONSENT_RECONCILE_CRON = '15 18 * * *';

/**
 * 每个用户应有的同意行数。
 *
 * **从 CONSENT_SCOPES 派生**，不写字面量 5：Phase 7 加入 L2 人工阅读授权时，这个数会
 * 自己跟着变。写死 5 的后果是那一天全库每个用户都触发一次告警，而真正的问题（历史
 * 用户没有新 scope 的行）会被淹没在一条说错了原因的告警里。
 */
export const CONSENT_ROWS_PER_USER = CONSENT_SCOPES.length;

/** 对账结果。三个整数 + 一个判定，没有任何可以塞进用户标识的位置。 */
export interface ConsentReconcileReport {
  readonly users: number;
  readonly consents: number;
  /** users × CONSENT_ROWS_PER_USER。 */
  readonly expected: number;
  readonly matches: boolean;
}

/** 跑一次对账。纯读，不写任何表 —— 它的职责是发现，不是修复。 */
export async function reconcileConsentRows(executor: Executor): Promise<ConsentReconcileReport> {
  const [userRow] = await executor.select({ n: sql<number>`count(*)::int` }).from(user);
  const [consentRow] = await executor.select({ n: sql<number>`count(*)::int` }).from(consent);
  const users = userRow?.n ?? 0;
  const consents = consentRow?.n ?? 0;
  const expected = users * CONSENT_ROWS_PER_USER;
  return { users, consents, expected, matches: consents === expected };
}

export interface ConsentReconcileDeps {
  readonly executor: Executor;
  /** 观察点。日志由调用方按白名单字段记 —— 本模块不 import logger。 */
  readonly onReport: (report: ConsentReconcileReport) => void;
}

export async function registerConsentReconcile(
  boss: PgBoss,
  deps: ConsentReconcileDeps,
): Promise<void> {
  await boss.createQueue(CONSENT_RECONCILE_QUEUE);
  await boss.work<null>(CONSENT_RECONCILE_QUEUE, async () => {
    deps.onReport(await reconcileConsentRows(deps.executor));
  });
  await boss.schedule(CONSENT_RECONCILE_QUEUE, CONSENT_RECONCILE_CRON, null, {
    tz: 'Asia/Shanghai',
    // 停机期间错过的那些不补发：对账是幂等的日快照，补发 N 次只会发 N 条一样的告警。
    missed: 'skip',
  });
}
