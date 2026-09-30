// POST /telemetry/error —— 前端异常上报（D-28 / RESEARCH §12.6 / T-14-01 / T-14-02）。
//
// 这是一个**未认证也开放**的写入端点，三条边界在实现之前就定死：
//   1. zod strict 白名单：未知字段直接 400 拒绝（不是忽略）—— 这同时就是
//      「不把消息正文带进 client_error」的保证。componentStack / errorMessage /
//      breadcrumb 一类字段**根本不在白名单里**（client_error 的列定义也容不下它们，
//      Plan 04 的 22 表形状是定过的，不为上报扩列 —— 比 PLAN 字面的「剥离」更强）。
//   2. 载荷大小上限 4 KiB（bodyLimit，注册在 app.ts 的挂载处）。
//   3. 按 IP（+ 可选的 Bearer token 指纹）限流：未认证更严 —— 否则这是一个免费的
//      写放大入口（T-14-01）。
//
// 写入 client_error（append-only，已登记 STORAGE_LOCATIONS）。app_role 对它的
// UPDATE/DELETE 在 0001 被 REVOKE —— 上报行落库后不可篡改。

import { createHash } from 'node:crypto';

import { Hono } from 'hono';
import { z } from 'zod';

import { clientError, db, resolveSession } from '@drift/db';

import { readSessionToken } from '../auth/session.ts';
import { logEvent } from '../../obs/logger.ts';

/** 白名单字段 —— 与 client_error 的列一一对应（D-28）。 */
export const TELEMETRY_ALLOWED_FIELDS = [
  'errorName',
  'errorCode',
  'route',
  'statusCode',
  'appVersion',
] as const;

/** 4 KiB。一条只有枚举字段的上报用不到更多。 */
export const TELEMETRY_MAX_BODY_BYTES = 4_096;

/**
 * strict：未知字段是 400，不是「剥掉继续」。
 * ⚠️ 不许把这里改成 passthrough / catchall —— 接受任意 jsonb 原样存储等于把
 * message 正文的入口交还给客户端（T-14-02，tools/ci 有 grep 守卫）。
 */
const ErrorBody = z.strictObject({
  errorName: z.string().min(1).max(128),
  errorCode: z.string().max(64).optional(),
  route: z.string().max(256).optional(),
  statusCode: z.number().int().optional(),
  appVersion: z.string().max(64).optional(),
});

/** 限流窗口与额度：未认证更严（(e) 的断言对象）。 */
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_ANONYMOUS = 20;
const RATE_LIMIT_AUTHENTICATED = 100;

interface Bucket {
  count: number;
  resetAt: number;
}

/** 进程内固定窗口（apps/api 是单进程三入口，PLAT-01 —— 不需要跨进程限流）。 */
const buckets = new Map<string, Bucket>();

function clientIp(headerIp: string | undefined): string {
  if (headerIp === undefined || headerIp.length === 0) return 'unknown';
  return headerIp.split(',')[0]?.trim() ?? 'unknown';
}

/** token 不直接进 key（它本身是凭证）：取 sha256 前 16 位做指纹。 */
function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

function rateKey(ip: string, token: string | null): string {
  return token === null ? `anon:${ip}` : `auth:${tokenFingerprint(token)}:${ip}`;
}

function allowRequest(key: string, limit: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (bucket === undefined || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    // 防御性清扫：Map 不该无界（被刷时 key 数有限，但老化条目要能退出）。
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) {
        if (v.resetAt <= now) buckets.delete(k);
      }
    }
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

/** Bearer 是否指向一个真实 session（限流分级用；解析失败按未认证处理）。 */
async function isAuthenticSession(token: string | null): Promise<boolean> {
  if (token === null) return false;
  const session = await resolveSession(token);
  return session !== null;
}

export const telemetryRoutes = new Hono();

telemetryRoutes.post('/telemetry/error', async (c) => {
  const ip = clientIp(c.req.header('x-forwarded-for'));
  const token = readSessionToken(c);
  const limit = (await isAuthenticSession(token))
    ? RATE_LIMIT_AUTHENTICATED
    : RATE_LIMIT_ANONYMOUS;

  if (!allowRequest(rateKey(ip, token), limit)) {
    // 429（T-14-01）：写放大入口在这里关死。
    logEvent('telemetry.rate_limited', { route: '/telemetry/error', statusCode: 429 }, 'warn');
    return c.json({ error: 'rate_limited' }, 429);
  }

  const parsed = ErrorBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    // 未知字段（含 componentStack 等任何越界字段）⇒ 400，不落库。
    return c.json({ error: 'invalid_body' }, 400);
  }

  const body = parsed.data;
  await db.insert(clientError).values({
    errorName: body.errorName,
    errorCode: body.errorCode ?? null,
    route: body.route ?? null,
    statusCode: body.statusCode ?? null,
    appVersion: body.appVersion ?? null,
  });
  logEvent('telemetry.recorded', { route: '/telemetry/error', statusCode: 202 });
  return c.json({ ok: true }, 202);
});
