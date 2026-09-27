// L5 集成层的共享 fixture —— 建一个用户 + 一个会话，**不经 HTTP**。
//
// 为什么不复用 tracer.test.ts 的注册流程：那条链路的被测对象是注册本身（邀请码并发、
// 五项同意、policy_version）。危机路径的被测对象是 turn 编排，走一次完整 HTTP 注册只会
// 把两件事的失败原因混在一起 —— 注册接口改了形状会让危机测试变红，而那与危机无关。
//
// ⚠️ 本文件**不是** *.test.ts，所以 vitest 不会收集它（include 只匹配 *.test.ts）。

import { randomUUID } from 'node:crypto';

import { asc } from 'drizzle-orm';

import { CONSENT_SCOPES, REQUIRED_SCOPES } from '@drift/contract';
import { character, consent, conversation, inviteCode, ownerDb, user } from '@drift/db';

/**
 * fixture 用户的政策版本。真实注册取 privacy.md 的内容哈希（apps/api 的 register.ts），
 * 这里不去算它 —— 本 fixture 不经 HTTP，被测对象也不是 policy_version。
 */
const FIXTURE_POLICY_VERSION = 'pv_fixture';

export interface SeededConversation {
  readonly userId: string;
  readonly conversationId: string;
  readonly characterId: string;
}

/** 取种子角色里的第一个（seed 保证有 3 个且各带一个生效的 persona_version）。 */
export async function firstSeededCharacterId(): Promise<string> {
  const rows = await ownerDb
    .select({ id: character.id })
    .from(character)
    .orderBy(asc(character.id))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new Error('种子角色为空 —— setup.ts 的 seed 没有跑成功');
  return row.id;
}

/**
 * 建一个用户与一个 active 会话。
 *
 * 用 ownerDb 而不是 db（app_role）：fixture 是测试装置，它要建的是 app_role 在生产里
 * 由注册流程建的那些行；用 owner 身份建它们，可以让被测代码那一侧的权限约束（审计表
 * 族的 REVOKE）仍然是真实生效的那一份。
 */
export async function seedConversation(label: string): Promise<SeededConversation> {
  const characterId = await firstSeededCharacterId();
  const code = `${label}-${randomUUID().slice(0, 8)}`;
  const userId = randomUUID();
  await ownerDb.insert(inviteCode).values({ code, createdBy: label });
  await ownerDb.insert(user).values({
    id: userId,
    name: label,
    email: `${label}-${userId.slice(0, 8)}@example.invalid`,
    birthDate: '1995-06-15',
    inviteCodeId: code,
  });
  // 五条同意。**不能省**：生产里每个 user 恰好有 CONSENT_SCOPES.length 行 consent，
  // 而 consent-reconcile 的日对账断言的就是这条全库不变式（T-09-02）。一个没有同意行
  // 的 fixture 用户会让那条对账在测试库里永远为假 —— 于是「残缺账号被检出」这条断言
  // 变成空真，而它正是这条对账存在的理由。
  await ownerDb.insert(consent).values(
    CONSENT_SCOPES.map((scope) => ({
      userId,
      scope,
      granted: REQUIRED_SCOPES.includes(scope),
      policyVersion: FIXTURE_POLICY_VERSION,
    })),
  );

  const conversationRows = await ownerDb
    .insert(conversation)
    .values({ userId, characterId })
    .returning({ id: conversation.id });
  const conversationId = conversationRows[0]?.id;
  if (conversationId === undefined) throw new Error('会话插入未返回行');
  return { userId, conversationId, characterId };
}
