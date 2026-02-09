import { getDb } from "./db.js";

export function parseExpand(expand) {
  if (!expand) return [];
  return expand.split(",").map((e) => parseExpandOp(e.trim()));
}

function parseExpandOp(expr) {
  const dotIndex = expr.indexOf(".");
  if (dotIndex !== -1) {
    const first = expr.slice(0, dotIndex);
    const rest = expr.slice(dotIndex + 1);
    const op = parseExpandOp(first);
    op.nested = [parseExpandOp(rest)];
    return op;
  }

  if (expr.startsWith("children:")) {
    return { type: "children", collection: expr.split(":")[1] };
  }

  return { type: expr };
}

export async function batchExpand(items, expandOps, tenantId) {
  if (!items.length || !expandOps.length) return items;

  const sql = getDb();
  const itemMap = new Map(items.map((i) => [i.id, i]));

  for (const item of items) item._expanded = {};

  for (const op of expandOps) {
    if (op.type === "parent") {
      const parentIds = [...new Set(items.map((i) => i.parent_id).filter(Boolean))];
      if (!parentIds.length) continue;

      const parents = await sql`
        SELECT * FROM items WHERE tenant_id = ${tenantId} AND id IN ${sql(parentIds)}
      `;

      const parentMap = new Map(parents.map((p) => [p.id, p]));
      for (const item of items) {
        if (item.parent_id) item._expanded.parent = parentMap.get(item.parent_id) || null;
      }

      if (op.nested?.length && parents.length) {
        await batchExpand([...parents], op.nested, tenantId);
      }
    }

    if (op.type === "owner") {
      const ownerIds = [...new Set(items.map((i) => i.owner_id).filter(Boolean))];
      if (!ownerIds.length) continue;

      const owners = await sql`
        SELECT * FROM items WHERE tenant_id = ${tenantId} AND id IN ${sql(ownerIds)}
      `;

      const ownerMap = new Map(owners.map((o) => [o.id, o]));
      for (const item of items) {
        if (item.owner_id) item._expanded.owner = ownerMap.get(item.owner_id) || null;
      }

      if (op.nested?.length && owners.length) {
        await batchExpand([...owners], op.nested, tenantId);
      }
    }

    if (op.type === "children") {
      const parentIds = items.map((i) => i.id);

      const children = await sql`
        SELECT * FROM items
        WHERE tenant_id = ${tenantId} AND collection = ${op.collection} AND parent_id IN ${sql(parentIds)}
        ORDER BY order_key
      `;

      for (const child of children) {
        const parent = itemMap.get(child.parent_id);
        if (parent) {
          parent._expanded[op.collection] ??= [];
          parent._expanded[op.collection].push(child);
        }
      }

      if (op.nested?.length && children.length) {
        await batchExpand([...children], op.nested, tenantId);
      }
    }
  }

  return items;
}
