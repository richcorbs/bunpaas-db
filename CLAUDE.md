# CLAUDE.md

Project context for Claude Code.

## What is ProtoDB?

A schema-agnostic, multi-tenant backend for prototyping apps (Kanban, CMS, CRM, etc.). Built with Node.js, Express, and PostgreSQL with JSONB storage.

## Commands

```bash
npm install          # Install dependencies
npm start            # Start server on http://localhost:5001
./tests.sh           # Run 61 bash/curl tests
```

## Project Structure

```
src/
  server.js        # Express routes (~220 lines) - main API
  db.js            # PostgreSQL connection, schema init (87 lines)
  auth.js          # Token authentication middleware (31 lines)
  expandPlanner.js # Parse ?expand query param with nested support (24 lines)
  expandBatch.js   # Batch fetch parent/owner/children recursively (77 lines)
client.js          # Optional JS client wrapper (~80 lines)
tests.sh           # Comprehensive curl test suite (61 tests)
```

## Database Schema

Three tables, auto-created on startup:

- **tenants** - `id`, `name`, `created_at`
- **api_tokens** - `token`, `tenant_id`, `can_read`, `can_write`, `created_at`
- **items** - `id`, `tenant_id`, `collection`, `parent_id`, `owner_id`, `order_key`, `data` (JSONB), `created_at`, `updated_at`

## API Endpoints

| Method | Endpoint | Auth | Notes |
|--------|----------|------|-------|
| POST | `/_tokens` | None | Creates tenant + tokens |
| GET | `/_tokens` | Write | Returns tenant's tokens |
| GET | `/:collection` | Read | List with pagination, filter, expand |
| GET | `/:collection/:id` | Read | Get single item |
| POST | `/:collection` | Write | Create item |
| PUT | `/:collection/:id` | Write | Full replace |
| PATCH | `/:collection/:id` | Write | Merge data (PostgreSQL `||` operator) |
| DELETE | `/:collection/:id` | Write | Delete item |

## Key Implementation Details

### Authentication (src/auth.js)
- Bearer token from `Authorization` header
- Lookup in `api_tokens` table
- Sets `req.auth = { tenant_id, can_read, can_write }`

### PUT vs PATCH (src/server.js)
- **PUT** (lines 167-183): Replaces entire item including `data`
- **PATCH** (lines 186-230): Merges `data` using `data || $N::jsonb`

### Expand Feature
- `?expand=parent` - fetch item's parent
- `?expand=owner` - fetch item's owner
- `?expand=children:cards` - fetch children from 'cards' collection
- **Nested expand** with dot notation: `?expand=children:columns.children:cards.owner`
  - Gets board → columns → cards → card owners in one query
- Results in `_expanded` object on each item

### JSON Filtering
- `?filter={"status":"done"}` - filters by JSONB fields
- Uses `data ->> $key = $value` SQL pattern

### Query Params
- `limit` (default: 25), `offset`, `orderBy` (default: created_at)
- `parentId`, `ownerId` for relationship filtering

## Test Suite

`tests.sh` runs 61 tests covering:
- Tenant/token creation
- CRUD operations (PUT replaces, PATCH merges)
- Query params (pagination, filter, expand, nested expand)
- Multi-tenant isolation
- Auth enforcement

Tests clean up after themselves by deleting created tenants.

## Environment

- `DATABASE_URL` - PostgreSQL connection (default: `postgres://postgres:@localhost:5432/prototype`)
- Database auto-creates if missing
- Schema auto-migrates on startup

## Gotchas

### order_key is TEXT (lexicographic sorting)
Numbers sort as strings: "10" < "2". Solutions:
- Zero-pad: "001", "002", "010"
- Use letters: "a", "b", "c" or fractional "a", "am", "b"

### PATCH does shallow merge
PostgreSQL `||` merges top-level keys only. Nested objects are replaced entirely:
```javascript
// Before: { "user": { "name": "John", "age": 30 } }
// PATCH:  { "user": { "email": "j@x.com" } }
// After:  { "user": { "email": "j@x.com" } }  // name and age gone!
```

### orderBy allows any column name
The `orderBy` param is interpolated directly into SQL (line 117). Not a security risk for tenant-isolated data, but invalid columns will throw errors. Valid values: `created_at`, `updated_at`, `order_key`, `collection`.

### No cascading deletes
Deleting a parent item does NOT delete its children. Children become orphaned (parent_id points to nothing).

### filter requires valid JSON
`?filter={status:done}` fails - must be `?filter={"status":"done"}` with proper JSON syntax.

### UUIDs required for relationships
`parentId` and `ownerId` must be valid UUIDs. Invalid UUIDs cause PostgreSQL errors.

### expand children requires collection name
`?expand=children` won't work - must specify collection: `?expand=children:cards`

## Design Philosophy

Simplicity over features. Intentionally removed:
- Real-time SSE subscriptions
- Activity logging
- Optimistic locking

Focus: Generic CRUD with tenant isolation, JSONB flexibility, relationship expansion.
