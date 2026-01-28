import pg from 'pg';

const DEFAULT_DB = 'prototype';
const DEFAULT_USER = 'postgres';
const DEFAULT_PASSWORD = ''; // empty password
const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 5432;

const connectionString =
  process.env.DATABASE_URL ||
  `postgres://${DEFAULT_USER}:${DEFAULT_PASSWORD}@${DEFAULT_HOST}:${DEFAULT_PORT}/${DEFAULT_DB}`;

/**
 * Ensure database exists (connects to 'postgres' DB first)
 */
async function ensureDatabase() {
  const adminPool = new pg.Pool({
    connectionString: `postgres://${DEFAULT_USER}:${DEFAULT_PASSWORD}@${DEFAULT_HOST}:${DEFAULT_PORT}/postgres`
  });

  const res = await adminPool.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [DEFAULT_DB]);
  if (res.rowCount === 0) {
    console.log(`Database '${DEFAULT_DB}' not found. Creating...`);
    await adminPool.query(`CREATE DATABASE ${DEFAULT_DB}`);
    console.log(`Database '${DEFAULT_DB}' created.`);
  }
  await adminPool.end();
}

// Initialize pool after ensuring DB exists
await ensureDatabase();

export const pool = new pg.Pool({
  connectionString
});

export async function query(sql, params) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function initializeSchema() {
  console.log('Checking/creating schema...');
  await query(`
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
  `);
  console.log('Schema check/creation complete.');
}

export async function startServer(app, port = 3000) {
  try {
    await initializeSchema();
    app.listen(port, () => console.log(`API running on http://localhost:${port}`));
  } catch (err) {
    console.error('Failed to initialize schema:', err);
    process.exit(1);
  }
}
