import { query } from './db.js';

export async function batchExpand(items, expandOps, tenantId) {
  if (!items.length || !expandOps.length) return items;

  const itemMap = new Map(items.map(i => [i.id, i]));

  for (const item of items) item._expanded = {};

  for (const op of expandOps) {
    if (op.type === 'parent') {
      const parentIds = [...new Set(items.map(i => i.parent_id).filter(Boolean))];
      if (!parentIds.length) continue;

      const parents = await query(
        `SELECT * FROM items WHERE tenant_id = $1 AND id = ANY($2)`,
        [tenantId, parentIds]
      );

      const parentMap = new Map(parents.map(p => [p.id, p]));
      for (const item of items) {
        if (item.parent_id) item._expanded.parent = parentMap.get(item.parent_id) || null;
      }

      // Recursively expand nested ops on parents
      if (op.nested?.length && parents.length) {
        await batchExpand(parents, op.nested, tenantId);
      }
    }

    if (op.type === 'owner') {
      const ownerIds = [...new Set(items.map(i => i.owner_id).filter(Boolean))];
      if (!ownerIds.length) continue;

      const owners = await query(
        `SELECT * FROM items WHERE tenant_id = $1 AND id = ANY($2)`,
        [tenantId, ownerIds]
      );

      const ownerMap = new Map(owners.map(o => [o.id, o]));
      for (const item of items) {
        if (item.owner_id) item._expanded.owner = ownerMap.get(item.owner_id) || null;
      }

      // Recursively expand nested ops on owners
      if (op.nested?.length && owners.length) {
        await batchExpand(owners, op.nested, tenantId);
      }
    }

    if (op.type === 'children') {
      const parentIds = items.map(i => i.id);
      const children = await query(
        `SELECT * FROM items
         WHERE tenant_id = $1 AND collection = $2 AND parent_id = ANY($3)
         ORDER BY order_key`,
        [tenantId, op.collection, parentIds]
      );

      for (const child of children) {
        const parent = itemMap.get(child.parent_id);
        if (parent) {
          parent._expanded[op.collection] ??= [];
          parent._expanded[op.collection].push(child);
        }
      }

      // Recursively expand nested ops on children
      if (op.nested?.length && children.length) {
        await batchExpand(children, op.nested, tenantId);
      }
    }
  }

  return items;
}
