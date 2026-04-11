# Example Run: Policy Creation + OpenClaw Agent Purchase

Complete walkthrough from a fresh computer restart to creating a policy in the
dashboard and running a governed purchase through the OpenClaw agent.

## Prerequisites

- Docker and Docker Compose installed
- Bun installed (`curl -fsSL https://bun.sh/install | bash`)
- OpenClaw image built locally as `openclaw:local`
- OpenClaw config directories exist at `~/.openclaw` and `~/.openclaw/workspace`

## Ports Reference

| Service      | URL                     | Purpose                              |
|--------------|-------------------------|--------------------------------------|
| PostgreSQL   | `localhost:5432`        | Database                             |
| Rules Engine | `http://localhost:3000` | Policy CRUD, Cedar evaluation        |
| Sidecar      | `http://localhost:8100` | Agent identity, authorization        |
| Demo Vendor  | `http://localhost:3002` | Storefront for purchase testing      |
| Dashboard    | `http://localhost:3001` | Policy management UI                 |
| OpenClaw     | `http://localhost:18789`| Agent chat UI                        |

---

## Step 1: Start Docker

```bash
sudo systemctl start docker
```

## Step 2: Create the shared Docker network (one-time only)

The Warranted demo and OpenClaw containers communicate over a shared network
called `warranted-net`.

```bash
docker network create warranted-net 2>/dev/null || echo "Network already exists"
```

## Step 3: Start the Warranted backend services

```bash
cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/warranted
docker compose -f docker-compose.demo.yml up -d
```

This starts 4 services in order:

1. **postgres** (port 5432) — database, waits for healthcheck
2. **api** (port 3000) — Hono API, auto-runs migrations + seed data
3. **sidecar** (port 8100) — Python governance sidecar (Ed25519 identity)
4. **demo-vendor** (port 3002) — Acme Cloud Compute storefront

Wait ~15 seconds for everything to initialize, then verify:

```bash
# Check API is healthy
curl -s http://localhost:3000/health

# Check sidecar identity
curl -s http://localhost:8100/check_identity | python3 -m json.tool

# Check demo vendor
curl -s http://localhost:3002/ | python3 -m json.tool
```

Expected sidecar output includes `agent_id`, `did` (starting with `did:mesh:`),
`spending_limit: 5000`, and `approved_vendors` list.

## Step 4: Start the dashboard

```bash
cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/warranted/apps/dashboard
bun install
NEXT_PUBLIC_API_URL=http://localhost:3000 bun run dev --port 3001 &
```

Open **http://localhost:3001** in a browser. You should see the dashboard with
pre-seeded data:

- **Policies** page: ~11 seed policies (agent spending limit, approved vendors,
  permitted categories, etc.)
- **Groups** page: Acme Corp org hierarchy (Finance, Engineering, Operations
  departments with teams underneath)

## Step 5: Kill any conflicting local sidecar process

If you previously ran the sidecar locally, kill it so the Docker container's
port binding works:

```bash
lsof -ti :8100 | xargs kill 2>/dev/null || true
```

## Step 6: Start the OpenClaw gateway

```bash
cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/openclaw
docker compose up -d
```

This starts `openclaw-gateway` on port 18789 connected to `warranted-net`, so
the agent can reach the sidecar at `http://warranted-sidecar:8100` and the
demo vendor at `http://demo-vendor:3001`.

## Step 7: Verify everything is running

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Expected containers:

| Container                        | Port  |
|----------------------------------|-------|
| `warranted-postgres-1`           | 5432  |
| `warranted-api-1`                | 3000  |
| `warranted-sidecar-1`            | 8100  |
| `warranted-demo-vendor-1`        | 3002  |
| `openclaw-openclaw-gateway-1`    | 18789 |

---

## Step 8: Create a new policy in the dashboard

Open **http://localhost:3001/policies** and click **Create Policy**.

Fill in:

| Field  | Value              |
|--------|--------------------|
| Name   | `gpu-spending-cap` |
| Domain | `finance`          |
| Effect | `deny`             |

Click **Create**. The policy appears in the list with no active version yet.

## Step 9: Add constraints to the policy

Click into the **gpu-spending-cap** policy. Under the **Constraints** tab, expand
the **Create Version** form.

1. Select action type: **purchase.initiate**
2. Fill in dimension values:
   - **amount** (numeric): `500`
   - **category** (set): `gpu`
3. Click **Save**

This generates a Cedar policy, hashes it, and sets it as the active version.
Switch to the **Cedar** tab to see the generated source:

```cedar
forbid (principal, action == Action::"purchase.initiate", resource)
when {
  context.amount > 500 &&
  context.category in ["gpu"]
};
```

## Step 10: Assign the policy to a group

The sidecar auto-registers its agent DID into the **Platform** team on startup.
Assign your new policy to that team so it applies to the agent.

**Option A: Via the dashboard**

Go to **Groups**, navigate to Engineering > Platform, and assign the policy there.

**Option B: Via curl**

First, get the policy ID:

```bash
curl -s http://localhost:3000/api/policies/rules | \
  python3 -c "import sys,json; [print(f\"{p['id']}  {p['name']}\") for p in json.load(sys.stdin)['data']]"
```

Then assign it to the Platform team (group ID `00000000-0000-0000-0000-000000000021`):

```bash
curl -s -X POST http://localhost:3000/api/policies/assignments \
  -H "Content-Type: application/json" \
  -d '{"policyId":"<POLICY_ID>","groupId":"00000000-0000-0000-0000-000000000021"}'
```

Replace `<POLICY_ID>` with the actual UUID from the first command.

---

## Step 11: Test the policy via the dashboard REPL

1. Go to **Agents** page at http://localhost:3001/agents
2. Enter the agent's DID (get it from `curl -s http://localhost:8100/check_identity | python3 -c "import sys,json; print(json.load(sys.stdin)['did'])"`)
3. Click **View Envelope** — the **Envelope** tab shows all resolved constraints
   inherited from the group hierarchy
4. Switch to the **Test** tab to open the Policy REPL
5. Enter test values and click **Evaluate**:

**Test 1 — Allowed purchase:**

| Field    | Value             |
|----------|-------------------|
| Vendor   | `aws`             |
| Amount   | `500`             |
| Category | `compute`         |

Expected: **Allow**

**Test 2 — Denied by gpu-spending-cap:**

| Field    | Value             |
|----------|-------------------|
| Vendor   | `aws`             |
| Amount   | `1000`            |
| Category | `gpu`             |

Expected: **Deny** (amount 1000 exceeds the gpu-spending-cap limit of 500)

---

## Step 12: Interact with the OpenClaw agent

Open the OpenClaw gateway at **http://localhost:18789**.

Paste this prompt:

```
Use the warranted-identity skill to buy 100 GPU hours from the demo vendor
storefront at http://demo-vendor:3001. Get a token from the sidecar, discover
the storefront, browse the catalog, create a session for gpu-hours-100, and
settle it. Use curl for all HTTP calls. Show me the receipt when done.
```

The agent will execute these steps automatically using the `warranted-identity`
skill:

### What happens behind the scenes

**1. Check identity**
```bash
curl -s http://warranted-sidecar:8100/check_identity
```
Returns agent DID, spending limit ($5000), approved vendors, trust score.

**2. Check authorization**
```bash
curl -s -X POST "http://warranted-sidecar:8100/check_authorization?vendor=vendor-acme-001&amount=2500&category=compute"
```
The sidecar proxies this to the rules engine at `http://api:3000/api/policies/check`,
which evaluates all assigned Cedar policies. Returns `authorized: true`.

**3. Get a JWT token**
```bash
curl -s -X POST http://warranted-sidecar:8100/issue_token
```
Returns an EdDSA-signed JWT with spending limits, approved vendors, and
categories in the claims.

**4. Discover the storefront**
```bash
curl -s http://demo-vendor:3001/.well-known/agent-storefront.json
```
Returns the storefront manifest (name, catalog endpoint, session endpoint,
min trust score).

**5. Browse the catalog**
```bash
curl -s -H "Authorization: Bearer <TOKEN>" http://demo-vendor:3001/agent-checkout/catalog
```
Returns 3 items: `gpu-hours-100` ($2500), `gpu-hours-500` ($10000),
`api-credits-10k` ($500).

**6. Create a purchase session**
```bash
curl -s -X POST \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"sku":"gpu-hours-100","quantity":1}],"transactionType":"fixed-price"}' \
  http://demo-vendor:3001/agent-checkout/session
```
Returns a `sessionId`.

**7. Settle the transaction**
```bash
curl -s -X POST \
  -H "Authorization: Bearer <TOKEN>" \
  http://demo-vendor:3001/agent-checkout/session/<SESSION_ID>/settle
```
Returns a signed receipt with Ed25519 signature, agent DID, items, total
amount, and timestamp.

---

## Step 13: Test a denied purchase

Try a purchase that should be blocked by the `gpu-spending-cap` policy you
created in step 9. In the OpenClaw agent, paste:

```
Check if you are authorized to purchase $1000 of gpu from aws. Run:
curl -s -X POST "http://warranted-sidecar:8100/check_authorization?vendor=aws&amount=1000&category=gpu"
Report whether the gpu-spending-cap policy blocked this.
```

Expected: `authorized: false` with a diagnostic message from the Cedar policy
evaluation.

---

## Cleanup

```bash
# Stop OpenClaw
cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/openclaw
docker compose down

# Stop Warranted services
cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/warranted
docker compose -f docker-compose.demo.yml down

# Stop dashboard (if running in background)
kill %1 2>/dev/null || true

# Remove the shared network (optional)
docker network rm warranted-net 2>/dev/null || true
```

---

## Troubleshooting

### Services won't start

```bash
# Check logs for the failing service
docker compose -f docker-compose.demo.yml logs api
docker compose -f docker-compose.demo.yml logs sidecar
docker compose -f docker-compose.demo.yml logs postgres
```

### Port already in use

```bash
lsof -i :3000   # Who's using port 3000?
lsof -i :8100   # Who's using port 8100?
```

### OpenClaw can't reach sidecar

Both compose stacks must be on the `warranted-net` network. Verify:

```bash
docker network inspect warranted-net --format '{{range .Containers}}{{.Name}} {{end}}'
```

You should see containers from both the warranted and openclaw stacks.

### Dashboard shows "Loading..." forever

The dashboard proxies API calls to `http://localhost:3000`. Make sure the API
container is running and the `NEXT_PUBLIC_API_URL` env var is set:

```bash
curl -s http://localhost:3000/api/policies/rules | head -c 200
```

### Sidecar returns local fallback instead of rules engine

If `check_authorization` returns `"reasons": ["within policy"]` but no Cedar
diagnostics, the sidecar couldn't reach the rules engine. Check:

```bash
docker compose -f docker-compose.demo.yml logs sidecar | grep -i "rules engine"
```

The sidecar needs `RULES_ENGINE_URL=http://api:3000/api/policies/check` (set
in the demo compose file).
