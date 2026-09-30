// AI 明示标识的跨端唯一真相源（COMPLY-01 / COMPLY-02 / COMPLY-09）。
//
// ⚠️ 两段文案是 **as const 常量**，不是服务端下发的字段。这比「渲染服务端下发的
// 文案」强一个量级：下发字段可以被置空、可以被一次配置改写、可以在某个 A/B 分支里
// 变成空串，而常量不能。服务端只回答「对手方是不是 AI」
// （conversation.counterpart_kind），**不回答「标识说什么」**。
//
// ⚠️ 全仓库各只有一处定义。徽标组件的 props 类型里不存在 text / children ——
// 用类型让「覆写文案」在编译期不可表达，而不是靠 code review 记得。

/** 会话列表 / 角色详情页的行内徽标文案。〔法定〕 */
export const AI_BADGE_TEXT = 'AI' as const;

/** 聊天界面 32px 常驻条文案。〔法定〕 */
export const AI_BANNER_TEXT = '你正在与 AI 角色互动，内容由 AI 生成' as const;

/** 内容级标识的标注管道版本。进 message.disclosure，用于事后追溯是哪一版注入的。 */
export const DISCLOSURE_LABELER_VERSION = 'disclosure-v1' as const;

/**
 * 内容级 AI 明示标识（落在 message.disclosure 上，由落库中间件逐条注入）。
 *
 * **只存事实，不存文案**：这条消息是 AI 生成的、何时被标注、哪一版管道标注的。
 * 把文案存进每一行会让「改一次配置就静默改掉一处法定标识」重新变成可能，
 * 而且会让同一段法定文字在库里有成千上万份副本。
 *
 * Phase 1 的消费点只有导出管道（气泡流不做逐条脚注，UI-SPEC 明文）。
 */
export interface Disclosure {
  readonly kind: 'ai_generated';
  /** ISO 8601。 */
  readonly labeledAt: string;
  readonly labelerVersion: typeof DISCLOSURE_LABELER_VERSION;
}

/**
 * 标识必须出现的四处（COMPLY-01/02）。
 *
 * 这份注册表存在的理由是防「加了第四处但只测了三处」：一条元测试按 testId 在测试
 * 结果里查找，断言**每个 surface 都有一条通过的断言**。新增一处 surface 而不加断言
 * → 元测试失败。
 */
export const DISCLOSURE_SURFACES = [
  {
    id: 'conversation_list',
    testId: 'ai-badge-conversation-list',
    /** 显隐驱动源：会话级的 counterpart_kind，不是消息级字段。 */
    drivenBy: 'conversation.counterpart_kind',
    text: AI_BADGE_TEXT,
  },
  {
    id: 'chat_banner',
    testId: 'ai-banner-chat',
    drivenBy: 'conversation.counterpart_kind',
    text: AI_BANNER_TEXT,
  },
  {
    id: 'character_detail',
    testId: 'ai-badge-character-detail',
    drivenBy: 'character.is_ai',
    text: AI_BADGE_TEXT,
  },
  {
    id: 'export_file',
    testId: 'ai-disclosure-export-file',
    /** 导出物是唯一消费 message.disclosure 的地方。 */
    drivenBy: 'message.disclosure',
    text: AI_BANNER_TEXT,
  },
] as const;

export type DisclosureSurfaceId = (typeof DISCLOSURE_SURFACES)[number]['id'];
