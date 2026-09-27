// 聊天域文案常量 —— 逐字取自 01-UI-SPEC.md 的 ## Copywriting Contract 与
// ## 硬退出呈现契约。
//
// ⚠️ chat 目录内的组件不得内联任何字符串文案：全部从本文件读（crisis/copy.ts
// 同一条约定）。tools/ci/exit-ui-contract.test.ts 在**运行时**从 UI-SPEC 提取
// 对应行并与本文件逐字比对 —— 抄错或 UI-SPEC 改行都会立刻变红，而不是退化成
// 一次宽松匹配（legal-required-sentences.test.ts 的同一条先例）。
//
// ⚠️ 系统卡片正文 EXIT_SYSTEM_CARD_COPY 的唯一定义在 @drift/contract —— 服务端
// 要用它落 message 表（硬退出的系统卡片行），web 只消费。这里 re-export 是为了
// 让 PLAN 约定的常量名在本文件可见，同时不产生第二份定义。

export { EXIT_SYSTEM_CARD_COPY } from '@drift/contract';

/** 2 小时时长提醒正文（COMPLY-03，UI-SPEC ## Copywriting Contract 逐字）。 */
export const USAGE_REMINDER_COPY = '你已经连续使用 2 小时了。要不要先歇一会？';

/** 2 小时提醒主按钮（吃 accent）。 */
export const USAGE_REMINDER_PRIMARY = '先去歇一会';

/** 2 小时提醒次按钮 —— neutral 文字按钮，不吃 accent（UI-SPEC 明文）。 */
export const USAGE_REMINDER_SECONDARY = '继续使用';

/** 过度依赖动态提醒正文（COMPLY-04，逐字）。 */
export const DEPENDENCY_NOTICE_COPY = '提醒一下：这段互动里的内容由 AI 生成。';

/** 过度依赖提醒唯一按钮 —— 单按钮，不提供第二个选项（这是一条告知，不是一次选择）。 */
export const DEPENDENCY_NOTICE_BUTTON = '我知道这是 AI 生成的';

/** 硬退出后输入框的占位符（UI-SPEC ## 硬退出呈现契约）。 */
export const EXIT_INPUT_PLACEHOLDER = '本次会话已结束';

/** 「更多」Sheet 里的显式退出入口（第十九条的窗口操作退出途径）。 */
export const END_SESSION_LABEL = '结束本次会话';

/** 未读分割线（CHAT-06，UI-SPEC ## Copywriting Contract 逐字）。 */
export const UNREAD_SEPARATOR_COPY = '以下是你离开后的消息';

/** 聊天空态（新会话无消息，UI-SPEC ## Copywriting Contract 逐字；{角色名} 运行时替换）。 */
export const CHAT_EMPTY_HEADING = '还没有开始';
export const CHAT_EMPTY_BODY_TEMPLATE = '说点什么，{角色名} 会回你。';

/** 断连补拉细条（CHAT-07，UI-SPEC ## Copywriting Contract 逐字）。 */
export const RECONNECTING_COPY = '连接断开，正在重新连接…… 重连后会自动补齐这段时间的消息。';

/** 列表加载失败（角色库 / 会话列表 / 角色详情共用一行，UI-SPEC 逐字）。 */
export const LIST_LOAD_ERROR_COPY = '没能加载出来 —— 网络或服务器暂时没有响应。点「重试」再试一次。';

/** 消息发送失败（CHAT-03，UI-SPEC 逐字）。 */
export const SEND_FAILED_COPY = '这条消息没有发出去 —— 网络似乎断开了。点这条消息重试。';

/** 重试控件（图标旁的 13px 可见文字；aria-label 见 MESSAGE_RETRY_ARIA）。 */
export const MESSAGE_RETRY_LABEL = '重试';
export const MESSAGE_RETRY_ARIA = '重试发送这条消息';

/** 输入栏（E5）：占位符与 icon-only 发送控件的可访问名称（UI-SPEC 无障碍名称行）。 */
export const COMPOSER_PLACEHOLDER = '说点什么…';
export const SEND_LABEL = '发送';
