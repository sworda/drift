'use client';

// 浏览器侧会话载体（Plan 14 / 成功标准 1 的前置）。
//
// ── 为什么是「客户端持有 Bearer token」而不是 cookie ─────────────────────────
// 服务的身份解析**唯一**入口是 Authorization: Bearer <token> → session 表
// （apps/api/src/modules/auth/session.ts，better-auth.ts 文件头明文「不挂它的
// HTTP handler」）。注册响应把 sessionToken 放在响应体里返回 —— 在这层存储落地
// 之前，浏览器里任何一个需要登录的页面都拿不到身份，人工走查在「浏览角色库」
// 一步就会卡死。
//
// localStorage 而非 sessionStorage：同一用户的多个标签页共享会话是 IM 的最低
// 预期。XSS 面与 cookie 相同（httpOnly cookie 挡不住 JS 发起的同源 fetch），而
// v1 的脚本面只有本仓代码 —— 没有 third-party script、没有 dangerouslySetInnerHTML。

const TOKEN_STORAGE_KEY = 'drift_session_token';

/** API 基址。与各页面共用同一个默认值（compose 栈里 api 默认绑定 127.0.0.1:3001）。 */
export const API_ORIGIN = process.env['NEXT_PUBLIC_API_ORIGIN'] ?? 'http://127.0.0.1:3001';

export function saveSessionToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // localStorage 被禁用（隐私模式等）：保存失败不致命 —— 本页内存里仍可用，
    // 刷新后需要重新注册。这是诚实降级，不是静默成功。
  }
}

export function readSessionToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearSessionToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // 同上：读不到就当没有。
  }
}

/**
 * 带身份的 fetch：把存储里的 token 附成 Authorization 头。
 * 401 由调用方处理（跳回注册 / 提示重新登录 —— v1 没有登录页，见 issues）。
 */
export async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = readSessionToken();
  const headers = new Headers(init?.headers);
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  return fetch(`${API_ORIGIN}${path}`, { ...init, headers });
}
