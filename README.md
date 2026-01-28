# ProtoDB

A schema-agnostic, multi-tenant backend for prototyping apps like Kanban, CMS, or CRM.
Built on Node.js, Express, and PostgreSQL with JSONB storage.

## Quick Start

```bash
npm install
npm start        # Server runs on http://localhost:5001
./tests.sh       # Run test suite
```

## API Overview

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/_tokens` | None | Create tenant |
| GET | `/_tokens` | Write | Get tokens |
| GET | `/:collection` | Read | List items |
| GET | `/:collection/:id` | Read | Get item |
| POST | `/:collection` | Write | Create item |
| PUT | `/:collection/:id` | Write | Replace item |
| PATCH | `/:collection/:id` | Write | Merge update |
| DELETE | `/:collection/:id` | Write | Delete item |

## Authentication

All requests (except tenant creation) require a Bearer token:

```
Authorization: Bearer <token>
```

### Create a Tenant

**curl:**
```bash
curl -X POST http://localhost:5001/_tokens \
  -H "Content-Type: application/json" \
  -d '{"name": "My App"}'
```

**JavaScript:**
```javascript
const response = await fetch("http://localhost:5001/_tokens", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "My App" })
});
const { tenant, tokens } = await response.json();
// tokens.readOnly - can only read
// tokens.readWrite - can read and write
```

Returns `readOnly` and `readWrite` tokens. Read tokens can only GET, write tokens can do everything.

## Data Model

Items are stored with this structure:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Auto-generated |
| `tenant_id` | UUID | Automatic tenant isolation |
| `collection` | TEXT | e.g., "tasks", "users" |
| `parent_id` | UUID | Optional parent reference |
| `owner_id` | UUID | Optional owner reference |
| `order_key` | TEXT | Optional sort key |
| `data` | JSONB | Your custom data |
| `created_at` | TIMESTAMPTZ | Auto-set |
| `updated_at` | TIMESTAMPTZ | Auto-updated |

## CRUD Operations

### Create

**curl:**
```bash
curl -X POST http://localhost:5001/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {"title": "My Task", "status": "pending"},
    "parentId": "optional-uuid",
    "ownerId": "optional-uuid",
    "orderKey": "a"
  }'
```

**JavaScript:**
```javascript
const response = await fetch("http://localhost:5001/tasks", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    data: { title: "My Task", status: "pending" },
    parentId: "optional-uuid",
    ownerId: "optional-uuid",
    orderKey: "a"
  })
});
const { data: item } = await response.json();
```

### Read

**curl:**
```bash
# List items
curl http://localhost:5001/tasks \
  -H "Authorization: Bearer $TOKEN"

# Get single item
curl http://localhost:5001/tasks/$ID \
  -H "Authorization: Bearer $TOKEN"
```

**JavaScript:**
```javascript
// List items
const listResponse = await fetch("http://localhost:5001/tasks", {
  headers: { "Authorization": `Bearer ${TOKEN}` }
});
const { data: items, pagination } = await listResponse.json();

// Get single item
const getResponse = await fetch(`http://localhost:5001/tasks/${ID}`, {
  headers: { "Authorization": `Bearer ${TOKEN}` }
});
const { data: item } = await getResponse.json();
```

### Update

**PUT** replaces the entire item:

**curl:**
```bash
curl -X PUT http://localhost:5001/tasks/$ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data": {"title": "New Title"}}'
# Result: data = {"title": "New Title"} (old fields removed)
```

**JavaScript:**
```javascript
const response = await fetch(`http://localhost:5001/tasks/${ID}`, {
  method: "PUT",
  headers: {
    "Authorization": `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ data: { title: "New Title" } })
});
// Result: data = {"title": "New Title"} (old fields removed)
```

**PATCH** merges with existing data:

**curl:**
```bash
curl -X PATCH http://localhost:5001/tasks/$ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data": {"status": "done"}}'
# Result: data = {"title": "Old Title", "status": "done"} (merged)
```

**JavaScript:**
```javascript
const response = await fetch(`http://localhost:5001/tasks/${ID}`, {
  method: "PATCH",
  headers: {
    "Authorization": `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ data: { status: "done" } })
});
// Result: data = {"title": "Old Title", "status": "done"} (merged)
```

### Delete

**curl:**
```bash
curl -X DELETE http://localhost:5001/tasks/$ID \
  -H "Authorization: Bearer $TOKEN"
```

**JavaScript:**
```javascript
await fetch(`http://localhost:5001/tasks/${ID}`, {
  method: "DELETE",
  headers: { "Authorization": `Bearer ${TOKEN}` }
});
```

## Query Parameters

| Parameter | Example | Description |
|-----------|---------|-------------|
| `limit` | `?limit=10` | Max items (default: 25) |
| `offset` | `?offset=20` | Skip items |
| `orderBy` | `?orderBy=updated_at` | Sort field |
| `parentId` | `?parentId=uuid` | Filter by parent |
| `ownerId` | `?ownerId=uuid` | Filter by owner |
| `filter` | `?filter={"status":"done"}` | JSON field filter |
| `expand` | `?expand=parent,owner` | Include related items |

## Expand Relationships

Inline parent, owner, or children:

**curl:**
```bash
# Expand parent and owner
curl "http://localhost:5001/tasks/$ID?expand=parent,owner" \
  -H "Authorization: Bearer $TOKEN"

# Expand children from a collection
curl "http://localhost:5001/boards/$ID?expand=children:cards" \
  -H "Authorization: Bearer $TOKEN"
```

**JavaScript:**
```javascript
// Expand parent and owner
const response = await fetch(
  `http://localhost:5001/tasks/${ID}?expand=parent,owner`,
  { headers: { "Authorization": `Bearer ${TOKEN}` } }
);
const { data: item } = await response.json();
// item._expanded.parent, item._expanded.owner

// Expand children from a collection
const boardResponse = await fetch(
  `http://localhost:5001/boards/${ID}?expand=children:cards`,
  { headers: { "Authorization": `Bearer ${TOKEN}` } }
);
```

Response includes `_expanded`:

```json
{
  "data": {
    "id": "task-id",
    "parent_id": "project-id",
    "_expanded": {
      "parent": { "id": "project-id", "data": {"name": "Project"} },
      "owner": { "id": "user-id", "data": {"name": "John"} },
      "tasks": [ ... ]
    }
  }
}
```

### Nested Expand

Use dot notation to expand multiple levels deep:

**curl:**
```bash
# Get board with columns, and each column with its cards
curl "http://localhost:5001/boards/$BOARD_ID?expand=children:columns.children:cards" \
  -H "Authorization: Bearer $TOKEN"

# Go deeper: board -> columns -> cards -> card owner
curl "http://localhost:5001/boards/$BOARD_ID?expand=children:columns.children:cards.owner" \
  -H "Authorization: Bearer $TOKEN"
```

**JavaScript:**
```javascript
const response = await fetch(
  `http://localhost:5001/boards/${boardId}?expand=children:columns.children:cards.owner`,
  { headers: { "Authorization": `Bearer ${TOKEN}` } }
);
const { data: board } = await response.json();
// board._expanded.columns[0]._expanded.cards[0]._expanded.owner
```

Response:

```json
{
  "data": {
    "id": "board-id",
    "_expanded": {
      "columns": [
        {
          "id": "column-id",
          "data": {"name": "To Do"},
          "_expanded": {
            "cards": [
              {"id": "card-id", "data": {"title": "Task 1"}}
            ]
          }
        }
      ]
    }
  }
}
```

## JSON Filtering

Filter by JSONB fields:

**curl:**
```bash
curl -G http://localhost:5001/tasks \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'filter={"status":"pending","priority":"high"}'
```

**JavaScript:**
```javascript
const filter = JSON.stringify({ status: "pending", priority: "high" });
const response = await fetch(
  `http://localhost:5001/tasks?filter=${encodeURIComponent(filter)}`,
  { headers: { "Authorization": `Bearer ${TOKEN}` } }
);
const { data: items } = await response.json();
```

## Example: Kanban Board

### Step 1: Create a Tenant

**curl:**
```bash
# Create tenant and get tokens
RESPONSE=$(curl -s -X POST http://localhost:5001/_tokens \
  -H "Content-Type: application/json" \
  -d '{"name": "My Kanban App"}')

# Extract the write token (you'll need jq or similar)
TOKEN=$(echo $RESPONSE | jq -r '.tokens.readWrite')
```

**JavaScript:**
```javascript
// Create tenant and get tokens
const tenantResponse = await fetch("http://localhost:5001/_tokens", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "My Kanban App" })
});
const { tokens } = await tenantResponse.json();
const TOKEN = tokens.readWrite;
```

### Step 2: Create a Board

**curl:**
```bash
# Create a board
RESPONSE=$(curl -s -X POST http://localhost:5001/boards \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data": {"name": "Sprint 1"}}')

BOARD_ID=$(echo $RESPONSE | jq -r '.data.id')
```

**JavaScript:**
```javascript
// Create a board
const boardResponse = await fetch("http://localhost:5001/boards", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ data: { name: "Sprint 1" } })
});
const { data: board } = await boardResponse.json();
const boardId = board.id;
```

### Step 3: Create Columns (as children of the board)

**curl:**
```bash
# Create "To Do" column
TODO_RESPONSE=$(curl -s -X POST http://localhost:5001/columns \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"parentId": "'$BOARD_ID'", "data": {"name": "To Do"}, "orderKey": "a"}')
TODO_COLUMN_ID=$(echo $TODO_RESPONSE | jq -r '.data.id')

# Create "In Progress" column
curl -X POST http://localhost:5001/columns \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"parentId": "'$BOARD_ID'", "data": {"name": "In Progress"}, "orderKey": "b"}'

# Create "Done" column
DONE_RESPONSE=$(curl -s -X POST http://localhost:5001/columns \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"parentId": "'$BOARD_ID'", "data": {"name": "Done"}, "orderKey": "c"}')
DONE_COLUMN_ID=$(echo $DONE_RESPONSE | jq -r '.data.id')
```

**JavaScript:**
```javascript
// Create columns as children of the board
const columnNames = ["To Do", "In Progress", "Done"];
const columnIds = [];

for (let i = 0; i < columnNames.length; i++) {
  const response = await fetch("http://localhost:5001/columns", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      parentId: boardId,
      data: { name: columnNames[i] },
      orderKey: String.fromCharCode(97 + i) // 'a', 'b', 'c'
    })
  });
  const { data: column } = await response.json();
  columnIds.push(column.id);
}
const [todoColumnId, inProgressColumnId, doneColumnId] = columnIds;
```

### Step 4: Create Cards in Columns

**curl:**
```bash
# Create a card in the "To Do" column
CARD_RESPONSE=$(curl -s -X POST http://localhost:5001/cards \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"parentId": "'$TODO_COLUMN_ID'", "data": {"title": "Build MVP"}, "orderKey": "a"}')
CARD_ID=$(echo $CARD_RESPONSE | jq -r '.data.id')
```

**JavaScript:**
```javascript
// Create a card in the "To Do" column
const cardResponse = await fetch("http://localhost:5001/cards", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    parentId: todoColumnId,
    data: { title: "Build MVP" },
    orderKey: "a"
  })
});
const { data: card } = await cardResponse.json();
const cardId = card.id;
```

### Step 5: List Cards in a Column

**curl:**
```bash
curl "http://localhost:5001/cards?parentId=$TODO_COLUMN_ID&orderBy=order_key" \
  -H "Authorization: Bearer $TOKEN"
```

**JavaScript:**
```javascript
const response = await fetch(
  `http://localhost:5001/cards?parentId=${todoColumnId}&orderBy=order_key`,
  { headers: { "Authorization": `Bearer ${TOKEN}` } }
);
const { data: cards } = await response.json();
```

### Step 6: Move a Card to Another Column

**curl:**
```bash
curl -X PATCH http://localhost:5001/cards/$CARD_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"parentId": "'$DONE_COLUMN_ID'"}'
```

**JavaScript:**
```javascript
await fetch(`http://localhost:5001/cards/${cardId}`, {
  method: "PATCH",
  headers: {
    "Authorization": `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ parentId: doneColumnId })
});
```

### Step 7: Get Full Board with Columns and Cards

**curl:**
```bash
# Get the board with its columns, and each column with its cards
curl "http://localhost:5001/boards/$BOARD_ID?expand=children:columns" \
  -H "Authorization: Bearer $TOKEN"

# Or get columns for a specific board with their cards
curl "http://localhost:5001/columns?parentId=$BOARD_ID&expand=children:cards&orderBy=order_key" \
  -H "Authorization: Bearer $TOKEN"
```

**JavaScript:**
```javascript
// Get columns for a specific board with their cards
const response = await fetch(
  `http://localhost:5001/columns?parentId=${boardId}&expand=children:cards&orderBy=order_key`,
  { headers: { "Authorization": `Bearer ${TOKEN}` } }
);
const { data: columns } = await response.json();
// Each column has _expanded.cards array
```

## JavaScript Client

A minimal client is included and served at `/client.js`:

```javascript
import { protodb } from "http://localhost:5001/client.js";

// Create tenant
const { tokens } = await protodb("http://localhost:5001").createTenant("My App");

// Use the API
const db = protodb("http://localhost:5001", tokens.readWrite);

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

### Alpine.js Example

```html
<!DOCTYPE html>
<html>
<head>
  <script defer src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script type="module">
    import { protodb } from "http://localhost:5001/client.js";
    window.db = protodb("http://localhost:5001", "YOUR_WRITE_TOKEN");
  </script>
</head>
<body>
  <div x-data="{
    tasks: [],
    newTitle: '',
    async init() {
      const { data } = await db.collection('tasks').list();
      this.tasks = data;
    },
    async addTask() {
      const { data } = await db.collection('tasks').create({
        data: { title: this.newTitle, done: false }
      });
      this.tasks.push(data);
      this.newTitle = '';
    },
    async toggle(task) {
      await db.collection('tasks').update(task.id, {
        data: { done: !task.data.done }
      });
      task.data.done = !task.data.done;
    },
    async remove(task) {
      await db.collection('tasks').delete(task.id);
      this.tasks = this.tasks.filter(t => t.id !== task.id);
    }
  }">
    <input x-model="newTitle" @keyup.enter="addTask" placeholder="New task...">
    <button @click="addTask">Add</button>

    <ul>
      <template x-for="task in tasks" :key="task.id">
        <li>
          <input type="checkbox" :checked="task.data.done" @click="toggle(task)">
          <span :class="task.data.done && 'line-through'" x-text="task.data.title"></span>
          <button @click="remove(task)">×</button>
        </li>
      </template>
    </ul>
  </div>
</body>
</html>
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://postgres:@localhost:5432/prototype` | PostgreSQL connection |
