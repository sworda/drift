// DATA_INVENTORY —— 表 × 列到用途 / 同意项 / 保存期 / 是否个人信息 / 研究分层的
// **单一真相源**（RESEARCH §6.4，PRIV-03 / PRIV-05 / PRIV-08 的共同地基）。
//
// 为什么必须是注册表而不是「说明文案靠人维护」：PRIV-03 要求隐私说明与实际存储字段
// 一致，而「新增一列忘了写进政策」这件事靠人盯必然漂移 —— 漂移的方向永远是漏列，而
// 漏列正是虚假陈述里最隐蔽的一种（T-10-04）。四条双向断言（见 assertInventoryInvariants）
// 让「新增列不登记」与「改名 / 删列不同步」都在构建期失败。
//
// 三个消费者（这是本注册表的全部价值，缺一个都不值得维护这 100+ 行字面量）：
//   1. 隐私中心「我们收集了什么」—— 由 buildCollectedView 按 scope 分组生成，UI 不硬编码；
//   2. STORAGE_LOCATIONS（Plan 11）—— 删除 worker 的存储位置清单与它交叉核对；
//   3. 保存期清理 cron（PRIV-08）—— 按 retention 生成，D-17 的四层保存期落在这里。
//
// ⚠️ 本文件必须保持**纯**：只 import @drift/contract 与 drizzle-orm 的类型工具，
// 不读盘、不连库、不碰环境变量。packages/db 的包入口会拉进 client.ts（模块加载即读
// DATABASE_URL），因此本文件通过 `./inventory` 子路径导出供 apps/web 的测试与
// @drift/contract 侧消费 —— 那条边界（「apps/web 不能 import @drift/db」）的真实含义
// 是「不能加载连接池」，不是「不能共享这一份纯数据」。
//
// ⚠️ layer === 'l0' 的条目在 Phase 1 是空集（研究管道在 Phase 7），第四条断言因此空真
// —— 由 tools/ci/fixtures/inventory-l0-vector.ts 的负向 fixture 证明它活着（RES-02，
// V.0 #7）。这条空真状态登记在 SKIPPED_CHECKS.md。

import { type ConsentScope, CONSENT_SCOPES } from '@drift/contract';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';

// ─── 类型 ────────────────────────────────────────────────────────────────────

/**
 * 保存期（D-17 的分层表）。
 *
 * account_life：账号存续期间保留。hardCapMonths 只对「聊天原文」设置（24 个月滚动
 * 清理的上限）—— 它是 optional 而不是必填，因为给账号必要信息设同样的硬上限会让
 * 「账号存续期间保留」这句话在 24 个月处变成假话。
 */
export type Retention =
  | { readonly kind: 'account_life'; readonly hardCapMonths?: 24 }
  | { readonly kind: 'fixed'; readonly days: number };

/**
 * 研究分层（RES-02 的判据载体）。Phase 1 全部为 'app' —— 研究管道在 Phase 7，
 * 届时 l0/l1/l2 的条目才会出现，第四条断言（l0 禁向量列）也随之获得真实被测对象。
 */
export type InventoryLayer = 'app' | 'l0' | 'l1' | 'l2';

/** 注册表条目：一个「含个人信息」的列（PRIV-03 的最小粒度）。 */
export interface InventoryEntry {
  /** drizzle schema 里的表名（DB 侧名字，不是 TS 属性名）。 */
  readonly table: string;
  /** DB 侧列名。 */
  readonly column: string;
  /** 隐私中心「我们收集了什么」里显示的文字 —— 与 privacy.md「我们收集什么」表的条目逐字一致。 */
  readonly humanLabel: string;
  /** 该条目的人类可读说明（同 humanLabel 的粒度，privacy.md 的「具体是什么」列）。 */
  readonly purpose: string;
  /** 'none' = 合同履行必要，不随同意项撤回而停止，但随账号删除一起删除。 */
  readonly consentScope: ConsentScope | 'none';
  readonly containsPersonalInfo: true;
  /** 个保法第二十八条的敏感个人信息（聊天原文、紧急联系人、危机记录等）。 */
  readonly isSensitive: boolean;
  readonly layer: InventoryLayer;
  readonly retention: Retention;
}

/**
 * 显式豁免：不含个人信息的列（或非表存储位置）。**每项必填一行理由** —— 一条没有
 * 理由的豁免与一个不存在的防线没有区别（tools/ci/data-inventory.test.ts 断言这件事）。
 */
export interface NonPersonalColumn {
  readonly table: string;
  readonly column: string;
  readonly containsPersonalInfo: false;
  readonly justification: string;
  /** 非表存储位置（pino 日志、导出文件目录、pg-boss 载荷）—— 不做列存在性校验。 */
  readonly nonTableStorage?: true;
}

// ─── 保存期常量（D-17）────────────────────────────────────────────────────────

/** 账号存续期间保留（无硬上限）。 */
const ACCOUNT_LIFE: Retention = { kind: 'account_life' };
/** 聊天原文：账号存续期 + 24 个月硬上限滚动清理（D-17 第一行）。 */
const CHAT_HARD_CAP_24M: Retention = { kind: 'account_life', hardCapMonths: 24 };
/** 审计表族（D-06 的七张 append-only 表）：6 个月（D-17 第四行，COMPLY-11 的下界）。 */
const AUDIT_180D: Retention = { kind: 'fixed', days: 180 };

// ─── 条目基底（同一 humanLabel 的列共享一段说明）─────────────────────────────

type EntryBase = Omit<InventoryEntry, 'table' | 'column'>;

/** 把一张表的一组列展开成条目 —— 列名写错会被第二条断言当场抓住。 */
function forTable(
  table: string,
  columns: readonly string[],
  base: EntryBase,
): readonly InventoryEntry[] {
  return columns.map((column) => ({ table, column, ...base }));
}

// ⚠️ humanLabel 与 purpose 的措辞与 apps/web/content/legal/privacy.md 的「我们收集什么」
// 表逐字对齐 —— tools/ci/data-inventory.test.ts 的集合相等断言在两个方向上比对它们。

const ACCOUNT: EntryBase = {
  humanLabel: '账号',
  purpose: '昵称、邮箱、出生日期、你用掉的那个邀请码、注册时间',
  consentScope: 'none',
  containsPersonalInfo: true,
  isSensitive: false,
  layer: 'app',
  retention: ACCOUNT_LIFE,
};

const CREDENTIALS: EntryBase = {
  humanLabel: '登录凭证',
  purpose: '密码的哈希值（不保存原文）、登录会话的令牌、登录时的 IP 与浏览器标识',
  consentScope: 'none',
  containsPersonalInfo: true,
  isSensitive: false,
  layer: 'app',
  retention: ACCOUNT_LIFE,
};

const EMERGENCY_CONTACT: EntryBase = {
  humanLabel: '紧急联系人',
  purpose:
    '一位监护人或紧急联系人的称呼与手机号（手机号加密保存，界面上只显示遮蔽后的形式），以及我们是否确认过这个号码打得通',
  consentScope: 'sensitive_pi',
  containsPersonalInfo: true,
  // 这是**第三方**的个人信息（填号码的人不是号码的主人），且只服务危机干预一个目的。
  isSensitive: true,
  layer: 'app',
  retention: ACCOUNT_LIFE,
};

const CHAT_TEXT: EntryBase = {
  humanLabel: '聊天原文',
  purpose: '你发出的每一条消息、角色回给你的每一条消息、它们的先后顺序与时间',
  // 依据是 basic_service 与 sensitive_pi 两项（policy 原文如此）；单值字段取
  // basic_service —— 它的说明文字写的正是「保存你的账号、聊天记录和会话状态」。
  consentScope: 'basic_service',
  containsPersonalInfo: true,
  // 聊天内容里很可能含健康、情绪、行踪这类敏感个人信息（个保法第二十八条）。
  isSensitive: true,
  layer: 'app',
  retention: CHAT_HARD_CAP_24M,
};

const CONVERSATIONS: EntryBase = {
  humanLabel: '会话与好友关系',
  purpose: '你加了哪些角色、每个会话的未读数与最后活跃时间、会话是否已被你结束',
  consentScope: 'none',
  containsPersonalInfo: true,
  isSensitive: false,
  layer: 'app',
  retention: ACCOUNT_LIFE,
};

const USAGE: EntryBase = {
  humanLabel: '使用时长',
  purpose: '每一段连续使用的起止与累计秒数、我们提醒过你几次',
  consentScope: 'none',
  containsPersonalInfo: true,
  isSensitive: false,
  layer: 'app',
  retention: ACCOUNT_LIFE,
};

const CRISIS: EntryBase = {
  humanLabel: '危机相关记录',
  purpose:
    '一次危机判定的等级、命中了哪条规则、分类器是否正常工作、被判定的那段候选回复的哈希与长度（不是正文）、以及联系紧急联系人的进展状态',
  consentScope: 'sensitive_pi',
  containsPersonalInfo: true,
  // 危机记录承载的是心理健康状态 —— 个保法第二十八条明列的敏感类别。
  isSensitive: true,
  layer: 'app',
  retention: ACCOUNT_LIFE,
};

const AUDIT_CRISIS: EntryBase = { ...CRISIS, retention: AUDIT_180D };

const EXIT_AND_DEPENDENCY: EntryBase = {
  humanLabel: '退出意图与依赖信号',
  purpose: '你表达过想结束会话的记录、以及「连续多天」「深夜占比偏高」这类使用强度信号及其依据',
  consentScope: 'none',
  containsPersonalInfo: true,
  isSensitive: false,
  layer: 'app',
  retention: AUDIT_180D,
};

const LLM_CALLS: EntryBase = {
  humanLabel: '模型调用记录',
  purpose: '每次调用了哪个模型、耗时、token 数、提示词版本与输入内容的哈希',
  consentScope: 'none',
  containsPersonalInfo: true,
  isSensitive: false,
  layer: 'app',
  retention: AUDIT_180D,
};

const CONSENTS: EntryBase = {
  humanLabel: '同意记录',
  purpose: '五个同意项各自的当前状态、每一次勾选与撤回的时间、以及你当时同意的是哪一版本政策',
  consentScope: 'none',
  containsPersonalInfo: true,
  isSensitive: false,
  layer: 'app',
  retention: ACCOUNT_LIFE,
};

const CONSENT_HISTORY: EntryBase = { ...CONSENTS, retention: AUDIT_180D };

const PRIVACY_ACTIONS: EntryBase = {
  humanLabel: '隐私操作记录',
  purpose: '你发起过的导出、删除、撤回，以及删除回执的逐项清单',
  consentScope: 'none',
  containsPersonalInfo: true,
  isSensitive: false,
  layer: 'app',
  retention: AUDIT_180D,
};

const CLIENT_ERRORS: EntryBase = {
  humanLabel: '前端错误',
  purpose: '报错的类型与代码、出错的路由、HTTP 状态码、应用版本',
  consentScope: 'none',
  containsPersonalInfo: true,
  isSensitive: false,
  layer: 'app',
  retention: AUDIT_180D,
};

// ─── 注册表本体 ──────────────────────────────────────────────────────────────

/**
 * 全部含个人信息的列。Plan 04 的 22 张表 × 每一列，要么在这里，要么在
 * NON_PERSONAL_COLUMNS 里带着理由 —— 四条断言的第一条保证没有第三种状态。
 */
export const DATA_INVENTORY: readonly InventoryEntry[] = [
  // 身份域（better-auth 四张核心表 + 紧急联系人）
  ...forTable(
    'user',
    ['id', 'name', 'email', 'email_verified', 'image', 'birth_date', 'invite_code_id', 'created_at', 'updated_at'],
    ACCOUNT,
  ),
  ...forTable('account', ['id', 'account_id', 'provider_id', 'user_id', 'created_at', 'updated_at'], ACCOUNT),
  ...forTable(
    'account',
    ['access_token', 'refresh_token', 'id_token', 'access_token_expires_at', 'refresh_token_expires_at', 'scope', 'password'],
    CREDENTIALS,
  ),
  ...forTable(
    'session',
    ['id', 'token', 'user_id', 'expires_at', 'ip_address', 'user_agent', 'created_at', 'updated_at'],
    CREDENTIALS,
  ),
  ...forTable('verification', ['id', 'identifier', 'value', 'expires_at', 'created_at', 'updated_at'], CREDENTIALS),
  ...forTable(
    'emergency_contact',
    ['id', 'user_id', 'kind', 'name', 'contact_ref_encrypted', 'reachability', 'created_at'],
    EMERGENCY_CONTACT,
  ),
  // 邀请码：码本身是运营资产（NON_PERSONAL），消耗关系指向用户
  ...forTable('invite_code', ['used_by', 'used_at'], ACCOUNT),

  // 同意域
  ...forTable('consent', ['id', 'user_id', 'scope', 'granted', 'policy_version', 'updated_at'], CONSENTS),
  ...forTable('consent_event', ['id', 'user_id', 'scope', 'action', 'policy_version', 'source', 'created_at'], CONSENT_HISTORY),

  // 会话与消息域
  ...forTable('conversation', ['id', 'user_id', 'character_id', 'status', 'unread_count', 'last_message_at', 'created_at', 'ended_at'], CONVERSATIONS),
  ...forTable('friendship', ['id', 'user_id', 'character_id', 'relationship', 'created_at'], CONVERSATIONS),
  ...forTable(
    'message',
    ['id', 'conversation_id', 'seq', 'sender_kind', 'text', 'disclosure', 'provenance', 'audience', 'created_at'],
    CHAT_TEXT,
  ),

  // 安全域
  ...forTable('session_risk_state', ['conversation_id', 'level', 'entered_at', 'decay_after', 'cleared_by', 'cleared_at'], CRISIS),
  ...forTable(
    'safety_event',
    [
      'id', 'user_id', 'conversation_id', 'message_id', 'previous_level', 'level', 'rule_hits',
      'classifier_status', 'classifier_model_snapshot', 'candidate_reply_hash', 'candidate_reply_len',
      'override_applied', 'created_at',
    ],
    AUDIT_CRISIS,
  ),
  ...forTable(
    'contact_attempt',
    ['id', 'safety_event_id', 'user_id', 'contact_ref', 'status', 'alert_sent_at', 'operator_ack_at', 'delivered_at', 'note', 'created_at', 'updated_at'],
    CRISIS,
  ),

  // 审计表族的其余五张 + 使用时长
  ...forTable('usage_segment', ['id', 'user_id', 'started_at', 'last_activity_at', 'accumulated_seconds', 'reminded_count', 'closed_at'], USAGE),
  ...forTable('privacy_action', ['id', 'user_id', 'kind', 'payload', 'created_at'], PRIVACY_ACTIONS),
  ...forTable(
    'llm_call',
    [
      'id', 'turn_id', 'purpose', 'provider', 'requested_model', 'model_snapshot', 'resolved_model',
      'provider_request_id', 'prompt_version', 'input_hash', 'persona_version_id', 'thinking_mode',
      'temperature', 'prompt_tokens', 'completion_tokens', 'cached_tokens', 'price_tier', 'latency_ms',
      'user_id', 'conversation_id', 'retrieved_memory_ids', 'recall_scores', 'created_at',
    ],
    LLM_CALLS,
  ),
  ...forTable('client_error', ['id', 'user_id', 'error_name', 'error_code', 'route', 'status_code', 'app_version', 'created_at'], CLIENT_ERRORS),
  ...forTable('exit_intent', ['id', 'user_id', 'conversation_id', 'tier', 'matched_rule', 'created_at'], EXIT_AND_DEPENDENCY),
  ...forTable('dependency_signal', ['id', 'user_id', 'rule_id', 'observed_at', 'evidence', 'created_at'], EXIT_AND_DEPENDENCY),
];

/** 非个人信息列 / 非表存储位置的显式豁免清单。 */
function exempt(table: string, column: string, justification: string): NonPersonalColumn {
  return { table, column, containsPersonalInfo: false, justification };
}

function nonTableStorage(table: string, column: string, justification: string): NonPersonalColumn {
  return { table, column, containsPersonalInfo: false, justification, nonTableStorage: true };
}

export const NON_PERSONAL_COLUMNS: readonly NonPersonalColumn[] = [
  // ── 平台内容资产：角色与人格是预置内容，不是用户的个人信息 ──
  exempt('character', 'id', '平台预置角色的标识 —— 角色库是运营内容，不含任何用户数据'),
  exempt('character', 'name', '平台预置角色的名字'),
  exempt('character', 'avatar', '静态头像资源标识（Phase 1 是资源名，不是 URL）'),
  exempt('character', 'blurb', '角色库列表里的一句话简介'),
  exempt('character', 'current_persona_version_id', '当前生效人格版本的内部指针'),
  exempt('character', 'created_at', '角色行的创建时间'),
  exempt('persona_version', 'id', '人格版本标识 —— 人格版本链是平台资产'),
  exempt('persona_version', 'character_id', '指向角色的外键'),
  exempt('persona_version', 'parent_id', 'append-only 版本链的上一版指针'),
  exempt('persona_version', 'core', '人格 L1 内核（价值观 / 硬边界 / 风格不变量）—— Phase 1 为预写内容'),
  exempt('persona_version', 'traits', '大五 + 社交倾向维度的定点整数 —— Phase 1 为预写内容'),
  exempt('persona_version', 'dossier', '第一人称小传 —— Phase 1 为预写内容'),
  exempt('persona_version', 'prompt_version', '生成这一版人格的系统提示词哈希（真相源在 git）'),
  exempt('persona_version', 'model_snapshot', '生成这一版人格的模型快照标识（PERS-10）'),
  exempt('persona_version', 'is_healthy', '人格健康标志（Phase 5 的回滚开关）'),
  exempt('persona_version', 'created_at', '版本创建时间'),

  // ── 运营资产：邀请码本身 ──
  exempt('invite_code', 'code', '邀请码本身是运营资产（D-19：删除账号时置空 used_by 而不是删码）'),
  exempt('invite_code', 'created_by', '发码的运营者标识（自由文本，不指向平台用户）'),
  exempt('invite_code', 'revoked_at', '吊销时间'),
  exempt('invite_code', 'created_at', '发码时间'),

  // ── 会话的机制性内部状态：不承载用户内容，其产物已按「聊天原文」登记 ──
  exempt('conversation', 'counterpart_kind', "恒为 'ai_character' 的常量枚举（COMPLY-01 的驱动源），不含用户数据"),
  exempt('conversation', 'next_seq', 'per-conversation 取号器的内部计数（CHAT-07）；它产出的消息序号已按「聊天原文」登记'),

  // ── 非表存储位置（RESEARCH §2.3 / §7.1）—— STORAGE_LOCATIONS（Plan 11）的交叉输入 ──
  nonTableStorage(
    'pino 日志',
    '（结构化日志行）',
    '日志不能按行删除（RESEARCH §2.3）。唯一诚实的姿态是设计上不含个人信息：apps/api 的 pino 载荷白名单只有枚举与标识类字段（D-28），消息正文与联系方式都不在白名单里；由运行时断言兜底（跑完整 turn 抓 pino 输出，断言不含消息正文任何 ≥6 字子串与手机号格式串）',
  ),
  nonTableStorage(
    '导出文件目录',
    '（export_artifact 文件）',
    '用户全部数据的完整副本，留存风险最高 —— D-17 定 7 天 TTL，由保存期清理 cron 删除（Plan 11）',
  ),
  nonTableStorage(
    'pgboss.job / pgboss.archive',
    '（data jsonb 载荷）',
    '队列载荷里的 userId / conversationId —— 删除 worker 显式 DELETE data->>\'userId\' = $1（RESEARCH §7.1），Plan 11 落地',
  ),
];

// ─── 四条双向断言（纯函数，负向 fixture 直接喂输入）──────────────────────────

/** 匹配向量类型（RES-02 / RES-03 的同一张黑名单）。 */
const VECTOR_SQL_TYPE = /^(vector|halfvec|sparsevec)/u;

/**
 * DATA_INVENTORY 与 NON_PERSONAL_COLUMNS 的四条不变式（RESEARCH §6.4）：
 *
 *   1. drizzle schema 枚举出的每一列，必须登记在 DATA_INVENTORY 或 NON_PERSONAL_COLUMNS 里
 *      —— 新增一列而不登记，构建失败（T-10-04）；
 *   2. 反向：DATA_INVENTORY 每条引用的表与列必须真实存在 —— 改名 / 删列而不同步，
 *      构建失败（NON_PERSONAL_COLUMNS 的非表豁免项不做这一侧校验，它们本就不指向表）；
 *   3. 每条 containsPersonalInfo 为 true 的条目必须有合法形态的 retention（PRIV-08 前置）；
 *   4. layer 为 l0 的条目，其列的 SQL 类型不得是向量（RES-02 —— L0 配有 ID 映射表，
 *      属去标识化而非匿名化，向量列等于把原文可重建的表示存进 L0）。
 *
 * 纯函数：schema 模块、清单都从参数进来，不读盘不连库 —— 负向 fixture 可以直接喂
 * 假输入（第四条在 Phase 1 空真，fixture 是它唯一的活性证据）。
 *
 * 失败信息逐项点名（缺哪一列 / 多引哪一列 / 哪一条缺 retention）—— 说不出缺了什么的
 * 断言，变红时无法指导修复。
 */
export function assertInventoryInvariants(
  schemaModule: Readonly<Record<string, unknown>>,
  inventory: readonly InventoryEntry[],
  nonPersonal: readonly NonPersonalColumn[],
): void {
  // 表名 → 列名集合（DB 侧名字）。is(x, PgTable) 与 drizzle-kit 用同一条判据。
  const columnsByTable = new Map<string, Set<string>>();
  for (const value of Object.values(schemaModule)) {
    if (!is(value, PgTable)) continue;
    const table = getTableName(value);
    columnsByTable.set(table, new Set(Object.values(getTableColumns(value)).map((column) => column.name)));
  }

  const registered = new Set<string>();
  for (const entry of inventory) registered.add(`${entry.table}.${entry.column}`);
  for (const entry of nonPersonal) {
    if (entry.nonTableStorage === true) continue;
    registered.add(`${entry.table}.${entry.column}`);
  }

  // 1. schema → 注册表：每列必须登记。
  const unregistered: string[] = [];
  for (const [table, columns] of columnsByTable) {
    for (const column of columns) {
      if (!registered.has(`${table}.${column}`)) unregistered.push(`${table}.${column}`);
    }
  }
  if (unregistered.length > 0) {
    throw new Error(
      `以下列未登记进 DATA_INVENTORY 或 NON_PERSONAL_COLUMNS（新增列必须登记，否则披露与实现漂移）：${unregistered.join('、')}`,
    );
  }

  // 2. 注册表 → schema：每条引用必须存在（非表豁免项跳过）。
  for (const entry of inventory) {
    const columns = columnsByTable.get(entry.table);
    if (columns === undefined) {
      throw new Error(`DATA_INVENTORY 引用了不存在的表「${entry.table}」（列 ${entry.column}）—— 改名 / 删表而未同步注册表`);
    }
    if (!columns.has(entry.column)) {
      throw new Error(`DATA_INVENTORY 引用了表「${entry.table}」里不存在的列「${entry.column}」—— 改名 / 删列而未同步注册表`);
    }
  }
  for (const entry of nonPersonal) {
    if (entry.nonTableStorage === true) continue;
    const columns = columnsByTable.get(entry.table);
    if (columns === undefined) {
      throw new Error(`NON_PERSONAL_COLUMNS 引用了不存在的表「${entry.table}」（列 ${entry.column}）`);
    }
    if (!columns.has(entry.column)) {
      throw new Error(`NON_PERSONAL_COLUMNS 引用了表「${entry.table}」里不存在的列「${entry.column}」`);
    }
  }

  // 3. 含个人信息的条目必须有合法形态的 retention。
  for (const entry of inventory) {
    const retention: Retention = entry.retention;
    if (retention.kind === 'account_life') {
      if (retention.hardCapMonths !== undefined && retention.hardCapMonths !== 24) {
        throw new Error(`「${entry.table}.${entry.column}」的 hardCapMonths 只允许 24（D-17），实际 ${String(retention.hardCapMonths)}`);
      }
    } else if (retention.kind === 'fixed') {
      if (!Number.isInteger(retention.days) || retention.days < 1) {
        throw new Error(`「${entry.table}.${entry.column}」的 fixed 保存期天数必须是正整数，实际 ${String(retention.days)}`);
      }
    } else {
      throw new Error(`「${entry.table}.${entry.column}」的 retention 形态不合法：${JSON.stringify(retention)}（PRIV-08：每条含个人信息的条目必须有保存期）`);
    }
  }

  // 4. layer 为 l0 的条目禁向量列（RES-02）。
  for (const entry of inventory) {
    if (entry.layer !== 'l0') continue;
    const table = Object.values(schemaModule).find(
      (candidate): candidate is PgTable => is(candidate, PgTable) && getTableName(candidate) === entry.table,
    );
    if (table === undefined) continue; // 第 2 条已对表存在性报错，这里不重复报。
    const column = Object.values(getTableColumns(table)).find((candidate) => candidate.name === entry.column);
    if (column === undefined) continue;
    const sqlType = column.getSQLType();
    if (VECTOR_SQL_TYPE.test(sqlType)) {
      throw new Error(
        `RES-02 违反：l0 层的「${entry.table}.${entry.column}」列是向量类型 ${sqlType} —— L0 配有 ID 映射表，属去标识化而非匿名化，原文可重建的表示不得进入 L0`,
      );
    }
  }

  // 豁免清单的每一条都必须有非空理由 —— 没有理由的豁免等于没有审查。
  for (const entry of nonPersonal) {
    if (entry.justification.trim().length === 0) {
      throw new Error(`NON_PERSONAL_COLUMNS 里「${entry.table}.${entry.column}」缺少豁免理由 —— 显式豁免必须自证`);
    }
  }
}

// ─── 「我们收集了什么」的视图构造（隐私中心 + CI 断言共用）────────────────────

/** 清单条目：humanLabel 粒度（不是列粒度 —— 用户读的是 12 类，不是 100+ 列）。 */
export interface CollectedItem {
  readonly humanLabel: string;
  readonly purpose: string;
  readonly isSensitive: boolean;
}

/** 一个分组：'none' = 合同履行必要；其余 = 对应同意项。 */
export interface CollectedGroup {
  readonly scope: ConsentScope | 'none';
  readonly granted: boolean;
  readonly items: readonly CollectedItem[];
}

export interface CollectedView {
  /** 已授权且确有数据的分组（'none' 恒在；撤回的 scope 不出现 —— 消失，不是置灰）。 */
  readonly collected: readonly CollectedGroup[];
  /** 已授权但该 scope 在注册表里条目数为 0 的同意项 —— 渲染第三态「已授权 · 尚未开始收集」。 */
  readonly authorizedButNotCollecting: readonly ConsentScope[];
}

/** 每个 scope 在注册表里的条目数 —— 「确有写入路径」的判定依据，不引入第二份清单。 */
export function countEntriesPerScope(
  inventory: readonly InventoryEntry[],
): Readonly<Record<ConsentScope | 'none', number>> {
  const counts: Record<ConsentScope | 'none', number> = { none: 0 } as Record<ConsentScope | 'none', number>;
  // 先把每个 scope 初始化成 0 —— 「条目数为 0」是第三态的判定依据，undefined 会让
  // buildCollectedView 的 === 0 比较静默落空。
  for (const scope of CONSENT_SCOPES) counts[scope] = 0;
  for (const entry of inventory) {
    counts[entry.consentScope] = (counts[entry.consentScope] ?? 0) + 1;
  }
  return counts;
}

/**
 * 由 DATA_INVENTORY + 五项同意的当前状态构造「我们收集了什么」视图（RESEARCH §6.5）。
 *
 * 两份清单的分离是本阶段的需求内部裁决：同意清单（5 项）是**未来处理的合法性基础**，
 * 收集清单只列**当前真实存在**的存储 —— 把 5 项同意直接渲染成 5 组「我们收集了…」
 * 就是披露尚未发生的收集，与写「匿名」同性质（T-10-03）。
 */
export function buildCollectedView(
  inventory: readonly InventoryEntry[],
  grantedByScope: Readonly<Record<ConsentScope, boolean>>,
): CollectedView {
  const collected: CollectedGroup[] = [];
  const scopes: readonly (ConsentScope | 'none')[] = ['none', ...CONSENT_SCOPES];
  for (const scope of scopes) {
    const granted = scope === 'none' ? true : grantedByScope[scope] === true;
    if (!granted) continue; // 撤回 ⇒ 整组消失（不是置灰）。
    const items: CollectedItem[] = [];
    const seen = new Set<string>();
    for (const entry of inventory) {
      if (entry.consentScope !== scope || seen.has(entry.humanLabel)) continue;
      seen.add(entry.humanLabel);
      items.push({ humanLabel: entry.humanLabel, purpose: entry.purpose, isSensitive: entry.isSensitive });
    }
    // 条目数为 0 的已授权 scope 不建空分组 —— 它属于 authorizedButNotCollecting（第三态），
    // 渲染一个空的「我们收集了…」分组等于披露一个不存在的清单。
    if (items.length === 0) continue;
    collected.push({ scope, granted, items });
  }

  const counts = countEntriesPerScope(inventory);
  const authorizedButNotCollecting = CONSENT_SCOPES.filter(
    (scope) => grantedByScope[scope] === true && counts[scope] === 0,
  );

  return { collected, authorizedButNotCollecting };
}
