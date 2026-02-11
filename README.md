# bunpaas-db

A schema-agnostic, multi-tenant backend for prototyping apps like Kanban, CMS, or CRM. Built as a [bunpaas-cli](https://github.com/bunpaas/bunpaas-cli) site with serverless functions on Bun and PostgreSQL with JSONB storage.

**Live Demo:** [bunpaas-db.richcorbs.com](https://bunpaas-db.richcorbs.com)

**Zero npm dependencies.** Uses Bun.sql (native PostgreSQL), Bun.CryptoHasher, and Web Crypto API.

## Features

- **Interactive Demo Page** - Try the API directly from your browser
- **Alpine.js Token Form** - Create tenants and get API tokens instantly
- **Schema-agnostic** - Store any JSON data in JSONB columns
- **Multi-tenant** - Complete tenant isolation
- **Relationship Expansion** - Fetch related items with `?expand=parent,owner,children:collection`
- **JSON Filtering** - Query by JSONB fields: `?filter={"status":"done"}` (supports nested paths like `{"user.name":"John"}`)
- **GIN Indexing** - Automatic PostgreSQL GIN index for fast JSONB queries
- **Numeric Sorting** - Automatic zero-padding for numeric order_key values (1, 2, 10 sort correctly)
- **Bulk Operations** - Create multiple items in one request with array payloads
- **Cascading Deletes** - Delete parent and all descendants with `?cascade=true`
- **User Management** - Built-in authentication with password hashing

## Quick Start

```bash
# Set your PostgreSQL connection
export DATABASE_URL=postgres://bunpaas:password@localhost:5432/bunpaas

bunpaas-cli dev      # Dev server with hot reload (http://localhost:8000)
bun test             # Run 44 tests
bunpaas-cli build    # Build for deployment
bunpaas-cli deploy   # Deploy to bunpaas
```

## API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/_tokens` | None | Create tenant |
| GET | `/_tokens` | Write | Get tokens |
| GET | `/_backup` | Write | Export tenant data |
| POST | `/_users` | Write | Create user |
| PATCH | `/_users/:id` | Write | Change password |
| DELETE | `/_users/:id` | Write | Delete user |
| POST | `/_signin` | Read | Authenticate user |
| GET | `/:collection` | Read | List items |
| GET | `/:collection/:id` | Read | Get item |
| POST | `/:collection` | Write | Create item (array for bulk create) |
| PUT | `/:collection/:id` | Write | Replace item |
| PATCH | `/:collection/:id` | Write | Merge update |
| DELETE | `/:collection/:id` | Write | Delete item (use `?cascade=true` for cascading delete) |

## Authentication

All requests (except tenant creation) require a Bearer token:

```
Authorization: Bearer <token>
```

### Create a Tenant

```javascript
const res = await fetch("http://localhost:5001/_tokens", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "My App" })
});
const { tenant, tokens } = await res.json();
// tokens.readOnly  - can only read
// tokens.readWrite - can read and write
```

## CRUD Operations

### Create

```javascript
const res = await fetch("http://localhost:5001/tasks", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    data: { title: "My Task", status: "pending" },
    parentId: "optional-uuid",
    orderKey: "a"
  })
});
const { data: task } = await res.json();
```

### Read

```javascript
// List items
const listRes = await fetch("http://localhost:5001/tasks", {
  headers: { "Authorization": `Bearer ${TOKEN}` }
});
const { data: items, pagination } = await listRes.json();

// Get single item
const getRes = await fetch(`http://localhost:5001/tasks/${id}`, {
  headers: { "Authorization": `Bearer ${TOKEN}` }
});
const { data: item } = await getRes.json();
```

### Update

**PUT** replaces the entire item. **PATCH** merges with existing data.

```javascript
// PUT - replaces data entirely
await fetch(`http://localhost:5001/tasks/${id}`, {
  method: "PUT",
  headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ data: { title: "New Title" } })
});

// PATCH - merges with existing data
await fetch(`http://localhost:5001/tasks/${id}`, {
  method: "PATCH",
  headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ data: { status: "done" } })
});
```

### Delete

```javascript
await fetch(`http://localhost:5001/tasks/${id}`, {
  method: "DELETE",
  headers: { "Authorization": `Bearer ${TOKEN}` }
});
```

## Bulk Operations

Create up to 100 items in a single request by passing an array:

```javascript
const res = await fetch("http://localhost:5001/tasks", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify([
    { data: { title: "Task 1", status: "pending" } },
    { data: { title: "Task 2", status: "done" } },
    { data: { title: "Task 3", status: "in_progress" } }
  ])
});
const { data: tasks, count } = await res.json();
// count: 3
```

## Cascading Deletes

Delete an item and all its descendants (children, grandchildren, etc.) across all collections:

```javascript
const res = await fetch(`http://localhost:5001/boards/${boardId}?cascade=true`, {
  method: "DELETE",
  headers: { "Authorization": `Bearer ${TOKEN}` }
});
const { deleted, ids } = await res.json();
// deleted: 5 (board + 4 children items)
// ids: ["uuid1", "uuid2", ...]
```

## Query Parameters

| Parameter | Example | Description |
|-----------|---------|-------------|
| `limit` | `?limit=10` | Max items (default: 25) |
| `offset` | `?offset=20` | Skip items |
| `orderBy` | `?orderBy=updated_at` | Sort field |
| `parentId` | `?parentId=uuid` | Filter by parent |
| `ownerId` | `?ownerId=uuid` | Filter by owner |
| `filter` | `?filter={"status":"done"}` | JSON field filter (supports nested: `{"user.name":"John"}`) |
| `cascade` | `?cascade=true` | Delete item and all descendants |
| `expand` | `?expand=parent,owner` | Include related items |

## Expand Relationships

```javascript
// Expand parent and owner
const res = await fetch(
  `http://localhost:5001/tasks/${id}?expand=parent,owner`,
  { headers: { "Authorization": `Bearer ${TOKEN}` } }
);
const { data: task } = await res.json();
// task._expanded.parent, task._expanded.owner

// Nested expand: board -> columns -> cards -> owner
const boardRes = await fetch(
  `http://localhost:5001/boards/${boardId}?expand=children:columns.children:cards.owner`,
  { headers: { "Authorization": `Bearer ${TOKEN}` } }
);
```

## Backup/Restore

Export all tenant data (items and users) as JSON:

```javascript
const res = await fetch("http://localhost:5001/_backup", {
  headers: { "Authorization": `Bearer ${WRITE_TOKEN}` }
});
const backup = await res.json();
// backup.version = "1.0"
// backup.exported_at = ISO timestamp
// backup.tenant = { id, name, created_at }
// backup.collections = { tasks: [...], projects: [...] }
// backup._users = [...]
```

## User Management

```javascript
// Create user
const userRes = await fetch("http://localhost:5001/_users", {
  method: "POST",
  headers: { "Authorization": `Bearer ${WRITE_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "user@example.com", password: "secret" })
});

// Sign in
const signinRes = await fetch("http://localhost:5001/_signin", {
  method: "POST",
  headers: { "Authorization": `Bearer ${READ_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "user@example.com", password: "secret" })
});

// Change password
await fetch(`http://localhost:5001/_users/${userId}`, {
  method: "PATCH",
  headers: { "Authorization": `Bearer ${WRITE_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ password: "newpassword" })
});

// Delete user
await fetch(`http://localhost:5001/_users/${userId}`, {
  method: "DELETE",
  headers: { "Authorization": `Bearer ${WRITE_TOKEN}` }
});
```

## JavaScript Client

A minimal client is served at `/assets/js/client.js`:

```javascript
import { bunpaasDb } from "http://localhost:5001/assets/js/client.js";

// Create tenant
const { tokens } = await bunpaasDb("http://localhost:5001").createTenant("My App");

// Use the API
const db = bunpaasDb("http://localhost:5001", tokens.readWrite);

// CRUD
const { data: task } = await db.collection("tasks").create({ data: { title: "Test" } });
const { data: tasks } = await db.collection("tasks").list({ filter: { status: "done" } });
await db.collection("tasks").update(task.id, { data: { status: "done" } });
await db.collection("tasks").delete(task.id);

// Nested expand
const { data: board } = await db.collection("boards").get(boardId, {
  expand: "children:columns.children:cards"
});
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://postgres:@localhost:5432/bunpaas` | PostgreSQL connection |
