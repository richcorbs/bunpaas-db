import { getDb } from "./lib/db.js";
import { authenticate, requireRead, requireWrite } from "./lib/auth.js";
import { parseExpand, batchExpand } from "./lib/expand.js";
import { flattenItem } from "./lib/flatten.js";
import { padOrderKey } from "./lib/orderKey.js";

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
  const body = req.body;
  const sql = await getDb();

  // Detect bulk vs single
  const isBulk = Array.isArray(body);
  const items = isBulk ? body : [body];

  // Validate bulk constraints
  if (isBulk && items.length > 100) {
    return { status: 400, body: { error: "Maximum 100 items allowed per bulk request" } };
  }

  // Validate each item has required 'data' field
  for (let i = 0; i < items.length; i++) {
    if (!items[i] || typeof items[i].data !== 'object') {
      return { status: 400, body: { error: `Item ${i} must have a 'data' object` } };
    }
  }

  // Build multi-row INSERT
  if (items.length === 0) {
    return { status: 400, body: { error: "No items to create" } };
  }

  const values = [];
  const params = [];
  let paramIndex = 1;

  for (const item of items) {
    const { parentId, ownerId, orderKey, data = {} } = item;
    values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5})`);
    params.push(
      auth.tenant_id,
      collection,
      parentId || null,
      ownerId || null,
      padOrderKey(orderKey),
      data
    );
    paramIndex += 6;
  }

  const rows = await sql.unsafe(
    `INSERT INTO items (tenant_id, collection, parent_id, owner_id, order_key, data)
     VALUES ${values.join(', ')}
     RETURNING *`,
    params
  );

  const results = rows.map(flattenItem);

  if (isBulk) {
    return { status: 201, body: { data: results, count: results.length } };
  } else {
    return { status: 201, body: { data: results[0] } };
  }
}
