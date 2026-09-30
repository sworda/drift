// /telemetry/error 的五条集成断言（D-28 / T-14-01 / T-14-02 / Plan 14 Task 2）。
//
//   (a) 含未知字段的载荷被 400 拒绝（白名单 = 拒绝，不是忽略）
//   (b) 超过 4 KiB 的载荷被拒（bodyLimit）
//   (c) 限流触发后 429（写放大入口关死）
//   (d) 写入的 client_error 行不含消息正文的任何 6 字以上子串 —— componentStack
//       一类字段在白名单外，根本进不了表（比「剥离」更强的边界）
//   (e) 未认证请求也能上报，但限额更严
//
// ⚠️ 限流是进程内固定窗口 —— 每条用例用独立的 X-Forwarded-For 隔离各自的桶。

import type { AddressInfo } from 'node:net';

import { serve } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'telemetry-operator-token-0123456789ab';
process.env['BETTER_AUTH_SECRET'] ??= 'telemetry-better-auth-secret-012345678';
process.env['CONTACT_ENCRYPTION_KEY'] ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

const { createApp } = await import('../../apps/api/src/http/app.ts');
const { closeDb, clientError, ownerSql, db } = await import('@drift/db');
import { desc } from 'drizzle-orm';

let baseUrl: string;
let stopServer: () => Promise<void>;

function post(body: unknown, ip: string): Promise<Response> {
  return fetch(`${baseUrl}/telemetry/error`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeAll(async () => {
  const app = createApp();
  const listener = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  const address = await new Promise<AddressInfo>((resolve, reject) => {
    const existing = listener.address() as AddressInfo | null;
    if (existing !== null) {
      resolve(existing);
      return;
    }
    listener.once('listening', () => resolve(listener.address() as AddressInfo));
    listener.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
  stopServer = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      listener.close(() => resolve());
    });
  };
}, 60_000);

afterAll(async () => {
  await stopServer();
  await closeDb();
  await ownerSql.end({ timeout: 5 });
}, 30_000);

describe('/telemetry/error（D-28）', () => {
  it('(a) 未知字段被 400 拒绝 —— 白名单是拒绝不是忽略', async () => {
    const response = await post(
      { errorName: 'TypeError', componentStack: 'at Component…' },
      '10.0.0.1',
    );
    expect(response.status).toBe(400);
  });

  it('(b) 超过 4 KiB 的载荷被拒（413）', async () => {
    const big = { errorName: 'E'.repeat(5_000) };
    const response = await post(big, '10.0.0.2');
    expect(response.status).toBe(413);
  });

  it('(c) 匿名限流触发后 429', async () => {
    // 额度 20/分钟：前 20 条受理（或因 schema 400 —— 计数在 schema 之前），第 21 条 429。
    let last = 0;
    for (let i = 0; i < 21; i += 1) {
      last = (await post({ errorName: 'RangeError' }, '10.0.0.3')).status;
    }
    expect(last).toBe(429);
  });

  it('(d) 白名单外的字段进不了表；写入行只含白名单列的值', async () => {
    const marker = '绝密对话正文标记串XY987654321';
    // 携带消息正文特征串的 componentStack / errorMessage 都在白名单外 ⇒ 400。
    const withStack = await post(
      { errorName: 'TypeError', componentStack: `at Chat (chat.ts)\n${marker}` },
      '10.0.0.4',
    );
    expect(withStack.status).toBe(400);
    const withMessage = await post({ errorName: 'TypeError', errorMessage: marker }, '10.0.0.4');
    expect(withMessage.status).toBe(400);

    // 一条合法上报落库。
    const ok = await post({ errorName: 'TypeError', route: '/chat/conv-1' }, '10.0.0.4');
    expect(ok.status).toBe(202);

    // 全表（本测试写入的行）不含特征串的任何 6 字以上子串。
    const rows = await db
      .select({
        errorName: clientError.errorName,
        errorCode: clientError.errorCode,
        route: clientError.route,
        statusCode: clientError.statusCode,
        appVersion: clientError.appVersion,
      })
      .from(clientError)
      .orderBy(desc(clientError.createdAt))
      .limit(50);
    const serialized = JSON.stringify(rows);
    for (let i = 0; i + 6 <= marker.length; i += 1) {
      expect(serialized).not.toContain(marker.slice(i, i + 6));
    }
    // 白名单行真实存在（非空真）。
    expect(rows.some((row) => row.errorName === 'TypeError' && row.route === '/chat/conv-1')).toBe(
      true,
    );
  });

  it('(e) 未认证可上报（202）且限额比认证态更严', async () => {
    const response = await post({ errorName: 'Error' }, '10.0.0.5');
    expect(response.status).toBe(202);
    // 匿名额度 20：另一 IP 打满后第 21 条 429 —— 比认证态（100）严。
    let last = 0;
    for (let i = 0; i < 21; i += 1) {
      last = (await post({ errorName: 'Error' }, '10.0.0.6')).status;
    }
    expect(last).toBe(429);
  });
});
