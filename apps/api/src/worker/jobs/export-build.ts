// 导出作业（PRIV-04 / COMPLY-02 / D-17）—— 双格式产物 + 逐条标识。
//
// ── 作业 data 不带 userId ───────────────────────────────────────────────────
// 与删除作业同一形态（见 account-deletion.ts 的说明）：pgboss 的 jsonb 载荷是注册
// 表登记的存储位置，userId 放在 privacy_action.payload（删除流程自己的位置）。
//
// ── 覆盖范围（个保法第四十五条：用户能看到的全部内容 + 系统形成的画像结论）──
// Phase 1 无画像，导出七类：消息、会话、好友关系、五项同意的当前状态与变更历史、
// 安全事件（脱敏到「发生过一次二级干预」级别，不含正文 —— 事实上表里本来就没有
// 正文，candidate_reply_hash 不可逆）、使用时长段、紧急联系人（联系方式遮蔽）。
//
// ── 标识注入（COMPLY-02/09）────────────────────────────────────────────────
// [AI] 前缀与文件头三行由 render.ts 注入（管道统一），.json 的每条角色消息对象
// 带 disclosure 字段（message.disclosure 的原样副本）。
//
// 零 env 依赖：执行器、目录与观察点从参数进来（consent-reconcile 的同一手法）。

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { desc, eq, inArray } from 'drizzle-orm';

import type { Disclosure } from '@drift/contract';
import { gatedFromStoredCharacterMessage } from '@drift/safety';
import {
  character,
  consent,
  consentEvent,
  conversation,
  emergencyContact,
  friendship,
  message,
  privacyAction,
  safetyEvent,
  usageSegment,
  type Executor,
} from '@drift/db';
import { maskedContactOf } from '../../modules/safety/masked-contact.ts';

import type { PgBoss } from 'pg-boss';

import { renderExportHeader, renderExportLine, renderExportUserLine } from '../../modules/export/render.ts';

/** pg-boss 队列名。 */
export const EXPORT_BUILD_QUEUE = 'export-build';

/** 队列策略 short：同 key（= userId，send 时指定）最多一个待执行作业。 */
export const EXPORT_BUILD_QUEUE_POLICY = 'short';

/** 作业 data（不含 userId —— 见文件头）。 */
export interface ExportBuildJobPayload {
  readonly exportId: string;
}

/** pending 行载荷。 */
interface PendingPayload {
  readonly status: 'pending';
  readonly userId: string;
}

/** D-17：导出产物 7 天 TTL（gc 作业与回执上的到期时间共用这一个常量）。 */
export const EXPORT_TTL_DAYS = 7;

export interface ExportFiles {
  readonly md: string;
  readonly json: string;
  readonly expiresAt: string;
}

export type ExportBuildPayload =
  | (PendingPayload & { readonly status: 'pending' })
  | { readonly status: 'failed' }
  | ({ readonly status: 'complete' } & ExportFiles);

/**
 * 建立一个导出动作：同一事务里写 privacy_action 的 pending 行 + 入队。
 */
export async function createExportAction(
  boss: PgBoss,
  executor: Executor,
  userId: string,
): Promise<{ readonly exportId: string }> {
  const inserted = await executor
    .insert(privacyAction)
    .values({
      userId,
      kind: 'export',
      payload: { status: 'pending', userId } as unknown as Record<string, unknown>,
    })
    .returning({ id: privacyAction.id });
  const exportId = inserted[0]?.id;
  if (exportId === undefined) throw new Error('privacy_action 插入未返回 id');

  const jobId = await boss.send(
    EXPORT_BUILD_QUEUE,
    { exportId } satisfies ExportBuildJobPayload,
    { singletonKey: userId },
  );
  void jobId; // short 策略下重复请求会去重为 null —— 已有作业在队列是正确的幂等状态。
  return { exportId };
}

// ─── 数据收集（七类）──────────────────────────────────────────────────────

/** 一条消息的导出形态（.json 的数组元素；.md 逐行渲染）。 */
export interface ExportedMessage {
  readonly conversationId: string;
  readonly seq: number;
  readonly senderKind: 'user' | 'character' | 'system';
  readonly text: string;
  /** 仅角色消息非空（DB CHECK 保证）；.json 的每条角色消息对象必须带它（断言 (c)）。 */
  readonly disclosure: Disclosure | null;
  readonly createdAt: string;
}

export interface ExportedSafetyEvent {
  readonly level: string;
  readonly previousLevel: string;
  readonly createdAt: string;
  readonly classifierStatus: string;
}

export interface ExportBundle {
  readonly conversations: { readonly id: string; readonly status: string; readonly createdAt: string }[];
  readonly messages: readonly ExportedMessage[];
  readonly friendships: { readonly characterId: string; readonly relationship: string; readonly createdAt: string }[];
  readonly consents: { readonly scope: string; readonly granted: boolean; readonly policyVersion: string }[];
  readonly consentEvents: { readonly scope: string; readonly action: string; readonly policyVersion: string; readonly createdAt: string }[];
  readonly safetyEvents: readonly ExportedSafetyEvent[];
  readonly usageSegments: { readonly startedAt: string; readonly lastActivityAt: string; readonly accumulatedSeconds: number }[];
  readonly emergencyContact: { readonly kind: string; readonly name: string; readonly contactMasked: string } | null;
}

/**
 * 收集一个用户的全部导出数据。**已删除的用户返回空集**（断言 (h)：删除后再次
 * 导出返回空集 —— 每一类查询都以 user_id 的存在为前提）。
 */
export async function collectExportBundle(executor: Executor, userId: string): Promise<ExportBundle> {
  const conversations = await executor
    .select({ id: conversation.id, status: conversation.status, createdAt: conversation.createdAt })
    .from(conversation)
    .where(eq(conversation.userId, userId));
  const conversationIds = conversations.map((row) => row.id);

  const messageRows =
    conversationIds.length === 0
      ? []
      : await executor
          .select({
            conversationId: message.conversationId,
            seq: message.seq,
            senderKind: message.senderKind,
            text: message.text,
            disclosure: message.disclosure,
            createdAt: message.createdAt,
          })
          .from(message)
          .where(inArray(message.conversationId, conversationIds))
          .orderBy(message.conversationId, message.seq);

  const [friendRows, consentRows, consentEventRows, safetyRows, usageRows, contactRows] = await Promise.all([
    executor
      .select({ characterId: friendship.characterId, relationship: friendship.relationship, createdAt: friendship.createdAt })
      .from(friendship)
      .where(eq(friendship.userId, userId)),
    executor
      .select({ scope: consent.scope, granted: consent.granted, policyVersion: consent.policyVersion })
      .from(consent)
      .where(eq(consent.userId, userId)),
    executor
      .select({ scope: consentEvent.scope, action: consentEvent.action, policyVersion: consentEvent.policyVersion, createdAt: consentEvent.createdAt })
      .from(consentEvent)
      .where(eq(consentEvent.userId, userId)),
    executor
      .select({
        level: safetyEvent.level,
        previousLevel: safetyEvent.previousLevel,
        createdAt: safetyEvent.createdAt,
        classifierStatus: safetyEvent.classifierStatus,
      })
      .from(safetyEvent)
      .where(eq(safetyEvent.userId, userId))
      .orderBy(desc(safetyEvent.createdAt)),
    executor
      .select({ startedAt: usageSegment.startedAt, lastActivityAt: usageSegment.lastActivityAt, accumulatedSeconds: usageSegment.accumulatedSeconds })
      .from(usageSegment)
      .where(eq(usageSegment.userId, userId)),
    executor
      .select({ kind: emergencyContact.kind, name: emergencyContact.name, ref: emergencyContact.contactRefEncrypted })
      .from(emergencyContact)
      .where(eq(emergencyContact.userId, userId))
      .limit(1),
  ]);

  return {
    conversations: conversations.map((row) => ({ id: row.id, status: row.status, createdAt: row.createdAt.toISOString() })),
    messages: messageRows.map((row) => ({
      conversationId: row.conversationId,
      seq: row.seq,
      senderKind: row.senderKind,
      text: row.text,
      disclosure: row.disclosure,
      createdAt: row.createdAt.toISOString(),
    })),
    friendships: friendRows.map((row) => ({ characterId: row.characterId, relationship: row.relationship, createdAt: row.createdAt.toISOString() })),
    consents: consentRows,
    consentEvents: consentEventRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    safetyEvents: safetyRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    usageSegments: usageRows.map((row) => ({ startedAt: row.startedAt.toISOString(), lastActivityAt: row.lastActivityAt.toISOString(), accumulatedSeconds: row.accumulatedSeconds })),
    emergencyContact:
      contactRows[0] === undefined
        ? null
        : {
            kind: contactRows[0].kind,
            name: contactRows[0].name,
            // 第三方的个人信息：只出遮蔽形态（138****1234），明文不进导出文件。
            contactMasked: maskedContactOf(contactRows[0].ref),
          },
  };
}

// ─── 渲染（.md / .json）──────────────────────────────────────────────────

/**
 * 渲染 .md 正文。文件头三行 + 逐条消息（角色行带 [AI]，由 renderExportLine 注入）。
 */
export function renderExportMarkdown(bundle: ExportBundle, conversationNameOf: (conversationId: string) => string, exportedAt: Date): string {
  const lines: string[] = [renderExportHeader(exportedAt), ''];
  lines.push('## 消息');
  for (const item of bundle.messages) {
    if (item.senderKind === 'character') {
      // 历史角色消息：disclosure 是「过过网关」的留证，经受控通道恢复为 GatedText。
      const gated = gatedFromStoredCharacterMessage(item.text, item.disclosure as Disclosure);
      lines.push(renderExportLine(gated, { characterName: conversationNameOf(item.conversationId), createdAt: new Date(item.createdAt) }));
    } else if (item.senderKind === 'user') {
      lines.push(renderExportUserLine(item.text, { createdAt: new Date(item.createdAt) }));
    }
  }
  lines.push('', '## 会话');
  for (const item of bundle.conversations) lines.push(`- ${item.id}（${item.status}，开始于 ${item.createdAt}）`);
  lines.push('', '## 好友关系');
  for (const item of bundle.friendships) lines.push(`- ${item.characterId}（${item.relationship}，自 ${item.createdAt}` + '）');
  lines.push('', '## 同意');
  for (const item of bundle.consents) lines.push(`- ${item.scope}：${item.granted ? '已授权' : '已撤回'}（同意的是 ${item.policyVersion} 那一版政策）`);
  for (const item of bundle.consentEvents) lines.push(`- ${item.createdAt} ${item.action} ${item.scope}（${item.policyVersion}）`);
  lines.push('', '## 安全事件');
  for (const item of bundle.safetyEvents) lines.push(`- ${item.createdAt}：发生了一次${item.level === 'crisis' ? '危机' : item.level === 'elevated' ? '二级干预' : '风险判定'}（${item.level}，分类器${item.classifierStatus === 'ok' ? '正常' : '未能给出判定'}）`);
  lines.push('', '## 使用时长');
  for (const item of bundle.usageSegments) lines.push(`- ${item.startedAt} 起，累计 ${String(item.accumulatedSeconds)} 秒`);
  lines.push('', '## 紧急联系人');
  if (bundle.emergencyContact === null) {
    lines.push('-（未填写）');
  } else {
    lines.push(`- ${bundle.emergencyContact.name}（${bundle.emergencyContact.kind === 'guardian' ? '监护人' : '紧急联系人'}，${bundle.emergencyContact.contactMasked}）`);
  }
  return lines.join('\n');
}

/** 渲染 .json：header 三行元数据 + 七类数据；每条角色消息对象带 disclosure 字段。 */
export function renderExportJson(bundle: ExportBundle, exportedAt: Date): string {
  return JSON.stringify(
    {
      header: {
        service: 'Drift',
        disclosure: '本文件全部角色消息由 AI 生成',
        exportedAt: exportedAt.toISOString(),
      },
      conversations: bundle.conversations,
      messages: bundle.messages,
      friendships: bundle.friendships,
      consents: bundle.consents,
      consentEvents: bundle.consentEvents,
      safetyEvents: bundle.safetyEvents,
      usageSegments: bundle.usageSegments,
      emergencyContact: bundle.emergencyContact,
    },
    null,
    2,
  );
}

// ─── 作业体 ───────────────────────────────────────────────────────────────

export interface ExportBuildDeps {
  readonly executor: Executor;
  readonly exportArtifactsDir: string;
  readonly now?: Date;
  /** 角色名解析（消息 → 会话 → 角色）。测试可注入。 */
  readonly characterNameOf?: (characterId: string) => string;
}

/** 待执行作业体（测试直调；worker handler 也走这里）。 */
export async function runExportBuildJob(deps: ExportBuildDeps, exportId: string): Promise<ExportBuildPayload> {
  const rows = await deps.executor
    .select({ payload: privacyAction.payload })
    .from(privacyAction)
    .where(eq(privacyAction.id, exportId))
    .limit(1);
  const payload = rows[0]?.payload as { readonly status?: string; readonly userId?: string } | undefined;
  if (payload === undefined) throw new Error(`导出动作行 ${exportId} 不存在`);
  if (payload.status === 'complete' || payload.status === 'failed') return payload as ExportBuildPayload;
  if (payload.userId === undefined) throw new Error(`导出动作行 ${exportId} 的 pending 载荷不完整`);

  try {
    const bundle = await collectExportBundle(deps.executor, payload.userId);
    // 会话 → 角色名：预先一次查齐（消息行渲染要的是可读名字，不是 sender_kind）。
    const convIdToCharacter = await deps.executor
      .select({ conversationId: conversation.id, characterName: character.name })
      .from(conversation)
      .innerJoin(character, eq(character.id, conversation.characterId))
      .where(eq(conversation.userId, payload.userId));
    const nameMap = new Map(convIdToCharacter.map((row) => [row.conversationId, row.characterName]));
    const nameOf = deps.characterNameOf ?? ((conversationId: string) => nameMap.get(conversationId) ?? '角色');
    const now = deps.now ?? new Date();
    const expiresAt = new Date(now.getTime() + EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000);
    const md = renderExportMarkdown(bundle, nameOf, now);
    const json = renderExportJson(bundle, now);

    const dir = join(deps.exportArtifactsDir, payload.userId);
    await mkdir(dir, { recursive: true });
    const mdPath = `${exportId}.md`;
    const jsonPath = `${exportId}.json`;
    await writeFile(join(dir, mdPath), md, 'utf8');
    await writeFile(join(dir, jsonPath), json, 'utf8');

    const finalPayload: ExportBuildPayload & ExportFiles = {
      status: 'complete',
      md: mdPath,
      json: jsonPath,
      expiresAt: expiresAt.toISOString(),
    };
    await deps.executor
      .update(privacyAction)
      .set({ payload: finalPayload as unknown as Record<string, unknown> })
      .where(eq(privacyAction.id, exportId));
    return finalPayload;
  } catch {
    // 失败也要落终态（前端据此渲染「导出没有完成」—— 空转的 pending 是无界等待）。
    const failedPayload: ExportBuildPayload = { status: 'failed' };
    await deps.executor
      .update(privacyAction)
      .set({ payload: failedPayload as unknown as Record<string, unknown> })
      .where(eq(privacyAction.id, exportId));
    return failedPayload;
  }
}

/** 建队列 + 注册 worker。 */
export async function registerExportBuild(boss: PgBoss, deps: ExportBuildDeps): Promise<void> {
  await boss.createQueue(EXPORT_BUILD_QUEUE, { policy: EXPORT_BUILD_QUEUE_POLICY });
  await boss.work<ExportBuildJobPayload>(EXPORT_BUILD_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await runExportBuildJob(deps, job.data.exportId);
    }
  });
}
