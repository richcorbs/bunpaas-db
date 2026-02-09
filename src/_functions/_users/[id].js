import { getDb } from "../lib/db.js";
import { authenticate, requireWrite } from "../lib/auth.js";

export async function patch(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;
  const denied = requireWrite(auth);
  if (denied) return denied;

  const { id } = req.params;
  const { password } = req.body || {};

  if (!password) {
    return { status: 400, body: { error: "Password is required" } };
  }

  const password_hash = new Bun.CryptoHasher("sha256").update(password).digest("hex");
  const sql = getDb();

  const rows = await sql`
    UPDATE _users SET password_hash = ${password_hash}
    WHERE tenant_id = ${auth.tenant_id} AND id = ${id}
    RETURNING id, email, active, created_at
  `;

  if (!rows.length) {
    return { status: 404, body: { error: "User not found" } };
  }

  return { status: 200, body: { data: rows[0] } };
}

export async function del(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;
  const denied = requireWrite(auth);
  if (denied) return denied;

  const { id } = req.params;
  const sql = getDb();

  const rows = await sql`
    DELETE FROM _users WHERE tenant_id = ${auth.tenant_id} AND id = ${id} RETURNING id
  `;

  if (!rows.length) {
    return { status: 404, body: { error: "User not found" } };
  }

  return { status: 204, body: null };
}
