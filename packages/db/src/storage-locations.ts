// STORAGE_LOCATIONS —— 一键删除（PRIV-05 / D-19）的显式存储位置注册表。
//
// 回执数量的唯一来源：**回执上的「已清除 N 处」= purge 成功执行且 countsAsCleared
// 不为 false 的项数**（D-19）。它不是运行时 information_schema 枚举 —— 枚举不到
// 导出文件、pgboss 载荷与 pino 日志，数字显得精确却骗人（D-19 明文否决）。
// 注册表的完整性由两条腿共同保证（RESEARCH §7.2）：
//   A 腿（tools/ci/storage-registry.test.ts，纯 TS）：drizzle schema 枚举的每张表，
//       必须在本注册表有对应项或在显式豁免清单里；并与 DATA_INVENTORY 交叉核对
//       （containsPersonalInfo 为 true 的表必须有 purge）。
//   B 腿（tools/ci/storage-registry-db.test.ts，连测试库）：information_schema.tables
//       的表集合 == 注册表表集合 ∪ KNOWN_EXTERNAL_SCHEMAS 覆盖的表 —— 这条腿抓的
//       是裸 SQL 迁移建的表、pg-boss 自己的表、publication DDL 与 CREATE EXTENSION
//       带来的对象，A 腿看不到它们。
//
// ── 三个不可协商 ─────────────────────────────────────────────────────────────
//   1. **不软删**（D-19）：在用户面前说「已清除」而数据还在，与在危机卡片上说
//      「已经联系了」是同一性质的虚假陈述。
//   2. **去标识化不计入 N**（Q1 裁决）：七张 append-only 审计表的项 countsAsCleared
//      为 false —— 它们被如实处理但**没有清除**，回执必须披露这一点而不是四舍五入。
//   3. **invite_code 置空而非删行**（D-19）：码本身是运营资产，删码会让历史发放
//      记录消失；置空 used_by 只解除它与被删用户的关联。
//
// ── 执行顺序即数组顺序 ───────────────────────────────────────────────────────
// 去标识化在最前（message / conversation / user 的删除依赖审计行先解除 FK 引用），
// user 行在最后（其余表全部引用它）。改顺序前先读 account-deletion.ts 的注释。
//
// ⚠️ 本文件保持纯：purge 接受 PurgeContext（executor 由调用方传 **purgeDb** ——
// purge_role 身份，审计表族的 UPDATE 权限只在它身上），不读盘不连库（node:fs 的
// import 只在 purge 被调用时才碰文件系统）。

import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { eq, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

import type { Executor } from './client.ts';
import { deidentifyAuditRows } from './deidentify.ts';
import {
  account,
  contactAttempt,
  consent,
  conversation,
  emergencyContact,
  friendship,
  inviteCode,
  session,
  usageSegment,
  user,
  verification,
} from './schema/index.ts';

/** A 腿对账时允许「不在注册表」的表：平台内容资产，不是任何用户的个人信息存储。 */
export const STORAGE_EXEMPT_TABLES = ['character', 'persona_version'] as const;

/**
 * B 腿对账时允许出现的非 public schema：
 *   pgboss            —— pg-boss 自建（job / queue / schedule / archive）
 *   drizzle           —— drizzle-kit 的迁移记账表（__drizzle_migrations）
 *   pg_catalog / information_schema —— PG 系统目录
 * 出现其他 schema（或 public 里的未登记表）都是 B 腿的红 —— B 腿第一次真跑就抓到了
 * drizzle schema 这个 A 腿结构性看不见的对象，这正是它存在的理由。
 */
export const KNOWN_EXTERNAL_SCHEMAS = ['pgboss', 'drizzle', 'pg_catalog', 'information_schema'] as const;

/** purge 的执行环境。executor 必须是 purge_role 身份（purgeDb 或其事务）。 */
export interface PurgeContext {
  readonly executor: Executor;
  /** 导出产物的根目录（D-17 的 7 天 TTL 作用域）。 */
  readonly exportArtifactsDir: string;
  /** 当前时间。回执时间戳与文件 TTL 判定共用一个来源。 */
  readonly now: Date;
}

/** 一个存储位置（RESEARCH §7.1 的 StorageLocation，含 Q1 裁决后的 countsAsCleared）。 */
export interface StorageLocation {
  /** 稳定标识，进回执逐项清单。 */
  readonly id: string;
  /** 用户可读（回执页展示）。 */
  readonly label: string;
  readonly containsPersonalInfo: boolean;
  /** containsPersonalInfo=false 时必填：为什么这一项可以不被清除。 */
  readonly justification?: string;
  /** 表级项指向的 public 表名（A 腿对账键）。非表项无此字段。 */
  readonly table?: string;
  /**
   * 该项成功执行后是否计入回执的「已清除 N 处」。省略 = true。
   * 七张审计表的去标识化项为 false（Q1：去标识化不等于清除）。
   */
  readonly countsAsCleared?: boolean;
  /**
   * 清除该位置。返回受影响的行 / 对象数。**必须条件化且幂等**：重复执行返回 0 行
   * 不报错（pg-boss 是 at-least-once 投递，D-19）。
   */
  readonly purge?: (ctx: PurgeContext, userId: string) => Promise<number>;
}

// ─── 注册表本体（顺序即执行顺序）────────────────────────────────────────────

/**
 * Phase 1 的全部存储位置（24 项）：
 *
 *   去标识化 ×7（countsAsCleared: false）· 业务表 DELETE ×11 · 邀请码置空 ×1 ·
 *   pgboss 载荷 ×2 · 导出文件 ×1 · pino 日志（无 purge）×1 · user（最后）×1
 */
export const STORAGE_LOCATIONS: readonly StorageLocation[] = [
  // ── 去标识化（最前：后续 DELETE 依赖审计行先解除 FK 引用）─────────────────
  {
    id: 'audit.safety_event',
    label: '安全事件记录（已去除可识别信息，保留合规所需的事件记录）',
    containsPersonalInfo: true,
    table: 'safety_event',
    countsAsCleared: false,
    purge: (ctx, userId) => deidentifyAuditRows(ctx.executor, userId, ['safety_event']),
  },
  {
    id: 'audit.consent_event',
    label: '同意变更记录（已去除可识别信息，保留合规所需的事件记录）',
    containsPersonalInfo: true,
    table: 'consent_event',
    countsAsCleared: false,
    purge: (ctx, userId) => deidentifyAuditRows(ctx.executor, userId, ['consent_event']),
  },
  {
    id: 'audit.privacy_action',
    label: '隐私操作记录（已去除可识别信息，保留合规所需的事件记录）',
    containsPersonalInfo: true,
    table: 'privacy_action',
    countsAsCleared: false,
    purge: (ctx, userId) => deidentifyAuditRows(ctx.executor, userId, ['privacy_action']),
  },
  {
    id: 'audit.llm_call',
    label: '模型调用记录（已去除可识别信息，保留合规所需的事件记录）',
    containsPersonalInfo: true,
    table: 'llm_call',
    countsAsCleared: false,
    purge: (ctx, userId) => deidentifyAuditRows(ctx.executor, userId, ['llm_call']),
  },
  {
    id: 'audit.client_error',
    label: '前端错误记录（已去除可识别信息，保留合规所需的事件记录）',
    containsPersonalInfo: true,
    table: 'client_error',
    countsAsCleared: false,
    purge: (ctx, userId) => deidentifyAuditRows(ctx.executor, userId, ['client_error']),
  },
  {
    id: 'audit.exit_intent',
    label: '退出意图记录（已去除可识别信息，保留合规所需的事件记录）',
    containsPersonalInfo: true,
    table: 'exit_intent',
    countsAsCleared: false,
    purge: (ctx, userId) => deidentifyAuditRows(ctx.executor, userId, ['exit_intent']),
  },
  {
    id: 'audit.dependency_signal',
    label: '依赖信号记录（已去除可识别信息，保留合规所需的事件记录）',
    containsPersonalInfo: true,
    table: 'dependency_signal',
    countsAsCleared: false,
    purge: (ctx, userId) => deidentifyAuditRows(ctx.executor, userId, ['dependency_signal']),
  },

  // ── 业务表 DELETE（先于 conversation / user，FK 顺序）─────────────────────
  {
    id: 'message',
    label: '聊天消息',
    containsPersonalInfo: true,
    table: 'message',
    // message 没有 user_id 列 —— 它经由 conversation 归属用户。先删消息（引用
    // conversation），conversation 的 DELETE 才不会被 FK 挡住。
    purge: async (ctx, userId) => {
      const rows = (await ctx.executor.execute(
        sql`delete from message where conversation_id in (select id from conversation where user_id = ${userId}) returning 1`,
      )) as unknown[];
      return rows.length;
    },
  },
  {
    id: 'session_risk_state',
    label: '会话风险状态',
    containsPersonalInfo: true,
    table: 'session_risk_state',
    purge: async (ctx, userId) => {
      const rows = (await ctx.executor.execute(
        sql`delete from session_risk_state where conversation_id in (select id from conversation where user_id = ${userId}) returning 1`,
      )) as unknown[];
      return rows.length;
    },
  },
  {
    id: 'contact_attempt',
    label: '危机联络尝试',
    containsPersonalInfo: true,
    table: 'contact_attempt',
    purge: async (ctx, userId) => {
      const rows = await ctx.executor
        .delete(contactAttempt)
        .where(eq(contactAttempt.userId, userId))
        .returning({ id: contactAttempt.id });
      return rows.length;
    },
  },
  {
    id: 'conversation',
    label: '会话',
    containsPersonalInfo: true,
    table: 'conversation',
    purge: async (ctx, userId) => {
      const rows = await ctx.executor
        .delete(conversation)
        .where(eq(conversation.userId, userId))
        .returning({ id: conversation.id });
      return rows.length;
    },
  },
  {
    id: 'friendship',
    label: '好友关系',
    containsPersonalInfo: true,
    table: 'friendship',
    purge: async (ctx, userId) => {
      const rows = await ctx.executor
        .delete(friendship)
        .where(eq(friendship.userId, userId))
        .returning({ id: friendship.id });
      return rows.length;
    },
  },
  {
    id: 'emergency_contact',
    label: '紧急联系人',
    containsPersonalInfo: true,
    table: 'emergency_contact',
    purge: async (ctx, userId) => {
      const rows = await ctx.executor
        .delete(emergencyContact)
        .where(eq(emergencyContact.userId, userId))
        .returning({ id: emergencyContact.id });
      return rows.length;
    },
  },
  {
    id: 'usage_segment',
    label: '使用时长',
    containsPersonalInfo: true,
    table: 'usage_segment',
    purge: async (ctx, userId) => {
      const rows = await ctx.executor
        .delete(usageSegment)
        .where(eq(usageSegment.userId, userId))
        .returning({ id: usageSegment.id });
      return rows.length;
    },
  },
  {
    id: 'consent',
    label: '同意状态',
    containsPersonalInfo: true,
    table: 'consent',
    purge: async (ctx, userId) => {
      const rows = await ctx.executor
        .delete(consent)
        .where(eq(consent.userId, userId))
        .returning({ id: consent.id });
      return rows.length;
    },
  },
  {
    id: 'account',
    label: '登录凭证',
    containsPersonalInfo: true,
    table: 'account',
    purge: async (ctx, userId) => {
      const rows = await ctx.executor
        .delete(account)
        .where(eq(account.userId, userId))
        .returning({ id: account.id });
      return rows.length;
    },
  },
  {
    id: 'session',
    label: '登录会话',
    containsPersonalInfo: true,
    table: 'session',
    // better-auth 的 session 表：删行即失效（断言 (i)：旧 cookie 请求返回 401）。
    purge: async (ctx, userId) => {
      const rows = await ctx.executor
        .delete(session)
        .where(eq(session.userId, userId))
        .returning({ id: session.id });
      return rows.length;
    },
  },
  {
    id: 'verification',
    label: '邮箱验证凭证',
    containsPersonalInfo: true,
    table: 'verification',
    purge: async (ctx, userId) => {
      const rows = await ctx.executor
        .delete(verification)
        // verification 没有 user_id —— better-auth 的 identifier 就是 email。
        .where(sql`identifier in (select email from "user" where id = ${userId})`)
        .returning({ id: verification.id });
      return rows.length;
    },
  },

  // ── 运营资产：置空而非删行 ──────────────────────────────────────────────
  {
    id: 'invite_code',
    label: '邀请码占用',
    containsPersonalInfo: true,
    table: 'invite_code',
    // D-19：码是运营资产 —— UPDATE 置空 used_by，不是 DELETE。
    purge: async (ctx, userId) => {
      const rows = await ctx.executor
        .update(inviteCode)
        .set({ usedBy: null, usedAt: null })
        .where(eq(inviteCode.usedBy, userId))
        .returning({ code: inviteCode.code });
      return rows.length;
    },
  },

  // ── 非表存储：pgboss 的 jsonb 载荷（RESEARCH §7.1 三处最易漏之二）──────────
  {
    id: 'pgboss.job',
    label: '任务队列载荷',
    containsPersonalInfo: true,
    // 队列作业的 data 是 jsonb，可能带 userId / conversationId。删除作业自身的
    // data 只含 actionId（不含 userId）—— 但历史与其他队列的形态不归本注册表
    // 保证，所以这里按 data->>'userId' 显式清（RESEARCH §7.1 的原文形态）。
    purge: async (ctx, userId) => {
      const rows = (await ctx.executor.execute(
        sql`delete from pgboss.job where data->>'userId' = ${userId} returning 1`,
      )) as unknown[];
      return rows.length;
    },
  },
  {
    id: 'pgboss.archive',
    label: '已完成作业归档',
    containsPersonalInfo: true,
    // ⚠️ pg-boss 12.34 实测**没有** archive 表（那是 v10 及更早的概念：v12 的
    // 完成作业留在 pgboss.job 里按 retention 清理）。RESEARCH §7.1 按旧版认知登记了
    // 这个位置 —— 这里按「表存在才清、不存在则 0 行成功」的防御形态保留它：
    // 未来 pg-boss 升级若重新引入 archive 表（它装的就是 jsonb 载荷），这条 purge
    // 已经就位，而不是等它带着 userId 重新出现在库里。
    purge: async (ctx, userId) => {
      const exists = await ctx.executor.execute(
        sql`select to_regclass('pgboss.archive') is not null as present`,
      ).then((rows) => (rows as unknown as { present: boolean }[])[0]?.present === true);
      if (!exists) return 0;
      const rows = (await ctx.executor.execute(
        sql`delete from pgboss.archive where data->>'userId' = ${userId} returning 1`,
      )) as unknown[];
      return rows.length;
    },
  },

  // ── 非表存储：磁盘上的导出文件（三处最易漏之首）────────────────────────────
  {
    id: 'export_artifact',
    label: '导出文件',
    containsPersonalInfo: true,
    // 全量对话副本，留存风险最高的一处（D-17 定 7 天 TTL）。目录布局：
    //   <exportArtifactsDir>/<userId>/<actionId>.{md,json}
    // 成功项的计数 = 删掉的文件数（目录不存在 = 0，成功且幂等）。
    purge: async (ctx, userId) => {
      const dir = join(ctx.exportArtifactsDir, userId);
      let entries: readonly string[];
      try {
        entries = await readdir(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
        throw error;
      }
      await rm(dir, { recursive: true, force: true });
      return entries.length;
    },
  },

  // ── 非表存储：pino 日志（三处最易漏之三，刻意无 purge）───────────────────
  {
    id: 'pino.log',
    label: '服务日志',
    containsPersonalInfo: false,
    justification:
      '日志文件不能按行删除（RESEARCH §2.3）：声称能删除它是一次无法履行的承诺。唯一诚实的姿态是设计上不含个人信息 —— logEvent 的字段白名单（LOG_ALLOWED_FIELDS）与 pino redact 两道防线保证消息正文与联系方式不进日志，运行时断言（tools/ci/pino-no-pii.test.ts：跑完整 turn 抓输出，不含正文任何 ≥6 字子串与 11 位手机号）证明登记为真。解除条件见 SKIPPED_CHECKS.md。',
  },

  // ── user 行：最后删（其余表全部引用它）───────────────────────────────────
  {
    id: 'user',
    label: '账号本体',
    containsPersonalInfo: true,
    table: 'user',
    purge: async (ctx, userId) => {
      const rows = await ctx.executor
        .delete(user)
        .where(eq(user.id, userId))
        .returning({ id: user.id });
      return rows.length;
    },
  },
];

// ─── A 腿纯函数（tools/ci/storage-registry.test.ts 消费）─────────────────────

/** 注册表覆盖的表名集合。 */
export function registeredTables(locations: readonly StorageLocation[]): ReadonlySet<string> {
  return new Set(
    locations
      .map((location) => location.table)
      .filter((table): table is string => table !== undefined),
  );
}

/**
 * A 腿断言（RESEARCH §7.2 表格的第一行 + DATA_INVENTORY 交叉核对）。
 *
 * 纯函数：schema 模块、注册表、清单都从参数进来 —— 负向 fixture（含额外表的假
 * schema）直接喂假输入，证明断言不是空真。失败信息逐项点名。
 *
 * 五条不变式：
 *   1. 注册表的每个表项都真实存在于 drizzle schema（防改名 / 删表漂移）；
 *   2. schema 枚举的每张表要么在注册表要么在豁免清单（新增表不登记 → 红）；
 *   3. DATA_INVENTORY 里含个人信息的表必须有对应存储位置（回执不漏报）；
 *   4. containsPersonalInfo=false 的项必须带非空 justification；
 *   5. countsAsCleared=false 的项的 label 必须含「已去除可识别信息」（Q1 的
 *      呈现层义务 —— 回执说清除而实际保留，需要显式披露）。
 */
export function assertStorageRegistryInvariants(
  schemaModule: Readonly<Record<string, unknown>>,
  locations: readonly StorageLocation[],
  inventoryTables: readonly string[],
  exemptTables: readonly string[] = [...STORAGE_EXEMPT_TABLES],
): void {
  const registered = registeredTables(locations);
  const schemaTables = new Set<string>();
  for (const value of Object.values(schemaModule)) {
    if (!is(value, PgTable)) continue;
    schemaTables.add(getTableName(value));
  }

  for (const table of registered) {
    if (!schemaTables.has(table)) {
      throw new Error(
        `STORAGE_LOCATIONS 引用了不存在的表「${table}」—— 改名 / 删表而未同步注册表`,
      );
    }
  }

  const missing: string[] = [];
  for (const table of schemaTables) {
    if (registered.has(table) || exemptTables.includes(table)) continue;
    missing.push(table);
  }
  if (missing.length > 0) {
    throw new Error(
      `以下表未登记进 STORAGE_LOCATIONS 且不在豁免清单（新增表必须登记，否则删除会静默漏掉它）：${missing.join('、')}`,
    );
  }

  const unlocated = inventoryTables.filter((table) => !registered.has(table));
  if (unlocated.length > 0) {
    throw new Error(
      `DATA_INVENTORY 里含个人信息的表没有 STORAGE_LOCATIONS 项（回执会漏报这些位置）：${unlocated.join('、')}`,
    );
  }

  for (const location of locations) {
    if (location.containsPersonalInfo) continue;
    if ((location.justification ?? '').trim().length === 0) {
      throw new Error(
        `存储位置「${location.id}」不含个人信息却没写豁免理由 —— 一条没有理由的豁免等于没有审查`,
      );
    }
  }

  for (const location of locations) {
    if (location.countsAsCleared !== false) continue;
    if (!location.label.includes('已去除可识别信息')) {
      throw new Error(
        `存储位置「${location.id}」不计入已清除（countsAsCleared: false）但 label 没有声明「已去除可识别信息」—— 回执说清除而实际保留，需要显式披露（Q1）`,
      );
    }
  }
}
