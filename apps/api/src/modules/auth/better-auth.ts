// better-auth 1.7.6 —— 账号与凭证的唯一实现（D-22）。
//
// ── 这个文件解决的那一个问题：让 better-auth 参与**我们的**事务 ────────────────
// PLAN 与 RESEARCH §6.1 都写「在单个事务里调 better-auth 的 server API 建账号」。
// 实读 @better-auth/drizzle-adapter@1.7.6 的类型后可以确认：
//
//     declare const drizzleAdapter: (db: DB, config: DrizzleAdapterConfig) => …
//
// —— `db` 在**构造期**绑定，适配器**没有**任何逐调用注入事务的入口（config 里的
// `transaction?: boolean` 只是「让适配器自己把多步操作包进一个事务」，不是「用外面
// 那个事务」）。照字面实现的结果是：better-auth 在它自己的连接上建账号，我们在自己的
// 事务里写同意，两者不同事务 —— 于是写同意失败时账号**已经留在库里**，而那正是
// T-09-02 的「残缺账号」，也是 PLAN 明令禁止依赖 databaseHooks 的同一个失效模式。
//
// 解法是把绑定点从「一个固定的 db」换成「当前执行上下文里的那个执行器」：
// AsyncLocalStorage 存当前事务，Proxy 把每次属性访问转发到它。better-auth 拿到的
// 仍然是一个普通的 drizzle 实例形状，而它发出的每一条 SQL 都落在我们的事务连接上。
// `runInRegistrationTx()` 是唯一的绑定点，spike 已实测：事务内 signUpEmail 成功，
// 事务内抛错后 user 表**零**残留行。
//
// ── 为什么不用 cookie / 不挂 better-auth 的 HTTP handler ─────────────────────
// 身份解析的唯一入口是 Authorization: Bearer <token> → session 表（modules/auth/session.ts）。
// better-auth 的 `signUpEmail` 在 autoSignIn 下会把 session 行写进同一张表并把 token
// 返回给我们，所以这里只用它的 server API，不挂它的路由。少一个未经设计的公网入口。
//
// ── telemetry 显式关闭 ───────────────────────────────────────────────────────
// 它的默认值是 false，这里仍然显式写出来：一个会在进程里发起出站请求的开关，
// 不能靠「默认值应该是关的」来保证 —— 那是 EGRESS_POINTS 注册表要防的那类出口。

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { AsyncLocalStorage } from 'node:async_hooks';

import { account, db, session, type Db, type Tx, user, verification } from '@drift/db';

import { env } from '../../config/env.ts';

/** 当前注册事务。只有 runInRegistrationTx() 写它。 */
const registrationTx = new AsyncLocalStorage<Tx>();

/**
 * 转发到「当前事务，没有就是普通连接」的 drizzle 实例。
 *
 * 绑定 `current` 而不是 `target`：drizzle 的方法内部要用到自己的 session/dialect，
 * 绑错 this 会让查询回到 app_role 的非事务连接上 —— 那正是本文件要消灭的分叉。
 */
const txAwareDb: Db = new Proxy(db, {
  get(target, property) {
    const current: Db | Tx = registrationTx.getStore() ?? target;
    const value: unknown = Reflect.get(current, property, current);
    if (typeof value === 'function') {
      return (value as (...args: readonly unknown[]) => unknown).bind(current);
    }
    return value;
  },
});

/**
 * 在事务 `t` 内执行 `fn`，期间 better-auth 的全部写入都落在 `t` 上。
 *
 * ⚠️ 任何调用 better-auth server API 的代码路径都必须包在这里面。不包的后果不是报错，
 * 而是**静默**回到非事务连接 —— 建号成功、同意回滚，残缺账号。
 */
export async function runInRegistrationTx<T>(t: Tx, fn: () => Promise<T>): Promise<T> {
  return registrationTx.run(t, fn);
}

/**
 * better-auth 实例。
 *
 * - `user.additionalFields` 只加 birthDate 与 inviteCodeId 两项（都 NOT NULL）。
 *   **同意项不放这里**：撤回需要时间线、披露需要 scope→字段的映射、scope 会随阶段
 *   增长（RESEARCH §6.1）。三件事布尔列一件也承载不了。
 * - `birthDate` 声明为 `string` 而不是 `date`：drizzle 的 `date()` 列在 postgres.js
 *   驱动下要一个 `YYYY-MM-DD` 字符串，声明成 date 会传下来一个 Date 实例并在绑定参数
 *   时抛 ERR_INVALID_ARG_TYPE（本 plan 实测）。
 * - **没有 databaseHooks**：PLAN 的明令禁止项，同时 grep 断言盯着它。
 */
export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  // 只用 server API、不挂路由，因此这个值不会出现在任何用户可见的地方；
  // 它仍必须是本进程真正监听的地址，而不是一个编造的域名。
  baseURL: `http://127.0.0.1:${String(env.PORT)}`,
  database: drizzleAdapter(txAwareDb, {
    provider: 'pg',
    schema: { user, account, session, verification },
    // 适配器自己不再开事务：外面已经有一个了，而嵌套事务在 postgres.js 下是 savepoint，
    // 徒增一层且掩盖真实的回滚边界。
    transaction: false,
  }),
  emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 8 },
  user: {
    additionalFields: {
      birthDate: { type: 'string', required: true, input: true },
      inviteCodeId: { type: 'string', required: true, input: true },
    },
  },
  telemetry: { enabled: false },
});
