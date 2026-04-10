import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getPool, ensureUsersSchema } from './db.mjs';

const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'mt-jwt-secret-2025-guangdong-mobile';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ── helpers ──────────────────────────────────────────────────────────────────

export function signToken(user) {
  return jwt.sign(
    { id: user.id, account: user.account, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function mapRow(row) {
  return {
    id: row.id,
    name: row.name,
    account: row.account,
    phone: row.phone,
    role: row.role,
    department: row.department,
    status: row.status,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listUsers({ keyword } = {}) {
  await ensureUsersSchema();
  const db = getPool();
  let sql = 'SELECT * FROM users ORDER BY created_at DESC';
  const params = [];
  if (keyword?.trim()) {
    const k = `%${keyword.trim().toLowerCase()}%`;
    sql = `SELECT * FROM users
           WHERE LOWER(name) LIKE $1 OR LOWER(account) LIKE $1 OR phone LIKE $1 OR LOWER(department) LIKE $1
           ORDER BY created_at DESC`;
    params.push(k);
  }
  const { rows } = await db.query(sql, params);
  return rows.map(mapRow);
}

export async function getUserById(id) {
  await ensureUsersSchema();
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getUserByAccount(account) {
  await ensureUsersSchema();
  const db = getPool();
  const { rows } = await db.query('SELECT * FROM users WHERE account = $1 LIMIT 1', [account]);
  return rows[0] || null;
}

export async function createUser({ name, account, password, phone, role, department, status }) {
  await ensureUsersSchema();
  const db = getPool();
  const existing = await getUserByAccount(account);
  if (existing) throw new Error('账号已存在');
  const id = randomUUID();
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  const now = new Date();
  await db.query(
    `INSERT INTO users (id, name, account, password_hash, phone, role, department, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
    [id, name, account, password_hash, phone || '', role || '内训师', department || '', status || '启用', now],
  );
  return getUserById(id);
}

export async function updateUser(id, fields) {
  await ensureUsersSchema();
  const db = getPool();
  const sets = [];
  const params = [];
  let idx = 1;

  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (k === 'password') {
      sets.push(`password_hash = $${idx++}`);
      params.push(await bcrypt.hash(v, SALT_ROUNDS));
    } else if (['name', 'phone', 'role', 'department', 'status'].includes(k)) {
      sets.push(`${k} = $${idx++}`);
      params.push(v);
    }
  }
  if (sets.length === 0) return getUserById(id);

  sets.push(`updated_at = $${idx++}`);
  params.push(new Date());
  params.push(id);

  await db.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx}`,
    params,
  );
  return getUserById(id);
}

export async function deleteUser(id) {
  await ensureUsersSchema();
  const db = getPool();
  const { rowCount } = await db.query('DELETE FROM users WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function verifyPassword(account, password) {
  const row = await getUserByAccount(account);
  if (!row) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  return ok ? mapRow(row) : null;
}

// ── 初始化种子管理员 ────────────────────────────────────────────────────────

export async function seedDefaultAdmin() {
  await ensureUsersSchema();
  const db = getPool();
  if (!db) return;
  const { rows } = await db.query("SELECT id FROM users WHERE role = '管理员' LIMIT 1");
  if (rows.length > 0) return;
  console.log('[users] 创建默认管理员: admin / admin123');
  await createUser({
    name: '系统管理员',
    account: 'admin',
    password: 'admin123',
    phone: '',
    role: '管理员',
    department: '信息技术部',
    status: '启用',
  });
}
