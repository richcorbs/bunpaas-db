import { getDb } from "./lib/db.js";
import { authenticate, requireWrite } from "./lib/auth.js";

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("hex");
}

export async function post(req) {
  const { name } = req.body || {};

  if (!name || typeof name !== "string" || !name.trim()) {
    return { status: 400, body: { error: "Name is required" } };
  }

  const sql = getDb(req.env);

  const [tenant] = await sql`
    INSERT INTO tenants (name) VALUES (${name.trim()}) RETURNING id, name, created_at
  `;

  const readOnlyToken = generateToken();
  const readWriteToken = generateToken();

  await sql`
    INSERT INTO api_tokens (token, tenant_id, can_read, can_write) VALUES
    (${readOnlyToken}, ${tenant.id}, TRUE, FALSE),
    (${readWriteToken}, ${tenant.id}, TRUE, TRUE)
  `;

  return {
    status: 201,
    body: {
      tenant: { id: tenant.id, name: tenant.name, created_at: tenant.created_at },
      tokens: { readOnly: readOnlyToken, readWrite: readWriteToken },
    },
  };
}

export async function get(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;
  const denied = requireWrite(auth);
  if (denied) return denied;

  const sql = getDb();
  const tokens = await sql`
    SELECT token, can_read, can_write, created_at
    FROM api_tokens
    WHERE tenant_id = ${auth.tenant_id}
    ORDER BY can_write ASC
  `;

  const readOnly = tokens.find((t) => t.can_read && !t.can_write);
  const readWrite = tokens.find((t) => t.can_read && t.can_write);

  return {
    status: 200,
    body: {
      tokens: {
        readOnly: readOnly?.token || null,
        readWrite: readWrite?.token || null,
      },
    },
  };
}
