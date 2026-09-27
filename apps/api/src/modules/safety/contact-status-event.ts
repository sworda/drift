// safety.contact_status 下行事件的构造与投递（SAFE-04 / Plan 08 Task 2）。
//
// ── 这条事件存在的理由 ────────────────────────────────────────────────────
// 二级卡片的联络状态行必须由**服务端** contact_attempt.status 驱动（UI-SPEC
// 〔法定〕）。卡片初次渲染时的状态随 HTTP 响应（TurnResult.reply.careCard）到达，
// 但之后的每一次推进（运营者确认 delivered / 标记 failed / 10 分钟超时置 failed）
// 都发生在另一个进程时间里 —— 用户正盯着那张卡片。没有这条事件，界面上那句
//「正在联系」会一直挂到用户刷新为止，而那正是「不告知联络结果」的静默形态。
//
// ── 载荷里为什么没有正文 ───────────────────────────────────────────────────
// 只带 id / 状态 / 姓名 / 遮蔽号码。对话文本从来不出现在安全事件的载荷里
//（SAFE-16 同一条原则）；号码只能是遮蔽形态 —— 第三方的个人信息。
//
// ── 投递失败不回滚状态 ─────────────────────────────────────────────────────
// contact_attempt 的推进先落库、后发事件。反过来会让「运营者点了确认但界面没变」
// 变成一次回滚 —— 而数据库里的 delivered 是真人已通话的事实，不能因为一条 WS
// 投递没送出去就撤销。客户端断线期间的推进由重连重建补齐（该读接口属后续 plan）。

import { eq } from 'drizzle-orm';

import {
  contactAttempt,
  decryptContact,
  emergencyContact,
  maskContact,
  safetyEvent,
  type Executor,
} from '@drift/db';

import { logError } from '../../obs/logger.ts';
import { publish } from '../../ws/server.ts';

/**
 * 读一行 contact_attempt 并把它变成 safety.contact_status 事件。
 *
// 返回 null 表示这一行不存在（或解不出会话）—— 调用方按「无事件可发」处理，
// 不抛错：事件是通知，不是留证；留证已经在 contact_attempt 落库时完成了。
 */
async function buildContactStatusEvent(
  executor: Executor,
  attemptId: string,
): Promise<{ conversationId: string; payload: unknown } | null> {
  const rows = await executor
    .select({
      userId: contactAttempt.userId,
      status: contactAttempt.status,
      contactRef: contactAttempt.contactRef,
      conversationId: safetyEvent.conversationId,
    })
    .from(contactAttempt)
    .innerJoin(safetyEvent, eq(safetyEvent.id, contactAttempt.safetyEventId))
    .where(eq(contactAttempt.id, attemptId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;

  const contacts = await executor
    .select({ name: emergencyContact.name, ref: emergencyContact.contactRefEncrypted })
    .from(emergencyContact)
    .where(eq(emergencyContact.userId, row.userId))
    .limit(1);
  const contact = contacts[0];

  // 遮蔽形态只对 delivered 有意义（failed / unavailable 的文案不引用号码）。
  // 解不开就给 null —— 渲染层本来就容忍 null，一个假号码比没有号码更糟。
  let contactMasked: string | null = null;
  if (row.status === 'delivered' && contact !== undefined) {
    try {
      contactMasked = maskContact(decryptContact(contact.ref));
    } catch {
      contactMasked = null;
    }
  }

  return {
    conversationId: row.conversationId,
    payload: {
      conversationId: row.conversationId,
      attemptId,
      status: row.status,
      contactName: contact?.name ?? null,
      contactMasked,
    },
  };
}

/**
 * 把一次 contact_attempt 的推进广播给正在看二级卡片的客户端。
 *
// 投递数（0 = 客户端不在线）不是错误 —— DB 是真相源，重连重建会补上。
// 本函数**不抛错**：推进已经落库，一次事件构造失败不该让调用方误以为状态
// 没写进去（那会让运营者重试一次已经完成的确认）。失败只留一条日志。
 */
export async function publishContactStatusEvent(
  executor: Executor,
  attemptId: string,
): Promise<number> {
  try {
    const event = await buildContactStatusEvent(executor, attemptId);
    if (event === null) return 0;
    return publish(event.conversationId, {
      // payload 已在构造处逐字段填好；这里只声明 type —— publish 的类型要求
      // 完整事件对象，下面的展开让 zod 契约之外的构造点不存在。
      ...({ type: 'safety.contact_status' } as const),
      payload: event.payload as {
        conversationId: string;
        attemptId: string;
        status: 'pending' | 'delivered' | 'failed' | 'unavailable';
        contactName: string | null;
        contactMasked: string | null;
      },
    });
  } catch (error) {
    // 白名单字段里没有 attemptId —— 用 contactAttemptStatus 标记这一次失败的阶段。
    // 排查靠错误名与进程日志的时间线，而不是把更多标识塞进日志。
    logError('contact_status.publish_failed', error, { contactAttemptStatus: 'unknown' });
    return 0;
  }
}