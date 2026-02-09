import { getDb } from "./lib/db.js";
import { authenticate } from "./lib/auth.js";

export async function post(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;

  const { email, password } = req.body || {};

  if (!email || !password) {
    return { status: 400, body: { error: "Email and password are required" } };
  }

  const password_hash = new Bun.CryptoHasher("sha256").update(password).digest("hex");
  const sql = await getDb();

  const rows = await sql`
    SELECT id, tenant_id, email, active, created_at
    FROM _users
    WHERE tenant_id = ${auth.tenant_id} AND email = ${email} AND password_hash = ${password_hash}
  `;

  if (!rows.length) {
    return { status: 401, body: { error: "Invalid email or password" } };
  }

  const user = rows[0];
  if (!user.active) {
    return { status: 403, body: { error: "Account is disabled" } };
  }

  return {
    status: 200,
    body: { data: { id: user.id, email: user.email, active: user.active, created_at: user.created_at } },
  };
}
