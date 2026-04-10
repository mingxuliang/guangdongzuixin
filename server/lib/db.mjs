import { Pool } from 'pg';

let pool;
let initPromise;

function toBool(value) {
  return ['1', 'true', 'yes', 'on', 'require'].includes(String(value || '').trim().toLowerCase());
}

function resolveSsl() {
  if (toBool(process.env.DATABASE_SSL) || toBool(process.env.PGSSLMODE)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

function resolveConfig() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    return {
      connectionString,
      ssl: resolveSsl(),
    };
  }

  const host = process.env.PGHOST?.trim();
  const database = process.env.PGDATABASE?.trim();
  const user = process.env.PGUSER?.trim();
  if (!host || !database || !user) return null;

  return {
    host,
    port: Number(process.env.PGPORT || 5432),
    database,
    user,
    password: process.env.PGPASSWORD ?? '',
    ssl: resolveSsl(),
  };
}

export function isPostgresConfigured() {
  return Boolean(resolveConfig());
}

export function getSessionStoreDriver() {
  const explicit = (process.env.KE_STORAGE_DRIVER || '').trim().toLowerCase();
  if (explicit === 'file' || explicit === 'postgres') return explicit;
  return isPostgresConfigured() ? 'postgres' : 'file';
}

export function getPool() {
  const config = resolveConfig();
  if (!config) return null;
  if (!pool) {
    pool = new Pool({
      ...config,
      max: Number(process.env.PGPOOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
    });
  }
  return pool;
}

export async function ensurePostgresSchema() {
  if (getSessionStoreDriver() !== 'postgres') return;
  const db = getPool();
  if (!db) {
    throw new Error('KE_STORAGE_DRIVER=postgres，但未配置 DATABASE_URL 或 PGHOST/PGDATABASE/PGUSER');
  }
  if (!initPromise) {
    initPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ke_sessions (
          id TEXT PRIMARY KEY,
          mode TEXT NOT NULL,
          course_id TEXT,
          course_title TEXT,
          project_name TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft',
          extraction_completed BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at TIMESTAMPTZ NOT NULL,
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_ke_sessions_updated_at
        ON ke_sessions (updated_at DESC)
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS ke_assets (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES ke_sessions(id) ON DELETE CASCADE,
          kind TEXT,
          original_name TEXT,
          storage TEXT,
          path TEXT,
          oss_bucket TEXT,
          oss_key TEXT,
          size BIGINT,
          mime TEXT,
          audio_pending BOOLEAN,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          payload JSONB NOT NULL DEFAULT '{}'::jsonb
        )
      `);

      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_ke_assets_session_id
        ON ke_assets (session_id)
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          account TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          phone TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT '内训师',
          department TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '启用',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_users_account
        ON users (account)
      `);

      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_users_role
        ON users (role)
      `);
    })();
  }
  await initPromise;
}

/**
 * 仅初始化 users 表（供 userStore 使用，不依赖 KE_STORAGE_DRIVER）。
 */
let usersInitPromise;
export async function ensureUsersSchema() {
  const db = getPool();
  if (!db) return;
  if (!usersInitPromise) {
    usersInitPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          account TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          phone TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT '内训师',
          department TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '启用',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_users_account ON users (account)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users (role)`);
    })();
  }
  await usersInitPromise;
}
