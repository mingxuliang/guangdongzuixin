const TOKEN_KEY = 'mt_token';
const USER_KEY = 'mt_user';

export type AuthUser = {
  id: string;
  name: string;
  account: string;
  role: string;
};

export function isLoggedIn(): boolean {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveAuth(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getAuthUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as AuthUser; } catch { return null; }
}

export function getDisplayName(): string {
  return getAuthUser()?.name ?? '未登录';
}

export function getDisplayRole(): string {
  return getAuthUser()?.role ?? '';
}

/** @deprecated 兼容旧代码 */
export function login(): void {
  if (!isLoggedIn()) {
    localStorage.setItem(TOKEN_KEY, '__compat__');
  }
}
