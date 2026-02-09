import { getDb } from "./lib/db.js";
import { authenticate, requireWrite } from "./lib/auth.js";

export async function post(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;
  const denied = requireWrite(auth);
  if (denied) return denied;

  const { email, password } = req.body || {};

  if (!email || !password) {
    return { status: 400, body: { error: "Email and password are required" } };
  }

  const password_hash = new Bun.CryptoHasher("sha256").update(password).digest("hex");
  const sql = getDb();

  try {
    const [user] = await sql`
      INSERT INTO _users (tenant_id, email, password_hash)
      VALUES (${auth.tenant_id}, ${email}, ${password_hash})
      RETURNING id, email, active, created_at
    `;
    return { status: 201, body: { data: user } };
  } catch (err) {
    if (err.errno === "23505") {
      return { status: 409, body: { error: "Email already exists" } };
    }
    throw err;
  }
}
