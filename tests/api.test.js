import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { ensureDatabase, initSchema, close as closeDb } from "../src/_functions/lib/db.js";
import { startTestServer } from "./server.js";

let server;
let BASE;
let READ_TOKEN, WRITE_TOKEN, TENANT_ID;

beforeAll(async () => {
  await ensureDatabase();
  await initSchema();
  server = startTestServer(0);
  BASE = `http://localhost:${server.port}`;
});

afterAll(async () => {
  // Cleanup test data
  const collections = [
    "tasks", "subtasks", "query-test", "projects", "users",
    "isolation-test", "boards", "columns", "cards",
  ];
  for (const collection of collections) {
    const res = await fetch(`${BASE}/${collection}?limit=1000`, {
      headers: { Authorization: `Bearer ${WRITE_TOKEN}` },
    });
    if (res.ok) {
      const { data } = await res.json();
      for (const item of data) {
        await fetch(`${BASE}/${collection}/${item.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${WRITE_TOKEN}` },
        });
      }
    }
  }
  server.stop();
  await closeDb();
});

// Helper
async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const status = res.status;
  let json = null;
  if (status !== 204) {
    try { json = await res.json(); } catch {}
  }
  return { status, json };
}

// ==========================================
// TENANT & TOKEN TESTS
// ==========================================

describe("Tenant & Token", () => {
  it("creates a new tenant (201)", async () => {
    const { status, json } = await api("POST", "/_tokens", { body: { name: "Test Tenant" } });
    expect(status).toBe(201);
    expect(json.tenant.id).toBeDefined();
    expect(json.tokens.readOnly).toBeDefined();
    expect(json.tokens.readWrite).toBeDefined();

    READ_TOKEN = json.tokens.readOnly;
    WRITE_TOKEN = json.tokens.readWrite;
    TENANT_ID = json.tenant.id;
  });

  it("rejects tenant creation without name (400)", async () => {
    const { status } = await api("POST", "/_tokens", { body: {} });
    expect(status).toBe(400);
  });

  it("gets tokens with write token (200)", async () => {
    const { status, json } = await api("GET", "/_tokens", { token: WRITE_TOKEN });
    expect(status).toBe(200);
    expect(json.tokens.readOnly).toBeDefined();
    expect(json.tokens.readWrite).toBeDefined();
  });

  it("rejects get tokens with read token (403)", async () => {
    const { status } = await api("GET", "/_tokens", { token: READ_TOKEN });
    expect(status).toBe(403);
  });
});

// ==========================================
// CRUD TESTS
// ==========================================

describe("CRUD Operations", () => {
  let ITEM_ID, SUBTASK_ID;

  it("creates an item (201)", async () => {
    const { status, json } = await api("POST", "/tasks", {
      token: WRITE_TOKEN,
      body: { data: { title: "Test Task", status: "pending", priority: 1 } },
    });
    expect(status).toBe(201);
    expect(json.data.id).toBeDefined();
    expect(json.data.collection).toBe("tasks");
    expect(json.data.title).toBe("Test Task");
    ITEM_ID = json.data.id;
  });

  it("creates item with parentId and ownerId (201)", async () => {
    const { status, json } = await api("POST", "/subtasks", {
      token: WRITE_TOKEN,
      body: { parentId: ITEM_ID, ownerId: ITEM_ID, data: { title: "Subtask" } },
    });
    expect(status).toBe(201);
    expect(json.data.parent_id).toBe(ITEM_ID);
    expect(json.data.owner_id).toBe(ITEM_ID);
    SUBTASK_ID = json.data.id;
  });

  it("gets a single item (200)", async () => {
    const { status, json } = await api("GET", `/tasks/${ITEM_ID}`, { token: READ_TOKEN });
    expect(status).toBe(200);
    expect(json.data.id).toBe(ITEM_ID);
  });

  it("returns 404 for non-existent item", async () => {
    const { status } = await api("GET", "/tasks/00000000-0000-0000-0000-000000000000", { token: READ_TOKEN });
    expect(status).toBe(404);
  });

  it("lists items in collection (200)", async () => {
    const { status, json } = await api("GET", "/tasks", { token: READ_TOKEN });
    expect(status).toBe(200);
    expect(json.data).toBeDefined();
    expect(json.pagination).toBeDefined();
  });

  it("PATCH merges data (200)", async () => {
    const { status, json } = await api("PATCH", `/tasks/${ITEM_ID}`, {
      token: WRITE_TOKEN,
      body: { data: { status: "in_progress" } },
    });
    expect(status).toBe(200);
    expect(json.data.title).toBe("Test Task");
    expect(json.data.status).toBe("in_progress");
  });

  it("PUT replaces data (200)", async () => {
    const { status, json } = await api("PUT", `/tasks/${ITEM_ID}`, {
      token: WRITE_TOKEN,
      body: { data: { title: "Replaced Task" } },
    });
    expect(status).toBe(200);
    expect(json.data.title).toBe("Replaced Task");
    expect(json.data.status).toBeUndefined();
  });

  it("PATCH with no fields returns 400", async () => {
    const { status } = await api("PATCH", `/tasks/${ITEM_ID}`, {
      token: WRITE_TOKEN,
      body: {},
    });
    expect(status).toBe(400);
  });

  it("rejects PATCH with read-only token (403)", async () => {
    const { status } = await api("PATCH", `/tasks/${ITEM_ID}`, {
      token: READ_TOKEN,
      body: { data: { title: "Hacked" } },
    });
    expect(status).toBe(403);
  });

  it("deletes subtask (204)", async () => {
    const { status } = await api("DELETE", `/subtasks/${SUBTASK_ID}`, { token: WRITE_TOKEN });
    expect(status).toBe(204);
  });

  it("returns 404 deleting non-existent item", async () => {
    const { status } = await api("DELETE", "/tasks/00000000-0000-0000-0000-000000000000", { token: WRITE_TOKEN });
    expect(status).toBe(404);
  });

  it("rejects delete with read-only token (403)", async () => {
    const { status } = await api("DELETE", `/tasks/${ITEM_ID}`, { token: READ_TOKEN });
    expect(status).toBe(403);
  });
});

// ==========================================
// QUERY PARAMETER TESTS
// ==========================================

describe("Query Parameters", () => {
  beforeAll(async () => {
    for (let i = 1; i <= 5; i++) {
      await api("POST", "/query-test", {
        token: WRITE_TOKEN,
        body: { data: { index: i, category: "A" } },
      });
    }
    for (let i = 6; i <= 10; i++) {
      await api("POST", "/query-test", {
        token: WRITE_TOKEN,
        body: { data: { index: i, category: "B" } },
      });
    }
  });

  it("limits results", async () => {
    const { status, json } = await api("GET", "/query-test?limit=3", { token: READ_TOKEN });
    expect(status).toBe(200);
    expect(json.data.length).toBe(3);
  });

  it("offsets results", async () => {
    const { status, json } = await api("GET", "/query-test?limit=3&offset=3", { token: READ_TOKEN });
    expect(status).toBe(200);
    expect(json.pagination.offset).toBe(3);
  });

  it("filters by JSON field", async () => {
    const filter = encodeURIComponent(JSON.stringify({ category: "B" }));
    const { status, json } = await api("GET", `/query-test?filter=${filter}`, { token: READ_TOKEN });
    expect(status).toBe(200);
    expect(json.data.length).toBe(5);
  });

  it("rejects invalid JSON filter (400)", async () => {
    const { status } = await api("GET", "/query-test?filter=not-json", { token: READ_TOKEN });
    expect(status).toBe(400);
  });
});

// ==========================================
// EXPAND RELATIONSHIPS TESTS
// ==========================================

describe("Expand Relationships", () => {
  let PROJECT_ID, USER_ID, TASK_ID;

  beforeAll(async () => {
    const proj = await api("POST", "/projects", {
      token: WRITE_TOKEN,
      body: { data: { name: "Project Alpha" } },
    });
    PROJECT_ID = proj.json.data.id;

    const user = await api("POST", "/users", {
      token: WRITE_TOKEN,
      body: { data: { name: "John Doe" } },
    });
    USER_ID = user.json.data.id;

    const task = await api("POST", "/tasks", {
      token: WRITE_TOKEN,
      body: { parentId: PROJECT_ID, ownerId: USER_ID, data: { title: "Task with relations" } },
    });
    TASK_ID = task.json.data.id;
  });

  it("expands parent", async () => {
    const { status, json } = await api("GET", `/tasks/${TASK_ID}?expand=parent`, { token: READ_TOKEN });
    expect(status).toBe(200);
    expect(json.data._expanded.parent).toBeDefined();
    expect(json.data._expanded.parent.name).toBe("Project Alpha");
  });

  it("expands owner", async () => {
    const { status, json } = await api("GET", `/tasks/${TASK_ID}?expand=owner`, { token: READ_TOKEN });
    expect(status).toBe(200);
    expect(json.data._expanded.owner).toBeDefined();
    expect(json.data._expanded.owner.name).toBe("John Doe");
  });

  it("expands multiple relationships", async () => {
    const { status, json } = await api("GET", `/tasks/${TASK_ID}?expand=parent,owner`, { token: READ_TOKEN });
    expect(status).toBe(200);
    expect(json.data._expanded.parent).toBeDefined();
    expect(json.data._expanded.owner).toBeDefined();
  });

  it("expands nested: board -> columns -> cards", async () => {
    const board = await api("POST", "/boards", {
      token: WRITE_TOKEN,
      body: { data: { name: "Test Board" } },
    });
    const BOARD_ID = board.json.data.id;

    const col = await api("POST", "/columns", {
      token: WRITE_TOKEN,
      body: { parentId: BOARD_ID, data: { name: "To Do" }, orderKey: "a" },
    });
    const COLUMN_ID = col.json.data.id;

    const card = await api("POST", "/cards", {
      token: WRITE_TOKEN,
      body: { parentId: COLUMN_ID, data: { title: "Test Card" } },
    });
    const CARD_ID = card.json.data.id;

    const { status, json } = await api(
      "GET",
      `/boards/${BOARD_ID}?expand=children:columns.children:cards`,
      { token: READ_TOKEN },
    );
    expect(status).toBe(200);
    expect(json.data._expanded.columns).toBeDefined();
    expect(json.data._expanded.columns[0]._expanded.cards).toBeDefined();
    expect(json.data._expanded.columns[0]._expanded.cards[0].title).toBe("Test Card");

    // Cleanup
    await api("DELETE", `/cards/${CARD_ID}`, { token: WRITE_TOKEN });
    await api("DELETE", `/columns/${COLUMN_ID}`, { token: WRITE_TOKEN });
    await api("DELETE", `/boards/${BOARD_ID}`, { token: WRITE_TOKEN });
  });

  afterAll(async () => {
    await api("DELETE", `/tasks/${TASK_ID}`, { token: WRITE_TOKEN });
    await api("DELETE", `/projects/${PROJECT_ID}`, { token: WRITE_TOKEN });
    await api("DELETE", `/users/${USER_ID}`, { token: WRITE_TOKEN });
  });
});

// ==========================================
// USER MANAGEMENT TESTS
// ==========================================

describe("User Management", () => {
  let USER_ID;

  it("creates a user (201)", async () => {
    const { status, json } = await api("POST", "/_users", {
      token: WRITE_TOKEN,
      body: { email: "test@example.com", password: "secret123" },
    });
    expect(status).toBe(201);
    expect(json.data.id).toBeDefined();
    expect(json.data.email).toBe("test@example.com");
    expect(json.data.active).toBe(true);
    USER_ID = json.data.id;
  });

  it("rejects user without email (400)", async () => {
    const { status } = await api("POST", "/_users", {
      token: WRITE_TOKEN,
      body: { password: "secret123" },
    });
    expect(status).toBe(400);
  });

  it("rejects duplicate email (409)", async () => {
    const { status } = await api("POST", "/_users", {
      token: WRITE_TOKEN,
      body: { email: "test@example.com", password: "different" },
    });
    expect(status).toBe(409);
  });

  it("signs in with correct credentials (200)", async () => {
    const { status, json } = await api("POST", "/_signin", {
      token: READ_TOKEN,
      body: { email: "test@example.com", password: "secret123" },
    });
    expect(status).toBe(200);
    expect(json.data.email).toBe("test@example.com");
  });

  it("changes password (200)", async () => {
    const { status } = await api("PATCH", `/_users/${USER_ID}`, {
      token: WRITE_TOKEN,
      body: { password: "newpassword456" },
    });
    expect(status).toBe(200);
  });

  it("rejects sign in with old password (401)", async () => {
    const { status } = await api("POST", "/_signin", {
      token: READ_TOKEN,
      body: { email: "test@example.com", password: "secret123" },
    });
    expect(status).toBe(401);
  });

  it("signs in with new password (200)", async () => {
    const { status } = await api("POST", "/_signin", {
      token: READ_TOKEN,
      body: { email: "test@example.com", password: "newpassword456" },
    });
    expect(status).toBe(200);
  });

  it("rejects wrong password (401)", async () => {
    const { status } = await api("POST", "/_signin", {
      token: READ_TOKEN,
      body: { email: "test@example.com", password: "wrongpassword" },
    });
    expect(status).toBe(401);
  });

  it("rejects non-existent user (401)", async () => {
    const { status } = await api("POST", "/_signin", {
      token: READ_TOKEN,
      body: { email: "nobody@example.com", password: "secret123" },
    });
    expect(status).toBe(401);
  });

  it("rejects create user with read token (403)", async () => {
    const { status } = await api("POST", "/_users", {
      token: READ_TOKEN,
      body: { email: "another@example.com", password: "secret" },
    });
    expect(status).toBe(403);
  });

  it("deletes user (204)", async () => {
    const { status } = await api("DELETE", `/_users/${USER_ID}`, { token: WRITE_TOKEN });
    expect(status).toBe(204);
  });

  it("rejects sign in after delete (401)", async () => {
    const { status } = await api("POST", "/_signin", {
      token: READ_TOKEN,
      body: { email: "test@example.com", password: "secret123" },
    });
    expect(status).toBe(401);
  });

  it("returns 404 deleting non-existent user", async () => {
    const { status } = await api("DELETE", "/_users/00000000-0000-0000-0000-000000000000", { token: WRITE_TOKEN });
    expect(status).toBe(404);
  });
});

// ==========================================
// AUTHENTICATION TESTS
// ==========================================

describe("Authentication", () => {
  it("rejects request without token (401)", async () => {
    const { status } = await api("GET", "/tasks");
    expect(status).toBe(401);
  });

  it("rejects invalid token (401)", async () => {
    const { status } = await api("GET", "/tasks", { token: "invalid-token-12345" });
    expect(status).toBe(401);
  });

  it("rejects malformed auth header (401)", async () => {
    const res = await fetch(`${BASE}/tasks`, {
      headers: { Authorization: `NotBearer ${READ_TOKEN}` },
    });
    expect(res.status).toBe(401);
  });
});

// ==========================================
// ORDER_KEY SORTING TESTS
// ==========================================

describe("Order Key Sorting", () => {
  let ITEM_IDS = [];

  beforeAll(async () => {
    // Create items with numeric order keys: 1, 2, 10
    // Without padding, lexicographic sort would be: 1, 10, 2
    // With padding, correct numeric sort: 1, 2, 10
    const items = [
      { orderKey: 1, data: { name: "First" } },
      { orderKey: 2, data: { name: "Second" } },
      { orderKey: 10, data: { name: "Tenth" } },
    ];

    for (const item of items) {
      const res = await api("POST", "/sort-test", {
        token: WRITE_TOKEN,
        body: item,
      });
      ITEM_IDS.push(res.json.data.id);
    }
  });

  it("pads numeric orderKey and returns unpadded", async () => {
    const { status, json } = await api("POST", "/sort-test", {
      token: WRITE_TOKEN,
      body: { orderKey: 42, data: { name: "Test" } },
    });
    expect(status).toBe(201);
    // Should return unpadded value
    expect(json.data.order_key).toBe("42");
  });

  it("preserves non-numeric orderKey as-is", async () => {
    const { status, json } = await api("POST", "/sort-test", {
      token: WRITE_TOKEN,
      body: { orderKey: "a", data: { name: "Alpha" } },
    });
    expect(status).toBe(201);
    expect(json.data.order_key).toBe("a");
  });

  it("sorts numeric orderKey correctly (1, 2, 10 not 1, 10, 2)", async () => {
    const { status, json } = await api("GET", "/sort-test?orderBy=order_key", { token: READ_TOKEN });
    expect(status).toBe(200);

    const orderKeys = json.data.map((item) => item.order_key);
    // Should be sorted numerically, not lexicographically
    expect(orderKeys).toEqual(["1", "2", "10", "42", "a"]);
  });

  afterAll(async () => {
    // Cleanup all sort-test items
    const { json } = await api("GET", "/sort-test?limit=1000", { token: READ_TOKEN });
    if (json?.data) {
      for (const item of json.data) {
        await api("DELETE", `/sort-test/${item.id}`, { token: WRITE_TOKEN });
      }
    }
  });
});

// ==========================================
// MULTI-TENANT ISOLATION TESTS
// ==========================================

describe("Multi-Tenant Isolation", () => {
  let TENANT2_READ_TOKEN, TENANT2_WRITE_TOKEN, TENANT1_ITEM_ID;

  beforeAll(async () => {
    const t2 = await api("POST", "/_tokens", { body: { name: "Second Tenant" } });
    TENANT2_READ_TOKEN = t2.json.tokens.readOnly;
    TENANT2_WRITE_TOKEN = t2.json.tokens.readWrite;

    const item = await api("POST", "/isolation-test", {
      token: WRITE_TOKEN,
      body: { data: { secret: "tenant1-data" } },
    });
    TENANT1_ITEM_ID = item.json.data.id;
  });

  it("second tenant sees 0 items from first", async () => {
    const { status, json } = await api("GET", "/isolation-test", { token: TENANT2_READ_TOKEN });
    expect(status).toBe(200);
    expect(json.data.length).toBe(0);
  });

  it("second tenant cannot access first tenant's item (404)", async () => {
    const { status } = await api("GET", `/isolation-test/${TENANT1_ITEM_ID}`, { token: TENANT2_READ_TOKEN });
    expect(status).toBe(404);
  });

  it("second tenant cannot update first tenant's item (404)", async () => {
    const { status } = await api("PATCH", `/isolation-test/${TENANT1_ITEM_ID}`, {
      token: TENANT2_WRITE_TOKEN,
      body: { data: { hacked: true } },
    });
    expect(status).toBe(404);
  });

  it("second tenant cannot delete first tenant's item (404)", async () => {
    const { status } = await api("DELETE", `/isolation-test/${TENANT1_ITEM_ID}`, { token: TENANT2_WRITE_TOKEN });
    expect(status).toBe(404);
  });

  afterAll(async () => {
    await api("DELETE", `/isolation-test/${TENANT1_ITEM_ID}`, { token: WRITE_TOKEN });
  });
});
