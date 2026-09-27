// 注册 —— **一个**事务里做完四件事（COMPLY-06 / COMPLY-07 / PRIV-01 / T-09-02）。
//
//   ① 建 better-auth 账号（user + account + session）
//   ② 条件更新消耗邀请码
//   ③ 写 5 条 consent + 5 条 consent_event
//   ④ 写 emergency_contact（联系方式加密）
//
// 任一步失败整体回滚。这条性质不是「写得仔细」，而是本文件存在的理由：注册链路的
// 静默失效模式是「账号存在、同意缺失」的**残缺账号** —— 它在「缺失视为未授权」的
// 读取逻辑下看起来完全正常（既可以读成「必选项未授权、应当拒绝服务」，也可以读成
// 「还没走完 onboarding」），因此没有任何现有断言会发现它。事务是唯一能让它不产生的
// 手段；日对账（worker/jobs/consent-reconcile.ts）是它万一产生时的检出手段。
//
// ── 为什么顺序是「先建账号、后消耗邀请码」──────────────────────────────────
// better-auth 自己生成 user.id，我们拿不到它之前无法写 invite_code.used_by。倒过来
// 需要接管 id 生成，那会把「谁生成 id」这件事从库里挪到我们手上，收益为零。
// 并发安全性不受顺序影响：两个请求各自插入自己的 user 行（不同邮箱、互不冲突），
// 随后争抢同一行 invite_code 的写锁，落败的一方拿到 0 行、抛错、**连同它刚建的账号
// 一起回滚**。tests/integration/register.test.ts 的 (b) 断言的就是这件事。
//
// ── policy_version 没有兜底分支 ──────────────────────────────────────────────
// 它是 apps/web/content/legal/privacy.md 的真实内容哈希。文件缺失即抛错，进程起不来。
// 这里不写默认值、不写 'unknown'、不 try/catch 吞掉：一条 policy_version 是伪造的
// consent_event，指向的是一份不存在的政策文本 —— 那样的留证比没有留证更糟，因为它
// 看起来像一份留证。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CONSENT_SCOPES,
  type ConsentScope,
  type EmergencyContactKind,
  isValidContactPhone,
  REQUIRED_SCOPES,
} from '@drift/contract';
import {
  consent,
  consentEvent,
  emergencyContact,
  encryptContact,
  maskContact,
  tx,
} from '@drift/db';
import { promptVersion } from '@drift/prompts';

import { auth, runInRegistrationTx } from './better-auth.ts';
import { consumeInviteCode } from './invite.ts';

/** 隐私政策正文。Plan 15 的产物，是 policy_version 的唯一来源。 */
const PRIVACY_POLICY_PATH = fileURLToPath(
  new URL('../../../../web/content/legal/privacy.md', import.meta.url),
);

/**
 * 当前生效的政策版本 = privacy.md 的内容哈希。
 *
 * 用 `@drift/prompts` 的 promptVersion 而不是在这里再写一次 sha256：项目里只允许存在
 * 一份「内容 → 版本」的实现（PLAT-08 同一条理由）。前缀因此读作 `pv_` —— 它标记的是
 * 哈希实现，不是被哈希的东西的种类。
 *
 * ⚠️ 模块加载期读，读不到就让进程起不来。这是 fail-loud 的最响形态。
 */
export const POLICY_VERSION: string = promptVersion(readFileSync(PRIVACY_POLICY_PATH, 'utf8'));

export class RequiredConsentMissingError extends Error {
  constructor(scope: ConsentScope) {
    super(`必选同意项 ${scope} 未授权，注册不能继续`);
    this.name = 'RequiredConsentMissingError';
  }
}

export class ContactFormatError extends Error {
  constructor() {
    super('紧急联系人的联系方式不是 11 位手机号');
    this.name = 'ContactFormatError';
  }
}

export interface RegisterEmergencyContact {
  readonly kind: EmergencyContactKind;
  readonly name: string;
  /** 11 位手机号明文。**只在本次请求的内存里存在** —— 落库前加密，响应里只出遮蔽形态。 */
  readonly phone: string;
}

export interface RegisterInput {
  readonly inviteCode: string;
  readonly email: string;
  readonly password: string;
  readonly name: string;
  /** YYYY-MM-DD。自填即信（D-22）；18 岁判据在 routes.ts，拒绝是法定终态。 */
  readonly birthDate: string;
  /** 五项同意的勾选状态。**缺项视为未授权**，不是默认同意。 */
  readonly consents: Readonly<Partial<Record<ConsentScope, boolean>>>;
  readonly emergencyContact: RegisterEmergencyContact;
}

export interface RegisterResult {
  readonly userId: string;
  readonly sessionToken: string;
  readonly policyVersion: string;
  /** 遮蔽后的联系方式（138****1234）。明文**不出现在任何响应体里**。 */
  readonly maskedContact: string;
}

export async function registerWithInvite(input: RegisterInput): Promise<RegisterResult> {
  // 两道前置校验放在事务外：它们不需要库，而且失败时不应该消耗一个邀请码。
  for (const scope of REQUIRED_SCOPES) {
    if (input.consents[scope] !== true) throw new RequiredConsentMissingError(scope);
  }
  if (!isValidContactPhone(input.emergencyContact.phone)) throw new ContactFormatError();

  // 加密在事务外做（纯计算），于是事务里不含任何可能抛 ContactEncryptionKeyError 的
  // 步骤 —— 密钥没配的后果是「注册失败」而不是「事务开到一半失败」。
  const contactRefEncrypted = encryptContact(input.emergencyContact.phone);

  return tx(async (t) => {
    // ① better-auth 建账号。runInRegistrationTx 是它落在**这个** t 上的唯一保证。
    const signUp = await runInRegistrationTx(t, async () =>
      auth.api.signUpEmail({
        body: {
          email: input.email,
          password: input.password,
          name: input.name,
          birthDate: input.birthDate,
          inviteCodeId: input.inviteCode,
        },
      }),
    );
    const userId = signUp.user.id;
    const sessionToken = signUp.token;
    if (sessionToken === null || sessionToken.length === 0) {
      // autoSignIn 开着却没拿到 token，说明 better-auth 的行为与这里的假设分叉了。
      // 回滚比返回一个没有会话的账号好：后者会让用户注册完却进不去。
      throw new Error('better-auth 未返回会话 token（autoSignIn 假设已失效）');
    }

    // ② 一次性消耗邀请码。落败方在这里拿到 0 行并把 ① 一起回滚。
    await consumeInviteCode(t, input.inviteCode, userId);

    // ③ 五条 consent + 五条 consent_event。**逐 scope 各一行**：没有任何一行能表达
    //    「全部同意」，PRIV-01 的「无捆绑」在存储层是结构性的，不是 UI 约定。
    for (const scope of CONSENT_SCOPES) {
      const granted = input.consents[scope] === true;
      await t.insert(consent).values({ userId, scope, granted, policyVersion: POLICY_VERSION });
      await t.insert(consentEvent).values({
        userId,
        scope,
        action: granted ? 'grant' : 'revoke',
        policyVersion: POLICY_VERSION,
        source: 'registration',
      });
    }

    // ④ 紧急联系人。reachability 走 schema 默认值 unconfirmed（D-22：我们没有任何
    //    手段证明一个号码打得通，写 confirmed 就是陈述一件未发生的事）。
    await t.insert(emergencyContact).values({
      userId,
      kind: input.emergencyContact.kind,
      name: input.emergencyContact.name,
      contactRefEncrypted,
    });

    return {
      userId,
      sessionToken,
      policyVersion: POLICY_VERSION,
      maskedContact: maskContact(input.emergencyContact.phone),
    };
  });
}
