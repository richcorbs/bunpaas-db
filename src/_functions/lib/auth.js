import { getDb } from "./db.js";

export async function authenticate(req) {
  const authHeader = req.headers?.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return { error: { status: 401, body: { error: "Missing token" } } };
  }

  const sql = await getDb();
  const rows = await sql`
    SELECT tenant_id, can_read, can_write
    FROM api_tokens
    WHERE token = ${token}
  `;

  if (!rows.length) {
    return { error: { status: 401, body: { error: "Invalid token" } } };
  }

  return rows[0];
}

export function requireRead(auth) {
  if (!auth.can_read) return { status: 403, body: { error: "Read not allowed" } };
  return null;
}

export function requireWrite(auth) {
  if (!auth.can_write) return { status: 403, body: { error: "Write not allowed" } };
  return null;
}
