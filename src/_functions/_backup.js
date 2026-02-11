import { getDb } from "./lib/db.js";
import { authenticate, requireWrite } from "./lib/auth.js";

export async function get(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;
  const denied = requireWrite(auth);
  if (denied) return denied;

  const sql = await getDb();

  // Get tenant info
  const [tenant] = await sql`
    SELECT id, name, created_at FROM tenants WHERE id = ${auth.tenant_id}
  `;

  // Get all items grouped by collection
  const items = await sql`
    SELECT id, collection, parent_id, owner_id, order_key, data, created_at, updated_at
    FROM items WHERE tenant_id = ${auth.tenant_id}
    ORDER BY collection, created_at
  `;

  // Group items by collection
  const collections = {};
  for (const item of items) {
    if (!collections[item.collection]) {
      collections[item.collection] = [];
    }
    collections[item.collection].push({
      id: item.id,
      parent_id: item.parent_id,
      owner_id: item.owner_id,
      order_key: item.order_key,
      data: item.data,
      created_at: item.created_at,
      updated_at: item.updated_at,
    });
  }

  // Get all users
  const users = await sql`
    SELECT id, email, active, created_at
    FROM _users WHERE tenant_id = ${auth.tenant_id}
    ORDER BY created_at
  `;

  return {
    status: 200,
    body: {
      version: "1.0",
      exported_at: new Date().toISOString(),
      tenant: {
        id: tenant.id,
        name: tenant.name,
        created_at: tenant.created_at,
      },
      collections,
      _users: users.map(u => ({
        id: u.id,
        email: u.email,
        active: u.active,
        created_at: u.created_at,
      })),
    },
  };
}
