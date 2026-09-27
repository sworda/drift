// 账号删除入口（PRIV-05）—— **本 plan 只定义签名，实现属 Plan 11。**
//
// 为什么现在就把签名定下来：PRIV-02 裁决了「撤回必选同意项 = 停止服务并进入删除流程」，
// 而 Plan 09 要落地撤回语义。如果此刻不定这个入口，撤回必选项的分支只有两种写法 ——
// 要么做成「撤回后继续聊天」的降级只读（PLAN 明令禁止：那会让系统在无合法性基础的
// 情况下继续处理个人信息），要么什么都不做并留一个 TODO（同样是继续处理）。
// 定义签名 + 抛 not-implemented 是第三种：撤回请求**失败**，用户看到的是 UI-SPEC 的
// 「这项同意没有撤回成功 —— 对应的数据流仍在继续」那一行，而不是一个假装成功的界面。
//
// ⚠️ 这个缺口已登记 SKIPPED_CHECKS.md（`account-deletion-not-implemented`），
// 解除条件是 Plan 11 落地实现并删除该行。

import type { Executor } from '@drift/db';

/** pg-boss 队列名。Plan 11 的 worker 用它。 */
export const ACCOUNT_DELETION_QUEUE = 'account-deletion';

/** 触发删除的原因。留证要回答「为什么删」，而不只是「删过」。 */
export const ACCOUNT_DELETION_REASONS = ['user_request', 'revoke_required_consent'] as const;
export type AccountDeletionReason = (typeof ACCOUNT_DELETION_REASONS)[number];

export interface AccountDeletionOptions {
  readonly reason: AccountDeletionReason;
}

/**
 * 删除作业的入队端口。
 *
 * 取 `Executor` 而不是 PgBoss 实例：Plan 11 需要让排作业与撤回记录落在**同一个事务**里
 * （pg-boss 支持传入连接）。一个「先提交撤回、再尽力排作业」的形态会在排作业失败时留下
 * 「同意已撤回、删除从未开始」的状态 —— 那正是无合法性基础继续持有数据。
 */
export type AccountDeletionEnqueue = (
  executor: Executor,
  userId: string,
  options: AccountDeletionOptions,
) => Promise<string>;

export class AccountDeletionNotImplementedError extends Error {
  constructor() {
    super(
      'enqueueAccountDeletion 尚未实现（Plan 11）。撤回必选同意项因此整体失败并回滚 —— ' +
        '这是刻意的：假装撤回成功而不启动删除，等于在无合法性基础的情况下继续持有数据。',
    );
    this.name = 'AccountDeletionNotImplementedError';
  }
}

/** Plan 11 用真实实现替换这个函数体，签名不变。 */
export const enqueueAccountDeletion: AccountDeletionEnqueue = () => {
  throw new AccountDeletionNotImplementedError();
};
