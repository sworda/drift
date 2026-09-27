// hono 实例。HTTP 是三个入口里的第一个（另两个是 ws/ 与 worker/）。

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';

import { env } from '../config/env.ts';
import { authRoutes } from '../modules/auth/routes.ts';
import { characterRoutes } from '../modules/characters/routes.ts';
import { chatRoutes } from '../modules/chat/routes.ts';
import { consentRoutes } from '../modules/consent/routes.ts';
import { conversationsRoutes } from '../modules/conversations/routes.ts';
import { friendshipRoutes } from '../modules/friendship/routes.ts';
import { deleteRoutes } from '../modules/privacy/delete-routes.ts';
import { exportRoutes } from '../modules/privacy/export-routes.ts';
import { privacyRoutes } from '../modules/privacy/inventory-routes.ts';
import { operatorSafetyRoutes } from '../modules/safety/routes.ts';
import {
  TELEMETRY_MAX_BODY_BYTES,
  telemetryRoutes,
} from '../modules/telemetry/routes.ts';
import { logEvent } from '../obs/logger.ts';
import { HEALTH_PATH, healthRoutes } from './health.ts';

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

  // 前端异常上报（D-28）：白名单 + 限流 + 4KiB 上限都在
  // modules/telemetry/routes.ts，bodyLimit 是传输层的第三道（更早、更便宜）。
  app.use('/telemetry/error', bodyLimit({ maxSize: TELEMETRY_MAX_BODY_BYTES }));
  app.route('/', telemetryRoutes);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((error, c) => {
    // 中间件显式抛出的 HTTPException（如 bodyLimit 的 413）有自己的响应 ——
    // 统一折成 500 会把「载荷被拒」伪装成「服务器坏了」，也让 (b) 类断言失真。
    if (error instanceof HTTPException) return error.getResponse();
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
