// 邀请码的一次性消耗（D-19 / D-23 / T-09-01 / T-04-03）。
//
// ── 为什么是条件更新，而不是「先查再改」────────────────────────────────────
//   update invite_code set used_by = $1, used_at = now()
//    where code = $2 and used_by IS NULL and revoked_at IS NULL returning code
// 并发下两个请求都会读到 used_by is null，于是「先 select 判断再 update」两个都往下走、
// 两个都建账号 —— 一次性凭证的全部意义就在这里丢掉。条件更新让第二个请求阻塞在行锁上，
// 解锁后重新求值 WHERE 得到 0 行，「恰好一个成功」由数据库保证而不是由时序运气保证。
//
// ── 为什么写成裸 SQL 而不是 drizzle 的 isNull() ────────────────────────────
// 两条理由，都不是风格问题：
//  1. 这条语句是 RESEARCH §10.2 与 PLAN 逐字给出的**契约**，源码里保持同一形态可以
//     让「代码是不是那条语句」用肉眼与 grep 同时判定；drizzle 生成的 `"used_by" is null`
//     与契约文本不是同一个串。
//  2. 值全部走 drizzle 的参数占位（${} 在 sql 模板里生成 $1/$2），没有字符串拼接，
//     因此不存在注入面。
//
// ── 为什么这张表没有「多次可用」的任何形态 ──────────────────────────────────
// 通用多次码泄漏一次就等于有了公开注册入口，而且**不会被察觉** —— 那会直接摧毁
// COMPLY-10 的四条抗辩之一（受邀制、人数上限）。invite_code 表因此没有 max_uses /
// use_count 一类列，本文件也没有任何绕过 used_by 判据的路径。

import { sql } from 'drizzle-orm';

import type { Tx } from '@drift/db';

export class InviteCodeUnavailableError extends Error {
  constructor(code: string) {
    // ⚠️ 不区分「不存在 / 已被使用 / 已撤销」：区分开就是一个可枚举码是否存在的
    // 旁路（T-09-06）。调用方也只回一个 409。
    super(`邀请码 ${code} 不可用`);
    this.name = 'InviteCodeUnavailableError';
  }
}

/**
 * 一次性消耗邀请码。成功即返回，失败抛 {@link InviteCodeUnavailableError}。
 *
 * ⚠️ 必须在注册事务内调用：它与建账号、写同意、写紧急联系人共享同一个回滚边界。
 */
export async function consumeInviteCode(t: Tx, code: string, userId: string): Promise<void> {
  const rows = await t.execute<{ code: string }>(sql`
    update invite_code
       set used_by = ${userId}, used_at = now()
     where code = ${code} and used_by IS NULL and revoked_at IS NULL
    returning code`);
  if (rows.length === 0) throw new InviteCodeUnavailableError(code);
}
