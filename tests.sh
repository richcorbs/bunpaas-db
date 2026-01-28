#!/bin/bash

# API Test Suite for ProtoDB
# Uses curl to exercise all endpoints

BASE_URL="${BASE_URL:-http://localhost:5001}"
API_URL="$BASE_URL"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
print_header() {
  echo -e "\n${BLUE}========================================${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}========================================${NC}"
}

print_test() {
  echo -e "\n${YELLOW}TEST: $1${NC}"
}

assert_status() {
  local expected=$1
  local actual=$2
  local test_name=$3

  if [ "$expected" -eq "$actual" ]; then
    echo -e "${GREEN}PASS${NC}: $test_name (status $actual)"
    ((TESTS_PASSED++)) || true
  else
    echo -e "${RED}FAIL${NC}: $test_name (expected $expected, got $actual)"
    ((TESTS_FAILED++)) || true
  fi
}

assert_json_field() {
  local json=$1
  local field=$2
  local expected=$3
  local test_name=$4

  local actual=$(echo "$json" | jq -r "$field")
  if [ "$actual" == "$expected" ]; then
    echo -e "${GREEN}PASS${NC}: $test_name"
    ((TESTS_PASSED++)) || true
  else
    echo -e "${RED}FAIL${NC}: $test_name (expected '$expected', got '$actual')"
    ((TESTS_FAILED++)) || true
  fi
}

assert_json_exists() {
  local json=$1
  local field=$2
  local test_name=$3

  local exists=$(echo "$json" | jq -e "$field" > /dev/null 2>&1 && echo "yes" || echo "no")
  if [ "$exists" == "yes" ]; then
    echo -e "${GREEN}PASS${NC}: $test_name"
    ((TESTS_PASSED++)) || true
  else
    echo -e "${RED}FAIL${NC}: $test_name (field $field not found)"
    ((TESTS_FAILED++)) || true
  fi
}

# Check if server is running
check_server() {
  print_header "Checking Server Availability"
  if curl -s -o /dev/null -w "%{http_code}" "$BASE_URL" > /dev/null 2>&1; then
    echo -e "${GREEN}Server is running at $BASE_URL${NC}"
  else
    echo -e "${RED}Server is not running at $BASE_URL${NC}"
    echo "Please start the server with: npm start"
    exit 1
  fi
}

# ==========================================
# TENANT & TOKEN TESTS
# ==========================================

test_create_tenant() {
  print_header "Tenant & Token Tests"

  print_test "Create a new tenant"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/_tokens" \
    -H "Content-Type: application/json" \
    -d '{"name": "Test Tenant"}')

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 201 "$HTTP_CODE" "Create tenant returns 201"
  assert_json_exists "$BODY" ".tenant.id" "Response contains tenant.id"
  assert_json_exists "$BODY" ".tokens.readOnly" "Response contains readOnly token"
  assert_json_exists "$BODY" ".tokens.readWrite" "Response contains readWrite token"

  # Store tokens for later tests
  READ_TOKEN=$(echo "$BODY" | jq -r '.tokens.readOnly')
  WRITE_TOKEN=$(echo "$BODY" | jq -r '.tokens.readWrite')
  TENANT_ID=$(echo "$BODY" | jq -r '.tenant.id')

  echo "Tenant ID: $TENANT_ID"
  echo "Read Token: ${READ_TOKEN:0:16}..."
  echo "Write Token: ${WRITE_TOKEN:0:16}..."

  print_test "Create tenant without name (should fail)"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/_tokens" \
    -H "Content-Type: application/json" \
    -d '{}')

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 400 "$HTTP_CODE" "Create tenant without name returns 400"

  print_test "Get tokens with write token"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/_tokens" \
    -H "Authorization: Bearer $WRITE_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 200 "$HTTP_CODE" "Get tokens returns 200"
  assert_json_exists "$BODY" ".tokens.readOnly" "Response contains readOnly token"
  assert_json_exists "$BODY" ".tokens.readWrite" "Response contains readWrite token"

  print_test "Get tokens with read-only token (should fail)"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/_tokens" \
    -H "Authorization: Bearer $READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 403 "$HTTP_CODE" "Get tokens with read token returns 403"
}

# ==========================================
# CRUD TESTS
# ==========================================

test_crud_operations() {
  print_header "CRUD Operations Tests"

  # CREATE
  print_test "Create an item"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/tasks" \
    -H "Authorization: Bearer $WRITE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"data": {"title": "Test Task", "status": "pending", "priority": 1}}')

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 201 "$HTTP_CODE" "Create item returns 201"
  assert_json_exists "$BODY" ".data.id" "Response contains item id"
  assert_json_field "$BODY" ".data.collection" "tasks" "Item has correct collection"
  assert_json_field "$BODY" ".data.data.title" "Test Task" "Item has correct title"

  ITEM_ID=$(echo "$BODY" | jq -r '.data.id')
  echo "Created item ID: $ITEM_ID"

  print_test "Create item with parentId and ownerId"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/subtasks" \
    -H "Authorization: Bearer $WRITE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"parentId\": \"$ITEM_ID\", \"ownerId\": \"$ITEM_ID\", \"data\": {\"title\": \"Subtask\"}}")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 201 "$HTTP_CODE" "Create item with relations returns 201"
  assert_json_field "$BODY" ".data.parent_id" "$ITEM_ID" "Item has correct parent_id"
  assert_json_field "$BODY" ".data.owner_id" "$ITEM_ID" "Item has correct owner_id"

  SUBTASK_ID=$(echo "$BODY" | jq -r '.data.id')

  # READ
  print_test "Get single item"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/tasks/$ITEM_ID" \
    -H "Authorization: Bearer $READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 200 "$HTTP_CODE" "Get item returns 200"
  assert_json_field "$BODY" ".data.id" "$ITEM_ID" "Returned correct item"

  print_test "Get non-existent item"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/tasks/00000000-0000-0000-0000-000000000000" \
    -H "Authorization: Bearer $READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 404 "$HTTP_CODE" "Get non-existent item returns 404"

  print_test "List items in collection"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/tasks" \
    -H "Authorization: Bearer $READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 200 "$HTTP_CODE" "List items returns 200"
  assert_json_exists "$BODY" ".data" "Response contains data array"
  assert_json_exists "$BODY" ".pagination" "Response contains pagination"

  # UPDATE - PATCH (merge)
  print_test "PATCH merges data"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$API_URL/tasks/$ITEM_ID" \
    -H "Authorization: Bearer $WRITE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"data": {"status": "in_progress"}}')

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 200 "$HTTP_CODE" "PATCH returns 200"
  assert_json_field "$BODY" ".data.data.title" "Test Task" "PATCH preserved existing title"
  assert_json_field "$BODY" ".data.data.status" "in_progress" "PATCH updated status"

  # UPDATE - PUT (replace)
  print_test "PUT replaces data"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "$API_URL/tasks/$ITEM_ID" \
    -H "Authorization: Bearer $WRITE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"data": {"title": "Replaced Task"}}')

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 200 "$HTTP_CODE" "PUT returns 200"
  assert_json_field "$BODY" ".data.data.title" "Replaced Task" "PUT set new title"
  # status should be gone since PUT replaces entirely
  STATUS=$(echo "$BODY" | jq -r '.data.data.status')
  if [ "$STATUS" == "null" ]; then
    echo -e "${GREEN}PASS${NC}: PUT removed old status field"
    ((TESTS_PASSED++)) || true
  else
    echo -e "${RED}FAIL${NC}: PUT should have removed status, got '$STATUS'"
    ((TESTS_FAILED++)) || true
  fi

  print_test "PATCH with no fields (should fail)"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$API_URL/tasks/$ITEM_ID" \
    -H "Authorization: Bearer $WRITE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}')

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 400 "$HTTP_CODE" "PATCH with no fields returns 400"

  print_test "PUT/PATCH with read-only token (should fail)"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$API_URL/tasks/$ITEM_ID" \
    -H "Authorization: Bearer $READ_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"data": {"title": "Hacked"}}')

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 403 "$HTTP_CODE" "PATCH with read token returns 403"

  # DELETE
  print_test "Delete subtask"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$API_URL/subtasks/$SUBTASK_ID" \
    -H "Authorization: Bearer $WRITE_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 204 "$HTTP_CODE" "Delete item returns 204"

  print_test "Delete non-existent item"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$API_URL/tasks/00000000-0000-0000-0000-000000000000" \
    -H "Authorization: Bearer $WRITE_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 404 "$HTTP_CODE" "Delete non-existent returns 404"

  print_test "Delete with read-only token (should fail)"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$API_URL/tasks/$ITEM_ID" \
    -H "Authorization: Bearer $READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 403 "$HTTP_CODE" "Delete with read token returns 403"
}

# ==========================================
# QUERY PARAMETER TESTS
# ==========================================

test_query_parameters() {
  print_header "Query Parameter Tests"

  # Use unique collection name to avoid data accumulation
  QUERY_COLLECTION="query-test-$$"

  # Create test data
  echo "Creating test data..."
  for i in {1..5}; do
    curl -s -X POST "$API_URL/$QUERY_COLLECTION" \
      -H "Authorization: Bearer $WRITE_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"data\": {\"index\": $i, \"category\": \"A\"}}" > /dev/null
  done

  for i in {6..10}; do
    curl -s -X POST "$API_URL/$QUERY_COLLECTION" \
      -H "Authorization: Bearer $WRITE_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"data\": {\"index\": $i, \"category\": \"B\"}}" > /dev/null
  done

  print_test "Pagination - limit"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/$QUERY_COLLECTION?limit=3" \
    -H "Authorization: Bearer $READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 200 "$HTTP_CODE" "Pagination limit returns 200"
  COUNT=$(echo "$BODY" | jq '.data | length')
  if [ "$COUNT" -eq 3 ]; then
    echo -e "${GREEN}PASS${NC}: Limit returned 3 items"
    ((TESTS_PASSED++)) || true
  else
    echo -e "${RED}FAIL${NC}: Limit should return 3 items, got $COUNT"
    ((TESTS_FAILED++)) || true
  fi

  print_test "Pagination - offset"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/$QUERY_COLLECTION?limit=3&offset=3" \
    -H "Authorization: Bearer $READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 200 "$HTTP_CODE" "Pagination offset returns 200"
  assert_json_field "$BODY" ".pagination.offset" "3" "Offset is correct in response"

  print_test "JSON filter"
  RESPONSE=$(curl -s -w "\n%{http_code}" -G "$API_URL/$QUERY_COLLECTION" \
    -H "Authorization: Bearer $READ_TOKEN" \
    --data-urlencode 'filter={"category":"B"}')

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 200 "$HTTP_CODE" "JSON filter returns 200"
  COUNT=$(echo "$BODY" | jq '.data | length')
  if [ "$COUNT" -eq 5 ]; then
    echo -e "${GREEN}PASS${NC}: Filter returned correct items"
    ((TESTS_PASSED++)) || true
  else
    echo -e "${RED}FAIL${NC}: Filter should return 5 items with category B, got $COUNT"
    ((TESTS_FAILED++)) || true
  fi

  print_test "Invalid JSON filter"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/$QUERY_COLLECTION?filter=not-json" \
    -H "Authorization: Bearer $READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 400 "$HTTP_CODE" "Invalid JSON filter returns 400"
}

# ==========================================
# EXPAND RELATIONSHIPS TESTS
# ==========================================

test_expand_relationships() {
  print_header "Expand Relationships Tests"

  # Create parent item
  RESPONSE=$(curl -s -X POST "$API_URL/projects" \
    -H "Authorization: Bearer $WRITE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"data": {"name": "Project Alpha"}}')

  PROJECT_ID=$(echo "$RESPONSE" | jq -r '.data.id')

  # Create owner item
  RESPONSE=$(curl -s -X POST "$API_URL/users" \
    -H "Authorization: Bearer $WRITE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"data": {"name": "John Doe"}}')

  USER_ID=$(echo "$RESPONSE" | jq -r '.data.id')

  # Create item with relationships
  RESPONSE=$(curl -s -X POST "$API_URL/tasks" \
    -H "Authorization: Bearer $WRITE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"parentId\": \"$PROJECT_ID\", \"ownerId\": \"$USER_ID\", \"data\": {\"title\": \"Task with relations\"}}")

  TASK_ID=$(echo "$RESPONSE" | jq -r '.data.id')

  print_test "Expand parent relationship"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/tasks/$TASK_ID?expand=parent" \
    -H "Authorization: Bearer $READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 200 "$HTTP_CODE" "Expand parent returns 200"
  assert_json_exists "$BODY" ".data._expanded.parent" "Response contains expanded parent"
  assert_json_field "$BODY" ".data._expanded.parent.data.name" "Project Alpha" "Parent data is correct"

  print_test "Expand owner relationship"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/tasks/$TASK_ID?expand=owner" \
    -H "Authorization: Bearer $READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 200 "$HTTP_CODE" "Expand owner returns 200"
  assert_json_exists "$BODY" ".data._expanded.owner" "Response contains expanded owner"
  assert_json_field "$BODY" ".data._expanded.owner.data.name" "John Doe" "Owner data is correct"

  print_test "Expand multiple relationships"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/tasks/$TASK_ID?expand=parent,owner" \
    -H "Authorization: Bearer $READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 200 "$HTTP_CODE" "Expand multiple returns 200"
  assert_json_exists "$BODY" ".data._expanded.parent" "Response contains expanded parent"
  assert_json_exists "$BODY" ".data._expanded.owner" "Response contains expanded owner"

  # Test nested expand (board -> columns -> cards)
  print_test "Nested expand: board -> columns -> cards"

  # Create a board
  RESPONSE=$(curl -s -X POST "$API_URL/boards" \
    -H "Authorization: Bearer $WRITE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"data": {"name": "Test Board"}}')
  BOARD_ID=$(echo "$RESPONSE" | jq -r '.data.id')

  # Create column under board
  RESPONSE=$(curl -s -X POST "$API_URL/columns" \
    -H "Authorization: Bearer $WRITE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"parentId\": \"$BOARD_ID\", \"data\": {\"name\": \"To Do\"}, \"orderKey\": \"a\"}")
  COLUMN_ID=$(echo "$RESPONSE" | jq -r '.data.id')

  # Create card under column
  RESPONSE=$(curl -s -X POST "$API_URL/cards" \
    -H "Authorization: Bearer $WRITE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"parentId\": \"$COLUMN_ID\", \"data\": {\"title\": \"Test Card\"}}")
  CARD_ID=$(echo "$RESPONSE" | jq -r '.data.id')

  # Test nested expand
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/boards/$BOARD_ID?expand=children:columns.children:cards" \
    -H "Authorization: Bearer $READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 200 "$HTTP_CODE" "Nested expand returns 200"
  assert_json_exists "$BODY" ".data._expanded.columns" "Board has expanded columns"
  assert_json_exists "$BODY" ".data._expanded.columns[0]._expanded.cards" "Columns have expanded cards"
  assert_json_field "$BODY" ".data._expanded.columns[0]._expanded.cards[0].data.title" "Test Card" "Card data is correct"

  # Cleanup nested expand test data
  curl -s -X DELETE "$API_URL/cards/$CARD_ID" -H "Authorization: Bearer $WRITE_TOKEN" > /dev/null
  curl -s -X DELETE "$API_URL/columns/$COLUMN_ID" -H "Authorization: Bearer $WRITE_TOKEN" > /dev/null
  curl -s -X DELETE "$API_URL/boards/$BOARD_ID" -H "Authorization: Bearer $WRITE_TOKEN" > /dev/null

  # Cleanup
  curl -s -X DELETE "$API_URL/tasks/$TASK_ID" -H "Authorization: Bearer $WRITE_TOKEN" > /dev/null
  curl -s -X DELETE "$API_URL/projects/$PROJECT_ID" -H "Authorization: Bearer $WRITE_TOKEN" > /dev/null
  curl -s -X DELETE "$API_URL/users/$USER_ID" -H "Authorization: Bearer $WRITE_TOKEN" > /dev/null
}

# ==========================================
# AUTHENTICATION TESTS
# ==========================================

test_authentication() {
  print_header "Authentication Tests"

  print_test "Request without token"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/tasks")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 401 "$HTTP_CODE" "No token returns 401"

  print_test "Request with invalid token"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/tasks" \
    -H "Authorization: Bearer invalid-token-12345")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 401 "$HTTP_CODE" "Invalid token returns 401"

  print_test "Request with malformed Authorization header"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/tasks" \
    -H "Authorization: NotBearer $READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 401 "$HTTP_CODE" "Malformed auth header returns 401"
}

# ==========================================
# MULTI-TENANT ISOLATION TESTS
# ==========================================

test_tenant_isolation() {
  print_header "Multi-Tenant Isolation Tests"

  # Create a second tenant
  RESPONSE=$(curl -s -X POST "$API_URL/_tokens" \
    -H "Content-Type: application/json" \
    -d '{"name": "Second Tenant"}')

  TENANT2_READ_TOKEN=$(echo "$RESPONSE" | jq -r '.tokens.readOnly')
  TENANT2_WRITE_TOKEN=$(echo "$RESPONSE" | jq -r '.tokens.readWrite')

  # Create item in first tenant
  RESPONSE=$(curl -s -X POST "$API_URL/isolation-test" \
    -H "Authorization: Bearer $WRITE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"data": {"secret": "tenant1-data"}}')

  TENANT1_ITEM_ID=$(echo "$RESPONSE" | jq -r '.data.id')

  print_test "Second tenant cannot see first tenant's items"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/isolation-test" \
    -H "Authorization: Bearer $TENANT2_READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  assert_status 200 "$HTTP_CODE" "List returns 200"
  COUNT=$(echo "$BODY" | jq '.data | length')
  if [ "$COUNT" -eq 0 ]; then
    echo -e "${GREEN}PASS${NC}: Second tenant sees 0 items from first tenant"
    ((TESTS_PASSED++)) || true
  else
    echo -e "${RED}FAIL${NC}: Tenant isolation breach - second tenant sees $COUNT items"
    ((TESTS_FAILED++)) || true
  fi

  print_test "Second tenant cannot access first tenant's item by ID"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/isolation-test/$TENANT1_ITEM_ID" \
    -H "Authorization: Bearer $TENANT2_READ_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 404 "$HTTP_CODE" "Cross-tenant access returns 404"

  print_test "Second tenant cannot update first tenant's item"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$API_URL/isolation-test/$TENANT1_ITEM_ID" \
    -H "Authorization: Bearer $TENANT2_WRITE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"data": {"hacked": true}}')

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 404 "$HTTP_CODE" "Cross-tenant update returns 404"

  print_test "Second tenant cannot delete first tenant's item"
  RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$API_URL/isolation-test/$TENANT1_ITEM_ID" \
    -H "Authorization: Bearer $TENANT2_WRITE_TOKEN")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  assert_status 404 "$HTTP_CODE" "Cross-tenant delete returns 404"

  # Cleanup
  curl -s -X DELETE "$API_URL/isolation-test/$TENANT1_ITEM_ID" \
    -H "Authorization: Bearer $WRITE_TOKEN" > /dev/null
}

# ==========================================
# CLEANUP
# ==========================================

cleanup() {
  print_header "Cleanup"
  echo "Cleaning up test data..."

  COLLECTIONS="tasks subtasks $QUERY_COLLECTION projects users isolation-test"

  for collection in $COLLECTIONS; do
    ITEMS=$(curl -s "$API_URL/$collection?limit=1000" \
      -H "Authorization: Bearer $READ_TOKEN" 2>/dev/null | jq -r '.data[].id' 2>/dev/null)

    for id in $ITEMS; do
      curl -s -X DELETE "$API_URL/$collection/$id" \
        -H "Authorization: Bearer $WRITE_TOKEN" > /dev/null 2>&1
    done
  done

  echo "Cleanup complete"
}

# ==========================================
# MAIN
# ==========================================

main() {
  echo -e "${BLUE}"
  echo "================================================"
  echo "   ProtoDB API Test Suite"
  echo "================================================"
  echo -e "${NC}"

  check_server
  test_create_tenant
  test_crud_operations
  test_query_parameters
  test_expand_relationships
  test_authentication
  test_tenant_isolation
  cleanup

  print_header "Test Results"
  echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
  echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
  echo ""

  if [ "$TESTS_FAILED" -gt 0 ]; then
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
  else
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
  fi
}

# Run tests
main "$@"
