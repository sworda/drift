// 隐私中心的全部界面文案（UI-SPEC ## Copywriting Contract 与 ## 交互契约 的逐字绑定）。
//
// 文案全部静态定义在这里 —— 不从 API、不从数据库取（T-10-07：远端下发的文案让源码
// 层禁用词扫描失效）。tools/ci/privacy-ui-contract.test.ts 在运行时从 01-UI-SPEC.md
// 逐行提取并逐字比对下面的常量，改 UI-SPEC 而忘了改这里会立刻变红（同
// consent-copy-contract.test.ts 的手法）。
//
// 「我们收集了什么」的条目文案**不在这里** —— 它们由 /me/collected 从 DATA_INVENTORY
// 生成（清单与实现漂移即构成虚假陈述），本文件只持有结构性文案。

/** 四个分区（UI-SPEC ## 交互契约「隐私中心」行；过多时横向滚动，不折叠为「更多」）。 */
export const TAB_COLLECTED = '我们收集了什么';
export const TAB_CONSENTS = '同意管理';
export const TAB_EXPORT = '导出';
export const TAB_DELETE = '删除';

/** 合同履行必要分组的组头（consentScope 为 none 的条目归这一组）。 */
export const CONTRACT_NECESSARY_GROUP_LABEL = '合同履行必要';

/**
 * 第三态（RESEARCH §6.5）：已授权、但该 scope 在 DATA_INVENTORY 里条目数为 0。
 * 与 privacy.md 的「你已经授权，我们目前还没有开始收集这项数据」同源 —— 界面与政策
 * 在同一件事上必须说同一句话。
 */
export const NOT_YET_COLLECTING_COPY = '你已授权，我们目前还没有开始收集这项数据；开始之前不会有任何变化。';

/**
 * 撤回失败（UI-SPEC Error state 撤回同意项失败行，逐字）。
 * Switch 回弹到服务端真实状态，这行文案明示「数据流仍在继续」并给出三个出路。
 */
export const REVOKE_FAILED_COPY =
  '这项同意**没有**撤回成功 —— 对应的数据流**仍在继续**。请再试一次；如果反复失败，先用「导出我的全部数据」留一份副本，再从隐私中心提交申诉，我们会人工停掉这条数据流。';

/** 撤回失败后的重试按钮。 */
export const REVOKE_RETRY_LABEL = '重试撤回';

/** 导出主 CTA（UI-SPEC Primary CTA 隐私中心导出行，逐字；accent，本屏唯一）。 */
export const EXPORT_CTA = '导出我的全部数据';

/** 导出功能属 Plan 11 —— 现阶段的如实占位说明（含「下一步做什么」）。 */
export const EXPORT_PENDING_NOTE = '导出功能还在建设中。现在就需要一份副本的话，请从「怎么联系我们与申诉」里写的方式告诉我们，我们人工导给你。';

/** 删除入口（destructive 文字按钮，不吃 accent —— 刻意不抢眼，UI-SPEC 视觉锚点契约）。 */
export const DELETE_ENTRY = '删除我的全部数据';

/** 删除属 Plan 11 —— 同上，如实占位。 */
export const DELETE_PENDING_NOTE = '删除功能还在建设中。现在就需要删除账号的话，请从「怎么联系我们与申诉」里写的方式告诉我们，我们人工删并回复你。';

/** 页面加载与加载失败（与空态必须可区分，UI-SPEC E9）。 */
export const COLLECTED_LOADING = '正在读取「我们收集了什么」……';
export const COLLECTED_LOAD_ERROR =
  '没能读取「我们收集了什么」 —— 网络或服务器暂时没有响应。点「重试」再试一次。';
export const COLLECTED_LOAD_RETRY = '重试';
