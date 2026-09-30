// 运营者后台端点 —— contact_attempt 的两个**人工**推进动作（D-09 / D-10）。
//
// ── 两条不可协商的边界 ──────────────────────────────────────────────────────
//
//  1. **与用户 session 完全分离的认证。** 身份来自 `x-operator-token` 头，与
//     `Authorization: Bearer` 的用户 session 走的是两条不相交的路径。把运营者动作挂在
//     用户 session 上意味着任何用户拿自己的 token 就能把别人的联络尝试标成 delivered
//     —— 而 delivered 会让界面陈述「我们已经联系了」（T-07-05）。
//     Phase 1 用共享密钥 + 仅内网（compose 里 api 只绑回环，对外入口是 caddy）。
//     真正的运营者账号体系不在本阶段。
//
//  2. **handler 里不读会话内容。** D-09 已裁决：运营者从**会话之外**联系用户，不做
//     「可读取用户与角色私密对话」的接管后台 —— 那本身是实质隐私侵入，需要写进隐私
//     政策。因此这两个 handler 只碰 contact_attempt 一张表，**不查 message**。
//     这条边界靠一条 grep 断言守着（Task 2 的 `<verify>`）。
//
// ⚠️ 路径前缀 `/internal/` 只是给读路由表的人看的提示，不是安全边界 —— 边界是上面
// 第 1 条的独立认证加部署层的仅内网绑定。

import { timingSafeEqual } from 'node:crypto';

import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '@drift/db';

import { env } from '../../config/env.ts';
import { logError, logEvent } from '../../obs/logger.ts';
import { OperatorActionRefusedError, ackDelivered, markFailed } from './contact.ts';
import { publishContactStatusEvent } from './contact-status-event.ts';

const OPERATOR_TOKEN_HEADER = 'x-operator-token';

const AckBody = z.object({
  operatorId: z.string().min(1).max(120),
  /** 真人确认已通话的记录。**不得为空** —— 它就是 delivered 的判据（D-10）。 */
  note: z.string().min(1).max(2_000),
});

const FailedBody = z.object({
  operatorId: z.string().min(1).max(120),
  note: z.string().max(2_000).optional(),
});

/**
 * 定长时间比较。
 *
 * 不直接用 `===`：字符串比较会在第一个不同的字节上短路，于是响应时间泄漏前缀匹配
 * 长度。长度不同时先返回 false（长度本身不是秘密），再对等长缓冲做 timingSafeEqual
 * —— timingSafeEqual 对长度不等的入参会抛错。
 */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorizeOperator(presented: string | undefined): boolean {
  if (presented === undefined || presented.length === 0) return false;
  return tokenMatches(presented, env.OPERATOR_API_TOKEN);
}

export const operatorSafetyRoutes = new Hono();

operatorSafetyRoutes.post('/internal/contact-attempts/:id/ack', async (c) => {
  if (!authorizeOperator(c.req.header(OPERATOR_TOKEN_HEADER))) {
    logEvent(
      'operator.unauthorized',
      { route: '/internal/contact-attempts/:id/ack', statusCode: 401 },
      'warn',
    );
    return c.json({ error: 'unauthorized' }, 401);
  }
  const parsed = AckBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues.map((i) => i.message) }, 400);
  }
  try {
    const advanced = await ackDelivered(db, {
      attemptId: c.req.param('id'),
      operatorId: parsed.data.operatorId,
      note: parsed.data.note,
    });
    if (!advanced) {
      // 不是 pending（已经是终态，或 id 不存在）。409 而不是 404：区分「没有这一行」
      // 与「这一行不能再推进」对运营者是有用的信息，而两者都不泄漏会话内容。
      return c.json({ error: 'not_pending' }, 409);
    }
    logEvent('contact_attempt.delivered', { contactAttemptStatus: 'delivered' });
    // 推进已落库 ⇒ 广播给正盯着二级卡片的用户（客户端不在线时返回 0，重连重建补上）。
    // 投递失败不影响响应：delivered 是真人已通话的事实，不因一条 WS 没送出去而撤销。
    await publishContactStatusEvent(db, c.req.param('id'));
    return c.json({ status: 'delivered' }, 200);
  } catch (error) {
    if (error instanceof OperatorActionRefusedError) {
      return c.json({ error: 'refused' }, 400);
    }
    logError('operator.ack_failed', error, { route: '/internal/contact-attempts/:id/ack' });
    return c.json({ error: 'internal_error' }, 500);
  }
});

operatorSafetyRoutes.post('/internal/contact-attempts/:id/failed', async (c) => {
  if (!authorizeOperator(c.req.header(OPERATOR_TOKEN_HEADER))) {
    logEvent(
      'operator.unauthorized',
      { route: '/internal/contact-attempts/:id/failed', statusCode: 401 },
      'warn',
    );
    return c.json({ error: 'unauthorized' }, 401);
  }
  const parsed = FailedBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues.map((i) => i.message) }, 400);
  }
  try {
    const advanced = await markFailed(db, {
      attemptId: c.req.param('id'),
      operatorId: parsed.data.operatorId,
      ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
    });
    if (!advanced) return c.json({ error: 'not_pending' }, 409);
    logEvent('contact_attempt.failed', { contactAttemptStatus: 'failed' });
    // 同上：状态先落库，事件是通知不是留证。
    await publishContactStatusEvent(db, c.req.param('id'));
    return c.json({ status: 'failed' }, 200);
  } catch (error) {
    if (error instanceof OperatorActionRefusedError) {
      return c.json({ error: 'refused' }, 400);
    }
    logError('operator.mark_failed_failed', error, {
      route: '/internal/contact-attempts/:id/failed',
    });
    return c.json({ error: 'internal_error' }, 500);
  }
});
