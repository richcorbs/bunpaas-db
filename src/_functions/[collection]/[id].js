import { getDb } from "../lib/db.js";
import { authenticate, requireRead, requireWrite } from "../lib/auth.js";
import { parseExpand, batchExpand } from "../lib/expand.js";
import { flattenItem } from "../lib/flatten.js";
import { padOrderKey } from "../lib/orderKey.js";

export async function get(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;
  const denied = requireRead(auth);
  if (denied) return denied;

  const { collection, id } = req.params;
  const sql = await getDb();

  const rows = await sql`
    SELECT * FROM items
    WHERE tenant_id = ${auth.tenant_id} AND collection = ${collection} AND id = ${id}
  `;

  if (!rows.length) {
    return { status: 404, body: { error: "Item not found" } };
  }

  const expandOps = parseExpand(req.query.expand);
  const [item] = await batchExpand([...rows], expandOps, auth.tenant_id);

  return { status: 200, body: { data: flattenItem(item) } };
}

export async function post(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;
  const denied = requireWrite(auth);
  if (denied) return denied;

  const { collection, id } = req.params;
  const { parentId, ownerId, orderKey, data = {} } = req.body || {};
  const sql = await getDb();

  const [item] = await sql.unsafe(
    `INSERT INTO items (tenant_id, collection, parent_id, owner_id, order_key, data)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [auth.tenant_id, collection, parentId || null, ownerId || null, padOrderKey(orderKey), data],
  );

  return { status: 201, body: { data: flattenItem(item) } };
}

export async function put(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;
  const denied = requireWrite(auth);
  if (denied) return denied;

  const { collection, id } = req.params;
  const { parentId, ownerId, orderKey, data = {} } = req.body || {};
  const sql = await getDb();

  const rows = await sql.unsafe(
    `UPDATE items SET parent_id = $4, owner_id = $5, order_key = $6, data = $7, updated_at = now()
     WHERE tenant_id = $1 AND collection = $2 AND id = $3
     RETURNING *`,
    [auth.tenant_id, collection, id, parentId || null, ownerId || null, padOrderKey(orderKey), data],
  );

  if (!rows.length) {
    return { status: 404, body: { error: "Item not found" } };
  }

  return { status: 200, body: { data: flattenItem(rows[0]) } };
}

export async function patch(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;
  const denied = requireWrite(auth);
  if (denied) return denied;

  const { collection, id } = req.params;
  const { parentId, ownerId, orderKey, data } = req.body || {};
  const sql = await getDb();

  const updates = [];
  const params = [auth.tenant_id, collection, id];

  if (parentId !== undefined) {
    params.push(parentId);
    updates.push(`parent_id = $${params.length}`);
  }
  if (ownerId !== undefined) {
    params.push(ownerId);
    updates.push(`owner_id = $${params.length}`);
  }
  if (orderKey !== undefined) {
    params.push(padOrderKey(orderKey));
    updates.push(`order_key = $${params.length}`);
  }
  if (data !== undefined) {
    params.push(data);
    updates.push(`data = data || $${params.length}`);
  }

  if (!updates.length) {
    return { status: 400, body: { error: "No fields to update" } };
  }

  updates.push("updated_at = now()");

  const rows = await sql.unsafe(
    `UPDATE items SET ${updates.join(", ")}
     WHERE tenant_id = $1 AND collection = $2 AND id = $3
     RETURNING *`,
    params,
  );

  if (!rows.length) {
    return { status: 404, body: { error: "Item not found" } };
  }

  return { status: 200, body: { data: flattenItem(rows[0]) } };
}

export async function del(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;
  const denied = requireWrite(auth);
  if (denied) return denied;

  const { collection, id } = req.params;
  const { cascade } = req.query;
  const sql = await getDb();

  // If cascade requested, find all descendants recursively
  let idsToDelete = [id];

  if (cascade) {
    // Use CTE to find all descendants recursively
    const descendantRows = await sql.unsafe(`
      WITH RECURSIVE descendants AS (
        -- Base case: direct children
        SELECT id FROM items
        WHERE tenant_id = $1 AND parent_id = $2

        UNION ALL

        -- Recursive case: children of children
        SELECT i.id FROM items i
        INNER JOIN descendants d ON i.parent_id = d.id
        WHERE i.tenant_id = $1
      )
      SELECT id FROM descendants
    `, [auth.tenant_id, id]);

    idsToDelete = [id, ...descendantRows.map(r => r.id)];
  }

  // Delete all items
  const rows = await sql.unsafe(`
    DELETE FROM items
    WHERE tenant_id = $1
    AND id IN (${idsToDelete.map((_, i) => `$${i + 2}`).join(', ')})
    RETURNING id
  `, [auth.tenant_id, ...idsToDelete]);

  if (!rows.length) {
    return { status: 404, body: { error: "Item not found" } };
  }

  // If cascading, return 200 with count, otherwise 204
  if (cascade) {
    return {
      status: 200,
      body: { deleted: rows.length, ids: rows.map(r => r.id) }
    };
  }

  return { status: 204, body: null };
}
