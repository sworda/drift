// apps/api 的**唯一**启动点：一个 node 进程，三个入口。
//
//   HTTP   —— hono（http/app.ts）
//   WS     —— ws 升级挂在同一个 http.Server 上（ws/server.ts）
//   worker —— pg-boss（worker/index.ts）
//
// PLAT-01 只允许两个部署单元（apps/api + apps/web），所以这三者不能拆成三个进程。
// 好处不只是省一个容器：WS 投递与 worker 调度共享同一份连接池与同一个进程内状态，
// 「拟真回复延迟到点了要往某条连接上投递」不需要跨进程消息总线。

import { Server as HttpServer } from 'node:http';

import { serve } from '@hono/node-server';

import { assertRouterInvariants } from '@drift/llm';

import { env } from './config/env.ts';
import { closeDb } from './db/client.ts';
import { createApp } from './http/app.ts';
import { HEALTH_PATH, healthRoutes } from './http/health.ts';
import { logError, logEvent } from './obs/logger.ts';
import { attachWebSocket, WS_PATH } from './ws/server.ts';
import { startWorker } from './worker/index.ts';

async function main(): Promise<void> {
  // 0) **启动的第一步**：Model Router 的三条不变量（SAFE-02 模型分离 / alias-only
  //    禁降级 / baseURL host 白名单）。抛错即 exit 1，在连库、监听、boss.start 之前。
  //
  //    为什么必须在最前面：这三条都是配置错误，而配置错误一旦让进程起来了，
  //    表现形式就是「一切正常，只是安全判定其实由扮演角色自己做」或「真实对话
  //    正在出境」—— 两者都不会有任何征兆，且第二条不可逆。
  assertRouterInvariants();

  logEvent('startup.begin', { phase: 'worker', route: WS_PATH });

  // 1) worker 先起：boss.start() 会建好 pgboss schema，而 /healthz 的 pgboss 字段查它。
  const worker = await startWorker();

  // 2) 启动自检：/healthz 是 Docker healthcheck 与部署验收的唯一探针。在开始监听
  //    之前先在进程内打一次 —— 探针自身抛错时容器只会显示 unhealthy 而不给任何
  //    可读原因，那是最难排查的一类部署故障。503 不阻止启动（依赖可能还在拉起），
  //    但探针本身崩掉就是配置错误，必须立刻死。
  const probe = await healthRoutes.request(HEALTH_PATH);
  logEvent('startup.health_probe', { route: HEALTH_PATH, statusCode: probe.status });

  // 3) HTTP，然后把 WS 升级挂到同一个 server 上。
  const app = createApp();
  const listener = serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' });
  // serve() 的返回类型是 http / http2 三者的联合；不传 createServer 时它恒为 node:http
  // 的 Server，而 ws 的升级只能挂在它上面。这里做一次真实收窄而不是 as 断言 ——
  // 断言会在将来有人给 serve() 传 http2 选项时静默通过，然后 WebSocket 在运行时
  // 无声地永不升级：一个不会报错、只会「实时功能莫名不工作」的故障。
  if (!(listener instanceof HttpServer)) {
    throw new Error('serve() 未返回 node:http Server，WebSocket 升级无法挂载');
  }
  const server: HttpServer = listener;
  const ws = attachWebSocket(server);
  logEvent('startup.listening', { phase: 'http', statusCode: 200, count: env.PORT });

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logEvent('shutdown.begin', { signal });
    try {
      // 顺序固定 worker → ws → http。先停止领新任务：反过来的话，连接已经断了
      // 而 worker 还在领「该给某条连接投递」的任务，那些任务会白跑一轮重试。
      await worker.stop();
      await ws.close();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      await closeDb();
      logEvent('shutdown.complete', { signal });
      process.exit(0);
    } catch (error) {
      logError('shutdown.failed', error, { signal });
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

await main();
