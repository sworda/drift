// 五项同意的**唯一**定义处 —— scope 取值、界面文案、必选性（PRIV-01，个保法第十四条）。
//
// 为什么在 @drift/contract 而不是 packages/db：这张表同时有三个消费方 —— 注册页的
// 五个 Checkbox（apps/web）、注册事务的逐项写入（apps/api）、consent / consent_event
// 两张表的 CHECK 取值域（packages/db）。放进其中任何一侧都会让另外两侧各抄一份，
// 而 scope 的取值是**法定披露口径** —— 两份定义就是两份口径，而分叉的那一天不会有
// 任何检查变红。packages/db/src/schema/consent.ts 因此从这里 import 并再导出，
// 而不是自己再写一遍。
//
// ⚠️ 改这个数组就是改法定披露口径：必须同步改 .planning/REQUIREMENTS.md 的 PRIV-01
// 与 apps/web/content/legal/privacy.md（后者的内容哈希就是 consent_event.policy_version，
// 所以改正文等于产生一版新政策）。
//
// ⚠️ 这里**没有**、也不会有任何能一次表达多项的结构：没有「全选」常量、没有分组、
// 没有 `ALL_GRANTED` 之类的预设。捆绑同意在这一层就不可表达。

/** PRIV-01 的五项，顺序即注册页的渲染顺序。前两项必选。 */
export const CONSENT_SCOPES = [
  'basic_service',
  'sensitive_pi',
  'research_l0',
  'research_l1',
  'persona_evolution',
] as const;

export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export interface ConsentScopeSpec {
  /** 界面上这一项叫什么。逐字取自 PRIV-01 与 UI-SPEC 的〔交互契约〕同意项行。 */
  readonly label: string;
  /**
   * 紧跟在 Checkbox 后面那一行 13px 说明。
   *
   * 语气基线（UI-SPEC ## 文案语气基线）：写「勾了会发生什么 / 不勾会发生什么」，
   * 不写「依据《个人信息保护法》第十四条……」。三个尚无数据流的可选项按
   * privacy.md 的同一口径写成「还没有开始收集」，而不是「正在收集」—— 界面与政策
   * 在同一件事上必须说同一句话。
   */
  readonly description: string;
  /** 必选项撤回即停止服务并进入删除流程（PRIV-02，Q2 裁决），不是「撤回后只读」。 */
  readonly required: boolean;
}

/**
 * scope → 文案与必选性。
 *
 * ⚠️ 写成**映射类型**而不是第二个数组：`Record<ConsentScope, …>` 由类型系统保证
 * 五项一个不多一个不少，于是「新增了 scope 但忘了写文案」是一次编译错误，而不是
 * 一个运行时渲染出 undefined 的界面。
 */
export const CONSENT_SCOPE_SPECS: Readonly<Record<ConsentScope, ConsentScopeSpec>> = {
  basic_service: {
    label: '基础服务与服务协议',
    description:
      '同意我们保存你的账号、聊天记录和会话状态，这样角色才能回你的话、你下次回来才看得到之前聊过什么。不勾这一项我们没法提供这个服务。',
    required: true,
  },
  sensitive_pi: {
    label: '敏感个人信息处理',
    description:
      '聊天内容里很可能含有你的健康、情绪、行踪这类敏感信息，紧急联系人的手机号也是。同意我们按这份政策处理它们。不勾这一项我们没法提供这个服务。',
    required: true,
  },
  research_l0: {
    label: 'L0 行为特征研究',
    description:
      '同意我们保留一份去标识化的行为特征（消息长度分布、回复间隔、标点与表情使用频率、话题类别、主动发起比例）用于研究。你已经授权的话，我们目前也还没有开始收集这项数据。',
    required: false,
  },
  research_l1: {
    label: 'L1 原文研究授权',
    description:
      '同意我们把脱敏后的聊天原文用于研究「真人到底是怎么聊天的」。你已经授权的话，我们目前也还没有开始收集这项数据。',
    required: false,
  },
  persona_evolution: {
    label: '人格演化贡献',
    description:
      '同意让你和角色的相处影响它的性格。现阶段角色的性格是固定的一版，不会因为和你相处而改变；这项数据我们还没有开始收集。',
    required: false,
  },
};

/**
 * 必选项。**从 SPECS 派生**，不是手写的第二份清单 —— 手写会与 `required` 字段分叉，
 * 而分叉的方向如果是「这里漏了一项」，注册就会放过一个缺必选同意的账号。
 */
export const REQUIRED_SCOPES: readonly ConsentScope[] = CONSENT_SCOPES.filter(
  (scope) => CONSENT_SCOPE_SPECS[scope].required,
);

/** 某个 scope 是否必选。守卫与路由共用一处判定。 */
export function isRequiredScope(scope: ConsentScope): boolean {
  return CONSENT_SCOPE_SPECS[scope].required;
}
