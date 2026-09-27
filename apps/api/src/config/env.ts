// apps/api 的环境变量：进程启动时**一次性**解析，失败即 exit 1。
//
// 为什么是 exit 1 而不是默认值或延迟报错：一个缺失的 WECOM_WEBHOOK_URL 在
// 「危机二级卡片要通知运营者」那一刻才失败，而那是本产品最不能静默失败的一条路径。
// 起不来是可见的，半年后才发现不是。
//
// ⚠️ 本文件是 apps/api 里**唯一**允许读 process.env 的位置。eslint.config.js 对
// `apps/api/src/**` 设了 MemberExpression[object.name='process'][property.name='env']
// 禁令，下面那一行 eslint-disable 是全仓库唯一一处显式豁免 —— 把豁免放在使用点上
// 而不是放在配置的 ignores 里，是为了让「谁绕过了这条禁令」在 code review 里看得见。

import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const EnvSchema = z.object({
  /** postgres://user:pass@host:5432/db —— 单库同时承载 OLTP + pgvector + pg-boss（PLAT-02）。 */
  DATABASE_URL: z.string().min(1, { error: 'DATABASE_URL 必填' }),
  /** apps/api 的 HTTP + WS 端口。Docker healthcheck 打的是这个端口的 /healthz。 */
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  /** apps/web 的 origin，CORS 白名单的唯一来源。不接受 '*'。 */
  WEB_ORIGIN: z.url({ error: 'WEB_ORIGIN 必须是完整 origin，例如 http://localhost:3000' }),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /** 企业微信机器人 webhook。Plan 06 的 notifyOperator / Plan 07 的状态机使用，本 plan 只声明。 */
  WECOM_WEBHOOK_URL: z.url({ error: 'WECOM_WEBHOOK_URL 必须是完整 URL' }),
  /**
   * 运营者后台的共享密钥（D-09/D-10 的两个人工推进端点）。
   *
   * ⚠️ 必填、无默认值、最短 32 字符。它与用户 session 是两条不相交的认证路径 ——
   * 把运营者动作挂在用户 session 上意味着任何用户都能把别人的联络尝试标成
   * delivered，而 delivered 会让界面陈述「我们已经联系了」（T-07-05）。
   * 给它一个默认值等于在生产里留一个已知密钥，所以缺失时进程不启动。
   */
  OPERATOR_API_TOKEN: z
    .string()
    .min(32, { error: 'OPERATOR_API_TOKEN 至少 32 个字符（运营者端点的共享密钥）' }),
  /** mock = 不出网的假 provider（D-27）；live = 真实调用。默认 mock。 */
  LLM_PROVIDER_MODE: z.enum(['mock', 'live']).default('mock'),
});

export type Env = Readonly<z.infer<typeof EnvSchema>>;

function loadEnv(): Env {
  // eslint-disable-next-line no-restricted-syntax -- 全仓库唯一一处 process.env 读取点（见文件头）
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // 这里不能用 logger：logger 自己依赖 env，而且此刻进程必须死掉而不是降级运行。
    process.stderr.write('[env] 环境变量校验失败，进程不启动：\n');
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
      process.stderr.write(`  - ${path}: ${issue.message}\n`);
    }
    process.exit(1);
  }
  return Object.freeze(parsed.data);
}

/** 只读的环境变量对象。apps/api 的其他模块只能从这里取值。 */
export const env: Env = loadEnv();
