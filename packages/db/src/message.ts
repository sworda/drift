// 消息落库 —— 三个出站出口之一（D-15），且是 message.disclosure 的**唯一**注入点。
//
// ⚠️ insertCharacterMessage 的 `text` 参数类型是 GatedText，不是 string。这不是装饰：
// 它让「一条没过出站网关的模型输出落进 message 表」在编译期不可表达。第四个出口
// 如果接受 string，类型系统不会报错 —— 那是本方案唯一的结构性缺口，靠 egress 注册表
// （Plan 06）堵。
//
// ⚠️ disclosure **不作为参数传入**。调用方给不了它，也就改不了它：法定标识的内容由
// 本文件与 @drift/contract 的常量共同决定，落库中间件统一注入（COMPLY-09）。
// PLAN 的 artifact 签名里写了 disclosure 形参，这里故意不采纳 —— 一个可传入的
// disclosure 等于把「谁负责标识」重新变成调用方的选择题，而 DB CHECK 只能保证
// 它非空，保证不了它是对的。

import { and, asc, eq, gt, sql } from 'drizzle-orm';

import {
  DISCLOSURE_LABELER_VERSION,
  type Disclosure,
  type GatedText,
} from '@drift/contract';

import type { Executor, Tx } from './client.ts';
import type { ConsentTicket } from './consent-ticket.ts';
import { conversation } from './schema/conversation.ts';
import { message, type MessageAudience, type MessageProvenance } from './schema/message.ts';

export interface InsertedMessage {
  readonly id: string;
  readonly seq: number;
  readonly createdAt: Date;
}

/**
 * per-conversation 的取号（CHAT-07）。
 *
 * ⚠️ 必须与消息插入在**同一个事务**里：UPDATE 会持有该 conversation 行的写锁，
 * 于是两条并发消息串行取号。分开两个事务的话，两条消息可能拿到同一个 seq ——
 * 唯一索引会把它变成一次写入失败（好），但在那之前 next_seq 已经前进了两次（空洞）。
 *
 * 不用全局 sequence：全局 sequence 会因其他会话消耗号而产生空洞，于是「断连后补拉
 * 是否完整」变成一个**无法断言**的问题 —— 收到 3 条还是 5 条都能解释成正常。
 */
async function nextSeq(tx: Tx, conversationId: string): Promise<number> {
  const rows = await tx
    .update(conversation)
    .set({ nextSeq: sql`${conversation.nextSeq} + 1` })
    .where(eq(conversation.id, conversationId))
    .returning({ nextSeq: conversation.nextSeq });
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`conversation ${conversationId} 不存在，无法取号`);
  }
  return row.nextSeq - 1;
}

/**
 * 用户消息落库。
 *
 * ⚠️ `ticket` 不是可选的，也不是装饰：**消息落库本身就是敏感个人信息处理**
 * （RESEARCH §6.3）。票只能由 requireConsent() 在查过 consent 表之后发出，于是
 * 「sensitive_pi 被撤回之后仍然往库里写消息」在编译期就写不出来 —— 而不是靠每个
 * 写入点各自记得去查一次。Phase 1 只有这一个 scope 有真实数据流，因此也**只有**
 * 这一个 scope 有消费方（给另外三个造消费点会造出无数据流的假消费，
 * 让 Plan 10 的「尚未开始收集」态失去意义）。
 */
export async function insertUserMessage(
  tx: Tx,
  input: {
    readonly conversationId: string;
    readonly text: string;
    readonly provenance: MessageProvenance;
    readonly ticket: ConsentTicket<'sensitive_pi'>;
  },
): Promise<InsertedMessage> {
  const seq = await nextSeq(tx, input.conversationId);
  const rows = await tx
    .insert(message)
    .values({
      conversationId: input.conversationId,
      seq,
      senderKind: 'user',
      text: input.text,
      // 用户消息没有 AI 标识。DB CHECK 只要求角色消息非空。
      disclosure: null,
      provenance: input.provenance,
      audience: 'user',
    })
    .returning({ id: message.id, seq: message.seq, createdAt: message.createdAt });
  const row = rows[0];
  if (row === undefined) throw new Error('用户消息插入未返回行');
  return row;
}

export interface InsertedCharacterMessage extends InsertedMessage {
  readonly disclosure: Disclosure;
}

/**
 * 角色消息落库。**出口签名只接受 GatedText。**
 *
 * @param input.text 已通过 packages/safety 的 safetyGateway() 的文本。
 * @param input.ticket sensitive_pi 的同意票据 —— 理由同 insertUserMessage。
 *   角色消息同样进 message 表，同样是这个用户的敏感个人信息处理。
 */
export async function insertCharacterMessage(
  tx: Tx,
  input: {
    readonly conversationId: string;
    readonly text: GatedText;
    readonly provenance: MessageProvenance;
    readonly audience?: MessageAudience;
    readonly ticket: ConsentTicket<'sensitive_pi'>;
  },
): Promise<InsertedCharacterMessage> {
  const seq = await nextSeq(tx, input.conversationId);
  const disclosure: Disclosure = {
    kind: 'ai_generated',
    labeledAt: new Date().toISOString(),
    labelerVersion: DISCLOSURE_LABELER_VERSION,
  };
  const rows = await tx
    .insert(message)
    .values({
      conversationId: input.conversationId,
      seq,
      senderKind: 'character',
      text: input.text,
      disclosure,
      provenance: input.provenance,
      audience: input.audience ?? 'user',
    })
    .returning({ id: message.id, seq: message.seq, createdAt: message.createdAt });
  const row = rows[0];
  if (row === undefined) throw new Error('角色消息插入未返回行');
  return { ...row, disclosure };
}

export interface ListedMessage {
  readonly id: string;
  readonly seq: number;
  readonly senderKind: 'user' | 'character' | 'system';
  readonly text: string;
  readonly disclosure: Disclosure | null;
  readonly createdAt: Date;
}

/**
 * 重连补拉（CHAT-07 / CHAT-06）。
 *
 * 离线期间不推送，上线时按游标补齐 —— DB 是真相源（STACK §4）。
 * 按 seq 升序返回，调用方据此判断有无空洞。
 */
export async function listMessagesAfterSeq(
  executor: Executor,
  conversationId: string,
  afterSeq: number,
): Promise<readonly ListedMessage[]> {
  return executor
    .select({
      id: message.id,
      seq: message.seq,
      senderKind: message.senderKind,
      text: message.text,
      disclosure: message.disclosure,
      createdAt: message.createdAt,
    })
    .from(message)
    .where(and(eq(message.conversationId, conversationId), gt(message.seq, afterSeq)))
    .orderBy(asc(message.seq));
}
