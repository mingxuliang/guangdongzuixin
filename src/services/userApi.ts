const base = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export type UserRole = '管理员' | '内训师' | '学员';
export type UserStatus = '启用' | '停用';

export type SystemUser = {
  id: string;
  name: string;
  account: string;
  phone: string;
  role: UserRole;
  department: string;
  status: UserStatus;
  createdAt: string;
  updatedAt?: string;
};

export type LoginResult = {
  token: string;
  user: SystemUser;
};

function getToken(): string | null {
  return localStorage.getItem('mt_token');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleRes<T>(r: Response): Promise<T> {
  const text = await r.text();
  if (!r.ok) {
    let msg: string;
    try { msg = JSON.parse(text).error; } catch { msg = text; }
    throw new Error(msg || `HTTP ${r.status}`);
  }
  return JSON.parse(text) as T;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function login(account: string, password: string): Promise<LoginResult> {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });
  return handleRes<LoginResult>(r);
}

export async function getMe(): Promise<SystemUser> {
  const r = await fetch(`${base}/auth/me`, {
    headers: authHeaders(),
  });
  return handleRes<SystemUser>(r);
}

// ── Users CRUD ──────────────────────────────────────────────────────────────

export async function fetchUsers(keyword?: string): Promise<SystemUser[]> {
  const qs = keyword ? `?keyword=${encodeURIComponent(keyword)}` : '';
  const r = await fetch(`${base}/users${qs}`, {
    headers: authHeaders(),
  });
  return handleRes<SystemUser[]>(r);
}

export async function createUserApi(data: {
  name: string;
  account: string;
  password?: string;
  phone?: string;
  role?: UserRole;
  department?: string;
  status?: UserStatus;
}): Promise<SystemUser> {
  const r = await fetch(`${base}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  return handleRes<SystemUser>(r);
}

export async function updateUserApi(id: string, data: {
  name?: string;
  phone?: string;
  role?: UserRole;
  department?: string;
  status?: UserStatus;
  password?: string;
}): Promise<SystemUser> {
  const r = await fetch(`${base}/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  return handleRes<SystemUser>(r);
}

export async function deleteUserApi(id: string): Promise<void> {
  const r = await fetch(`${base}/users/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!r.ok) {
    const text = await r.text();
    let msg: string;
    try { msg = JSON.parse(text).error; } catch { msg = text; }
    throw new Error(msg || `HTTP ${r.status}`);
  }
}

export async function toggleUserStatusApi(id: string, status: UserStatus): Promise<SystemUser> {
  const r = await fetch(`${base}/users/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ status }),
  });
  return handleRes<SystemUser>(r);
}

export async function resetPasswordApi(id: string, password: string): Promise<void> {
  const r = await fetch(`${base}/users/${id}/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) {
    const text = await r.text();
    let msg: string;
    try { msg = JSON.parse(text).error; } catch { msg = text; }
    throw new Error(msg || `HTTP ${r.status}`);
  }
}

export const roleOptions: UserRole[] = ['管理员', '内训师', '学员'];
