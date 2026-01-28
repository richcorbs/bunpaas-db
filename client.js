/**
 * ProtoDB - Simple API Client
 *
 * Usage:
 *
 *   // Create tenant
 *   const { tokens } = await protodb("http://localhost:5001").createTenant("My App");
 *
 *   // Use the API
 *   const db = protodb("http://localhost:5001", tokens.readWrite);
 *
 *   // Create
 *   const { data: task } = await db.collection("tasks").create({
 *     data: { title: "Test" }
 *   });
 *
 *   // List with filters
 *   const { data: tasks } = await db.collection("tasks").list({
 *     filter: { status: "done" },
 *     expand: "owner"
 *   });
 *
 *   // Update (merge)
 *   await db.collection("tasks").update(task.id, {
 *     data: { status: "done" }
 *   });
 *
 *   // Replace (overwrite)
 *   await db.collection("tasks").replace(task.id, {
 *     data: { title: "New Title" }
 *   });
 *
 *   // Delete
 *   await db.collection("tasks").delete(task.id);
 *
 *   // Nested expand
 *   const { data: board } = await db.collection("boards").get(boardId, {
 *     expand: "children:columns.children:cards"
 *   });
 */

export function protodb(baseUrl, token) {
  const headers = {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` })
  };

  async function request(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error((await res.json()).error);
    return res.status === 204 ? null : res.json();
  }

  return {
    // Create tenant (no auth needed)
    createTenant: (name) => request("POST", "/_tokens", { name }),

    // Collection operations
    collection: (name) => ({
      list: (opts = {}) => {
        const params = new URLSearchParams();
        if (opts.limit) params.set("limit", opts.limit);
        if (opts.offset) params.set("offset", opts.offset);
        if (opts.orderBy) params.set("orderBy", opts.orderBy);
        if (opts.parentId) params.set("parentId", opts.parentId);
        if (opts.ownerId) params.set("ownerId", opts.ownerId);
        if (opts.filter) params.set("filter", JSON.stringify(opts.filter));
        if (opts.expand) params.set("expand", opts.expand);
        const query = params.toString();
        return request("GET", `/${name}${query ? `?${query}` : ""}`);
      },
      get: (id, opts = {}) => {
        const query = opts.expand ? `?expand=${opts.expand}` : "";
        return request("GET", `/${name}/${id}${query}`);
      },
      create: (body) => request("POST", `/${name}`, body),
      replace: (id, body) => request("PUT", `/${name}/${id}`, body),
      update: (id, body) => request("PATCH", `/${name}/${id}`, body),
      delete: (id) => request("DELETE", `/${name}/${id}`)
    })
  };
}
