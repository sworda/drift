// 两级关怀卡片的内容构造（SAFE-03 / SAFE-04 + UI-SPEC ## 危机干预呈现契约）。
//
// ── 为什么返回结构化对象而不是拼好的一段文本 ────────────────────────────────
// R1.24：安全覆写后的内容**不得伪装成角色的自然发言**。一段纯文本无法承载这条约束
// —— 它会被当成一条角色消息渲染（气泡 + 头像 + AI 徽标），而那正是「真正的求助被当成
// 剧情」的成因。结构化卡片让渲染层只能用 Alert 组件，而 `level` 字段决定用哪一版式。
//
// ── 一级卡片在**类型层**就没有联络语义 ──────────────────────────────────────
// SAFE-03 明文「不联络紧急联系人」。因此 CareCardLevel1 里不存在 contactStatus 字段
// —— 不是「渲染时记得别显示」，而是拿不到值可显示。文件末尾有一条编译期断言把这件事
// 钉住：给 CareCardLevel1 加一个 contactStatus 字段会让那一行报错。
//
// ── 资源清单 fail-closed ────────────────────────────────────────────────────
// ctx 给的清单为空时**不返回空清单**，而是返回 12356 与 120 两条兜底行。一张「请寻求
// 帮助」但没有任何号码的关怀卡片，在急性危机面上比没有卡片更糟：它把告知义务做成了
// 形式，而用户此刻最需要的恰恰是一个立刻可拨的号码。

/**
 * contact_attempt 的四态。
 *
 * ⚠️ 这里独立声明而不是 import `@drift/db`：后者在模块加载时构造连接池并要求
 * DATABASE_URL，而 packages/safety 必须能在不连库的 L3/L4 进程里被加载（Plan 06 的
 * 出口注册表断言就住在 L4）。分叉由 tests/integration/contact-attempt.test.ts 的一条
 * 集合相等断言挡着 —— 与 RISK_LEVELS 在 packages/prompts / packages/db 各有一份独立
 * 声明、由 tools/ci/prompt-version.test.ts 守着，是同一套办法。
 */
export const CONTACT_ATTEMPT_STATUSES = ['pending', 'delivered', 'failed', 'unavailable'] as const;
export type ContactAttemptStatus = (typeof CONTACT_ATTEMPT_STATUSES)[number];

export const CARE_CARD_LEVELS = ['level1', 'level2'] as const;
export type CareCardLevelKey = (typeof CARE_CARD_LEVELS)[number];

/** 署名行。UI-SPEC：两级都固定首行「来自 Drift 的关心」，平台口吻一律用「我们」。 */
export const CARE_CARD_SIGNATURE = '来自 Drift 的关心';

export interface HelpResource {
  readonly label: string;
  /** 可直接 tel: 拨打的号码。UI-SPEC 的 44×44 直呼按钮取它。 */
  readonly phone: string;
  readonly availability: string;
}

/**
 * fail-closed 兜底清单。
 *
 * 12356 是全国统一心理援助热线，120 是急救。两条都**不是**可选项：failed 与
 * unavailable 两态下 UI-SPEC 要求把援助渠道行提到卡片首屏第一行，而那一行必须有号码。
 */
export const FALLBACK_HELP_RESOURCES = [
  { label: '全国心理援助热线 12356', phone: '12356', availability: '24 小时接听' },
  { label: '急救 120', phone: '120', availability: '24 小时接听' },
] as const satisfies readonly HelpResource[];

/** 一级（极端情绪）卡片。**没有 contactStatus，也没有任何联络相关字段。** */
export interface CareCardLevel1 {
  readonly level: 'level1';
  readonly signature: string;
  /** 情绪安抚一段。 */
  readonly reassurance: string;
  /** 鼓励寻求帮助一段。 */
  readonly encouragement: string;
  readonly resources: readonly HelpResource[];
}

/** 二级（自残自杀意图 / 重大财产损失）卡片。 */
export interface CareCardLevel2 {
  readonly level: 'level2';
  readonly signature: string;
  readonly reassurance: string;
  readonly resources: readonly HelpResource[];
  /** 服务端 contact_attempt.status。四态**全部**要有渲染分支（UI-SPEC 明文）。 */
  readonly contactStatus: ContactAttemptStatus;
  /** 联系人姓名。无联系人记录时为 null。 */
  readonly contactName: string | null;
  /** 遮蔽后的联系方式（138****1234）。第三方个人信息，界面上只能是遮蔽形态。 */
  readonly maskedContact: string | null;
  /**
   * 是否可以在界面上陈述「我们已经联系了」。
   *
   * ⚠️ 由服务端算，而不是由渲染层判断 status。理由：在急性危机面上陈述一件尚未发生的
   * 事，性质与隐私中心写「匿名」完全相同 —— 不是技术风险，是虚假陈述（T-07-03）。
   * 把这个判断留在渲染层意味着每一个分支都可能写错一次；算成一个布尔值则只有一处。
   */
  readonly claimsContacted: boolean;
  /**
   * 是否把援助渠道行提到卡片首屏第一行（UI-SPEC：failed / unavailable 两态）。
   * 联络失败正是用户最需要一个立刻可用渠道的时刻。
   */
  readonly hotlineFirst: boolean;
  /** 会话外联系的告知（D-09：**不提供**会话内人工接管）。 */
  readonly outOfBandNotice: string;
  /** 唯一确认按钮的标签。UI-SPEC 明文不得替换为「我知道了」这类泛化确认。 */
  readonly confirmLabel: string;
}

export type CareCard = CareCardLevel1 | CareCardLevel2;

export interface CareCardLevel1Context {
  readonly resources?: readonly HelpResource[];
}

export interface CareCardLevel2Context {
  readonly resources?: readonly HelpResource[];
  readonly contactStatus: ContactAttemptStatus;
  readonly contactName?: string | null;
  readonly maskedContact?: string | null;
}

const LEVEL1_REASSURANCE =
  '我们看到你现在很不好受。这样的感受很沉，你不需要一个人硬扛着。';
const LEVEL1_ENCOURAGEMENT =
  '如果你愿意，可以先给下面任一个渠道打个电话，或者找一个身边你还信得过的人说一说。求助不是软弱，是一条现实里真的存在的出路。';
const LEVEL2_REASSURANCE =
  '我们很担心你现在的处境。请先看下面这些能立刻用上的帮助方式。';
const OUT_OF_BAND_NOTICE =
  '我们已经收到通知，会尽快从这段对话之外直接联系你。';
const CONFIRM_LABEL = '我看到这些帮助方式了';

/** 清单为空 ⇒ 返回兜底行，绝不返回空清单。 */
function resourcesOrFallback(resources: readonly HelpResource[] | undefined): readonly HelpResource[] {
  if (resources === undefined || resources.length === 0) return FALLBACK_HELP_RESOURCES;
  return resources;
}

export function buildCareCard(level: 'level1', ctx?: CareCardLevel1Context): CareCardLevel1;
export function buildCareCard(level: 'level2', ctx: CareCardLevel2Context): CareCardLevel2;
/**
 * 构造关怀卡片。
 *
 * 重载而不是单一签名：单一签名会让 `buildCareCard('level1', { contactStatus })` 通过
 * 类型检查，于是「一级不可能有联络语义」变回一条需要人去记住的约定。
 */
export function buildCareCard(
  level: CareCardLevelKey,
  ctx?: CareCardLevel1Context | CareCardLevel2Context,
): CareCard {
  if (level === 'level1') {
    return {
      level: 'level1',
      signature: CARE_CARD_SIGNATURE,
      reassurance: LEVEL1_REASSURANCE,
      encouragement: LEVEL1_ENCOURAGEMENT,
      resources: resourcesOrFallback(ctx?.resources),
    };
  }
  if (ctx === undefined || !('contactStatus' in ctx)) {
    // 二级卡片没有 contactStatus 就无法如实告知联络结果，而静默联络是 UI-SPEC 明文
    // 禁止的第一条。抛错而不是给一个默认值 —— 默认值会变成一次没有根据的陈述。
    throw new Error('buildCareCard(level2) 必须传入 contactStatus —— 二级卡片不得省略联络状态行');
  }
  return {
    level: 'level2',
    signature: CARE_CARD_SIGNATURE,
    reassurance: LEVEL2_REASSURANCE,
    resources: resourcesOrFallback(ctx.resources),
    contactStatus: ctx.contactStatus,
    contactName: ctx.contactName ?? null,
    maskedContact: ctx.maskedContact ?? null,
    claimsContacted: ctx.contactStatus === 'delivered',
    hotlineFirst: ctx.contactStatus === 'failed' || ctx.contactStatus === 'unavailable',
    outOfBandNotice: OUT_OF_BAND_NOTICE,
    confirmLabel: CONFIRM_LABEL,
  };
}

/**
 * 编译期断言：一级卡片的类型里**不存在** contactStatus 字段（SAFE-03）。
 *
 * 给 CareCardLevel1 加一个 contactStatus 字段 ⇒ Extract<...> 不再是 never ⇒
 * `true` 不可赋给 `false`，这一行报错。
 */
export const CARE_CARD_LEVEL1_HAS_NO_CONTACT_STATUS: [
  Extract<keyof CareCardLevel1, 'contactStatus'>,
] extends [never]
  ? true
  : false = true;

/**
 * 遮蔽联系方式（138****1234）。第三方个人信息在界面上只能是遮蔽形态（UI-SPEC〔法定〕）。
 * 非 11 位输入一律整串遮蔽 —— 猜格式比多遮几位更糟。
 */
export function maskContact(raw: string): string {
  const digits = raw.replace(/\D/gu, '');
  if (digits.length !== 11) return '****';
  return `${digits.slice(0, 3)}****${digits.slice(7)}`;
}
