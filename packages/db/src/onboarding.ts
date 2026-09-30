// 会话解析 —— 按不透明 token 查 better-auth 的 session 表。
//
// ── Plan 09 的变更 ──────────────────────────────────────────────────────────
// 本文件原先还承载注册事务（邀请码消耗 + scrypt 建账号 + 五条同意），那是 01-04 为了
// 让 tracer 能断言「并发邀请码恰好一个成功」而交付的**前身**。Plan 09 按计划把建账号
// 那一步换成 better-auth 1.7.6 的 server API，于是整条注册事务上移到
// `apps/api/src/modules/auth/register.ts`：**packages/db 不得依赖 better-auth**
// —— 它是一个 HTTP 框架化的认证库，把它拖进数据层会让 seed / 迁移 / drizzle-kit
// 全都间接依赖一个认证配置（含 secret）。
//
// 留在这里的只有 resolveSession：session 表是 schema 的一部分，而「按 token 解析身份」
// 是一次纯粹的数据读取。better-auth 写的就是这张表、这一列，所以这是同一份真相。
//
// ⚠️ **不存在**任何「请求里带 userId 就当成登录」的路径（T-04-01）。

import { and, eq, sql } from 'drizzle-orm';

import { tx } from './client.ts';
import { session } from './schema/auth.ts';

export interface ResolvedSession {
  readonly userId: string;
}

/** 按不透明 token 解析会话。过期即视为未登录（不自动续期）。 */
export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  const rows = await tx(async (t) =>
    t
      .select({ userId: session.userId })
      .from(session)
      .where(and(eq(session.token, token), sql`${session.expiresAt} > now()`)),
  );
  return rows[0] ?? null;
}
