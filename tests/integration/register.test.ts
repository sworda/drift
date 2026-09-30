// 注册链路的集成断言（COMPLY-06 / COMPLY-07 / PRIV-01 / T-09-01..03）。
//
// 六条断言各自对应一个具体的失效模式，而不是「注册跑通了」：
//   (a) 五条同意、两项必选为 true —— 「缺项视为未授权」不是「默认同意」
//   (b) 同一邀请码并发两次恰好一个成功 —— 条件更新而不是「先查再改」
//   (c) 四步中任一步失败整体回滚 —— **残缺账号不可能产生**
//   (d) 库里那一列不是 11 位明文数字 —— 第三方的个人信息已加密
//   (e) 注册响应体里没有 11 位连续数字 —— 明文不出接口
//   (f) 日对账能检出残缺账号 —— 万一从别的路径产生了，有人会知道
//
// ⚠️ (c) 的失败是**测试内注入**的（给 emergency_contact.kind 一个越界值，撞 DB CHECK），
// 不是临时改一行源码。临时改源码只证明了执行那一刻；注入之后每个 PR 都证明一次。

import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import type { EmergencyContactKind } from '@drift/contract';
import { promptVersion } from '@drift/prompts';
import { serve } from '@hono/node-server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// env.ts 在 import 时解析环境变量并在缺失时 process.exit(1)，因此必须先设。
process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'register-test-operator-token-0123456789abc';
process.env['BETTER_AUTH_SECRET'] ??= 'register-test-better-auth-secret-0123456789';
process.env['CONTACT_ENCRYPTION_KEY'] ??=
  '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';
process.env['LLM_PROVIDER_MODE'] = 'mock';
process.env['LOG_LEVEL'] ??= 'warn';

const { createApp } = await import('../../apps/api/src/http/app.ts');
const { POLICY_VERSION, registerWithInvite } = await import(
  '../../apps/api/src/modules/auth/register.ts'
);
const { reconcileConsentRows, CONSENT_ROWS_PER_USER } = await import(
  '../../apps/api/src/worker/jobs/consent-reconcile.ts'
);
const { CONSENT_SCOPES } = await import('@drift/contract');
const { closeDb, consent, consentEvent, db, emergencyContact, ownerDb, ownerSql } =
  await import('@drift/db');

/** 11 位连续数字。(d) 与 (e) 两条断言共用这一个判据。 */
const ELEVEN_DIGITS = /\d{11}/;
const CONTACT_PHONE = '13800001234';

let baseUrl: string;
let stopServer: () => Promise<void>;

async function mintInviteCode(code: string): Promise<void> {
  await ownerSql`insert into invite_code (code, created_by) values (${code}, 'register-test')`;
}

function uniqueSuffix(label: string): string {
  return `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function registerInput(code: string, suffix: string): Parameters<typeof registerWithInvite>[0] {
  return {
    inviteCode: code,
    email: `${suffix}@example.invalid`,
    password: 'correct-horse-battery',
    name: suffix,
    birthDate: '1995-06-15',
    consents: { basic_service: true, sensitive_pi: true },
    emergencyContact: { kind: 'emergency', name: '紧急联系人', phone: CONTACT_PHONE },
  };
}

beforeAll(async () => {
  const server = serve({ fetch: createApp().fetch, port: 0 });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
  stopServer = async () =>
    new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  await Promise.resolve();
});

afterAll(async () => {
  await stopServer();
  await closeDb();
  await ownerSql.end({ timeout: 5 });
});

describe('注册事务（Plan 09 Task 1）', () => {
  it('(a) 注册成功后 consent 恰好 5 行，两项必选 granted 为 true', async () => {
    const code = uniqueSuffix('reg-a');
    await mintInviteCode(code);
    const result = await registerWithInvite(registerInput(code, uniqueSuffix('a')));

    const rows = await db
      .select({ scope: consent.scope, granted: consent.granted, version: consent.policyVersion })
      .from(consent)
      .where(eq(consent.userId, result.userId));
    expect(rows).toHaveLength(CONSENT_SCOPES.length);
    const granted = new Map(rows.map((r) => [r.scope, r.granted]));
    expect(granted.get('basic_service')).toBe(true);
    expect(granted.get('sensitive_pi')).toBe(true);
    expect(granted.get('research_l0')).toBe(false);
    expect(granted.get('research_l1')).toBe(false);
    expect(granted.get('persona_evolution')).toBe(false);

    // policy_version 是服务端算出来的 privacy.md 内容哈希，不是调用方传进来的值。
    for (const row of rows) expect(row.version).toBe(POLICY_VERSION);

    // 五条 consent_event 各一条，action 与 granted 一一对应（撤回也留证）。
    const events = await db
      .select({ scope: consentEvent.scope, action: consentEvent.action })
      .from(consentEvent)
      .where(eq(consentEvent.userId, result.userId));
    expect(events).toHaveLength(CONSENT_SCOPES.length);
    for (const event of events) {
      expect(event.action).toBe(granted.get(event.scope) === true ? 'grant' : 'revoke');
    }
  });

  it('(b) 同一邀请码并发注册两次，恰好一个成功（T-09-01）', async () => {
    const code = uniqueSuffix('reg-b');
    await mintInviteCode(code);

    // 真并发。串行跑这条会放过一个「先 select 判断再 update」的实现 —— 那正是要防的。
    const outcomes = await Promise.allSettled([
      registerWithInvite(registerInput(code, uniqueSuffix('b1'))),
      registerWithInvite(registerInput(code, uniqueSuffix('b2'))),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const users = await ownerSql<{ readonly n: number }[]>`
      select count(*)::int as n from "user" where invite_code_id = ${code}
    `;
    expect(users[0]?.n, '同一个邀请码建出了多于一个账号').toBe(1);
  });

  it('(c) 第四步失败时整体回滚 —— 不产生残缺账号（T-09-02）', async () => {
    const code = uniqueSuffix('reg-c');
    await mintInviteCode(code);
    const suffix = uniqueSuffix('c');
    const email = `${suffix}@example.invalid`;

    // 注入：kind 越界，撞 emergency_contact_kind_allowed 这条 DB CHECK。
    // 此时前三步（建账号 / 消耗邀请码 / 五条同意）都已经写过了 —— 如果它们不在同一个
    // 事务里，下面三条断言至少有一条会留下行。
    await expect(
      registerWithInvite({
        ...registerInput(code, suffix),
        emergencyContact: {
          kind: 'spouse' as EmergencyContactKind,
          name: '越界角色',
          phone: CONTACT_PHONE,
        },
      }),
    ).rejects.toThrow();

    const users = await ownerSql<{ readonly id: string }[]>`
      select id from "user" where email = ${email}
    `;
    expect(users, '账号在事务失败后仍然留在库里（残缺账号）').toHaveLength(0);

    const consents = await ownerSql<{ readonly n: number }[]>`
      select count(*)::int as n from consent where policy_version = ${POLICY_VERSION}
        and user_id not in (select id from "user")
    `;
    expect(consents[0]?.n, '同意行成了孤儿 —— 它不在建账号那个事务里').toBe(0);

    const invite = await ownerSql<{ readonly usedBy: string | null }[]>`
      select used_by as "usedBy" from invite_code where code = ${code}
    `;
    expect(invite[0]?.usedBy, '邀请码被一次失败的注册消耗掉了').toBeNull();
  });

  it('(d) emergency_contact 的联系方式不是 11 位明文数字（T-09-03）', async () => {
    const code = uniqueSuffix('reg-d');
    await mintInviteCode(code);
    const result = await registerWithInvite(registerInput(code, uniqueSuffix('d')));

    const rows = await db
      .select({ stored: emergencyContact.contactRefEncrypted })
      .from(emergencyContact)
      .where(eq(emergencyContact.userId, result.userId));
    const stored = rows[0]?.stored;
    expect(stored).toBeDefined();
    expect(stored).not.toContain(CONTACT_PHONE);
    expect(ELEVEN_DIGITS.test(stored ?? ''), '库里存的是明文号码').toBe(false);
    // v1:<iv>:<tag>:<密文>。前缀是将来换算法时的判据，不靠长度猜。
    expect(stored?.startsWith('v1:')).toBe(true);

    // 返回给调用方的是遮蔽形态，不是明文。
    expect(result.maskedContact).toBe('138****1234');
  });

  it('(e) 注册接口的响应体不含 11 位连续数字（T-09-03）', async () => {
    const code = uniqueSuffix('reg-e');
    await mintInviteCode(code);
    const suffix = uniqueSuffix('e');
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inviteCode: code,
        email: `${suffix}@example.invalid`,
        password: 'correct-horse-battery',
        name: '张三',
        birthDate: '1995-06-15',
        consents: { basic_service: true, sensitive_pi: true },
        emergencyContact: { kind: 'guardian', name: '监护人', phone: CONTACT_PHONE },
      }),
    });
    expect(response.status).toBe(201);
    const raw = await response.text();
    expect(raw).not.toContain(CONTACT_PHONE);
    expect(ELEVEN_DIGITS.test(raw), `响应体里出现了 11 位连续数字：${raw}`).toBe(false);
    expect(raw).toContain('138****1234');
  });

  it('(f) 日对账能检出残缺账号，且告警载荷里没有 userId（T-09-02 / T-09-03）', async () => {
    const code = uniqueSuffix('reg-f');
    await mintInviteCode(code);
    const result = await registerWithInvite(registerInput(code, uniqueSuffix('f')));

    const before = await reconcileConsentRows(ownerDb);
    expect(before.expected).toBe(before.users * CONSENT_ROWS_PER_USER);
    expect(before.matches, '基线就不平 —— 测试库里已经有残缺账号').toBe(true);

    // 人为删掉一条同意行 —— 这正是「账号在、同意缺」的形状。
    const victim = await ownerDb
      .select({ id: consent.id, scope: consent.scope, version: consent.policyVersion })
      .from(consent)
      .where(eq(consent.userId, result.userId))
      .limit(1);
    const row = victim[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    await ownerSql`delete from consent where id = ${row.id}`;

    const after = await reconcileConsentRows(ownerDb);
    expect(after.matches, '删掉一条同意行之后对账仍然报平 —— 这条检查是空真的').toBe(false);
    expect(after.consents).toBe(after.expected - 1);

    // 告警载荷只有三个整数 + 一个布尔，没有任何可以塞进用户标识的位置。
    expect(Object.keys(after).sort()).toEqual(['consents', 'expected', 'matches', 'users']);

    // 还原，免得把不平的状态留给同一个库里的其他断言。
    await ownerDb
      .insert(consent)
      .values({ id: row.id, userId: result.userId, scope: row.scope, granted: false, policyVersion: row.version });
    const restored = await reconcileConsentRows(ownerDb);
    expect(restored.matches).toBe(true);
  });

  it('必选同意项未勾选时拒绝注册，且不消耗邀请码', async () => {
    const code = uniqueSuffix('reg-req');
    await mintInviteCode(code);
    const input = registerInput(code, uniqueSuffix('req'));
    await expect(
      registerWithInvite({ ...input, consents: { basic_service: true } }),
    ).rejects.toThrow(/sensitive_pi/);

    const invite = await ownerSql<{ readonly usedBy: string | null }[]>`
      select used_by as "usedBy" from invite_code where code = ${code}
    `;
    expect(invite[0]?.usedBy).toBeNull();
  });

  it('POLICY_VERSION 等于 privacy.md 的真实内容哈希（运行时相等）', () => {
    const privacyPath = fileURLToPath(
      new URL('../../apps/web/content/legal/privacy.md', import.meta.url),
    );
    expect(POLICY_VERSION).toBe(promptVersion(readFileSync(privacyPath, 'utf8')));
  });

  it('user 表在本用例集结束时每个账号都恰好 5 条同意', async () => {
    const orphans = await ownerSql<{ readonly email: string; readonly n: number }[]>`
      select u.email, (select count(*)::int from consent c where c.user_id = u.id) as n
        from "user" u
       where (select count(*) from consent c where c.user_id = u.id) <> ${CONSENT_ROWS_PER_USER}
    `;
    expect(orphans, `存在同意行数不等于 5 的账号：${JSON.stringify(orphans)}`).toHaveLength(0);
  });
});
