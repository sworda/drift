// 账号删除（PRIV-05 / D-19 / Q1）—— 入队端口 + worker 执行体 + 回执。
//
// ── 三条本文件必须诚实的事 ──────────────────────────────────────────────────
//   1. 回执的 N = purge 成功执行且 countsAsCleared 不为 false 的项数（D-19）。
//      「成功执行」包含影响 0 行的成功（幂等重跑、本来就空的位置）—— 口径是
//      「执行成功的项数」而不是「非空项数」，否则空账号的回执会谎报 0 处。
//   2. 审计表族的七项 countsAsCleared: false（Q1）—— 它们被执行（去标识化）、被
//      呈现（单列 + 「不计入上面的 N」）、但不计入 N。回执说清除而实际保留是
//      一次需要显式披露的事。
//   3. 部分失败不得四舍五入：任一项 ok=false ⇒ status='partial'，UI 禁止渲染
//      「已删除完成」，改渲染 M/N 分支与三个出路（重试 / 导出留副本 / 提交申诉）。
//
// ── 执行形态（RESEARCH §7.3 的落地）──────────────────────────────────────────
// 逐项 try/catch 而不是单事务：PG 里一条语句失败即 abort 整个事务，「单事务 + 逐项
// catch」在结构上不可表达。部分失败的诚实呈现（M/N）本来就要求已成功项不回滚 ——
// 半删除状态是 D-19 明文接受的中间态（重试出路就是为它存在的）。
//
// ── 零 env 依赖 ──────────────────────────────────────────────────────────────
// 本文件不 import config/env.ts 也不 import obs/logger.ts（后者 import 前者）——
// env.ts 在模块加载时校验环境变量并 exit 1，任何 import 它的模块都无法在不带
// 凭据的集成测试进程里被加载。执行器、目录与观察点都从参数进来（consent-reconcile
// 的同一手法）。

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { Db, PgBoss } from 'pg-boss';
import type postgres from 'postgres';

import { privacyAction, type Executor } from '@drift/db';
import { STORAGE_LOCATIONS } from '@drift/db';

/** pg-boss 队列名（Plan 09 定下的名字，worker/测试/入队三方共用）。 */
export const ACCOUNT_DELETION_QUEUE = 'account-deletion';

/**
 * 队列策略必须是 short（pg-boss-delay-api.test.ts 锁定的事实）：standard 下
 * singletonKey 不去重 —— 同一个用户连排两次会得到两个删除作业。short 保证每个
 * singletonKey（= userId）最多一个待执行作业。
 */
export const ACCOUNT_DELETION_QUEUE_POLICY = 'short';

/** 触发删除的原因。留证要回答「为什么删」，而不只是「删过」。 */
export const ACCOUNT_DELETION_REASONS = ['user_request', 'revoke_required_consent'] as const;
export type AccountDeletionReason = (typeof ACCOUNT_DELETION_REASONS)[number];

export interface AccountDeletionOptions {
  readonly reason: AccountDeletionReason;
}

/** Plan 09 定下的入队端口签名 —— 实现，签名不变。 */
export type AccountDeletionEnqueue = (
  executor: Executor,
  userId: string,
  options: AccountDeletionOptions,
) => Promise<string>;

// ─── pg-boss 的进程级注册与事务内入队 ────────────────────────────────────────

/**
 * boss 实例的进程级注册（setContactAttemptTimeoutScheduler 的同一手法）。
 *
 * 排定动作发生在 HTTP 请求链路里（POST /me/delete 与撤回必选项的事务），而 PgBoss
 * 实例由 startWorker() 持有。未注册时 requireBoss() **抛错**而不是静默 no-op：
 * 「撤回成功了但删除作业排不进去」是无合法性基础继续持有数据的最坏形态。
 */
let schedulerBoss: PgBoss | null = null;

export function setAccountDeletionScheduler(boss: PgBoss | null): void {
  schedulerBoss = boss;
}

function requireBoss(): PgBoss {
  if (schedulerBoss === null) {
    throw new Error(
      'account-deletion 的 boss 未注册（startWorker 未运行）。删除作业无法入队 —— 这必须是显式失败，静默吞掉会让「撤回成功但删除从未开始」变成可能。',
    );
  }
  return schedulerBoss;
}

/**
 * 把 drizzle Executor 的底层 postgres 连接适配成 pg-boss 的 IDatabase —— 让
 * boss.send 的 INSERT INTO pgboss.job 落在**调用方的事务**里（撤回记录 + 入队
 * 同生共死，Plan 09 定下的结构）。
 *
 * 取连接的方式：db 的 \$client（PostgresJsDatabase 公开属性）或事务的
 * session.client（drizzle 的 transaction() 内部就是 client.begin(...)，事务
 * 的 client 挂在 session 上）。两条路径覆盖 Executor 的两个成员。
 */
function pgBossDbOf(executor: Executor): Db {
  const candidate = executor as unknown as {
    readonly $client?: unknown;
    readonly session?: { readonly client?: unknown };
  };
  const client = candidate.$client ?? candidate.session?.client;
  if (client === undefined || client === null) {
    throw new Error('无法从 Executor 取出底层 postgres 连接（事务内入队需要它）');
  }
  return {
    executeSql: async (text: string, values?: unknown[]) => {
      const rows = await (client as unknown as postgres.Sql).unsafe(text, (values ?? []) as never[]);
      return { rows: rows as unknown[] };
    },
  };
}

/** 删除动作的 pending 行载荷（privacy_action.payload）。 */
interface PendingPayload {
  readonly status: 'pending';
  readonly userId: string;
  readonly reason: AccountDeletionReason;
  readonly receiptToken: string;
}

/**
 * 建立一个删除动作：同一事务里写 privacy_action 的 pending 行 + 入队作业。
 *
 * ⚠️ 作业的 data 只带 actionId，**不带 userId** —— pgboss 的 jsonb 载荷是 STORAGE_
 * LOCATIONS 登记的存储位置，删除作业自己的载荷带 userId 等于把「要删谁」写进一个
 * 删除自身管不到的地方（作业行要等 handler 返回后才被清理）。userId 从
 * privacy_action.payload 读 —— 那是删除流程自己的位置。
 */
export async function createDeletionAction(
  executor: Executor,
  userId: string,
  reason: AccountDeletionReason,
): Promise<{ readonly actionId: string; readonly receiptToken: string; readonly jobId: string | null }> {
  const boss = requireBoss();
  const receiptToken = randomUUID();
  const payload: PendingPayload = { status: 'pending', userId, reason, receiptToken };
  // id 由 schema 的 defaultFn(newId) 生成 —— RETURNING 拿回来（不自己造第二份 id 形态）。
  const inserted = await executor
    .insert(privacyAction)
    .values({ userId, kind: 'delete', payload: payload as unknown as Record<string, unknown> })
    .returning({ id: privacyAction.id });
  const actionId = inserted[0]?.id;
  if (actionId === undefined) throw new Error('privacy_action 插入未返回 id');

  const jobId = await boss.send(
    ACCOUNT_DELETION_QUEUE,
    { actionId } satisfies AccountDeletionJobPayload,
    { singletonKey: userId, db: pgBossDbOf(executor) },
  );
  return { actionId, receiptToken, jobId };
}

/** Plan 09 的入队端口：撤回必选项时在同一事务里调它。返回作业 id（已在队列时为哨兵）。 */
export const enqueueAccountDeletion: AccountDeletionEnqueue = async (executor, userId, options) => {
  const { jobId } = await createDeletionAction(executor, userId, options.reason);
  // short 策略下同 key 的第二次 send 返回 null —— 作业已在队列里（用户重复触发），
  // 这是正确的幂等状态而不是失败。
  return jobId ?? `already-queued:${userId}`;
};

// ─── 执行体与回执 ────────────────────────────────────────────────────────────

/** 作业 data（不含 userId —— 见 createDeletionAction 的说明）。 */
export interface AccountDeletionJobPayload {
  readonly actionId: string;
}

/** 回执的逐项清单条目。 */
export interface DeletionReceiptItem {
  /** STORAGE_LOCATIONS 的 id。 */
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  /** 受影响的行 / 对象数。幂等重跑时为 0。 */
  readonly rows: number;
  /** 该项完成时刻（ISO）。 */
  readonly at: string;
  /** countsAsCleared === false 的项（审计去标识化，Q1）。 */
  readonly deidentified: boolean;
}

/** 删除回执（PRIV-05：回执数量 = purge 成功执行且不计去标识化的项数）。 */
export interface DeletionReceipt {
  readonly status: 'complete' | 'partial';
  readonly clearedCount: number;
  readonly failedCount: number;
  readonly items: readonly DeletionReceiptItem[];
  readonly deletedAt: string;
}

/** N 的口径：成功执行且非去标识化的项数。独立导出供测试做注入式非空真证明。 */
export function countCleared(items: readonly DeletionReceiptItem[]): number {
  return items.filter((item) => item.ok && !item.deidentified).length;
}

export interface AccountDeletionDeps {
  /** 必须是 purgeDb（purge_role）：审计表族的 UPDATE 权限只在它身上。 */
  readonly executor: Executor;
  readonly exportArtifactsDir: string;
  /** 测试注入：当前时间（回执时间戳）。 */
  readonly now?: Date;
  /** 测试注入：让指定 id 的 purge 抛错（部分失败分支的确定性触发）。 */
  readonly failLocationIds?: readonly string[];
  /** 观察点。零 env 依赖的代价：日志由调用方按白名单字段记。 */
  readonly onEvent?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
}

/**
 * 遍历 STORAGE_LOCATIONS 执行删除，产出回执。
 *
 * 幂等：全部 purge 是条件删除，第二次执行各处返回 0 行；回执由 runAccountDeletionJob
 * 在作业层短路（pending 才执行）。
 */
export async function executeAccountDeletion(
  deps: AccountDeletionDeps,
  userId: string,
): Promise<DeletionReceipt> {
  const now = deps.now ?? new Date();
  const items: DeletionReceiptItem[] = [];

  for (const location of STORAGE_LOCATIONS) {
    if (location.purge === undefined) continue; // pino：无 purge，不执行也不呈现。
    const at = now.toISOString();
    if (deps.failLocationIds?.includes(location.id)) {
      items.push({ id: location.id, label: location.label, ok: false, rows: 0, at, deidentified: location.countsAsCleared === false });
      continue;
    }
    try {
      const rows = await location.purge(
        { executor: deps.executor, exportArtifactsDir: deps.exportArtifactsDir, now },
        userId,
      );
      items.push({ id: location.id, label: location.label, ok: true, rows, at, deidentified: location.countsAsCleared === false });
    } catch (error) {
      deps.onEvent?.('account_deletion.purge_failed', {
        jobName: ACCOUNT_DELETION_QUEUE,
        errorCode: (error as { readonly name?: string }).name ?? 'unknown',
      });
      items.push({ id: location.id, label: location.label, ok: false, rows: 0, at, deidentified: location.countsAsCleared === false });
    }
  }

  const failedCount = items.filter((item) => !item.ok).length;
  return {
    status: failedCount === 0 ? 'complete' : 'partial',
    clearedCount: countCleared(items),
    failedCount,
    items,
    deletedAt: now.toISOString(),
  };
}

/** 回执在 privacy_action.payload 里的形态（去标识化后不含 userId）。 */
export interface DeletionReceiptPayload {
  readonly status: 'complete' | 'partial';
  readonly receiptToken: string;
  readonly reason: AccountDeletionReason;
  readonly clearedCount: number;
  readonly failedCount: number;
  readonly items: readonly DeletionReceiptItem[];
  readonly deletedAt: string;
}

/**
 * 作业体：读 pending 行拿 userId → 执行 → 把回执写回同一行。
 *
 * 幂等短路：payload.status 已是终态 ⇒ 直接返回已存的回执（重复投递不重跑 ——
 * 第一次执行已把 payload.userId 去标识化移除，第二次本来也读不到目标）。
 */
export async function runAccountDeletionJob(
  deps: AccountDeletionDeps,
  actionId: string,
): Promise<DeletionReceiptPayload> {
  const rows = await deps.executor
    .select({ payload: privacyAction.payload })
    .from(privacyAction)
    .where(eq(privacyAction.id, actionId))
    .limit(1);
  const payload = rows[0]?.payload as
    | { readonly status?: string; readonly userId?: string; readonly receiptToken?: string; readonly reason?: AccountDeletionReason }
    | undefined;
  if (payload === undefined) {
    throw new Error(`删除动作行 ${actionId} 不存在 —— 无法定位要删的账号`);
  }
  // 幂等短路必须在完整性守卫**之前**：重复投递读回的是已写好的回执（没有
  // userId —— 它在第一次执行时被去标识化移除了），先守卫会把幂等重跑误判成
  // 「行不完整」而失败，而幂等恰恰是重复投递时唯一正确的形态。
  if (payload.status === 'complete' || payload.status === 'partial') {
    return payload as DeletionReceiptPayload;
  }
  if (payload.userId === undefined || payload.receiptToken === undefined || payload.reason === undefined) {
    throw new Error(`删除动作行 ${actionId} 的 pending 载荷不完整 —— 无法定位要删的账号`);
  }

  const receipt = await executeAccountDeletion(deps, payload.userId);
  const finalPayload: DeletionReceiptPayload = {
    status: receipt.status,
    receiptToken: payload.receiptToken,
    reason: payload.reason,
    clearedCount: receipt.clearedCount,
    failedCount: receipt.failedCount,
    items: receipt.items,
    deletedAt: receipt.deletedAt,
  };
  // 回执写回。privacy_action 是审计表（app_role 无 UPDATE）—— 这里用的 executor
  // 是 purgeDb，0004 已给它列级 UPDATE(user_id, payload) 权限。
  await deps.executor
    .update(privacyAction)
    .set({ payload: finalPayload as unknown as Record<string, unknown> })
    .where(eq(privacyAction.id, actionId));

  deps.onEvent?.(
    receipt.status === 'complete' ? 'account_deletion.completed' : 'account_deletion.partial',
    { jobName: ACCOUNT_DELETION_QUEUE, count: receipt.clearedCount },
  );
  return finalPayload;
}

/**
 * 建队列 + 注册 worker。startWorker 调用；测试直接调（零 env 依赖）。
 */
export async function registerAccountDeletion(
  boss: PgBoss,
  deps: AccountDeletionDeps,
): Promise<void> {
  await boss.createQueue(ACCOUNT_DELETION_QUEUE, { policy: ACCOUNT_DELETION_QUEUE_POLICY });
  await boss.work<AccountDeletionJobPayload>(ACCOUNT_DELETION_QUEUE, async (jobs) => {
    // pg-boss 12 的 work handler 接收**批量**（Job[]）—— 逐个执行。
    for (const job of jobs) {
      await runAccountDeletionJob(deps, job.data.actionId);
    }
  });
}

/**
 * pgboss 表的跨角色授权 —— 只能由 owner 身份在 boss.start() **之后**执行
 * （pgboss 的表由 start 建出来，迁移期不存在）。
 *
 * - app_role 需要 pgboss.job 的 INSERT + SELECT：撤回事务里的 boss.send 以
 *   app_role 连接执行（同生共死的代价）。权限只给 job 一张表 —— 撤回链路不碰
 *   pg-boss 的其他内部结构。
 * - purge_role 需要 pgboss.job / pgboss.archive 的 DELETE + SELECT：STORAGE_
 *   LOCATIONS 的队列载荷 purge 项。
 * - ALTER DEFAULT PRIVILEGES：pg-boss 自己的后续迁移新建的表自动带同一组授权。
 */
export async function ensurePgbossGrants(owner: postgres.Sql): Promise<void> {
  // USAGE 是表权限的前提（0001 只 GRANT 了 public 的）—— 没有它，表级 GRANT 全部
  // 形同虚设，DELETE 会以 permission denied for schema pgboss 失败（实测）。
  await owner.unsafe('grant usage on schema pgboss to app_role, purge_role');
  // pg-boss 12 的 insert 实际落在 pgboss.job_common（job 是分区路由表）—— 表布局
  // 不是稳定契约，因此对 schema 内全部表授权而不是点名（实测：只给 job 会在
  // job_common 上 42501）。
  await owner.unsafe('grant select, insert on all tables in schema pgboss to app_role');
  await owner.unsafe('grant select, delete on all tables in schema pgboss to purge_role');
  // pgboss.archive：pg-boss 12.34 实测无此表（见 storage-locations.ts 的注释）。
  // purge_role 对未来 pgboss 新表的授权由下面的 default privileges 覆盖。
  await owner.unsafe(
    'alter default privileges in schema pgboss grant select, insert on tables to app_role',
  );
  await owner.unsafe(
    'alter default privileges in schema pgboss grant select, delete on tables to purge_role',
  );
}
