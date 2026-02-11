import { getDb } from "./lib/db.js";
import { authenticate, requireRead, requireWrite } from "./lib/auth.js";
import { parseExpand, batchExpand } from "./lib/expand.js";
import { flattenItem } from "./lib/flatten.js";

export async function get(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;
  const denied = requireRead(auth);
  if (denied) return denied;

  const { collection } = req.params;
  const { parentId, ownerId, limit = 25, offset = 0, orderBy = "created_at", filter } = req.query;
  const sql = await getDb();

  const conditions = ["tenant_id = $1", "collection = $2"];
  const params = [auth.tenant_id, collection];

  if (parentId) {
    params.push(parentId);
    conditions.push(`parent_id = $${params.length}`);
  }
  if (ownerId) {
    params.push(ownerId);
    conditions.push(`owner_id = $${params.length}`);
  }

  if (filter) {
    try {
      const jsonFilter = JSON.parse(filter);
      Object.entries(jsonFilter).forEach(([key, value]) => {
        const parts = key.split('.');
        if (parts.length === 1) {
          // Top-level key: data ->> 'key'
          params.push(key, value);
          conditions.push(`data ->> $${params.length - 1} = $${params.length}`);
        } else {
          // Nested path: data #> ARRAY['part1','part2'] = '"value"'
          parts.forEach(part => params.push(part));
          params.push(JSON.stringify(value));
          const arrayPlaceholders = parts.map((_, i) => `$${params.length - parts.length + i}`).join(',');
          conditions.push(`data #> ARRAY[${arrayPlaceholders}] = $${params.length}`);
        }
      });
    } catch {
      return { status: 400, body: { error: "Invalid JSON filter" } };
    }
  }

  const rows = await sql.unsafe(
    `SELECT * FROM items
     WHERE ${conditions.join(" AND ")}
     ORDER BY ${orderBy}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  const expandOps = parseExpand(req.query.expand);
  const expandedRows = await batchExpand([...rows], expandOps, auth.tenant_id);

  return {
    status: 200,
    body: {
      data: expandedRows.map(flattenItem),
      pagination: { limit: Number(limit), offset: Number(offset), count: expandedRows.length },
    },
  };
}

export async function post(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;
  const denied = requireWrite(auth);
  if (denied) return denied;

  const { collection } = req.params;
  const { parentId, ownerId, orderKey, data = {} } = req.body || {};
  const sql = await getDb();

  const [item] = await sql.unsafe(
    `INSERT INTO items (tenant_id, collection, parent_id, owner_id, order_key, data)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [auth.tenant_id, collection, parentId || null, ownerId || null, orderKey || null, data],
  );

  return { status: 201, body: { data: flattenItem(item) } };
}
