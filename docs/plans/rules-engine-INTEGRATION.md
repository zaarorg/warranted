# Rules Engine Integration Plan — Exact Steps

## Quick Start (TL;DR)

```bash
# 1. Create shared Docker network
docker network create warranted-net

# 2. Start the rules engine
cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/rules_engine
docker compose up --build -d

# 3. Seed Warranted-specific policies
cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/warranted
bash scripts/seed-rules-engine.sh

# 4. Copy the agent UUID to openclaw env
echo "AGENT_RULES_ENGINE_ID=<uuid-from-seed-output>" >> ../openclaw/.env

# 5. Start the OpenClaw stack
cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/openclaw
docker compose up -d

# 6. Test
curl -s -X POST "http://localhost:8100/check_authorization?vendor=aws&amount=2500&category=compute" | jq .
# Should show: "policy_engine": "cedar", "authorized": true
```

**Rollback (30 seconds):** If the integration breaks the demo, set `RULES_ENGINE_URL=` (empty string) in the sidecar's environment, restart the sidecar, and you're back to local checks. The fallback path handles this automatically.

---

## Overview

Wire the rules engine (Cedar-based policy evaluation) into the Warranted governance sidecar so that `/check_authorization` calls the rules engine's `POST /check` endpoint instead of using hardcoded Python checks. The rules engine runs as a separate Docker Compose stack connected via a shared Docker network.

**Current flow:**
```
Agent → Sidecar /check_authorization → hardcoded Python (SPENDING_LIMIT, APPROVED_VENDORS, PERMITTED_CATEGORIES)
```

**Target flow:**
```
Agent → Sidecar /check_authorization → Rules Engine POST /check (Cedar evaluation)
                                     → fallback to local checks if engine unreachable
```

### Design Decisions

- **`requires_approval` stays in the sidecar.** The sidecar checks `amount > 1000` after Cedar returns. The rules engine has `requires_human_approval` as a boolean dimension, but the sidecar's threshold-based approach is more practical. This is not an open question — it's the design decision for the demo.
- **Decision log will be empty in the dashboard.** The Rust engine doesn't write to `decision_log` and there's no write API. The dashboard's "Recent Decisions" panel will show no data after Cedar checks. This is acceptable for the demo — the value is the envelope visualization and policy REPL, not the decision history.
- **Category enforcement is dual-layer.** Cedar checks amount + vendor. The sidecar checks category locally. The seed script adds the `category` dimension via direct SQL so Cedar can enforce it too, but the sidecar retains its local check as a safety net.

---

## Step 1: Shared Docker Network

### Create the external network
```bash
docker network create warranted-net
```

This is a one-time command. Both Docker Compose stacks will attach to it.

### Edit rules engine `docker-compose.yml`

**File:** `~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/rules_engine/docker-compose.yml`

Add the external network declaration and attach all services to it:

```diff
 networks:
   app:
     driver: bridge
+  warranted-net:
+    external: true

 services:
   postgres:
     ...
-    networks: [app]
+    networks: [app, warranted-net]
   engine:
     ...
-    networks: [app]
+    networks: [app, warranted-net]
   management:
     ...
-    networks: [app]
+    networks: [app, warranted-net]
   frontend:
     ...
-    networks: [app]
+    networks: [app, warranted-net]
```

### Edit openclaw `docker-compose.yml`

**File:** `~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/openclaw/docker-compose.yml`

Add the external network and attach the sidecar:

```diff
+networks:
+  warranted-net:
+    external: true

 services:
   warranted-sidecar:
     ...
+    networks: [warranted-net]
   demo-vendor:
     ...
+    networks: [warranted-net]
   openclaw-gateway:
     ...
+    networks: [warranted-net]
   openclaw-cli:
     # Uses network_mode: "service:openclaw-gateway", inherits its networks
     ...
```

### Port conflict analysis

| Port | Rules Engine Service | OpenClaw Service | Conflict? |
|------|---------------------|------------------|-----------|
| 3001 | `engine` (Rust Cedar) | `demo-vendor` (Bun) | **YES** |
| 3100 | `frontend` (Next.js, mapped from 3000) | — | No |
| 5432 | — | — | No (rules engine uses 5434 on host) |
| 5434 | `postgres` | — | No |
| 8080 | `management` (Kotlin/Ktor) | — | No |
| 8100 | — | `warranted-sidecar` | No |
| 18789 | — | `openclaw-gateway` | No |

**Resolution for port 3001:** Change the rules engine's host port mapping. The container-internal port stays 3001 — only the host-exposed port changes. Cross-container communication uses the internal port via Docker DNS (`engine:3001`).

```diff
   engine:
     ...
     ports:
-      - "${ENGINE_PORT:-3001}:3001"
+      - "${ENGINE_PORT:-3002}:3001"
```

After this change, the rules engine's Cedar engine is accessible at:
- **Host:** `http://localhost:3002/check`
- **Docker network:** `http://engine:3001/check`

The `demo-vendor` service keeps port 3001.

---

## Step 2: Start the Rules Engine

### Prerequisites
- Docker and Docker Compose (v2)
- ~4 GB disk space (Rust compilation caches, Gradle caches, Postgres data)
- First build takes 3-5 minutes (Rust compilation of `cedar-policy` 4.9)

### Build and start
```bash
# Create the shared network first (if not already done)
docker network create warranted-net 2>/dev/null || true

# Build and start the rules engine
cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/rules_engine
docker compose up --build -d
```

The services start in this order (enforced by `depends_on` with health checks):
1. `postgres` — Postgres 16 with pgcrypto + ltree extensions
2. `management` — Kotlin/Ktor (runs Flyway migrations, seeds demo data via `R__seed_data.sql`)
3. `engine` — Rust Cedar engine (loads Cedar policies from Postgres with 30-attempt retry loop)
4. `frontend` — Next.js dashboard

### Verify each service is healthy
```bash
# Postgres (host port 5434)
docker compose exec postgres pg_isready -U rules -d rules_engine
# Expected: /var/run/postgresql:5432 - accepting connections

# Management API (host port 8080)
curl -sf http://localhost:8080/health
# Expected: {"status":"ok"}

# Cedar Engine (host port 3002 after port change)
curl -sf http://localhost:3002/health
# Expected: ok

# Frontend (host port 3100)
curl -sf http://localhost:3100 -o /dev/null -w '%{http_code}'
# Expected: 200

# Verify seed data loaded
curl -sf http://localhost:8080/api/v1/policies | jq 'length'
# Expected: 7

curl -sf http://localhost:8080/api/v1/agents | jq 'length'
# Expected: 15
```

### Verify Cedar evaluation works with seeded data
```bash
curl -sf -X POST http://localhost:3002/check \
  -H "Content-Type: application/json" \
  -d '{
    "principal": "Agent::\"20000000-0000-0000-0000-000000000001\"",
    "action": "Action::\"purchase.initiate\"",
    "resource": "Resource::\"any\"",
    "context": {"amount": 100, "vendor": "AWS", "hour": 10, "request_date": "2026-01-01", "requires_human_approval": true}
  }'
# Expected: {"decision":"Allow","diagnostics":["policy0","policy1","policy2","policy3"]}
```

---

## Step 3: Connect OpenClaw Stack

### YAML changes to openclaw's docker-compose.yml

The full diff for the openclaw `docker-compose.yml`:

```diff
+networks:
+  warranted-net:
+    external: true
+
 services:
   openclaw-gateway:
     ...
+    networks: [warranted-net]
   openclaw-cli:
     # network_mode: "service:openclaw-gateway" — inherits gateway's networks
     ...
   warranted-sidecar:
     ...
     environment:
       - ED25519_SEED=${ED25519_SEED:-warranted-demo-seed}
+      - RULES_ENGINE_URL=http://engine:3001
+    networks: [warranted-net]
   demo-vendor:
     ...
+    networks: [warranted-net]
```

### Verify cross-network connectivity

After both stacks are running:

```bash
# From the sidecar container, reach the rules engine
docker compose exec warranted-sidecar curl -sf http://engine:3001/health
# Expected: ok

# From the sidecar container, reach the management API
docker compose exec warranted-sidecar curl -sf http://management:8080/health
# Expected: {"status":"ok"}

# Verify the sidecar is still accessible from the gateway
docker compose exec openclaw-gateway curl -sf http://warranted-sidecar:8100/check_identity
# Expected: JSON with did, public_key, trust_score, etc.
```

**Note:** The `openclaw-cli` uses `network_mode: "service:openclaw-gateway"`, so it shares the gateway's network stack and can reach all services the gateway can reach.

---

## Step 4: Seed Warranted Policies

The rules engine already has Acme Corp seeded via Flyway (`R__seed_data.sql`). We need to add Warranted-specific data: a `category` dimension, an openclaw agent, and policies matching the sidecar's current hardcoded checks.

**Important:** The seeded `purchase.initiate` action type (`30000000-0000-0000-0000-000000000001`) already has `amount` (numeric), `vendor` (set), `requires_human_approval` (boolean), and `allowed_window` (temporal) dimensions. We need to add a `category` dimension (set kind).

### Seed script: `scripts/seed-rules-engine.sh`

```bash
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
```

### API request/response shapes reference

**POST /api/v1/agents** (create agent)
```json
// Request (AgentRequest)
{
  "name": "openclaw-agent-001",
  "domain": "finance",
  "orgId": "00000000-0000-0000-0000-000000000001",
  "email": "openclaw@warranted.dev"
}
// Response 201 (AgentResponse)
{
  "id": "a1b2c3d4-...",
  "name": "openclaw-agent-001",
  "domain": "finance",
  "orgId": "00000000-0000-0000-0000-000000000001",
  "email": "openclaw@warranted.dev",
  "isActive": true,
  "createdAt": "2026-04-10T..."
}
```

**POST /api/v1/policies** (create policy)
```json
// Request (PolicyRequest)
{
  "name": "warranted-spending-policy",
  "domain": "finance",
  "effect": "allow",
  "orgId": "00000000-0000-0000-0000-000000000001"
}
// Response 201 (PolicyResponse)
{
  "id": "b2c3d4e5-...",
  "name": "warranted-spending-policy",
  "domain": "finance",
  "effect": "allow",
  "orgId": "00000000-0000-0000-0000-000000000001",
  "activeVersionId": null,
  "createdAt": "2026-04-10T..."
}
```

**POST /api/v1/policies/{id}/versions** (create version)
```json
// Request (PolicyVersionRequest)
{
  "cedarSource": "permit (\n  principal == Agent::\"uuid\",\n  action == Action::\"purchase.initiate\",\n  resource\n)\nwhen {\n  context.amount <= 5000 &&\n  context.vendor in [\"aws\", \"azure\", \"gcp\"]\n};",
  "constraints": "[{\"action\":\"purchase.initiate\",\"dimension\":\"amount\",\"kind\":\"numeric\",\"max\":5000}]"
}
// Response 201 (PolicyVersionResponse)
{
  "id": "c3d4e5f6-...",
  "policyId": "b2c3d4e5-...",
  "versionNumber": 1,
  "cedarSource": "permit ( ... );",
  "cedarHash": "abc123...",
  "constraints": "[...]",
  "createdAt": "2026-04-10T..."
}
```

**POST /api/v1/assignments** (assign policy to agent)
```json
// Request (AssignmentRequest)
{
  "policyId": "b2c3d4e5-...",
  "policyVersionId": "c3d4e5f6-...",
  "agentId": "a1b2c3d4-..."
}
// Response 201 (AssignmentResponse)
{
  "id": "d4e5f6g7-...",
  "policyId": "b2c3d4e5-...",
  "policyVersionId": "c3d4e5f6-...",
  "groupId": null,
  "agentId": "a1b2c3d4-...",
  "assignedAt": "2026-04-10T..."
}
```

**POST /check** (Cedar engine — Rust)
```json
// Request (CheckRequest from evaluator.rs)
{
  "principal": "Agent::\"a1b2c3d4-...\"",
  "action": "Action::\"purchase.initiate\"",
  "resource": "Resource::\"any\"",
  "context": {
    "amount": 2500,
    "vendor": "aws"
  }
}
// Response 200 (CheckResponse from evaluator.rs)
{
  "decision": "Allow",
  "diagnostics": ["policy0"]
}
```

---

## Step 5: Wire Sidecar to Rules Engine

### Add `httpx` to requirements.txt

**File:** `requirements.txt`

```diff
 agent-os-kernel[full]
 agentmesh-runtime
 inter-agent-trust-protocol
 fastapi
 uvicorn
 PyJWT[crypto]
+httpx
```

### Modify `sidecar/server.py`

**Full diff of changes:**

```diff
 import json
 import hashlib
 import logging
 import os
 import time
 import base64
+import httpx
 from fastapi import FastAPI, HTTPException
 from fastapi.responses import Response
 ...

+# ---------------------------------------------------------------------------
+# Rules Engine integration
+# ---------------------------------------------------------------------------
+RULES_ENGINE_URL = os.environ.get("RULES_ENGINE_URL", "")
+AGENT_RULES_ENGINE_ID = os.environ.get("AGENT_RULES_ENGINE_ID", "")
+
+
+async def _check_rules_engine(vendor: str, amount: float, category: str) -> dict | None:
+    """Call the rules engine POST /check endpoint. Returns None if unreachable."""
+    if not RULES_ENGINE_URL or not AGENT_RULES_ENGINE_ID:
+        return None
+
+    check_request = {
+        "principal": f'Agent::"{AGENT_RULES_ENGINE_ID}"',
+        "action": 'Action::"purchase.initiate"',
+        "resource": 'Resource::"any"',
+        "context": {
+            "amount": amount,
+            "vendor": vendor,
+        },
+    }
+
+    try:
+        async with httpx.AsyncClient(timeout=5.0) as client:
+            resp = await client.post(
+                f"{RULES_ENGINE_URL}/check",
+                json=check_request,
+            )
+            resp.raise_for_status()
+            return resp.json()
+    except Exception as e:
+        logger.warning(f"Rules engine unreachable: {e}")
+        return None


 @app.post("/check_authorization")
 async def check_authorization(vendor: str, amount: float, category: str):
+    # Try rules engine first
+    cedar_result = await _check_rules_engine(vendor, amount, category)
+
+    if cedar_result is not None:
+        # Map Cedar response to sidecar response format
+        authorized = cedar_result.get("decision") == "Allow"
+        diagnostics = cedar_result.get("diagnostics", [])
+
+        # Cedar denied — supplement with human-readable reasons from local knowledge
+        reasons = []
+        if not authorized:
+            if amount > SPENDING_LIMIT:
+                reasons.append(f"Amount ${amount} exceeds limit of ${SPENDING_LIMIT}")
+            if vendor not in APPROVED_VENDORS:
+                reasons.append(f"Vendor '{vendor}' not on approved list")
+            if category not in PERMITTED_CATEGORIES:
+                reasons.append(f"Category '{category}' not authorized")
+            if not reasons:
+                reasons.append("Denied by policy engine")
+        else:
+            # Cedar allowed — still check category locally (dual-layer enforcement)
+            if category not in PERMITTED_CATEGORIES:
+                authorized = False
+                reasons.append(f"Category '{category}' not authorized")
+
+        score = reputation_mgr.get_or_create_score(AGENT_ID)
+        trust_level = reputation_mgr.get_trust_level(AGENT_ID)
+
+        return {
+            "authorized": authorized,
+            "reasons": reasons if reasons else ["within policy"],
+            "requires_approval": amount > 1000,
+            "agent_id": AGENT_ID,
+            "did": AGENT_DID,
+            "trust_score": score.score,
+            "trust_level": trust_level.value,
+            "vendor": vendor,
+            "amount": amount,
+            "category": category,
+            "policy_engine": "cedar",
+            "diagnostics": diagnostics,
+        }
+
+    # Fallback: local checks (rules engine unreachable or not configured)
     reasons = []
     if amount > SPENDING_LIMIT:
         reasons.append(f"Amount ${amount} exceeds limit of ${SPENDING_LIMIT}")
     ...  # rest of existing code unchanged
     return {
         "authorized": len(reasons) == 0,
         "reasons": reasons if reasons else ["within policy"],
         "requires_approval": amount > 1000,
         "agent_id": AGENT_ID,
         "did": AGENT_DID,
         "trust_score": score.score,
         "trust_level": trust_level.value,
         "vendor": vendor,
         "amount": amount,
         "category": category,
+        "policy_engine": "local",
     }
```

### Agent ID mapping

The sidecar knows the agent as `AGENT_ID = "openclaw-agent-001"` (a human-readable name). The rules engine uses UUIDs. The mapping is:

1. The seed script creates an agent with `name: "openclaw-agent-001"` and gets back a UUID
2. That UUID is set as `AGENT_RULES_ENGINE_ID` env var on the sidecar container
3. The sidecar uses `AGENT_RULES_ENGINE_ID` in Cedar `CheckRequest.principal`

**If the mapping is unknown at deploy time:** The sidecar can look up the agent by name via `GET /api/v1/agents` and filter by `name == "openclaw-agent-001"`. However, this adds a dependency on the management API at startup. Prefer the env var approach.

### Category handling

The seed script adds a `category` dimension via direct SQL INSERT (Step 2 of the seed script). However, the Cedar policy source only checks `amount` and `vendor` — adding `context.category` to the Cedar `when` clause requires regenerating the policy version. For the demo, the sidecar enforces category locally as a safety net even when Cedar returns `Allow`.

---

## Step 6: Docker Environment Variables

### YAML diff for openclaw's docker-compose.yml

```diff
   warranted-sidecar:
     image: python:3.12-slim
     working_dir: /app
     volumes:
       - ../warranted/sidecar:/app
       - ../warranted/requirements.txt:/app/requirements.txt
     environment:
       - ED25519_SEED=${ED25519_SEED:-warranted-demo-seed}
+      - RULES_ENGINE_URL=${RULES_ENGINE_URL:-http://engine:3001}
+      - AGENT_RULES_ENGINE_ID=${AGENT_RULES_ENGINE_ID:-}
     command: bash -c "pip install -r requirements.txt && uvicorn server:app --host 0.0.0.0 --port 8100"
     ports:
       - "8100:8100"
     restart: unless-stopped
+    networks: [warranted-net]
```

**Important:** `RULES_ENGINE_URL` uses `engine:3001` (the Docker service name from the rules engine's docker-compose.yml, on the internal container port). Not `localhost:3002`.

The `AGENT_RULES_ENGINE_ID` must be set after running the seed script. The seed script prints the UUID. Set it in the openclaw `.env` file:

```bash
# In ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/openclaw/.env
AGENT_RULES_ENGINE_ID=<uuid-from-seed-script>
```

---

## Step 7: Test the Integration

### Prerequisites
1. Rules engine stack running (`docker compose up -d` in rules_engine/)
2. Seed script completed (`bash scripts/seed-rules-engine.sh`)
3. `AGENT_RULES_ENGINE_ID` set in openclaw `.env`
4. OpenClaw stack running (`docker compose up -d` in openclaw/)

### Test 1: Authorized purchase
```bash
curl -s -X POST "http://localhost:8100/check_authorization?vendor=aws&amount=2500&category=compute" | jq .
```
**Expected:** `"authorized": true, "policy_engine": "cedar"`

### Test 2: Over-limit purchase
```bash
curl -s -X POST "http://localhost:8100/check_authorization?vendor=aws&amount=6000&category=compute" | jq .
```
**Expected:** `"authorized": false, "policy_engine": "cedar", "reasons": ["Amount $6000.0 exceeds limit of $5000"]`

### Test 3: Unapproved vendor
```bash
curl -s -X POST "http://localhost:8100/check_authorization?vendor=sketchy&amount=100&category=compute" | jq .
```
**Expected:** `"authorized": false, "policy_engine": "cedar", "reasons": ["Vendor 'sketchy' not on approved list"]`

### Test 4: Unapproved category
```bash
curl -s -X POST "http://localhost:8100/check_authorization?vendor=aws&amount=100&category=weapons" | jq .
```
**Expected:** `"authorized": false, "policy_engine": "cedar", "reasons": ["Category 'weapons' not authorized"]`

Note: Cedar returns `Allow` for amount+vendor, but the sidecar's local category check catches it (dual-layer enforcement).

### Test 5: Rules engine down (fallback)
```bash
# Stop the rules engine
cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/rules_engine
docker compose stop engine

# Test — should fall back to local checks
curl -s -X POST "http://localhost:8100/check_authorization?vendor=aws&amount=2500&category=compute" | jq .
# Expected: "authorized": true, "policy_engine": "local"

# Restart the engine
docker compose start engine
```

### Test 6: Full storefront demo
```bash
# Terminal 1: sidecar (if not running in Docker)
source .venv/bin/activate && ED25519_SEED=test-seed-123 uvicorn sidecar.server:app --port 8100

# Terminal 2: vendor server
bun run scripts/demo-vendor-server.ts

# Terminal 3: demo client
bun run scripts/demo-storefront.ts
```
**Expected:** The full demo flow works unchanged. The storefront SDK calls the sidecar, the sidecar calls the rules engine. The SDK's response format is unchanged.

---

## Step 8: Dashboard Access

### URL
```
http://localhost:3100
```

### Pages to visit after seeding

1. **Dashboard (`/`)** — Overview page showing policy/agent/group/decision counts. Should show the new `openclaw-agent-001` agent and `warranted-spending-policy` policy.
2. **Agents list (`/agents`)** — Find `openclaw-agent-001` in the list.
3. **Agent detail (`/agents/{openclaw-agent-id}`)** — Three tabs:
   - **Envelope tab** — Shows effective permissions. Should display `purchase.initiate` with amount max 5000, vendor set including `vendor-acme-001`.
   - **Decisions tab** — Empty for now (decision log writes are not implemented in the Rust engine).
   - **Test tab** — Select `purchase.initiate`, fill in `amount: 2500, vendor: aws`, click "Run Check". Should show `Allow`.
4. **Policies list (`/policies`)** — Find `warranted-spending-policy` in the list.
5. **Policy detail (`/policies/{spending-policy-id}`)** — Three tabs:
   - **Constraints tab** — Structured view of amount/vendor dimensions.
   - **Cedar tab** — Syntax-highlighted Cedar source showing the `permit` block.
   - **History tab** — Version timeline showing v1 with its SHA-256 hash.
6. **Agent detail Test tab** — Test a denial:
   - Select `purchase.initiate`
   - Set `amount: 6000, vendor: aws`
   - Click "Run Check"
   - Should show `Deny`

---

## Rollback Procedure

If the rules engine integration breaks the demo and you need to revert immediately:

```bash
# Option 1: Disable via env var (30 seconds)
# Set RULES_ENGINE_URL to empty in openclaw/.env
echo "RULES_ENGINE_URL=" >> ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/openclaw/.env
cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/openclaw
docker compose restart warranted-sidecar
# The sidecar detects empty RULES_ENGINE_URL and uses local checks automatically

# Option 2: Stop the rules engine entirely
cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/rules_engine
docker compose down
# The sidecar's try/except catches the connection failure and falls back to local checks
```

Both options result in `"policy_engine": "local"` in the sidecar response. No changes needed to the SDK, storefront, or OpenClaw skill.

---

## Open Questions

### Issues found while reading the code

1. **No organization CRUD API.** The management API has no endpoint to create/list organizations. Orgs are only created via SQL (Flyway seed). The Acme Corp org (`00000000-0000-0000-0000-000000000001`) is pre-seeded. For the Warranted integration, we reuse this org.

2. **No dimension_definitions CRUD API.** The `dimension_definitions` table has no management API routes — dimensions are only created via SQL seed. The seed script handles this via `docker exec psql`.

3. **Cedar entity hierarchy not loaded.** The Rust engine evaluates against `Entities::empty()`. Cedar's `principal in Group::"acme"` clauses don't match agents via group membership. Our Warranted policy uses `principal == Agent::"uuid"` (exact match) which works correctly.

4. **Port 3001 conflict.** Resolved by changing the rules engine's host port to 3002. Cross-container communication uses internal port 3001 via Docker DNS.

5. **Cedar diagnostics are opaque.** Cedar returns policy IDs like `"policy0"`, not human-readable names. The sidecar supplements with its own denial reason logic.

6. **No decision log write mechanism.** The dashboard's "Recent Decisions" panel will be empty. The Rust engine evaluates but doesn't write to `decision_log`. Acceptable for the demo.

7. **CORS restrictions.** The management API only allows `localhost:3100`, `localhost:3000`, and `localhost:8080`. Server-to-server calls from the sidecar are unaffected. Only matters if the Warranted dashboard calls the management API directly.

8. **OPA gap.** Rate limits, rolling windows, and budget tracking are described as OPA/Rego concerns but OPA is not implemented. Daily spend limits remain in the sidecar's local logic for now.

9. **Test coverage.** The rules engine has zero unit tests. The only test is `tests/smoke.sh`. Consider adding tests before production use.

---

## References

- [Rules Engine Architecture Map](./rules-engine-ARCHITECTURE.md) — full architecture analysis
- [Storefront SDK Plan](./storefront-sdk-PLAN.md) — SDK implementation plan
- [Storefront SDK Spec](./storefront-sdk-SPEC.md) — verification flow specification
- [Spending Policy YAML](../../sidecar/policies/spending-policy.yaml) — current hardcoded policies
- [Sidecar Server](../../sidecar/server.py) — current governance sidecar