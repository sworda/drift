// 注册流程的界面文案 —— 逐字取自 01-UI-SPEC.md 的 `## Copywriting Contract`。
//
// ⚠️ 这些串**不得**在组件里内联。tools/ci/consent-ui-contract.test.ts 在运行时从
// UI-SPEC 逐行提取并与这里逐字比对：改 UI-SPEC 而忘了改这里会立刻变红，反过来也是。
// 内联的文案没有这层绑定 —— 它会与契约悄悄分叉，而分叉的是法定告知口径。

/** 注册最后一步的主 CTA。每屏至多一个主 CTA 吃 accent（UI-SPEC Accent 闭合清单第 1 项）。 */
export const REGISTER_CTA = '完成注册，开始使用';

/**
 * 18 岁法定终态拒绝（COMPLY-07）。
 *
 * ⚠️ 这一行是 UI-SPEC「错误文案必须含下一步」的**唯一豁免**：拒绝本身就是法律要求的
 * 终局结果，任何「下一步」都在引导用户绕过年龄门槛（提示「换个年龄再试」等于教人造假）。
 * 渲染它的容器里因此**不得**出现任何按钮或链接。
 */
export const AGE_GATE_REJECTION = '本服务仅向 18 周岁及以上用户提供。';

/** 紧急联系人格式不通过（COMPLY-06 / R1.23）。 */
export const CONTACT_FORMAT_ERROR =
  '这个联系方式我们没法识别，请填写 11 位手机号。这一项不能留空 —— 监护人或紧急联系人填一个就可以。';

/** 注册提交失败（COMPLY-06）。含「下一步」——它不是终态拒绝，是一次可重试的失败。 */
export const REGISTER_SUBMIT_ERROR =
  '注册没有完成 —— 网络中断或服务器暂时没有响应。你填的内容都还在，点「重试提交」再试一次。';

/**
 * 注册提交失败的**细分**文案 —— 服务端把 better-auth 的 APIError 按 body.code 拆成
 * 独立错误码（apps/api/src/modules/auth/routes.ts），前端按码给出可执行的下一步。
 * 兜底仍是 REGISTER_SUBMIT_ERROR：拿不到细分码（真网络断、未知错误）时显示它。
 *
 * 2026-09-30 之前的实现只有兜底一条 —— 「邮箱已注册」被渲染成网络中断，误导排查。
 */
export const REGISTER_EMAIL_USED_ERROR =
  '这个邮箱已经注册过账号 —— 请换一个邮箱再试（同一邮箱无法重复注册）。';

export const REGISTER_PASSWORD_POLICY_ERROR =
  '注册没有完成 —— 密码未通过服务端安全策略（至少 8 位）。调整后再点「重试提交」。';

/** 按服务端错误码选提交失败文案。code 为 null / 未知码 ⇒ 兜底。纯函数，测试直接喂。 */
export function registerSubmitErrorCopy(code: string | null): string {
  if (code === 'email_already_used') return REGISTER_EMAIL_USED_ERROR;
  if (code === 'password_policy') return REGISTER_PASSWORD_POLICY_ERROR;
  return REGISTER_SUBMIT_ERROR;
}


export const REGISTER_RETRY_LABEL = '重试提交';

/**
 * 步骤 0 的字段级错误文案。
 *
 * ⚠️ 这一组之所以存在，是因为步骤 0 的「下一步」**不再因未填完而禁用**（理由见
 * steps.tsx）：用户点得动，点下去就必须被告知还差什么。每一条都必须含「下一步做什么」，
 * 且说得出可执行的门槛（如密码的「至少 8 位」）—— UI-SPEC ## 文案语气基线明文要求
 * 「错误文案必须含『下一步做什么』，禁止只描述问题」。
 */
export const INVITE_CODE_REQUIRED_ERROR = '请填写邀请码 —— 它是一次性的准入凭证，注册时必须填。';
export const EMAIL_FORMAT_ERROR = '请填写有效的邮箱地址，格式像 name@example.com。';
export const PASSWORD_TOO_SHORT_ERROR = '密码至少 8 位，请再加几个字符。';
export const NAME_REQUIRED_ERROR = '请填写昵称 —— 角色会用这个名字称呼你。';
export const BIRTH_DATE_REQUIRED_ERROR =
  '请选择一个完整的出生日期（年-月-日），我们用它确认你已满 18 周岁。';

/**
 * 紧急联系人字段说明（R1.23）。
 *
 * ⚠️ 它必须渲染在 Field 的 description 行，**不是** placeholder：占位符在用户开始输入
 * 之后就消失了，而这句话是一条需要持续可读的告知 —— 它说明我们会在什么情况下动用
 * 第三方的个人信息。
 */
export const CONTACT_FIELD_DESCRIPTION =
  '只有在你明确表达自残自杀意图、或正遭受重大财产损失时，我们才会联系这位联系人。其他任何情况都不会。';

/** 三个步骤的标题。每屏唯一的 Display 28px 元素（UI-SPEC ## 视觉锚点契约 注册行）。 */
export const STEP_TITLES = ['确认你的年龄', '填一位紧急联系人', '五项同意'] as const;

/** 占位符只做格式示例，不承担说明职责（见 CONTACT_FIELD_DESCRIPTION）。 */
export const CONTACT_PHONE_PLACEHOLDER = '11 位手机号';
export const CONTACT_NAME_PLACEHOLDER = '称呼';

export const EMERGENCY_CONTACT_KIND_LABELS = {
  guardian: '监护人',
  emergency: '紧急联系人',
} as const;

/** 邀请码是唯一准入凭证（D-19/D-23）。 */
export const INVITE_CODE_LABEL = '邀请码';
export const EMAIL_LABEL = '邮箱';
export const PASSWORD_LABEL = '密码';
export const NAME_LABEL = '昵称';
export const BIRTH_DATE_LABEL = '出生日期';
export const NEXT_STEP_LABEL = '下一步';

/** 注册成功的落点提示（Plan 14：走查顺序 注册 → 角色库）。 */
export const REGISTER_DONE_TITLE = '注册完成';
export const REGISTER_DONE_BODY = '你已经注册成功。接下来去角色库挑一个感兴趣的角色，加为好友后就可以开始聊了。';

/**
 * 主 CTA 处于禁用态时，写在它旁边的一行原因说明。
 *
 * UI-SPEC ## 交互契约（第 401 行）规定两项必选任一未勾选时主 CTA **必须禁用**；
 * ## 文案语气基线（第 389 行）又规定错误文案**必须含下一步做什么**。禁用态没有
 * 「提交后报错」这个出口，所以禁用原因必须自己说出来 —— 这一行就是那个出口。
 * `{缺失项}` 由 CONSENT_SCOPE_SPECS[scope].label 逐项填入（不硬编码文案）。
 */
export const MISSING_REQUIRED_CONSENT_NOTE = '还差必选同意项：{缺失项}。勾上后才能完成注册。';
export const MISSING_REQUIRED_PLACEHOLDER = '{缺失项}';
