# Platform Extension — Specification

## Overview

Extend the existing Warranted platform with enterprise identity (WorkOS), agent provisioning with lineage tracking, multi-tenancy, tool manifest projection (Registry MCP), and an execution gateway (sidecar extension). All work builds on top of the existing codebase — no rewrites, no new languages, no service count explosion.

**What exists and stays unchanged:**
- `packages/rules-engine/` — Cedar WASM evaluation, envelope resolution, entity store, schema, seed (370 tests)
- `packages/storefront-sdk/` — 10-step verification chain, two-phase authorization (191 tests)
- `apps/api/` — Hono management API with policy CRUD, atomic versioning, group hierarchy, envelope resolution, Cedar check, decision log
- `apps/dashboard/` — Next.js admin UI with envelope visualization, REPL tester, Cedar viewer, group tree
- `sidecar/` — Python FastAPI governance sidecar with Ed25519 identity, JWT issuance, authorization proxy, transaction signing
- Enterprise packaging — Dockerfiles, compose files (dev/production/demo), integration guides, npm pipeline

**What this spec adds:**
- WorkOS SSO + Directory Sync for real enterprise identity
- Agent provisioning with human-to-agent binding and lineage arrays
- Org-level multi-tenancy with full data isolation
- Tool Catalog + Registry MCP for tool manifest projection
- Sidecar execution gateway with credential injection and rate tracking

**What this spec defers:**
- Instructional MCP (LLM intent gate) — build when customers ask for it
- Content-addressed immutable policies — current mutable-with-versions model works
- Rust rewrite — when traffic data proves TypeScript is the bottleneck
- Capability tokens — need Instructional MCP first
- Agent-spawns-agent — lineage array supports it structurally; build when a customer needs sub-agents

---

## Constraints

- **No new languages.** TypeScript for all new code. Python sidecar extended, not replaced.
- **No new databases.** Postgres (existing) + Redis (added for sessions/rate counters). No vector stores.
- **Service count stays manageable.** Current: 4 (Postgres, API, Sidecar, Dashboard). Target: 6 (+ Redis, + Registry MCP). Not 13.
- **All existing tests keep passing.** Every phase must leave the 370 root tests and 16 dashboard tests green.
- **Existing API shapes preserved.** New endpoints are additive. Existing endpoints get org-scoping but don't change request/response shapes for single-org deployments.
- **Dashboard extends, doesn't rebuild.** New pages added alongside existing ones.

---

## Phase 1: WorkOS Integration

### Goal

Replace hardcoded identity with real enterprise SSO. Admin dashboard requires login. Directory groups sync from the customer's IdP (Entra, Okta, Google Workspace) into the existing group hierarchy.

### What Changes

**New dependency:** `@workos-inc/node` added to `apps/api/`.

**WorkOS AuthKit integration:**
- `apps/api/src/middleware/auth.ts` — middleware that validates WorkOS session on management API endpoints. Extracts `org_id`, `user_id`, `om_id` (organization membership ID) from the session. Injects into request context.
- Management API endpoints (`/api/policies/*`) require a valid WorkOS session. The existing `POST /api/policies/check` endpoint (sidecar proxy target) remains unauthenticated — it's internal-only on the backend network.
- Dashboard login page at `/login` — WorkOS AuthKit redirect flow. On success, session cookie set. All dashboard pages require authentication.
- Dashboard fetches show the authenticated org's data only.

**Directory Sync webhook handler:**
- `apps/api/src/webhooks/workos.ts` — HTTP endpoint registered with WorkOS. Handles SCIM events:
  - `dsync.group.created` / `dsync.group.updated` / `dsync.group.deleted` → sync to `groups` table
  - `dsync.user.created` / `dsync.user.deleted` / `dsync.user.suspended` → sync to agent lifecycle (Phase 2)
  - `organization_membership.created` / `organization_membership.updated` / `organization_membership.deleted` → sync memberships
- Directory groups map to existing `groups` table. The `nodeType` field maps: IdP "organization" → `org`, IdP department-level groups → `department`, IdP team-level groups → `team`.
- Group `parentId` relationships come from the IdP's group nesting (if the IdP supports it) or are configured manually in the dashboard.

**WorkOS org → existing `organizations` table mapping:**
- `organizations.workosOrgId` — new column (TEXT, nullable, unique). When set, this org is managed by WorkOS. When null, it's the legacy demo mode.
- On first WorkOS login, if no org exists with that `workosOrgId`, create one. Seed data (Acme Corp) can optionally be linked to a WorkOS org for demo purposes.

**Environment variables:**
- `WORKOS_API_KEY` — WorkOS API key
- `WORKOS_CLIENT_ID` — WorkOS client ID for AuthKit
- `WORKOS_WEBHOOK_SECRET` — webhook signature verification

### What Stays Unchanged

Envelope resolver, Cedar evaluation, policy CRUD API shapes, policy assignments, group hierarchy logic, sidecar, storefront SDK. The dashboard pages (policies, agents, groups, petitions) all work — they just now show org-scoped data behind a login.

### Schema Changes

```sql
ALTER TABLE organizations ADD COLUMN workos_org_id TEXT UNIQUE;
ALTER TABLE organizations ADD COLUMN workos_directory_id TEXT;

CREATE TABLE workos_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  last_sync_at TIMESTAMPTZ,
  sync_cursor TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Tests

- WorkOS AuthKit mock: middleware extracts org_id/user_id from session
- Directory Sync webhook: group created event → group appears in `groups` table
- Directory Sync webhook: user suspended event → recorded (used in Phase 2 for agent lifecycle)
- Dashboard requires login: unauthenticated request to `/policies` redirects to `/login`
- Existing 370 tests still pass (auth middleware is opt-in, test DB helper bypasses auth)

---

## Phase 2: Agent Identity Service + The Seam

### Goal

Formalize agent creation. A human user (authenticated via WorkOS) provisions an agent through the dashboard or API. The system records who authorized the agent, what their permissions were at creation time, and generates a cryptographic identity for the agent. This is "the seam" between the WorkOS identity zone and the Ed25519 agent zone.

### What Changes

**New package: `packages/identity/`**

Pure TypeScript library (no HTTP server — consumed by the API).

```typescript
// packages/identity/src/index.ts

export interface AgentIdentity {
  agentId: string;           // "agent_<base58(sha256(pubkey))>"
  publicKey: Uint8Array;     // Ed25519 public key
  privateKey: Uint8Array;    // Ed25519 private key (returned to admin, never stored in plaintext)
  did: string;               // "did:mesh:<hex(pubkey)>" (backward compatible with existing sidecar)
}

export interface LineageRecord {
  agentId: string;
  parentId: string;          // WorkOS om_* for human-sponsored, agent_* for agent-spawned
  parentType: "user" | "agent";
  sponsorOrgId: string;      // WorkOS org_id
  sponsorUserId: string;     // WorkOS user_id (the human at the top of the chain)
  sponsorMembershipId: string; // WorkOS om_* 
  sponsorRoleAtCreation: string; // role slug at creation time
  sponsorEnvelopeSnapshot: object; // effective envelope at creation time
  lineage: string[];         // ["org_01H...", "om_01H...", "agent_7Xk..."]
  createdAt: string;
  signature: string;         // parent signs this record
}

// Generate a new agent identity
export function createAgentIdentity(): AgentIdentity;

// Derive agent ID from public key (deterministic)
export function deriveAgentId(publicKey: Uint8Array): string;

// Derive DID from public key (backward compatible with sidecar)
export function deriveDid(publicKey: Uint8Array): string;
```

Uses `@noble/ed25519` for key generation (same algorithm as the existing sidecar but in TypeScript).

**New schema tables:**

```sql
CREATE TABLE agent_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  agent_id TEXT NOT NULL UNIQUE,          -- "agent_<base58(sha256(pubkey))>"
  did TEXT NOT NULL UNIQUE,               -- "did:mesh:<hex>" (backward compat)
  public_key BYTEA NOT NULL,
  -- private key NOT stored — returned once at creation, admin saves it
  status TEXT NOT NULL DEFAULT 'active',  -- active, suspended, revoked
  created_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE agent_lineage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id),
  parent_id TEXT NOT NULL,                 -- om_* or agent_*
  parent_type TEXT NOT NULL,               -- 'user' or 'agent'
  sponsor_user_id TEXT NOT NULL,           -- WorkOS user_id (human at top)
  sponsor_membership_id TEXT NOT NULL,     -- WorkOS om_*
  sponsor_role_at_creation TEXT,
  sponsor_envelope_snapshot JSONB NOT NULL, -- envelope at creation time
  lineage JSONB NOT NULL,                  -- ordered array: ["org_...", "om_...", "agent_..."]
  signature TEXT NOT NULL,                 -- parent's signature over this record
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**New API endpoint — the seam:**

`POST /api/agents/create` — creates an agent with identity + policy binding in one atomic operation.

Request (authenticated via WorkOS session):
```json
{
  "name": "procurement-agent-01",
  "groupId": "00000000-0000-0000-0000-000000000300",
  "policyIds": ["00000000-0000-0000-0000-000000000400"]
}
```

Flow:
1. Extract `org_id`, `user_id`, `om_id`, role from WorkOS session
2. Compute the sponsor's effective envelope via `resolveEnvelope(db, sponsorDid, orgId)` — where `sponsorDid` is derived from the WorkOS membership
3. Call `createAgentIdentity()` to generate Ed25519 keypair
4. Validate that the requested policies are a subset of the sponsor's envelope (the narrowing invariant)
5. Write `agent_identities` record
6. Write `agent_lineage` record with sponsor snapshot
7. Add agent to the requested group via existing `agentGroupMemberships`
8. Assign policies via existing `policyAssignments`
9. Return: `{ agentId, did, publicKey, sidecarConfig: { ED25519_SEED, RULES_ENGINE_URL } }`

The `sidecarConfig` is the `docker run` command the admin uses to deploy the agent's sidecar. The private key is encoded as the `ED25519_SEED` — returned once, never stored.

**Extend sidecar:**
- Accept `ED25519_PRIVATE_KEY` env var as an alternative to `ED25519_SEED`. When set, use the provided private key directly instead of deriving from a seed. This supports agent provisioning where the keypair is generated server-side.
- Both `ED25519_SEED` (legacy) and `ED25519_PRIVATE_KEY` (new) work. The sidecar picks whichever is set.

**Dashboard: Agent Provisioning page (`/agents/new`):**
- Form: agent name, select group (dropdown from `GET /api/policies/groups`), select policies (multi-select)
- "Create Agent" button → `POST /api/agents/create`
- On success: show the sidecar config (copyable `docker run` command), agent ID, DID
- Redirect to `/agents/[did]` to see the envelope

**SCIM cascade (from Phase 1 webhooks):**
- `dsync.user.suspended` / `dsync.user.deleted` → find all agents where `sponsor_user_id` matches → set `status = 'suspended'` on `agent_identities` → sidecar's next authorization check returns denied
- `organization_membership.deleted` → find all agents where `sponsor_membership_id` matches → same cascade

### What Stays Unchanged

Envelope resolver, Cedar evaluation, policy model, existing dashboard pages (policies, groups, Cedar viewer, REPL). The existing sidecar works identically for agents deployed with `ED25519_SEED`.

### Tests

- `createAgentIdentity()` generates valid Ed25519 keypair and deterministic agent ID
- `deriveAgentId()` and `deriveDid()` are deterministic (same pubkey → same ID)
- `POST /api/agents/create` creates agent + lineage + group membership + policy assignment atomically
- `POST /api/agents/create` rejects policies that exceed sponsor's envelope
- Lineage array is correctly ordered: `[org_id, om_id, agent_id]`
- Agent suspension cascades from WorkOS user suspension
- Existing 370 tests still pass

---

## Phase 3: Multi-Tenancy + Org Isolation

### Goal

Make the existing system multi-tenant. Every query is scoped by `org_id` from the authenticated session. Two organizations cannot see or affect each other's data.

### What Changes

**Org-scoping on all queries:**

Most tables already have `org_id` (the rules engine schema was designed with it). The management API routes need to filter by the authenticated org:

```typescript
// Before (all policies)
const policies = await db.select().from(schema.policies);

// After (org-scoped)
const orgId = c.get("orgId"); // from WorkOS auth middleware
const policies = await db.select().from(schema.policies).where(eq(schema.policies.orgId, orgId));
```

Every route in `apps/api/src/routes/policies/` gets org-scoping. This is a mechanical change — add `.where(eq(...orgId, orgId))` to every query.

**Tables that need `org_id` added (if missing):**
- Audit the entire schema. The rules engine schema already has `org_id` on: `organizations`, `groups`, `policies`, `policyVersions`, `policyAssignments`, `agentGroupMemberships`, `actionTypes`, `dimensionDefinitions`, `decisionLog`.
- New tables from Phase 2 (`agent_identities`, `agent_lineage`) already have `org_id`.
- Verify `decisionLog` entries are scoped and filtered by org.

**Dashboard org-scoping:**
- All `apiFetch` calls automatically include the session cookie
- API returns only the authenticated org's data
- No UI changes needed — the dashboard already renders whatever the API returns

**Sidecar org-scoping:**
- The sidecar is already one-per-agent. The agent's lineage (from Phase 2) contains the `org_id`. When the sidecar calls `POST /api/policies/check`, the API resolves the agent's org from the lineage and scopes the evaluation.
- No sidecar code changes needed — the scoping happens in the API.

**Per-org seed data:**
- The existing Acme Corp seed data is one org. Multi-tenancy means other orgs start empty.
- New orgs created via WorkOS login get an empty state: no policies, no groups (until SCIM syncs), no agents.
- Add an optional "Demo org" seed that can be triggered via `POST /api/orgs/seed-demo` (admin-only, creates the Acme Corp data under the authenticated org).

### Tests

- Create two orgs. Create policies in org A. Query from org B → empty results.
- Create agent in org A. Resolve envelope → works. Query from org B → not found.
- Decision log entries from org A not visible to org B.
- Group hierarchy operations in org A don't affect org B.
- Existing 370 tests still pass (tests use a single-org setup, auth is bypassed in test DB helper).

---

## Phase 4: Tool Catalog + Registry MCP

### Goal

Agents discover their available tools via the MCP protocol. The tool manifest hides numeric bounds, rate limits, and temporal windows — agents see tools and enum-constrained parameters, not rules.

### What Changes

**Extend `actionTypes` table → Tool Catalog:**

```sql
ALTER TABLE action_types ADD COLUMN parameter_schema JSONB;     -- full JSON Schema (unconstrained)
ALTER TABLE action_types ADD COLUMN permission_category TEXT;    -- e.g., "financial", "communication"
ALTER TABLE action_types ADD COLUMN status TEXT DEFAULT 'active'; -- active, deprecated
ALTER TABLE action_types ADD COLUMN description TEXT;
ALTER TABLE action_types ADD COLUMN tool_backend_url TEXT;       -- internal URL for API proxy (Phase 5)
```

The existing `actionTypes` table already has `orgId`, `name`, and `dimensionDefinitions`. Adding these columns makes it a full tool catalog without creating a new table.

**Tool Catalog admin API (org-scoped):**
- `POST /api/tools` — register a new tool (creates `actionTypes` entry with parameter schema)
- `GET /api/tools` — list org's tools
- `PUT /api/tools/:id` — update tool metadata
- `DELETE /api/tools/:id` — deprecate tool

These are thin wrappers around the existing `actionTypes` CRUD.

**New package: `packages/registry-mcp/`**

MCP protocol server using `@modelcontextprotocol/sdk`. Agents connect via MCP, present identity, receive a projected tool manifest.

```typescript
// packages/registry-mcp/src/server.ts

import { Server } from "@modelcontextprotocol/sdk/server";

// MCP tool: list_tools
// Agent calls this to discover available tools
// Flow:
// 1. Extract agent identity from DPoP proof in request
// 2. Call GET /api/policies/agents/:did/envelope on the management API
// 3. Filter tool catalog to tools present in the envelope
// 4. Project parameter schemas:
//    - Set constraints → enum values in the schema
//    - Numeric bounds → hidden (agent sees "type: number", not "max: 500")
//    - Temporal windows → hidden
//    - Rate limits → hidden
//    - Boolean flags (requires_approval) → hidden
// 5. Return projected tool manifest via MCP
```

**Projection logic (the core deliverable):**

Given a tool's full parameter schema and the agent's resolved envelope, produce a projected schema:

```typescript
interface ProjectedTool {
  toolId: string;
  name: string;
  description: string;
  parameters: Record<string, ProjectedParameter>;
}

interface ProjectedParameter {
  type: string;              // "string", "number", "boolean"
  required: boolean;
  enum?: string[];           // set constraints → visible as enum
  // numeric max → NOT included
  // rate limits → NOT included
  // temporal windows → NOT included
}
```

Example: if the envelope says `vendor ∈ {AWS, GCP}` and `amount ≤ 500`:
```json
{
  "toolId": "purchase_initiate",
  "name": "Initiate Purchase",
  "parameters": {
    "vendor": { "type": "string", "enum": ["AWS", "GCP"], "required": true },
    "amount": { "type": "number", "required": true },
    "category": { "type": "string", "enum": ["compute"], "required": true }
  }
}
```

The agent sees that `vendor` must be "AWS" or "GCP" (useful for valid input) but does NOT see that `amount` is capped at $500.

**DPoP verification library: `packages/shared/dpop/`**

Replaces current JWT verification for agent-to-service communication.

```typescript
// packages/shared/dpop/src/index.ts

export interface DPoPProof {
  agentId: string;
  publicKey: Uint8Array;
  signature: Uint8Array;
  nonce: string;
  issuedAt: number;
}

// Verify a DPoP proof and extract agent identity
export function verifyDPoP(proof: string, expectedUrl: string): Promise<DPoPProof>;

// Create a DPoP proof (used by agents/sidecars)
export function createDPoP(privateKey: Uint8Array, url: string): Promise<string>;
```

Used by Registry MCP and API proxy (Phase 5). The existing JWT-based sidecar authentication continues to work alongside DPoP — DPoP is for agent→MCP communication, JWT is for agent→vendor communication (storefront SDK).

**Dashboard: Tool Catalog page (`/tools`):**
- List org's tools with parameter schemas
- Create/edit tool definitions
- Shows which policies reference each tool

### Tests

- Registry MCP: agent connects → receives projected manifest with correct enum values and hidden numeric bounds
- Registry MCP: agent with no permissions → empty manifest
- Registry MCP: two agents with different policies → different projections
- Projection logic: set constraints become enums, numeric bounds are stripped
- Tool Catalog CRUD: create, update, deprecate (org-scoped)
- Existing 370 tests still pass

---

## Phase 5: API Proxy as Sidecar Extension

### Goal

The sidecar becomes the execution gate. Agents send tool calls through it. The sidecar verifies identity, checks authorization in real-time (with runtime context), injects platform credentials, forwards to the tool backend, and logs the decision.

### What Changes

**New sidecar endpoint: `POST /execute`**

```python
@app.post("/execute")
async def execute_tool(tool_id: str, parameters: dict):
    # 1. Verify agent identity (existing DPoP or JWT)
    # 2. Check session validity (Redis lookup)
    # 3. Build runtime context: parameters + current timestamp + rate counters + spend-to-date
    # 4. Call POST /api/policies/check with runtime context
    # 5. On deny: return opaque refusal, log to decision log
    # 6. On allow:
    #    a. Fetch platform credentials for this tool (from credentials store)
    #    b. Construct authenticated outbound request
    #    c. Forward to tool backend URL (from tool catalog)
    #    d. Return response to agent
    #    e. Log full decision to decision log
```

**Opaque denials:**
```json
{
  "status": "denied",
  "message": "This action is not available at this time."
}
```

The agent does NOT learn why it was denied. The decision log records the full reason (which constraint failed, which policy applied).

**Platform credentials store:**

```sql
CREATE TABLE platform_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  tool_id UUID NOT NULL REFERENCES action_types(id),
  credential_type TEXT NOT NULL,           -- "api_key", "oauth2", "service_account"
  encrypted_credentials JSONB NOT NULL,    -- encrypted at rest
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, tool_id)
);
```

Agents never see these credentials. The sidecar fetches them from the API and injects them into outbound requests.

**Redis for sessions and rate counters:**

Add Redis to `docker-compose.yml`:
```yaml
redis:
  image: redis:7-alpine
  ports: ["6379:6379"]
```

Rate counters: per-agent request counts within time windows (hourly, daily). A request by a child agent increments counters for every ancestor in the lineage array (DAG-aware). Stored in Redis with TTL-based expiry.

Spend tracking: cumulative spend per agent, per ancestor, per tool. Stored in Postgres (financial amounts need stronger consistency than Redis).

**Hash-chained audit log:**

Extend existing `decisionLog` table:
```sql
ALTER TABLE decision_log ADD COLUMN prev_hash TEXT;
ALTER TABLE decision_log ADD COLUMN entry_hash TEXT;
ALTER TABLE decision_log ADD COLUMN lineage_path JSONB;
ALTER TABLE decision_log ADD COLUMN runtime_context JSONB;
```

Each entry's `entry_hash = sha256(prev_hash + decision_id + outcome + timestamp + ...)`. The chain is per-org, append-only. Tamper-evidence: if any entry is modified, the hash chain breaks.

**Weather tool backend (first integration):**

`packages/tools/weather/` — TypeScript wrapper around OpenWeatherMap API.

```typescript
// Accepts standardized internal request from sidecar
// Translates to OpenWeatherMap format
// Calls external API with org's injected API key
// Returns standardized response
```

Register in tool catalog for the demo org. Write Cedar policies for weather: allowed parameters, any constraints. Store API key in `platform_credentials`.

**Dashboard: Credentials management page (`/tools/[id]/credentials`):**
- Upload/manage platform credentials per tool per org
- Shows credential type, last rotated date
- Does NOT display credential values

### Tests

- `POST /execute` with valid identity + within envelope → proxied to mock backend, response returned
- `POST /execute` exceeding numeric cap → opaque denial, decision log entry with full reason
- Rate counter increments for agent AND ancestors on each request
- Spend tracking updates for financial tool calls
- Hash-chained audit log: entries link via prev_hash, chain verification passes
- Platform credentials: stored encrypted, injected into outbound request, never returned to agent
- Weather tool: end-to-end through sidecar → API check → credential injection → OpenWeatherMap → response
- Existing 370 tests still pass

---

## Deferred (Post-Customer)

| Feature | Trigger | Dependency |
|---|---|---|
| **Instructional MCP** (LLM intent gate, RAG pipeline, capability tokens) | Customer requests natural-language agent interaction | Phase 4 (Registry MCP) + Phase 5 (API proxy) |
| **Content-addressed immutable policies** | Audit/compliance requirement from customer | Current version history + Cedar hash is sufficient until then |
| **Agent-spawns-agent** (sub-agents) | Customer needs autonomous agent hierarchies | Phase 2 lineage array already supports it structurally |
| **Rust rewrite of hot path** | Traffic data showing TypeScript is the bottleneck | All phases (profile first, rewrite second) |
| **Capability tokens** | Instructional MCP exists | Instructional MCP |
| **Human-in-the-loop approval workflow** | Customer requests it | Phase 5 (execution gateway) |
| **Key rotation and compromise recovery** | Security audit requirement | Phase 2 (identity service) |

---

## Service Inventory

| Service | Technology | Port | Phase Added |
|---|---|---|---|
| Postgres | Postgres 16 | 5432 | Existing |
| Rules Engine API | TypeScript/Bun/Hono | 3000 | Existing |
| Governance Sidecar | Python/FastAPI | 8100 | Existing |
| Dashboard | Next.js 16 | 3001 | Existing |
| Redis | Redis 7 | 6379 | Phase 2 |
| Registry MCP | TypeScript/MCP SDK | 8200 | Phase 4 |

Six services total. No Rust. No vector stores. No LLM dependencies.

---

## Environment Variables (New)

| Variable | Service | Phase | Description |
|---|---|---|---|
| `WORKOS_API_KEY` | API | 1 | WorkOS API key |
| `WORKOS_CLIENT_ID` | API | 1 | WorkOS AuthKit client ID |
| `WORKOS_WEBHOOK_SECRET` | API | 1 | Webhook signature verification |
| `REDIS_URL` | API, Sidecar | 2 | Redis connection string |
| `ED25519_PRIVATE_KEY` | Sidecar | 2 | Alternative to ED25519_SEED for provisioned agents |
| `REGISTRY_MCP_PORT` | Registry MCP | 4 | Port for MCP server (default 8200) |
| `OPENWEATHERMAP_API_KEY` | Weather tool | 5 | First tool integration credential |

---

## Migration Path

Each phase is independently deployable. A customer can use the system at any phase:

- **After Phase 1:** Dashboard requires login. Directory groups sync from IdP. Policies managed by authenticated admins. (Same product, real identity.)
- **After Phase 2:** Admins provision agents through the dashboard. Each agent has a verifiable lineage back to the human who authorized it. (Agent provisioning story.)
- **After Phase 3:** Multiple enterprises use the same deployment. Full data isolation. (Multi-tenant SaaS.)
- **After Phase 4:** Agents discover tools via MCP. Tool manifests are projected — agents see what they can do, not the rules governing them. (The tool manifest story.)
- **After Phase 5:** Agents execute tool calls through the sidecar. Credentials injected, rate limits enforced, decisions hash-chained. (The execution gateway story.)

No phase requires the subsequent phases. Each is a shippable increment.
