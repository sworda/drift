// 负向 fixture：chat 目录的计时器禁令必须抓到这三处调用（COMPLY-03）。
// 本文件被 tools/ci/chat-timer-ban.test.ts 以 ignore:false 显式 lint ——
// 常规运行里 fixtures 目录在全局 ignores 中。

export function BadTimer() {
  window.setTimeout(() => undefined, 1000);
  setTimeout(() => undefined, 2000);
  window.setInterval(() => undefined, 3000);
  return null;
}
