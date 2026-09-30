// GET /healthz —— Docker healthcheck 与部署验收的**唯一**探针（RESEARCH §2.3）。
//
// 它必须真的查数据库，而不是回一个常量。理由：一个永远返回 200 的 healthz 会让
// `docker compose up -d --wait` 在数据库其实没起来的情况下也判成功，而那正是
// 「单机全栈起得来」这条验收想排除的情况。
//
// 三个字段各自对应 PLAT-02 的一个组成部分：
//   db       —— select 1，连接池活着
//   pgvector —— 扩展的实际 extversion（必须 ≥0.8.2，CVE-2026-3172）
//   pgboss   —— pgboss schema 里确实有表，即 boss.start() 跑完了自己的迁移
// 任一项失败返回 503：降级不是健康。

import { Hono } from 'hono';

import { sql } from '../db/client.ts';
import { logError, logEvent } from '../obs/logger.ts';
import { PGBOSS_SCHEMA } from '../worker/index.ts';

export const HEALTH_PATH = '/healthz';

export interface HealthBody {
  readonly status: 'ok' | 'degraded';
  readonly db: 'ok' | null;
  /** pgvector 的 extversion 原文，例如 "0.8.6"。查不到扩展时为 null。 */
  readonly pgvector: string | null;
  readonly pgboss: 'ok' | null;
}

async function probeDb(): Promise<'ok' | null> {
  try {
    const rows = await sql<{ readonly ok: number }[]>`select 1 as ok`;
    return rows.length === 1 ? 'ok' : null;
  } catch (error) {
    logError('health.db_probe_failed', error);
    return null;
  }
}

async function probePgvector(): Promise<string | null> {
  try {
    const rows = await sql<{ readonly extversion: string }[]>`
      select extversion from pg_extension where extname = 'vector'
    `;
    return rows[0]?.extversion ?? null;
  } catch (error) {
    logError('health.pgvector_probe_failed', error);
    return null;
  }
}

async function probePgboss(): Promise<'ok' | null> {
  try {
    const rows = await sql<{ readonly tables: number }[]>`
      select count(*)::int as tables
      from information_schema.tables
      where table_schema = ${PGBOSS_SCHEMA}
    `;
    return (rows[0]?.tables ?? 0) > 0 ? 'ok' : null;
  } catch (error) {
    logError('health.pgboss_probe_failed', error);
    return null;
  }
}

export async function probeHealth(): Promise<HealthBody> {
  const [db, pgvector, pgboss] = await Promise.all([probeDb(), probePgvector(), probePgboss()]);
  const healthy = db === 'ok' && pgvector !== null && pgboss === 'ok';
  return { status: healthy ? 'ok' : 'degraded', db, pgvector, pgboss };
}

export const healthRoutes = new Hono();

healthRoutes.get(HEALTH_PATH, async (c) => {
  const body = await probeHealth();
  if (body.status !== 'ok') {
    logEvent('health.degraded', { route: HEALTH_PATH, statusCode: 503 }, 'warn');
    return c.json(body, 503);
  }
  return c.json(body, 200);
});
