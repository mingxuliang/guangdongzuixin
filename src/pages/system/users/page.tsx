import { useCallback, useEffect, useMemo, useState } from 'react';

import DashboardMainLayout from '../../dashboard/components/DashboardMainLayout';
import {
  createUserApi,
  deleteUserApi,
  fetchUsers,
  roleOptions,
  toggleUserStatusApi,
  updateUserApi,
  type SystemUser,
  type UserRole,
  type UserStatus,
} from '../../../services/userApi';
import { getAuthUser } from '../../../utils/auth';

const inputBase =
  'w-full rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-500/[0.12] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';

const labelCls = 'mb-2 block text-[13px] font-medium text-slate-700';

function formatCreatedAt(s: string): string {
  if (!s) return '—';
  return s.includes('T') ? s.slice(0, 10) : s.slice(0, 10);
}

const UserManagementPage = () => {
  const isAdmin = getAuthUser()?.role === '管理员';

  const [users, setUsers] = useState<SystemUser[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    account: '',
    phone: '',
    role: '内训师' as UserRole,
    department: '',
    status: '启用' as UserStatus,
    initialPassword: '',
    newPassword: '',
  });

  const loadUsers = useCallback(async () => {
    setListError(null);
    setLoading(true);
    try {
      const list = await fetchUsers();
      setUsers(list);
    } catch (e) {
      setListError(e instanceof Error ? e.message : '加载失败');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(k) ||
        u.account.toLowerCase().includes(k) ||
        (u.phone || '').includes(k) ||
        (u.department || '').toLowerCase().includes(k),
    );
  }, [users, keyword]);

  const openAdd = () => {
    setEditingId(null);
    setForm({
      name: '',
      account: '',
      phone: '',
      role: '内训师',
      department: '',
      status: '启用',
      initialPassword: '',
      newPassword: '',
    });
    setModal('add');
  };

  const openEdit = (u: SystemUser) => {
    setEditingId(u.id);
    setForm({
      name: u.name,
      account: u.account,
      phone: u.phone || '',
      role: u.role,
      department: u.department || '',
      status: u.status,
      initialPassword: '',
      newPassword: '',
    });
    setModal('edit');
  };

  const closeModal = () => {
    setModal(null);
    setEditingId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!form.name.trim() || !form.account.trim()) return;
    if (modal === 'add') {
      const pwd = form.initialPassword.trim();
      if (pwd.length > 0 && pwd.length < 6) {
        alert('初始密码至少 6 位，或留空使用系统默认');
        return;
      }
    }

    setSaving(true);
    try {
      if (modal === 'add') {
        await createUserApi({
          name: form.name.trim(),
          account: form.account.trim(),
          password: form.initialPassword.trim() || undefined,
          phone: form.phone.trim() || '',
          role: form.role,
          department: form.department.trim() || '',
          status: form.status,
        });
      } else if (modal === 'edit' && editingId) {
        await updateUserApi(editingId, {
          name: form.name.trim(),
          phone: form.phone.trim() || '',
          role: form.role,
          department: form.department.trim() || '',
          status: form.status,
          ...(form.newPassword.trim().length >= 6 ? { password: form.newPassword.trim() } : {}),
        });
      }
      await loadUsers();
      closeModal();
    } catch (err) {
      alert(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!isAdmin) return;
    if (!confirm('确定删除该用户？')) return;
    try {
      await deleteUserApi(id);
      await loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败');
    }
  };

  const toggleStatus = async (u: SystemUser) => {
    if (!isAdmin) return;
    const next: UserStatus = u.status === '启用' ? '停用' : '启用';
    try {
      await toggleUserStatusApi(u.id, next);
      await loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : '状态更新失败');
    }
  };

  return (
    <DashboardMainLayout
      breadcrumb={
        <>
          <span className="font-semibold text-slate-600">系统管理</span>
          <i className="ri-arrow-right-s-line text-slate-300" />
          <span className="font-semibold text-slate-800">用户管理</span>
        </>
      }
    >
      <div className="min-h-[calc(100vh-3.5rem)] bg-[#eef2f7] px-5 py-8 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">用户管理</h1>
              <p className="mt-1.5 text-sm text-slate-500">维护平台账号、角色与启用状态（数据来自 PostgreSQL）</p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={openAdd}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-5 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:from-blue-700 hover:to-blue-800 hover:shadow-blue-600/30"
              >
                <i className="ri-user-add-line text-lg" />
                新建用户
              </button>
            )}
          </div>

          {!isAdmin && (
            <div className="mb-5 rounded-xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              当前为只读视图；新增、编辑、删除与状态变更需使用<strong className="mx-0.5">管理员</strong>账号登录。
            </div>
          )}

          {listError && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {listError}
              <button type="button" className="ml-3 underline" onClick={() => loadUsers()}>
                重试
              </button>
            </div>
          )}

          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-lg flex-1">
              <i className="ri-search-line pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索姓名、账号、手机、部门"
                className={`${inputBase} h-11 pl-11`}
                disabled={loading}
              />
            </div>
            <p className="text-sm text-slate-500">
              共 <span className="font-semibold tabular-nums text-slate-800">{filtered.length}</span> 人
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_30px_-12px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.02]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="whitespace-nowrap px-5 py-3.5">姓名</th>
                    <th className="whitespace-nowrap px-5 py-3.5">账号</th>
                    <th className="whitespace-nowrap px-5 py-3.5">手机</th>
                    <th className="whitespace-nowrap px-5 py-3.5">角色</th>
                    <th className="min-w-[140px] px-5 py-3.5">部门</th>
                    <th className="whitespace-nowrap px-5 py-3.5">状态</th>
                    <th className="whitespace-nowrap px-5 py-3.5">创建时间</th>
                    <th className="whitespace-nowrap px-5 py-3.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-16 text-center text-slate-500">
                        加载中…
                      </td>
                    </tr>
                  ) : (
                    filtered.map((u) => (
                      <tr key={u.id} className="transition-colors hover:bg-slate-50/90">
                        <td className="whitespace-nowrap px-5 py-3.5 font-medium text-slate-900">{u.name}</td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-slate-600">{u.account}</td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-slate-600">{u.phone || '—'}</td>
                        <td className="whitespace-nowrap px-5 py-3.5">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              u.role === '管理员'
                                ? 'bg-violet-100 text-violet-800'
                                : u.role === '内训师'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-slate-600">{u.department || '—'}</td>
                        <td className="whitespace-nowrap px-5 py-3.5">
                          {isAdmin ? (
                            <button
                              type="button"
                              onClick={() => toggleStatus(u)}
                              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                                u.status === '启用'
                                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80 hover:bg-emerald-100'
                                  : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/80 hover:bg-slate-200'
                              }`}
                            >
                              {u.status}
                            </button>
                          ) : (
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                u.status === '启用'
                                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80'
                                  : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/80'
                              }`}
                            >
                              {u.status}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 tabular-nums text-slate-500">
                          {formatCreatedAt(u.createdAt)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-right">
                          {isAdmin ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openEdit(u)}
                                className="mr-3 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-blue-600 transition hover:bg-blue-50"
                              >
                                <i className="ri-edit-line" />
                                编辑
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(u.id)}
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-red-600 transition hover:bg-red-50"
                              >
                                <i className="ri-delete-bin-line" />
                                删除
                              </button>
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {!loading && filtered.length === 0 && (
              <div className="py-16 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <i className="ri-user-search-line text-2xl" />
                </div>
                <p className="text-sm text-slate-500">暂无匹配用户</p>
              </div>
            )}
          </div>
        </div>

        {modal && isAdmin && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
            onClick={closeModal}
            role="presentation"
          >
            <div
              className="w-full max-w-[480px] overflow-hidden rounded-3xl bg-white shadow-2xl shadow-slate-900/20 ring-1 ring-slate-200/80"
              role="dialog"
              onClick={(e) => e.stopPropagation()}
              aria-modal="true"
              aria-labelledby="user-form-title"
            >
              <div className="relative bg-gradient-to-br from-blue-600 via-blue-600 to-indigo-700 px-6 pb-8 pt-6 text-white">
                <button
                  type="button"
                  onClick={closeModal}
                  className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white transition hover:bg-white/20"
                  aria-label="关闭"
                >
                  <i className="ri-close-line text-xl" />
                </button>
                <div className="flex items-start gap-4 pr-10">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
                    <i className={`text-2xl ${modal === 'add' ? 'ri-user-add-line' : 'ri-user-settings-line'}`} />
                  </div>
                  <div>
                    <h2 id="user-form-title" className="text-xl font-bold tracking-tight">
                      {modal === 'add' ? '新建用户' : '编辑用户'}
                    </h2>
                    <p className="mt-1 text-sm text-blue-100/95">
                      {modal === 'add' ? '填写基本信息并分配角色与权限' : '修改用户资料；可选重置密码'}
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="px-6 pb-2 pt-6">
                <div className="space-y-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">基本信息</p>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="sm:col-span-1">
                      <label className={labelCls}>
                        姓名 <span className="text-red-500">*</span>
                      </label>
                      <input
                        required
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="真实姓名"
                        className={inputBase}
                        disabled={saving}
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <label className={labelCls}>
                        登录账号 <span className="text-red-500">*</span>
                      </label>
                      <input
                        required
                        disabled={modal === 'edit' || saving}
                        value={form.account}
                        onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
                        placeholder="英文或数字"
                        className={inputBase}
                      />
                      {modal === 'edit' && (
                        <p className="mt-1.5 text-xs text-slate-400">编辑时不可修改登录账号</p>
                      )}
                    </div>
                    <div className="sm:col-span-1">
                      <label className={labelCls}>手机</label>
                      <div className="relative">
                        <i className="ri-smartphone-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          value={form.phone}
                          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                          placeholder="选填"
                          className={`${inputBase} pl-10`}
                          disabled={saving}
                        />
                      </div>
                    </div>
                    <div className="sm:col-span-1">
                      <label className={labelCls}>部门</label>
                      <div className="relative">
                        <i className="ri-building-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          value={form.department}
                          onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                          placeholder="选填"
                          className={`${inputBase} pl-10`}
                          disabled={saving}
                        />
                      </div>
                    </div>
                    {modal === 'add' && (
                      <div className="sm:col-span-2">
                        <label className={labelCls}>初始密码</label>
                        <input
                          type="password"
                          value={form.initialPassword}
                          onChange={(e) => setForm((f) => ({ ...f, initialPassword: e.target.value }))}
                          placeholder="留空则使用系统默认 password123"
                          autoComplete="new-password"
                          className={inputBase}
                          disabled={saving}
                        />
                        <p className="mt-1 text-xs text-slate-400">至少 6 位；留空与后端默认一致</p>
                      </div>
                    )}
                    {modal === 'edit' && (
                      <div className="sm:col-span-2">
                        <label className={labelCls}>重置密码（可选）</label>
                        <input
                          type="password"
                          value={form.newPassword}
                          onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
                          placeholder="不修改请留空"
                          autoComplete="new-password"
                          className={inputBase}
                          disabled={saving}
                        />
                        <p className="mt-1 text-xs text-slate-400">填写则更新为新密码（至少 6 位）</p>
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4 sm:p-5">
                    <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      角色与状态
                    </p>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <label className={labelCls}>角色</label>
                        <div className="relative">
                          <select
                            value={form.role}
                            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                            className={`${inputBase} cursor-pointer appearance-none pr-10`}
                            disabled={saving}
                          >
                            {roleOptions.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                          <i className="ri-arrow-down-s-line pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>状态</label>
                        <div className="relative">
                          <select
                            value={form.status}
                            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as UserStatus }))}
                            className={`${inputBase} cursor-pointer appearance-none pr-10`}
                            disabled={saving}
                          >
                            <option value="启用">启用</option>
                            <option value="停用">停用</option>
                          </select>
                          <i className="ri-arrow-down-s-line pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 flex flex-col-reverse gap-3 border-t border-slate-100 pt-6 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={saving}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="h-11 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-6 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:from-blue-700 hover:to-blue-800 disabled:opacity-60"
                  >
                    {saving ? '保存中…' : '保存'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardMainLayout>
  );
};

export default UserManagementPage;
