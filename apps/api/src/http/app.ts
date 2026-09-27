// hono 实例。HTTP 是三个入口里的第一个（另两个是 ws/ 与 worker/）。

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';

import { env } from '../config/env.ts';
import { authRoutes } from '../modules/auth/routes.ts';
import { characterRoutes } from '../modules/characters/routes.ts';
import { chatRoutes } from '../modules/chat/routes.ts';
import { conversationsRoutes } from '../modules/conversations/routes.ts';
import { consentRoutes } from '../modules/consent/routes.ts';
import { friendshipRoutes } from '../modules/friendship/routes.ts';
import { deleteRoutes } from '../modules/privacy/delete-routes.ts';
import { exportRoutes } from '../modules/privacy/export-routes.ts';
import { privacyRoutes } from '../modules/privacy/inventory-routes.ts';
import { operatorSafetyRoutes } from '../modules/safety/routes.ts';
import { logEvent } from '../obs/logger.ts';
import { HEALTH_PATH, healthRoutes } from './health.ts';

/**
 * `/telemetry/error` 的载荷白名单（D-28 / RESEARCH §12.6）。
 *
 * 这是一个未认证的写入端点，两条约束在写实现之前就要成立：
 *   - 只接受这些字段，**不接受任意 jsonb 原样存** —— 这同时就是「不把消息正文
 *     带进 client_error 表」的保证；
 *   - 载荷有大小上限 + 限流，否则它是一个免费的写放大入口。
 *
 * 明确否决 Sentry 等第三方云：breadcrumb 极易携带用户消息片段，性质同 Langfuse Cloud。
 */
export const TELEMETRY_ALLOWED_FIELDS = [
  'errorName',
  'errorCode',
  'route',
  'statusCode',
  'appVersion',
] as const;

/** 4 KiB。一条只有枚举字段的上报用不到更多。 */
export const TELEMETRY_MAX_BODY_BYTES = 4_096;

export function createApp(): Hono {
  const app = new Hono();

  // origin 来自 env，不接受 '*' —— WEB_ORIGIN 在 env.ts 里已按 URL 校验过。
  app.use('*', cors({ origin: env.WEB_ORIGIN, credentials: true }));

  app.route('/', healthRoutes);
  app.route('/', authRoutes);
  app.route('/', consentRoutes);
  app.route('/', privacyRoutes);
  app.route('/', deleteRoutes);
  app.route('/', exportRoutes);
  app.route('/', characterRoutes);
  app.route('/', friendshipRoutes);
  app.route('/', conversationsRoutes);
  app.route('/', chatRoutes);
  // 运营者后台（D-09/D-10）。认证与用户 session **完全分离**（x-operator-token），
  // 见 modules/safety/routes.ts 的文件头。
  app.route('/', operatorSafetyRoutes);

  app.post(
    '/telemetry/error',
    bodyLimit({ maxSize: TELEMETRY_MAX_BODY_BYTES }),
    (c) => {
      // 路由骨架：限流与落 client_error 表在 Plan 14。
      // 501 是此刻唯一诚实的响应 —— 返回 204 会让前端以为上报成功，而
      // 「没有上报就无法知道错误态契约是否被违反」正是 D-28 存在的理由。
      logEvent('telemetry.not_implemented', { route: '/telemetry/error', statusCode: 501 }, 'warn');
      return c.json({ error: 'not_implemented' }, 501);
    },
  );

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((error, c) => {
    logEvent(
      'http.unhandled_error',
      { errorName: error.name, route: c.req.path, method: c.req.method, statusCode: 500 },
      'error',
    );
    return c.json({ error: 'internal_error' }, 500);
  });

  logEvent('http.routes_mounted', { route: HEALTH_PATH });

  return app;
}
