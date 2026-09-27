// 负向 fixture：crisis 目录的计时器禁令（Plan 08 Task 2 / SAFE-04）。
//
// 本文件**故意**违反禁令 —— 它证明那条 eslint 规则不是空真的：真的有人在危机
// 组件里写了计时器调用，lint 必须报错。它住在 fixtures 目录（全局 ignores 之内，
// 常规 lint 跳过），由 tools/ci/crisis-ui-contract.test.ts 以 ignore:false 显式
// lint 并断言 no-restricted-syntax 命中。

// 违规 1：前端自行判定联络超时 —— 界面说失败了、服务端还在 pending。
window.setTimeout(() => {
  void '联络超时';
}, 600_000);

// 违规 1b：裸调用形式同样必须被抓住。
setTimeout(() => {
  void '又一种联络超时';
}, 300_000);

// 违规 2：前端轮询状态 —— 状态由 safety.contact_status 事件驱动，不由界面数秒。
const timer = window.setInterval(() => {
  void '轮询';
}, 1_000);

export { timer };