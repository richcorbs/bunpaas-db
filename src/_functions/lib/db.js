import { SQL } from "bun";

const DEFAULT_URL = "postgres://postgres:@localhost:5432/bunpaas";

let sql;
let schemaReady = false;

export function getDb(env = {}) {
  if (!sql) {
    const url = env.DATABASE_URL || process.env.DATABASE_URL || DEFAULT_URL;
    sql = new SQL(url);
    // Initialize schema on first connection
    initSchema(env).catch(err => console.error("Schema init error:", err));
  }
  return sql;
}

export async function query(text, params = []) {
  return getDb().unsafe(text, params);
}

export async function initSchema(env = {}) {
  if (schemaReady) return;
  const db = getDb(env);

  await db.unsafe(`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      token TEXT PRIMARY KEY,
      tenant_id UUID REFERENCES tenants(id),
      can_read BOOLEAN DEFAULT TRUE,
      can_write BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      collection TEXT NOT NULL,
      parent_id UUID,
      owner_id UUID,
      order_key TEXT,
      data JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_items_tenant_collection
      ON items (tenant_id, collection);

    CREATE TABLE IF NOT EXISTS _users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email
      ON _users (tenant_id, email);
  `);

  schemaReady = true;
}

export async function ensureDatabase() {
  const admin = new SQL("postgres://postgres:@localhost:5432/postgres");
  const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${"bunpaas"}`;
  if (rows.length === 0) {
    await admin.unsafe("CREATE DATABASE bunpaas");
  }
  await admin.close();
}

export async function close() {
  if (sql) {
    await sql.close();
    sql = null;
    schemaReady = false;
  }
}
