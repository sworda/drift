// 硬退出的平台文案（COMPLY-05 / UI-SPEC ## 硬退出呈现契约）。
//
// ⚠️ 唯一定义在此（与 AI_BANNER_TEXT 同一条先例）：服务端 executeHardExit 用它
// 落 message 表的系统卡片行，web 从消息行读它渲染。放进任何一侧都会逼另一侧
// 抄一份 —— 两份法定文案分叉的那天不会有任何检查变红。

/** 硬退出系统卡片的正文（中性，非危机）。 */
export const EXIT_SYSTEM_CARD_COPY = '已停止本次会话。你随时可以回来。' as const;
