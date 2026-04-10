#!/usr/bin/env bash
set -euo pipefail

# Configuration
MGMT="${RULES_ENGINE_MGMT_URL:-http://localhost:8080}"
ENGINE="${RULES_ENGINE_URL:-http://localhost:3002}"
RULES_PG_CONTAINER="${RULES_PG_CONTAINER:-rules_engine-postgres-1}"
ORG_ID="00000000-0000-0000-0000-000000000001"  # Acme Corp (pre-seeded)
ACTION_TYPE_ID="30000000-0000-0000-0000-000000000001"  # purchase.initiate (pre-seeded)

# Shared temp file for curl → jq handoff (avoids pipe-in-subshell issues)
TMPFILE=$(mktemp)
trap "rm -f $TMPFILE" EXIT

# Helper: curl response → temp file → jq parse
# Usage: api_get <url> && jq_tmp '<filter>'
api_get() { curl -sf "$1" 2>/dev/null > "$TMPFILE" || echo "[]" > "$TMPFILE"; }
api_post() {
  local url="$1"; shift
  curl -sf -X POST "$url" "$@" 2>/dev/null > "$TMPFILE" && return 0 || return 1
}
jq_tmp() { jq -r "$@" "$TMPFILE"; }

echo "=== Warranted Rules Engine Seeding ==="
echo "Management API: $MGMT"
echo "Cedar Engine:   $ENGINE"

# -----------------------------------------------------------------------
# 0. Health check
# -----------------------------------------------------------------------
echo ""
echo "--- Step 0: Health Check ---"

if ! curl -sf "$MGMT/health" > /dev/null 2>&1; then
  echo "ERROR: Management API unreachable at $MGMT"
  exit 1
fi
echo "Management API: OK"

if ! curl -sf "$ENGINE/health" > /dev/null 2>&1; then
  echo "ERROR: Cedar Engine unreachable at $ENGINE"
  exit 1
fi
echo "Cedar Engine: OK"

# -----------------------------------------------------------------------
# 1. Verify org exists (Acme Corp is pre-seeded via Flyway)
# -----------------------------------------------------------------------
echo ""
echo "--- Step 1: Verify Organization ---"

api_get "$MGMT/api/v1/groups"
ORG_GROUP=$(jq_tmp --arg oid "$ORG_ID" '[.[] | select(.nodeType == "org" and .orgId == $oid)] | .[0].id // empty')

if [ -z "$ORG_GROUP" ]; then
  echo "WARNING: Acme Corp org group not found. Seed data may not have loaded."
  echo "Run: cd rules_engine && docker compose down -v && docker compose up --build -d"
else
  echo "Org group ID: $ORG_GROUP"
fi

# -----------------------------------------------------------------------
# 2. Add 'category' dimension via direct SQL
# -----------------------------------------------------------------------
echo ""
echo "--- Step 2: Add Category Dimension ---"

docker exec "$RULES_PG_CONTAINER" psql -U rules -d rules_engine -c "
  INSERT INTO dimension_definitions (action_type_id, dimension_name, kind, set_members)
  VALUES ('$ACTION_TYPE_ID', 'category', 'set',
    ARRAY['compute','software-licenses','cloud-services','api-credits','developer-tools'])
  ON CONFLICT (action_type_id, dimension_name) DO NOTHING;
" 2>/dev/null && echo "Category dimension: added (or already exists)" || echo "WARNING: Could not add category dimension via SQL"

# -----------------------------------------------------------------------
# 3. Create the openclaw-agent-001 agent
# -----------------------------------------------------------------------
echo ""
echo "--- Step 3: Create OpenClaw Agent ---"

api_get "$MGMT/api/v1/agents"
OPENCLAW_AGENT_ID=$(jq_tmp '[.[] | select(.name == "openclaw-agent-001")] | .[0].id // empty')

if [ -n "$OPENCLAW_AGENT_ID" ]; then
  echo "Agent already exists: $OPENCLAW_AGENT_ID"
else
  if api_post "$MGMT/api/v1/agents" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"openclaw-agent-001\",
      \"domain\": \"finance\",
      \"orgId\": \"$ORG_ID\",
      \"email\": \"openclaw@warranted.dev\"
    }"; then
    OPENCLAW_AGENT_ID=$(jq_tmp '.id')
    echo "Created agent: $OPENCLAW_AGENT_ID"
  else
    echo "ERROR: Failed to create agent"
  fi
fi

if [ -z "${OPENCLAW_AGENT_ID:-}" ]; then
  echo "ERROR: Could not create or find openclaw-agent-001. Exiting."
  exit 1
fi

# -----------------------------------------------------------------------
# 4. Add agent to the org group (for group-level policy inheritance)
# -----------------------------------------------------------------------
echo ""
echo "--- Step 4: Add Agent to Org Group ---"

if [ -n "$ORG_GROUP" ]; then
  if api_post "$MGMT/api/v1/groups/$ORG_GROUP/members" \
    -H "Content-Type: application/json" \
    -d "{\"agentId\": \"$OPENCLAW_AGENT_ID\"}"; then
    echo "Membership: $(cat "$TMPFILE")"
  else
    echo "Membership: already_exists"
  fi
else
  echo "SKIP: No org group found"
fi

# -----------------------------------------------------------------------
# 5. Create warranted-spending-policy (allow effect)
# -----------------------------------------------------------------------
echo ""
echo "--- Step 5: Create Spending Policy ---"

api_get "$MGMT/api/v1/policies"
SPENDING_POLICY_ID=$(jq_tmp '[.[] | select(.name == "warranted-spending-policy")] | .[0].id // empty')

if [ -n "$SPENDING_POLICY_ID" ]; then
  echo "Spending policy already exists: $SPENDING_POLICY_ID"
else
  if api_post "$MGMT/api/v1/policies" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"warranted-spending-policy\",
      \"domain\": \"finance\",
      \"effect\": \"allow\",
      \"orgId\": \"$ORG_ID\"
    }"; then
    SPENDING_POLICY_ID=$(jq_tmp '.id')
    echo "Created policy: $SPENDING_POLICY_ID"
  else
    echo "ERROR: Failed to create spending policy"
  fi
fi

# -----------------------------------------------------------------------
# 6. Create policy version with Cedar source
# -----------------------------------------------------------------------
echo ""
echo "--- Step 6: Create Policy Version (Cedar Source) ---"

SPENDING_VERSION_ID=""

if [ -n "${SPENDING_POLICY_ID:-}" ]; then
  api_get "$MGMT/api/v1/policies/$SPENDING_POLICY_ID/versions"
  VERSION_COUNT=$(jq_tmp 'length')

  if [ "$VERSION_COUNT" -gt "0" ]; then
    SPENDING_VERSION_ID=$(jq_tmp '.[-1].id')
    echo "Version already exists: $SPENDING_VERSION_ID (count: $VERSION_COUNT)"
  else
    # Management API Cedar validation requires native FFI which may not be available.
    # Insert policy version directly via SQL as a reliable fallback.
    SPENDING_VERSION_ID=$(uuidgen)
    CEDAR_SOURCE=$(cat <<'CEDAR'
permit (
  principal == Agent::"AGENT_ID_PLACEHOLDER",
  action == Action::"purchase.initiate",
  resource
)
when {
  context.amount <= 5000 &&
  ["aws", "azure", "gcp", "github", "vercel", "railway", "vendor-acme-001"].contains(context.vendor)
};
CEDAR
)
    CEDAR_SOURCE="${CEDAR_SOURCE//AGENT_ID_PLACEHOLDER/$OPENCLAW_AGENT_ID}"

    CONSTRAINTS='[{"action":"purchase.initiate","dimension":"amount","kind":"numeric","max":5000},{"action":"purchase.initiate","dimension":"vendor","kind":"set","members":["aws","azure","gcp","github","vercel","railway","vendor-acme-001"]}]'

    if docker exec "$RULES_PG_CONTAINER" psql -U rules -d rules_engine -c "
      INSERT INTO policy_versions (id, policy_id, version_number, cedar_source, constraints)
      VALUES ('$SPENDING_VERSION_ID', '$SPENDING_POLICY_ID', 1,
        \$cedar\$${CEDAR_SOURCE}\$cedar\$,
        '$CONSTRAINTS'::jsonb)
      ON CONFLICT DO NOTHING;
      UPDATE policies SET active_version_id = '$SPENDING_VERSION_ID' WHERE id = '$SPENDING_POLICY_ID';
    " 2>/dev/null; then
      echo "Created version (via SQL): $SPENDING_VERSION_ID"
    else
      echo "ERROR: Failed to create policy version"
      SPENDING_VERSION_ID=""
    fi
  fi
else
  echo "SKIP: No spending policy ID"
fi

# -----------------------------------------------------------------------
# 7. Assign policy to the agent
# -----------------------------------------------------------------------
echo ""
echo "--- Step 7: Assign Policy to Agent ---"

if [ -n "${SPENDING_POLICY_ID:-}" ] && [ -n "${SPENDING_VERSION_ID:-}" ] && [ -n "${OPENCLAW_AGENT_ID:-}" ]; then
  api_get "$MGMT/api/v1/agents/$OPENCLAW_AGENT_ID/assignments"
  ALREADY_ASSIGNED=$(jq_tmp --arg pid "$SPENDING_POLICY_ID" '[.[] | select(.policyId == $pid)] | length')

  if [ "$ALREADY_ASSIGNED" -gt "0" ]; then
    echo "Policy already assigned to agent"
  else
    if api_post "$MGMT/api/v1/assignments" \
      -H "Content-Type: application/json" \
      -d "{
        \"policyId\": \"$SPENDING_POLICY_ID\",
        \"policyVersionId\": \"$SPENDING_VERSION_ID\",
        \"agentId\": \"$OPENCLAW_AGENT_ID\"
      }"; then
      ASSIGNMENT_ID=$(jq_tmp '.id')
      echo "Created assignment: $ASSIGNMENT_ID"
    else
      echo "ERROR: Failed to create assignment"
    fi
  fi
else
  echo "SKIP: Missing policy, version, or agent ID"
fi

# -----------------------------------------------------------------------
# 8. Reload Cedar engine (picks up new policies)
# -----------------------------------------------------------------------
echo ""
echo "--- Step 8: Reload Cedar Engine ---"
if curl -sf -X POST "$ENGINE/reload" 2>/dev/null > "$TMPFILE"; then
  echo "Reload result: $(cat "$TMPFILE")"
else
  echo "Reload result: failed"
fi

# -----------------------------------------------------------------------
# 9. Test the integration
# -----------------------------------------------------------------------
echo ""
echo "--- Step 9: Test Cedar Evaluation ---"

run_check() {
  local desc="$1" amount="$2" vendor="$3"
  echo ""
  echo "$desc"
  python3 -c "
import json
body = {
    'principal': 'Agent::\"$OPENCLAW_AGENT_ID\"',
    'action': 'Action::\"purchase.initiate\"',
    'resource': 'Resource::\"any\"',
    'context': {'amount': $amount, 'vendor': '$vendor'}
}
print(json.dumps(body))
" > "$TMPFILE"
  local body
  body=$(cat "$TMPFILE")
  if curl -sf -X POST "$ENGINE/check" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null > "$TMPFILE"; then
    echo "  Result: $(cat "$TMPFILE")"
  else
    echo "  Result: ERROR - request failed"
  fi
}

run_check "Test 1: Authorized purchase (amount=2500, vendor=aws)" 2500 "aws"
run_check "Test 2: Over-limit purchase (amount=6000)" 6000 "aws"
run_check "Test 3: Unapproved vendor (vendor=sketchy)" 100 "sketchy"

# -----------------------------------------------------------------------
# 10. Print mapping summary
# -----------------------------------------------------------------------
echo ""
echo "=== Mapping Summary ==="
echo "Agent name:        openclaw-agent-001"
echo "Agent UUID:        ${OPENCLAW_AGENT_ID:-UNKNOWN}"
echo "Policy ID:         ${SPENDING_POLICY_ID:-UNKNOWN}"
echo "Version ID:        ${SPENDING_VERSION_ID:-UNKNOWN}"
echo "Org ID:            $ORG_ID"
echo ""
echo "=== Next Steps ==="
echo "1. Add to openclaw/.env:"
echo "   AGENT_RULES_ENGINE_ID=${OPENCLAW_AGENT_ID:-UNKNOWN}"
echo ""
echo "2. Restart the openclaw stack:"
echo "   cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/openclaw"
echo "   docker compose down && docker compose up -d"
