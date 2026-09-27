// 危机相关文案常量 —— 逐字取自 01-UI-SPEC.md 的 ## Copywriting Contract。
//
// ⚠️ crisis 目录内的组件不得内联任何字符串文案（PLAN key_links）：全部从本文件读。
// tools/ci/crisis-ui-contract.test.ts 断言二级确认按钮的法定文案在本文件中恰好
// 出现一次 —— 复制成两份的那天，就是某个分支开始把它替换成泛化确认的那天。
//
// ⚠️ 平台口吻一律用「我们」（R1.24 的语言层）：关怀卡片是平台的关心，不是角色的发言。
// 不用感叹号、不用 emoji；失败文案必须含「下一步做什么」（UI-SPEC 文案语气基线）。

/** 署名行。两级关怀卡片的首行固定文字〔法定 · R1.24〕。 */
export const CARE_SIGNATURE = '来自 Drift 的关心';

/** 二级卡片唯一确认按钮〔法定〕。不得替换为「我知道了」「确定」这类泛化确认 ——
 *  这是本阶段风险最高的一次点击，标签必须描述用户确认了什么。 */
export const LEVEL2_CONFIRM_LABEL = '我看到这些帮助方式了';

/** failed / unavailable 态、44×44 tel: 直呼按钮的可见标签（UI-SPEC）。 */
export const HOTLINE_CALL_LABEL = '拨打 12356';

/** 全国心理援助热线（24 小时接听）—— 兜底清单与四态文案共用的号码。 */
export const CRISIS_HOTLINE_PHONE = '12356';

/**
 * pending 态的 13px 说明行。
 *
 * UI-SPEC 的 pending 文案是一整句，渲染契约是「文字行 + 13px 说明」：主行承载
 * 「正在联系…」，说明行承载后半句。两个常量按序拼接后与 UI-SPEC 的
 * 「紧急联系人联络状态 · pending」逐字相等（tools/ci 断言这条拼接）。
 */
export const PENDING_NOTE = '这需要一点时间，在此期间可以先看下面的帮助方式。';

/** SAFE-14 情感边界引导 —— 危机关怀卡片必带的边界提醒：身边的人与专业帮助
 *  是角色替代不了的。这正是关怀卡片要传达的核心事实。 */
export const EMOTIONAL_BOUNDARY_COPY =
  '我是一个 AI 角色。你身边的人和专业的帮助，是我替代不了的。';

/** 会话外联系告知（二级卡片必含，与卡片对象 outOfBandNotice 同文）。
 *  本阶段不提供会话内人工接管（D-09）—— 留着不实现的承诺与写「匿名」同性质。 */
export const OUT_OF_BAND_NOTICE = '我们已经收到通知，会尽快从这段对话之外直接联系你。';

/**
 * 紧急联系人联络状态的四条文案（SAFE-04 / R1.23，逐字）。
 *
 * ⚠️ delivered 是**唯一**可以出现「我们已经联系了」的分支。pending / failed /
 * unavailable 三条在语义上不含「已经联系」—— 这个性质被 RTL 断言 (b) 钉住：在急性
 * 危机面上陈述一件尚未发生的事，性质与隐私中心写「匿名」完全相同（虚假陈述）。
 */
export const CONTACT_STATUS_COPY = {
  pending: '正在联系你填写的紧急联系人 {姓名}（{遮蔽后的联系方式}）。',
  delivered: '我们已经联系了你填写的紧急联系人：{姓名} {遮蔽后的联系方式}。',
  failed:
    '我们暂时没能联系上 {姓名}，还在继续尝试。现在可以直接打这个电话：全国心理援助热线 12356（24 小时接听）。',
  unavailable:
    '你填写的紧急联系人现在联系不上，我们不会让你一直等。请直接打这个电话：全国心理援助热线 12356（24 小时接听）；如果你现在就有危险，请打 120。',
} as const;

/**
 * 联络状态取值域（渲染层视图类型）。
 *
 * 与 @drift/safety 的 CONTACT_ATTEMPT_STATUSES、@drift/contract 下行事件
 * safety.contact_status 的 status 枚举同域 —— 三方一致性由
 * tools/ci/crisis-ui-contract.test.ts 的集合相等断言守着（分叉的形态是某个分支
 * 静默渲染不出四态之一，而没有任何编译错误）。
 */
export type ContactStatus = 'pending' | 'delivered' | 'failed' | 'unavailable';

/** 四态取值域的运行时形态（与上面的类型同一来源）。 */
export const CONTACT_STATUSES: readonly ContactStatus[] = [
  'pending',
  'delivered',
  'failed',
  'unavailable',
];

/**
 * 按状态渲染联络状态行文案。
 *
 * 占位符替换：缺失的姓名/号码替换成空串而不是渲染字面量占位符 —— 渲染一个
 * 「{姓名}」给用户等于把机器内部状态展示给他。服务端的取值域保证（contact.ts）：
 * pending / delivered 两态姓名与遮蔽号码都在场，failed 恒有姓名，unavailable 两者皆无。
 */
export function contactStatusLine(
  status: ContactStatus,
  contact: { readonly name: string | null; readonly masked: string | null },
): string {
  return CONTACT_STATUS_COPY[status]
    .replaceAll('{姓名}', contact.name ?? '')
    .replaceAll('{遮蔽后的联系方式}', contact.masked ?? '');
}