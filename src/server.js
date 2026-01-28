import express from "express";
import bodyParser from "body-parser";
import crypto from "crypto";
import { readFileSync } from "fs";

import { query, startServer } from "./db.js";
import { authenticate, requireRead, requireWrite } from "./auth.js";
import { parseExpand } from "./expandPlanner.js";
import { batchExpand } from "./expandBatch.js";

const app = express();
app.use(bodyParser.json());

/**
 * Serve the JavaScript client
 */
app.get("/client.js", (req, res) => {
  res.type("application/javascript").send(readFileSync("./client.js", "utf8"));
});

/**
 * Create a new tenant with tokens (no auth required - onboarding endpoint)
 */
app.post("/_tokens", async (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }

  // Create the tenant
  const [tenant] = await query(`INSERT INTO tenants (name) VALUES ($1) RETURNING id, name, created_at`, [name.trim()]);

  // Generate two secure tokens
  const readOnlyToken = crypto.randomBytes(32).toString("hex");
  const readWriteToken = crypto.randomBytes(32).toString("hex");

  // Insert both tokens
  await query(
    `INSERT INTO api_tokens (token, tenant_id, can_read, can_write) VALUES
     ($1, $2, TRUE, FALSE),
     ($3, $2, TRUE, TRUE)`,
    [readOnlyToken, tenant.id, readWriteToken],
  );

  res.status(201).json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      created_at: tenant.created_at,
    },
    tokens: {
      readOnly: readOnlyToken,
      readWrite: readWriteToken,
    },
  });
});

// Apply authentication to all routes below
app.use(authenticate);

/**
 * Get tokens for the current tenant (requires read-write token)
 */
app.get("/_tokens", requireWrite, async (req, res) => {
  const tokens = await query(
    `SELECT token, can_read, can_write, created_at
     FROM api_tokens
     WHERE tenant_id = $1
     ORDER BY can_write ASC`,
    [req.auth.tenant_id],
  );

  const readOnly = tokens.find((t) => t.can_read && !t.can_write);
  const readWrite = tokens.find((t) => t.can_read && t.can_write);

  res.json({
    tokens: {
      readOnly: readOnly?.token || null,
      readWrite: readWrite?.token || null,
    },
  });
});

/**
 * Collection CRUD routes
 */

// List items
app.get("/:collection", requireRead, async (req, res) => {
  const { collection } = req.params;
  const { parentId, ownerId, limit = 25, offset = 0, orderBy = "created_at", filter } = req.query;

  const conditions = ["tenant_id = $1", "collection = $2"];
  const params = [req.auth.tenant_id, collection];

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
        params.push(key, value);
        conditions.push(`data ->> $${params.length - 1} = $${params.length}`);
      });
    } catch (err) {
      return res.status(400).json({ error: "Invalid JSON filter" });
    }
  }

  const rows = await query(
    `SELECT * FROM items
     WHERE ${conditions.join(" AND ")}
     ORDER BY ${orderBy}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  const expandOps = parseExpand(req.query.expand);
  const expandedRows = await batchExpand(rows, expandOps, req.auth.tenant_id);

  res.json({
    data: expandedRows,
    pagination: { limit: Number(limit), offset: Number(offset), count: expandedRows.length },
  });
});

// Get single item
app.get("/:collection/:id", requireRead, async (req, res) => {
  const { collection, id } = req.params;

  const rows = await query(
    `SELECT * FROM items
     WHERE tenant_id = $1 AND collection = $2 AND id = $3`,
    [req.auth.tenant_id, collection, id],
  );

  if (!rows.length) {
    return res.status(404).json({ error: "Item not found" });
  }

  const expandOps = parseExpand(req.query.expand);
  const [item] = await batchExpand(rows, expandOps, req.auth.tenant_id);

  res.json({ data: item });
});

// Create item
app.post("/:collection", requireWrite, async (req, res) => {
  const { collection } = req.params;
  const { parentId, ownerId, orderKey, data = {} } = req.body;

  const [item] = await query(
    `INSERT INTO items (tenant_id, collection, parent_id, owner_id, order_key, data)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [req.auth.tenant_id, collection, parentId || null, ownerId || null, orderKey || null, data],
  );

  res.status(201).json({ data: item });
});

// Replace item (PUT = full replace)
app.put("/:collection/:id", requireWrite, async (req, res) => {
  const { collection, id } = req.params;
  const { parentId, ownerId, orderKey, data = {} } = req.body;

  const rows = await query(
    `UPDATE items SET parent_id = $4, owner_id = $5, order_key = $6, data = $7, updated_at = now()
     WHERE tenant_id = $1 AND collection = $2 AND id = $3
     RETURNING *`,
    [req.auth.tenant_id, collection, id, parentId || null, ownerId || null, orderKey || null, data],
  );

  if (!rows.length) {
    return res.status(404).json({ error: "Item not found" });
  }

  res.json({ data: rows[0] });
});

// Update item (PATCH = merge data)
app.patch("/:collection/:id", requireWrite, async (req, res) => {
  const { collection, id } = req.params;
  const { parentId, ownerId, orderKey, data } = req.body;

  // Build dynamic update
  const updates = [];
  const params = [req.auth.tenant_id, collection, id];

  if (parentId !== undefined) {
    params.push(parentId);
    updates.push(`parent_id = $${params.length}`);
  }
  if (ownerId !== undefined) {
    params.push(ownerId);
    updates.push(`owner_id = $${params.length}`);
  }
  if (orderKey !== undefined) {
    params.push(orderKey);
    updates.push(`order_key = $${params.length}`);
  }
  if (data !== undefined) {
    // Deep merge: existing data || new data (cast to jsonb)
    params.push(JSON.stringify(data));
    updates.push(`data = data || $${params.length}::jsonb`);
  }

  if (!updates.length) {
    return res.status(400).json({ error: "No fields to update" });
  }

  updates.push("updated_at = now()");

  const rows = await query(
    `UPDATE items SET ${updates.join(", ")}
     WHERE tenant_id = $1 AND collection = $2 AND id = $3
     RETURNING *`,
    params,
  );

  if (!rows.length) {
    return res.status(404).json({ error: "Item not found" });
  }

  res.json({ data: rows[0] });
});

// Delete item
app.delete("/:collection/:id", requireWrite, async (req, res) => {
  const { collection, id } = req.params;

  const rows = await query(
    `DELETE FROM items WHERE tenant_id = $1 AND collection = $2 AND id = $3 RETURNING id`,
    [req.auth.tenant_id, collection, id],
  );

  if (!rows.length) {
    return res.status(404).json({ error: "Item not found" });
  }

  res.status(204).send();
});

/**
 * Start the server
 */
startServer(app, 5001);
