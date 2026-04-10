#!/usr/bin/env bash
set -euo pipefail

# Configuration
MGMT="${RULES_ENGINE_MGMT_URL:-http://localhost:8080}"
ENGINE="${RULES_ENGINE_URL:-http://localhost:3002}"
RULES_PG_CONTAINER="${RULES_PG_CONTAINER:-rules_engine-postgres-1}"
ORG_ID="00000000-0000-0000-0000-000000000001"  # Acme Corp (pre-seeded)
ACTION_TYPE_ID="30000000-0000-0000-0000-000000000001"  # purchase.initiate (pre-seeded)

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

GROUPS=$(curl -sf "$MGMT/api/v1/groups" || echo "[]")
ORG_GROUP=$(echo "$GROUPS" | jq -r '[.[] | select(.nodeType == "org" and .orgId == "'"$ORG_ID"'")] | .[0].id // empty')

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

EXISTING_AGENTS=$(curl -sf "$MGMT/api/v1/agents" || echo "[]")
OPENCLAW_AGENT_ID=$(echo "$EXISTING_AGENTS" | jq -r '[.[] | select(.name == "openclaw-agent-001")] | .[0].id // empty')

if [ -n "$OPENCLAW_AGENT_ID" ]; then
  echo "Agent already exists: $OPENCLAW_AGENT_ID"
else
  AGENT_RESPONSE=$(curl -sf -X POST "$MGMT/api/v1/agents" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"openclaw-agent-001\",
      \"domain\": \"finance\",
      \"orgId\": \"$ORG_ID\",
      \"email\": \"openclaw@warranted.dev\"
    }" 2>/dev/null || echo "")

  if [ -z "$AGENT_RESPONSE" ]; then
    echo "ERROR: Failed to create agent"
  else
    OPENCLAW_AGENT_ID=$(echo "$AGENT_RESPONSE" | jq -r '.id')
    echo "Created agent: $OPENCLAW_AGENT_ID"
  fi
fi

if [ -z "$OPENCLAW_AGENT_ID" ]; then
  echo "ERROR: Could not create or find openclaw-agent-001. Exiting."
  exit 1
fi

# -----------------------------------------------------------------------
# 4. Add agent to the org group (for group-level policy inheritance)
# -----------------------------------------------------------------------
echo ""
echo "--- Step 4: Add Agent to Org Group ---"

if [ -n "$ORG_GROUP" ]; then
  MEMBERSHIP_RESULT=$(curl -sf -X POST "$MGMT/api/v1/groups/$ORG_GROUP/members" \
    -H "Content-Type: application/json" \
    -d "{\"agentId\": \"$OPENCLAW_AGENT_ID\"}" 2>/dev/null || echo "already_exists")
  echo "Membership: $MEMBERSHIP_RESULT"
else
  echo "SKIP: No org group found"
fi

# -----------------------------------------------------------------------
# 5. Create warranted-spending-policy (allow effect)
# -----------------------------------------------------------------------
echo ""
echo "--- Step 5: Create Spending Policy ---"

EXISTING_POLICIES=$(curl -sf "$MGMT/api/v1/policies" || echo "[]")
SPENDING_POLICY_ID=$(echo "$EXISTING_POLICIES" | jq -r '[.[] | select(.name == "warranted-spending-policy")] | .[0].id // empty')

if [ -n "$SPENDING_POLICY_ID" ]; then
  echo "Spending policy already exists: $SPENDING_POLICY_ID"
else
  POLICY_RESPONSE=$(curl -sf -X POST "$MGMT/api/v1/policies" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"warranted-spending-policy\",
      \"domain\": \"finance\",
      \"effect\": \"allow\",
      \"orgId\": \"$ORG_ID\"
    }" 2>/dev/null || echo "")

  if [ -z "$POLICY_RESPONSE" ]; then
    echo "ERROR: Failed to create spending policy"
  else
    SPENDING_POLICY_ID=$(echo "$POLICY_RESPONSE" | jq -r '.id')
    echo "Created policy: $SPENDING_POLICY_ID"
  fi
fi

# -----------------------------------------------------------------------
# 6. Create policy version with Cedar source
# -----------------------------------------------------------------------
echo ""
echo "--- Step 6: Create Policy Version (Cedar Source) ---"

if [ -n "$SPENDING_POLICY_ID" ]; then
  VERSIONS=$(curl -sf "$MGMT/api/v1/policies/$SPENDING_POLICY_ID/versions" || echo "[]")
  VERSION_COUNT=$(echo "$VERSIONS" | jq 'length')

  if [ "$VERSION_COUNT" -gt "0" ]; then
    SPENDING_VERSION_ID=$(echo "$VERSIONS" | jq -r '.[-1].id')
    echo "Version already exists: $SPENDING_VERSION_ID (count: $VERSION_COUNT)"
  else
    # Build Cedar source and JSON body via Python for proper escaping
    VERSION_RESPONSE=$(python3 -c "
import json, sys

cedar_source = '''permit (
  principal == Agent::\"$OPENCLAW_AGENT_ID\",
  action == Action::\"purchase.initiate\",
  resource
)
when {
  context.amount <= 5000 &&
  context.vendor in [\"aws\", \"azure\", \"gcp\", \"github\", \"vercel\", \"railway\", \"vendor-acme-001\"]
};'''

constraints = json.dumps([
    {'action': 'purchase.initiate', 'dimension': 'amount', 'kind': 'numeric', 'max': 5000},
    {'action': 'purchase.initiate', 'dimension': 'vendor', 'kind': 'set', 'members': ['aws', 'azure', 'gcp', 'github', 'vercel', 'railway', 'vendor-acme-001']},
])

body = {'cedarSource': cedar_source, 'constraints': constraints}
print(json.dumps(body))
" | curl -sf -X POST "$MGMT/api/v1/policies/$SPENDING_POLICY_ID/versions" \
      -H "Content-Type: application/json" \
      -d @- 2>/dev/null || echo "")

    if [ -z "$VERSION_RESPONSE" ]; then
      echo "ERROR: Failed to create policy version"
      echo "Trying generate endpoint instead..."
      VERSION_RESPONSE=$(curl -sf -X POST "$MGMT/api/v1/policies/$SPENDING_POLICY_ID/versions/generate" \
        -H "Content-Type: application/json" \
        -d "{
          \"constraints\": \"[]\",
          \"principal\": \"$OPENCLAW_AGENT_ID\",
          \"principalType\": \"agent\",
          \"actionType\": \"purchase.initiate\"
        }" 2>/dev/null || echo "")
    fi

    if [ -n "$VERSION_RESPONSE" ]; then
      SPENDING_VERSION_ID=$(echo "$VERSION_RESPONSE" | jq -r '.id')
      echo "Created version: $SPENDING_VERSION_ID"
    else
      echo "ERROR: Failed to create policy version via both endpoints"
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

if [ -n "$SPENDING_POLICY_ID" ] && [ -n "$SPENDING_VERSION_ID" ] && [ -n "$OPENCLAW_AGENT_ID" ]; then
  EXISTING_ASSIGNMENTS=$(curl -sf "$MGMT/api/v1/agents/$OPENCLAW_AGENT_ID/assignments" 2>/dev/null || echo "[]")
  ALREADY_ASSIGNED=$(echo "$EXISTING_ASSIGNMENTS" | jq -r '[.[] | select(.policyId == "'"$SPENDING_POLICY_ID"'")] | length')

  if [ "$ALREADY_ASSIGNED" -gt "0" ]; then
    echo "Policy already assigned to agent"
  else
    ASSIGN_RESPONSE=$(curl -sf -X POST "$MGMT/api/v1/assignments" \
      -H "Content-Type: application/json" \
      -d "{
        \"policyId\": \"$SPENDING_POLICY_ID\",
        \"policyVersionId\": \"$SPENDING_VERSION_ID\",
        \"agentId\": \"$OPENCLAW_AGENT_ID\"
      }" 2>/dev/null || echo "")

    if [ -n "$ASSIGN_RESPONSE" ]; then
      ASSIGNMENT_ID=$(echo "$ASSIGN_RESPONSE" | jq -r '.id')
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
RELOAD_RESULT=$(curl -sf -X POST "$ENGINE/reload" || echo "failed")
echo "Reload result: $RELOAD_RESULT"

# -----------------------------------------------------------------------
# 9. Test the integration
# -----------------------------------------------------------------------
echo ""
echo "--- Step 9: Test Cedar Evaluation ---"

echo ""
echo "Test 1: Authorized purchase (amount=2500, vendor=aws)"
RESULT=$(curl -sf -X POST "$ENGINE/check" \
  -H "Content-Type: application/json" \
  -d "{
    \"principal\": \"Agent::\"$OPENCLAW_AGENT_ID\"\",
    \"action\": \"Action::\"purchase.initiate\"\",
    \"resource\": \"Resource::\"any\"\",
    \"context\": {\"amount\": 2500, \"vendor\": \"aws\"}
  }" 2>/dev/null || echo '{"decision":"ERROR","diagnostics":["request failed"]}')
echo "  Result: $RESULT"

echo ""
echo "Test 2: Over-limit purchase (amount=6000)"
RESULT=$(curl -sf -X POST "$ENGINE/check" \
  -H "Content-Type: application/json" \
  -d "{
    \"principal\": \"Agent::\"$OPENCLAW_AGENT_ID\"\",
    \"action\": \"Action::\"purchase.initiate\"\",
    \"resource\": \"Resource::\"any\"\",
    \"context\": {\"amount\": 6000, \"vendor\": \"aws\"}
  }" 2>/dev/null || echo '{"decision":"ERROR","diagnostics":["request failed"]}')
echo "  Result: $RESULT"

echo ""
echo "Test 3: Unapproved vendor (vendor=sketchy)"
RESULT=$(curl -sf -X POST "$ENGINE/check" \
  -H "Content-Type: application/json" \
  -d "{
    \"principal\": \"Agent::\"$OPENCLAW_AGENT_ID\"\",
    \"action\": \"Action::\"purchase.initiate\"\",
    \"resource\": \"Resource::\"any\"\",
    \"context\": {\"amount\": 100, \"vendor\": \"sketchy\"}
  }" 2>/dev/null || echo '{"decision":"ERROR","diagnostics":["request failed"]}')
echo "  Result: $RESULT"

# -----------------------------------------------------------------------
# 10. Print mapping summary
# -----------------------------------------------------------------------
echo ""
echo "=== Mapping Summary ==="
echo "Agent name:        openclaw-agent-001"
echo "Agent UUID:        $OPENCLAW_AGENT_ID"
echo "Policy ID:         $SPENDING_POLICY_ID"
echo "Version ID:        $SPENDING_VERSION_ID"
echo "Org ID:            $ORG_ID"
echo ""
echo "=== Next Steps ==="
echo "1. Add to openclaw/.env:"
echo "   AGENT_RULES_ENGINE_ID=$OPENCLAW_AGENT_ID"
echo ""
echo "2. Restart the openclaw stack:"
echo "   cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/openclaw"
echo "   docker compose down && docker compose up -d"
