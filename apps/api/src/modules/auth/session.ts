// 会话解析 —— 路由的**唯一**身份来源。
//
// ⚠️ 身份只来自 Authorization: Bearer <token> → session 表的一行。
// **不存在**任何「请求里带 userId 就当成登录」的路径：那种形态在开发期看起来省事，
// 在上线后是一个任何人都能冒用任何账号的越权入口（T-04-01）。
//
// Plan 09 用 better-auth 的 session 处理替换这里的查表 —— 表结构就是 better-auth 的
// session 表，所以那是一次替换而不是一次迁移。

import type { Context } from 'hono';

import { resolveSession } from '@drift/db';

const BEARER_PREFIX = 'Bearer ';

export function readSessionToken(c: Context): string | null {
  const header = c.req.header('authorization');
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

/** 解析出 userId；未登录或会话过期返回 null。调用方据此回 401。 */
export async function currentUserId(c: Context): Promise<string | null> {
  const token = readSessionToken(c);
  if (token === null) return null;
  const session = await resolveSession(token);
  return session?.userId ?? null;
}
