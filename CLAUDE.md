# CLAUDE.md

Project context for Claude Code.

## What is bunpaas-db?

A schema-agnostic, multi-tenant backend for prototyping apps (Kanban, CMS, CRM, etc.). Built as a bunpaas-cli site with `_functions` on Bun and PostgreSQL with JSONB storage. Zero npm dependencies.

## Commands

```bash
bunpaas-cli build   # Build site to dist/
bunpaas-cli dev     # Dev server with hot reload
bun test            # Run ~60 tests
```

## Project Structure

```
src/
  pages/
    index.html           # Landing page + API docs
  layouts/
    default.html         # HTML layout (rico.css)
  assets/
    css/rico.css         # CSS framework
    js/client.js         # JS client wrapper
  _functions/
    _tokens.js           # POST (create tenant), GET (list tokens)
    _users.js            # POST (create user)
    _users/[id].js       # PATCH (change pw), DELETE (delete user)
    _signin.js           # POST (authenticate)
    [collection].js      # GET (list), POST (create)
    [collection]/[id].js # GET, PUT, PATCH, DELETE
    lib/
      db.js              # Bun SQL connection, schema init
      auth.js            # Token auth helper
      expand.js          # Parse & batch-expand relationships
      flatten.js         # Flatten item (merge data to top level)
tests/
  server.js              # Test server helper
  api.test.js            # Bun test suite (~60 tests)
site.json                # bunpaas-cli site config
```

## Architecture

This is a **bunpaas-cli site**. The API lives in `src/_functions/` using file-based routing:

- `_functions/_tokens.js` → `/_tokens`
- `_functions/_users/[id].js` → `/_users/:id`
- `_functions/[collection].js` → `/:collection`
- `_functions/[collection]/[id].js` → `/:collection/:id`

Handlers export named functions per HTTP method (`get`, `post`, `put`, `patch`, `del`):

```js
export async function get(req) {
  return { status: 200, body: { data: [...] } };
}
```

Request object: `{ method, path, query, headers, body, params, env }`
Response object: `{ status, headers, body }`

## Database

Uses **Bun.sql** (native PostgreSQL client, zero dependencies).

Four tables, auto-created via `initSchema()`:

- **tenants** - `id`, `name`, `created_at`
- **api_tokens** - `token`, `tenant_id`, `can_read`, `can_write`, `created_at`
- **items** - `id`, `tenant_id`, `collection`, `parent_id`, `owner_id`, `order_key`, `data` (JSONB), `created_at`, `updated_at`
- **_users** - `id`, `tenant_id`, `email`, `password_hash`, `active`, `created_at`

Connection: `req.env.DATABASE_URL` → `process.env.DATABASE_URL` → `postgres://postgres:@localhost:5432/bunpaas`

## API Endpoints

| Method | Endpoint | Auth | Notes |
|--------|----------|------|-------|
| POST | `/_tokens` | None | Creates tenant + tokens |
| GET | `/_tokens` | Write | Returns tenant's tokens |
| POST | `/_users` | Write | Create user |
| PATCH | `/_users/:id` | Write | Change password |
| DELETE | `/_users/:id` | Write | Delete user |
| POST | `/_signin` | Read | Authenticate user |
| GET | `/:collection` | Read | List with pagination, filter, expand |
| GET | `/:collection/:id` | Read | Get single item |
| POST | `/:collection` | Write | Create item |
| PUT | `/:collection/:id` | Write | Full replace |
| PATCH | `/:collection/:id` | Write | Merge data (PostgreSQL `||` operator) |
| DELETE | `/:collection/:id` | Write | Delete item |

## Key Implementation Details

### Authentication (src/_functions/lib/auth.js)
- Bearer token from `Authorization` header
- Lookup in `api_tokens` table
- Returns `{ tenant_id, can_read, can_write }` or `{ error: { status, body } }`
- Each handler calls `authenticate(req)` directly (no middleware)

### PUT vs PATCH
- **PUT**: Replaces entire item including `data`
- **PATCH**: Merges `data` using `data || $N::jsonb`

### Expand Feature
- `?expand=parent` - fetch item's parent
- `?expand=owner` - fetch item's owner
- `?expand=children:cards` - fetch children from 'cards' collection
- **Nested expand** with dot notation: `?expand=children:columns.children:cards.owner`
- Results in `_expanded` object on each item

### JSON Filtering
- `?filter={"status":"done"}` - filters by JSONB fields

### Query Params
- `limit` (default: 25), `offset`, `orderBy` (default: created_at)
- `parentId`, `ownerId` for relationship filtering

## Test Suite

`bun test` runs ~60 tests covering:
- Tenant/token creation
- CRUD operations (PUT replaces, PATCH merges)
- Query params (pagination, filter, expand, nested expand)
- User management (create, delete, signin)
- Multi-tenant isolation
- Auth enforcement

Tests use a lightweight test server (tests/server.js) that routes to the _functions handlers.

## Environment

- `DATABASE_URL` - PostgreSQL connection (default: `postgres://postgres:@localhost:5432/bunpaas`)
- Database auto-creates if missing (via `ensureDatabase()`)
- Schema auto-creates via `initSchema()`

## Gotchas

### order_key is TEXT (lexicographic sorting)
Numbers sort as strings: "10" < "2". Use zero-padding or letters.

### PATCH does shallow merge
PostgreSQL `||` merges top-level keys only. Nested objects are replaced entirely.

### No cascading deletes
Deleting a parent item does NOT delete its children.

### filter requires valid JSON
`?filter={status:done}` fails - must be `?filter={"status":"done"}`.

### expand children requires collection name
`?expand=children` won't work - must specify: `?expand=children:cards`

## Design Philosophy

Simplicity over features. Zero npm dependencies. Native Bun APIs only.
