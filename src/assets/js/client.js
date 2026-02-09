/**
 * bunpaas-db - Simple API Client
 *
 * Usage:
 *
 *   // Create tenant
 *   const { tokens } = await bunpaasDb("https://db.example.com").createTenant("My App");
 *
 *   // Use the API
 *   const db = bunpaasDb("https://db.example.com", tokens.readWrite);
 *
 *   // CRUD Operations
 *   const { data: task } = await db.collection("tasks").create({
 *     data: { title: "Test" }
 *   });
 *
 *   const { data: tasks } = await db.collection("tasks").list({
 *     filter: { status: "done" },
 *     expand: "owner"
 *   });
 *
 *   await db.collection("tasks").update(task.id, {
 *     data: { status: "done" }
 *   });
 *
 *   await db.collection("tasks").replace(task.id, {
 *     data: { title: "New Title" }
 *   });
 *
 *   await db.collection("tasks").delete(task.id);
 *
 *   // User Management
 *   const { data: user } = await db.users.create("user@example.com", "password");
 *   const { data: session } = await db.users.signin("user@example.com", "password");
 *   await db.users.changePassword(user.id, "newpassword");
 *   await db.users.delete(user.id);
 */

export function bunpaasDb(baseUrl, token) {
  const headers = {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };

  async function request(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json()).error);
    return res.status === 204 ? null : res.json();
  }

  return {
    createTenant: (name) => request("POST", "/_tokens", { name }),

    users: {
      create: (email, password) => request("POST", "/_users", { email, password }),
      changePassword: (id, password) => request("PATCH", `/_users/${id}`, { password }),
      delete: (id) => request("DELETE", `/_users/${id}`),
      signin: (email, password) => request("POST", "/_signin", { email, password }),
    },

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
      delete: (id) => request("DELETE", `/${name}/${id}`),
    }),
  };
}
