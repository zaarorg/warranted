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
- **No new databases.** Postgres (existing) + Redis (added Phase 2 for sessions/rate counters). No vector stores.
- **Service count stays manageable.** Current: 4 (Postgres, API, Sidecar, Dashboard). Target: 6 (+ Redis, + Registry MCP). Not 13.
- **All existing tests keep passing.** Every phase must leave the 370 root tests and 16 dashboard tests green.
- **Existing API shapes preserved.** New endpoints are additive. Existing endpoints get org-scoping but don't change request/response shapes for single-org deployments.
- **Dashboard extends, doesn't rebuild.** New pages added alongside existing ones.
- **Phase ordering is linear.** Phase 1 -> 2 -> 3 -> 4 -> 5. Phase 3 (multi-tenancy) is required before Phase 4 and 5.
- **Migration strategy:** One Drizzle migration per phase (`0001_phase1_workos`, `0002_phase2_identity`, `0003_phase3_multitenancy`, `0004_phase4_tools`, `0005_phase5_execution`).

---

## Phase 1: WorkOS Integration

### Goal

Replace hardcoded identity with real enterprise SSO. Admin dashboard requires login. Directory groups sync from the customer's IdP (Entra, Okta, Google Workspace) into the existing group hierarchy.

### What Changes

**New dependency:** `@workos-inc/node` added to `apps/api/`. `@workos-inc/authkit-nextjs` added to `apps/dashboard/`.

**Login flow:**
- WorkOS AuthKit hosted login with custom branding. The `@workos-inc/authkit-nextjs` middleware handles the redirect flow, session management via encrypted cookies, and callback processing.
- No Redis required for sessions in Phase 1 — WorkOS AuthKit uses encrypted cookies natively.
- Dashboard login page at `/login` — WorkOS AuthKit redirect flow. On success, encrypted session cookie set. All dashboard pages require authentication.
- Dashboard fetches show the authenticated org's data only.

**Auth middleware — Hono middleware with selective application:**
- `apps/api/src/middleware/auth.ts` — Hono middleware that validates WorkOS session on management API endpoints. Extracts `org_id`, `user_id`, `om_id` (organization membership ID) from the session. Injects into request context.
- Applied selectively per route group:
  - `/api/policies/*` management endpoints — require valid WorkOS session.
  - `POST /api/policies/check` — authenticated via `INTERNAL_API_SECRET` shared secret. The sidecar sends `X-Internal-Token` header with the shared secret value. This endpoint is internal-only on the backend network.
  - `GET /health` — unauthenticated. No middleware applied.
- Management API endpoints require a valid WorkOS session. The existing `/check` endpoint uses the internal shared secret pattern instead.

**Webhook mount point:**
- `apps/api/src/routes/webhooks/workos.ts` — new route group mounted at `/api/webhooks/workos` (not under `/policies`). Registered as a new route group in `index.ts`.
- Handles SCIM events:
  - `dsync.group.created` / `dsync.group.updated` / `dsync.group.deleted` -> sync to `groups` table
  - `dsync.user.created` / `dsync.user.deleted` / `dsync.user.suspended` -> sync to agent lifecycle (Phase 2)
  - `organization_membership.created` / `organization_membership.updated` / `organization_membership.deleted` -> sync memberships

**SCIM group mapping — manual in dashboard:**
- Directory groups land in the `groups` table with `nodeType = 'unassigned'`. The CHECK constraint on `nodeType` is updated to include `'unassigned'` as a valid value.
- Admins manually assign the correct `nodeType` (`org`, `department`, `team`) and `parentId` relationships via the dashboard. The IdP does not dictate the hierarchy — it provides the raw groups, and the admin maps them.

**Org creation from WorkOS:**
- On first WorkOS login, if no org exists with that `workosOrgId`, create one automatically.
- Use the WorkOS organization name directly as the org name.
- Generate `slug` via kebab-case transformation of the org name with a collision suffix (e.g., `acme-corp`, `acme-corp-2`) if needed.
- Seed data (Acme Corp) can optionally be linked to a WorkOS org for demo purposes.

**SCIM idempotency — dual strategy:**
- **Event ID dedup table:** New `workos_processed_events` table stores event IDs. Before processing any webhook event, check this table — if the event ID exists, skip processing and return 200.
- **Natural idempotency:** All write operations use upserts (INSERT ... ON CONFLICT DO UPDATE) so that replayed events produce the same result.
- Both strategies combined ensure safe webhook replay without side effects.

**Environment variables:**
- `WORKOS_API_KEY` — WorkOS API key
- `WORKOS_CLIENT_ID` — WorkOS client ID for AuthKit
- `WORKOS_WEBHOOK_SECRET` — webhook signature verification
- `INTERNAL_API_SECRET` — shared secret for sidecar-to-API authentication on `/check` endpoint

### What Stays Unchanged

Envelope resolver, Cedar evaluation, policy CRUD API shapes, policy assignments, group hierarchy logic, sidecar, storefront SDK. The dashboard pages (policies, agents, groups, petitions) all work — they just now show org-scoped data behind a login.

### Schema Changes

```sql
-- Migration: 0001_phase1_workos

ALTER TABLE organizations ADD COLUMN workos_org_id TEXT UNIQUE;
ALTER TABLE organizations ADD COLUMN workos_directory_id TEXT;

-- Update nodeType CHECK constraint to include 'unassigned'
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_node_type_check;
ALTER TABLE groups ADD CONSTRAINT groups_node_type_check
  CHECK (node_type IN ('org', 'department', 'team', 'unassigned'));

CREATE TABLE workos_processed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now()
);

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
- Auth on `/check`: valid `X-Internal-Token` header -> 200; missing/invalid header -> 401
- `/health` endpoint: no auth required -> 200
- Directory Sync webhook: group created event -> group appears in `groups` table with `nodeType = 'unassigned'`
- Directory Sync webhook: duplicate event ID -> skipped (idempotency)
- Directory Sync webhook: user suspended event -> recorded (used in Phase 2 for agent lifecycle)
- Org creation: first login creates org with kebab-case slug; second org with same name gets collision suffix
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
  seed: Uint8Array;          // Ed25519 seed (returned to admin, stored encrypted)
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
  depth: number;             // lineage depth (max 5)
  createdAt: string;
  signature: string;         // parent signs this record
}

// Generate a new agent identity from a seed
export function createAgentIdentity(): AgentIdentity;

// Derive agent ID from public key (deterministic)
export function deriveAgentId(publicKey: Uint8Array): string;

// Derive DID from public key (backward compatible with sidecar)
export function deriveDid(publicKey: Uint8Array): string;
```

Uses `@noble/ed25519` for key generation (same algorithm as the existing sidecar but in TypeScript).

**Key management — seed-based derivation:**
- Agent identity is derived from an Ed25519 seed, not a random keypair.
- The seed is stored encrypted in the `agent_key_seeds` table. Encryption uses HKDF key derivation: `HKDF(AGENT_SEED_ENCRYPTION_KEY, org_id)` produces a per-org encryption key.
- Seeds are re-downloadable by org admins from the dashboard (not one-time-only).
- Dashboard shows seed in two formats: modal display + `.env` file download. An "I have saved this seed" checkbox is required before dismissing the modal.

**Lineage depth limit:**
- Hard limit of 5 levels enforced at agent creation time.
- If creating an agent whose lineage would exceed 5 levels, the API returns a 400 error with a clear message.
- This limit applies structurally — agent-spawns-agent (deferred) will also be subject to it.

**Sponsor envelope — synthetic agent_did for WorkOS users:**
- WorkOS `om_*` IDs are mapped to synthetic `agent_did` values in `agentGroupMemberships`. This allows the existing `resolveEnvelope()` function to work unchanged for human sponsors.
- The seam creates a synthetic DID entry for the WorkOS membership so that the envelope resolution chain works: human sponsor -> synthetic DID -> group membership -> policy assignments -> resolved envelope.

**Narrowing invariant enforcement:**
- When an admin assigns policies to an agent, the system validates that the agent's effective envelope is a subset of the sponsor's envelope.
- Constraint value comparison rules:
  - **Numeric:** child value <= parent value
  - **Set:** child set is a subset of parent set
  - **Boolean:** child can only be more restrictive (e.g., `requires_approval: true` when parent has `false`)
  - **Temporal:** child window <= parent window
  - **Rate:** child rate <= parent rate
- On violation, the error message tells the admin which specific dimension failed (e.g., "spending_limit 10000 exceeds sponsor's limit of 5000").

**Agent suspension via Redis:**
- Redis is added in Phase 2 (not Phase 1).
- SCIM webhook writes agent status to Redis: key `{org_id}:status:{agent_id}`, no TTL.
- Both `/check` and `/execute-check` (Phase 5) read Redis status before Cedar evaluation.
- Sub-second propagation: when a user is suspended in the IdP, the webhook fires, Redis is updated, and the agent's next request is denied.

**New schema tables:**

```sql
-- Migration: 0002_phase2_identity

CREATE TABLE agent_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  agent_id TEXT NOT NULL UNIQUE,          -- "agent_<base58(sha256(pubkey))>"
  did TEXT NOT NULL UNIQUE,               -- "did:mesh:<hex>" (backward compat)
  public_key BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active, suspended, revoked
  created_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE agent_key_seeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id),
  encrypted_seed BYTEA NOT NULL,          -- encrypted via HKDF(AGENT_SEED_ENCRYPTION_KEY, org_id)
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id)
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
  depth INTEGER NOT NULL,                  -- lineage depth (max 5)
  signature TEXT NOT NULL,                 -- parent's signature over this record
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT lineage_depth_check CHECK (depth <= 5)
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
2. Compute the sponsor's effective envelope via `resolveEnvelope(db, sponsorDid, orgId)` — where `sponsorDid` is the synthetic DID derived from the WorkOS membership
3. Call `createAgentIdentity()` to generate Ed25519 keypair from seed
4. Validate that the requested policies are a subset of the sponsor's envelope (the narrowing invariant, with per-dimension error messages)
5. Validate lineage depth <= 5
6. Write `agent_identities` record
7. Write `agent_key_seeds` record (encrypted seed)
8. Write `agent_lineage` record with sponsor snapshot
9. Add agent to the requested group via existing `agentGroupMemberships`
10. Assign policies via existing `policyAssignments`
11. Write agent status to Redis: `{org_id}:status:{agent_id}` = `active`
12. Return: `{ agentId, did, publicKey, sidecarConfig: { ED25519_SEED, RULES_ENGINE_URL } }`

The `sidecarConfig` is the `docker run` command the admin uses to deploy the agent's sidecar.

**Extend sidecar:**
- Accept `ED25519_PRIVATE_KEY` env var as an alternative to `ED25519_SEED`. When set, use the provided private key directly instead of deriving from a seed. This supports agent provisioning where the keypair is generated server-side.
- Both `ED25519_SEED` (legacy) and `ED25519_PRIVATE_KEY` (new) work. The sidecar picks whichever is set.

**Dashboard: Agent Provisioning page (`/agents/new`):**
- Form: agent name, select group (dropdown from `GET /api/policies/groups`), select policies (multi-select)
- "Create Agent" button -> `POST /api/agents/create`
- On success: show seed in modal + `.env` file download. "I have saved this seed" checkbox required before dismissal.
- Show sidecar config (copyable `docker run` command), agent ID, DID
- Seed is re-downloadable from the agent detail page (`/agents/[did]`) by org admins.
- Redirect to `/agents/[did]` to see the envelope

**SCIM cascade (from Phase 1 webhooks):**
- `dsync.user.suspended` / `dsync.user.deleted` -> find all agents where `sponsor_user_id` matches -> set `status = 'suspended'` on `agent_identities` -> write suspension to Redis -> sidecar's next authorization check returns denied (sub-second)
- `organization_membership.deleted` -> find all agents where `sponsor_membership_id` matches -> same cascade

### What Stays Unchanged

Envelope resolver, Cedar evaluation, policy model, existing dashboard pages (policies, groups, Cedar viewer, REPL). The existing sidecar works identically for agents deployed with `ED25519_SEED`.

### Tests

- `createAgentIdentity()` generates valid Ed25519 keypair and deterministic agent ID
- `deriveAgentId()` and `deriveDid()` are deterministic (same pubkey -> same ID)
- Seed encryption: encrypt with HKDF-derived key -> decrypt -> matches original seed
- Seed re-download: org admin can retrieve encrypted seed and decrypt it
- `POST /api/agents/create` creates agent + lineage + group membership + policy assignment atomically
- `POST /api/agents/create` rejects policies that exceed sponsor's envelope (with specific dimension in error message)
- `POST /api/agents/create` rejects lineage depth > 5
- Narrowing invariant: numeric <=, set subset, boolean restrictive, temporal <=, rate <= — each tested
- Lineage array is correctly ordered: `[org_id, om_id, agent_id]`
- Sponsor envelope uses synthetic DID for WorkOS om_* membership
- Agent suspension cascades from WorkOS user suspension (writes to Redis)
- Redis status check: suspended agent -> `/check` returns denied
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

**Tables that need `org_id` added:**

- **`agentGroupMemberships`:** Add `org_id` column + Postgres Row-Level Security (RLS) policy. RLS ensures that even if application code misses a WHERE clause, rows from other orgs are invisible.
- **`decisionLog`:** Add `org_id` column (denormalized for query performance). Add index on `(org_id, evaluated_at)`.
- **`actionTypes`:** Add `org_id` column (org-scoped tools). Update unique constraint from `UNIQUE(name)` to `UNIQUE(org_id, name)`. Existing seed data backfilled with Acme Corp `org_id`. New orgs get default tools via a `seedDefaultTools(orgId)` template function.

**No additional migration needed** for policies/decision logs referencing `actionTypeId` — UUIDs don't change when `org_id` is added.

```sql
-- Migration: 0003_phase3_multitenancy

ALTER TABLE agent_group_memberships ADD COLUMN org_id UUID REFERENCES organizations(id);
-- Backfill existing rows
UPDATE agent_group_memberships SET org_id = (
  SELECT org_id FROM groups WHERE groups.id = agent_group_memberships.group_id
);
ALTER TABLE agent_group_memberships ALTER COLUMN org_id SET NOT NULL;

-- RLS on agentGroupMemberships
ALTER TABLE agent_group_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_group_memberships_org_isolation ON agent_group_memberships
  USING (org_id = current_setting('app.current_org_id')::uuid);

ALTER TABLE decision_log ADD COLUMN org_id UUID REFERENCES organizations(id);
-- Backfill from agent lineage or envelope context
CREATE INDEX idx_decision_log_org_evaluated ON decision_log(org_id, evaluated_at);

ALTER TABLE action_types ADD COLUMN org_id UUID REFERENCES organizations(id);
-- Backfill existing seed data with Acme Corp org_id
ALTER TABLE action_types DROP CONSTRAINT IF EXISTS action_types_name_unique;
ALTER TABLE action_types ADD CONSTRAINT action_types_org_name_unique UNIQUE(org_id, name);
```

**Per-org seed data:**
- The existing Acme Corp seed data is one org with its `org_id` backfilled on `actionTypes`.
- New orgs created via WorkOS login get default tools via `seedDefaultTools(orgId)` — a template that copies the standard tool definitions with the new org's `org_id`.
- No policies, no groups (until SCIM syncs), no agents for new orgs beyond the default tools.

**Dashboard org-scoping:**
- All `apiFetch` calls automatically include the session cookie
- API returns only the authenticated org's data
- No UI changes needed — the dashboard already renders whatever the API returns

**Sidecar org-scoping:**
- The sidecar is already one-per-agent. The agent's lineage (from Phase 2) contains the `org_id`. When the sidecar calls `POST /api/policies/check`, the API resolves the agent's org from the lineage and scopes the evaluation.
- No sidecar code changes needed — the scoping happens in the API.

### Tests

- **Existing tests:** Use the seed org (Acme Corp). Auth bypassed in test DB helper. All 370 tests still pass.
- **New `org-isolation.test.ts`** with 7-10 tests:
  - Create two orgs. Create policies in org A. Query from org B -> empty results.
  - Create agent in org A. Resolve envelope -> works. Query from org B -> not found.
  - Decision log entries from org A not visible to org B.
  - Group hierarchy operations in org A don't affect org B.
  - `actionTypes` with same name in two orgs -> both exist (unique constraint is per-org).
  - RLS on `agentGroupMemberships`: direct query without WHERE clause still returns only current org's rows.
  - `seedDefaultTools(orgId)` creates standard tools for new org.

---

## Phase 4: Tool Catalog + Registry MCP

### Goal

Agents discover their available tools via the MCP protocol. The tool manifest hides numeric bounds, rate limits, and temporal windows — agents see tools and enum-constrained parameters, not the rules governing them.

### What Changes

**Extend `actionTypes` table -> Tool Catalog:**

```sql
-- Migration: 0004_phase4_tools

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

**MCP org lookup — new endpoint:**
- `GET /api/agents/:did/envelope` — DID-only lookup. The API resolves the agent's org internally from the agent's lineage record. The MCP server does not need to know or pass the org_id — it sends only the DID.

**New package: `packages/registry-mcp/`**

MCP protocol server using `@modelcontextprotocol/sdk`. Agents connect via MCP, present identity, receive a projected tool manifest.

- **Transport:** Streamable HTTP (not SSE).
- **Deployment:** Separate process. Communicates with the API via HTTP. No direct DB access.

```typescript
// packages/registry-mcp/src/server.ts

import { Server } from "@modelcontextprotocol/sdk/server";

// MCP tool: list_tools
// Agent calls this to discover available tools
// Flow:
// 1. Extract agent identity from DPoP proof in request
// 2. Call GET /api/agents/:did/envelope on the management API (DID-only, org resolved internally)
// 3. Filter tool catalog to tools present in the envelope
// 4. Project parameter schemas:
//    - Set constraints -> enum values in the schema
//    - Numeric bounds -> hidden (agent sees "type: number", not "max: 500")
//    - Temporal windows -> hidden
//    - Rate limits -> completely blind — no hints in manifest whatsoever
//    - Boolean flags (requires_approval) -> hidden
// 5. Return projected tool manifest via MCP
```

**Rate limit visibility: completely blind.** Agents receive no indication that rate limits exist. No headers, no manifest fields, no error message hints. A rate-limited request receives the same opaque denial as any other policy violation.

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
  enum?: string[];           // set constraints -> visible as enum
  // numeric max -> NOT included
  // rate limits -> NOT included
  // temporal windows -> NOT included
}
```

Example: if the envelope says `vendor in {AWS, GCP}` and `amount <= 500`:
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
// Accepts explicit `now` parameter for deterministic testing
export function verifyDPoP(proof: string, expectedUrl: string, now?: number): Promise<DPoPProof>;

// Create a DPoP proof (used by agents/sidecars)
// Accepts explicit `issuedAt` parameter for deterministic testing
export function createDPoP(privateKey: Uint8Array, url: string, issuedAt?: number): Promise<string>;
```

**DPoP minting by sidecar:**
- New sidecar endpoint: `POST /create_dpop_proof` — the sidecar mints DPoP proofs on behalf of the agent using its Ed25519 private key.
- The agent requests a DPoP proof from its sidecar, then presents it to the Registry MCP or API.

**DPoP testing strategy:**
- `createDPoP` and `verifyDPoP` accept explicit `issuedAt`/`now` parameters so tests are fully deterministic — no mocking of `Date.now()` required.

Used by Registry MCP and API proxy (Phase 5). The existing JWT-based sidecar authentication continues to work alongside DPoP — DPoP is for agent->MCP communication, JWT is for agent->vendor communication (storefront SDK).

**Dashboard: Tool Catalog page (`/tools`):**
- List org's tools with parameter schemas
- Create/edit tool definitions
- Shows which policies reference each tool

### Tests

- Registry MCP: agent connects -> receives projected manifest with correct enum values and hidden numeric bounds
- Registry MCP: agent with no permissions -> empty manifest
- Registry MCP: two agents with different policies -> different projections
- Registry MCP: rate limits are completely invisible in manifest (no fields, no hints)
- Projection logic: set constraints become enums, numeric bounds are stripped
- Tool Catalog CRUD: create, update, deprecate (org-scoped)
- DPoP: `createDPoP(key, url, issuedAt)` -> `verifyDPoP(proof, url, now)` round-trip succeeds with explicit timestamps
- DPoP: expired proof rejected; wrong URL rejected; replay rejected
- Sidecar `POST /create_dpop_proof`: returns valid DPoP proof
- `GET /api/agents/:did/envelope`: resolves org internally from DID
- Existing 370 tests still pass

---

## Phase 5: Execution Gateway + Audit Chain

### Goal

The sidecar becomes the execution gate. Agents send tool calls through it. The sidecar verifies identity, checks authorization in real-time (with runtime context), injects platform credentials, forwards to the tool backend, and logs the decision. Full hash-chained audit trail.

### What Changes

**New centralized check endpoint: `POST /api/policies/execute-check`**

All execution gates are centralized in the API (not split between sidecar and API). One HTTP call from the sidecar performs the entire check:

1. Redis status check (is agent suspended?)
2. Rate counter check (Redis)
3. Spend-to-date check (Postgres)
4. Cedar policy evaluation
5. Rate counter increment (on allow)
6. Spend tracking update (on allow)
7. Decision log entry

Response on allow:
```json
{
  "allowed": true,
  "toolBackendUrl": "https://api.openweathermap.org/...",
  "credentials": { "apiKey": "decrypted-org-credential" },
  "auditRef": "decision-log-uuid"
}
```

Response on deny:
```json
{
  "allowed": false,
  "auditRef": "decision-log-uuid"
}
```

The tool URL and credentials are returned in the response — the sidecar does not need to fetch them separately.

**Sidecar endpoint: `POST /execute`**

```python
@app.post("/execute")
async def execute_tool(tool_id: str, parameters: dict):
    # 1. Verify agent identity (existing DPoP or JWT)
    # 2. Call POST /api/policies/execute-check with full runtime context
    #    (single HTTP call — all checks happen server-side)
    # 3. On deny: return opaque refusal to agent
    # 4. On allow:
    #    a. Use returned credentials and tool URL from execute-check response
    #    b. Construct authenticated outbound request
    #    c. Forward to tool backend URL
    #    d. Return response to agent
```

**Sidecar authentication to credentials API:**
- The sidecar authenticates to `/execute-check` using a per-sidecar DPoP proof (not a shared secret).
- Each sidecar mints a DPoP proof using its Ed25519 private key. The API verifies the proof against the agent's registered public key.

**Opaque denials:**
```json
{
  "status": "denied",
  "message": "This action is not available at this time."
}
```

The agent does NOT learn why it was denied. The decision log records the full reason (which constraint failed, which policy applied).

**Platform credentials store with per-org encryption:**

```sql
CREATE TABLE platform_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  tool_id UUID NOT NULL REFERENCES action_types(id),
  credential_type TEXT NOT NULL,           -- "api_key", "oauth2", "service_account"
  encrypted_credentials JSONB NOT NULL,    -- encrypted with per-org HKDF key
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, tool_id)
);
```

- **Encryption:** Per-org HKDF-derived keys. Master key: `CREDENTIAL_ENCRYPTION_KEY` env var (separate from `AGENT_SEED_ENCRYPTION_KEY`). Derived key: `hkdf(sha256, masterKey, orgId, "warranted-credentials-v1", 32)`.
- **Credential rotation:** Always fetch latest credentials on each `/execute-check` call. No caching. When an admin rotates credentials in the dashboard, the next execution automatically uses the new values.
- Agents never see these credentials. The API returns them to the sidecar in the `/execute-check` response, and the sidecar injects them into outbound requests.

**Redis for rate counters:**

Add Redis to `docker-compose.yml`:
```yaml
redis:
  image: redis:7-alpine
  ports: ["6379:6379"]
```

**Rate counters — Lua script for atomic ancestor increment:**
- Per-agent request counts within time windows (hourly, daily).
- A request by a child agent atomically increments counters for every ancestor in the lineage array using a Redis Lua script (single atomic operation).
- Redis keys are org-prefixed:
  - `{org_id}:rate:hourly:{entity_id}` — TTL 3600
  - `{org_id}:rate:daily:{entity_id}` — TTL 86400
  - `{org_id}:status:{agent_id}` — TTL none (from Phase 2)
  - `{org_id}:session:{session_id}` — TTL from session expiry

**Spend tracking — dual-write with reconciliation:**
- **Running balance table:** `agent_spend_balances` — current spend totals per agent, updated in real-time.
- **Spend event log:** `spend_events` — append-only log of every spend event.
- Both written in one Postgres transaction on each allowed execution.
- **Nightly reconciliation:** Background job that verifies `agent_spend_balances` matches the sum of `spend_events`. Alerts on discrepancy.

```sql
CREATE TABLE agent_spend_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  agent_id TEXT NOT NULL,
  period TEXT NOT NULL,                    -- "daily", "monthly"
  period_start TIMESTAMPTZ NOT NULL,
  total_spend NUMERIC(15,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, period, period_start)
);

CREATE TABLE spend_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  agent_id TEXT NOT NULL,
  tool_id UUID NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  decision_log_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Hash-chained audit log:**

Extend existing `decisionLog` table:
```sql
ALTER TABLE decision_log ADD COLUMN prev_hash TEXT;
ALTER TABLE decision_log ADD COLUMN entry_hash TEXT;
ALTER TABLE decision_log ADD COLUMN lineage_path JSONB;
ALTER TABLE decision_log ADD COLUMN runtime_context JSONB;
```

- **Hash chain is computed by a periodic batch job**, NOT at write time. A background job running every 5-10 seconds in the API process chains unlinked entries.
- The background job uses Postgres advisory locks to ensure only one instance runs at a time (safe for multi-process deployments).
- Each entry's `entry_hash = sha256(prev_hash + decision_id + outcome + timestamp + ...)`. The chain is per-org, append-only.
- Tamper-evidence: if any entry is modified, the hash chain breaks.

**Hash chain verification — three mechanisms:**
1. **Dashboard page:** `/audit/chain` — admin can trigger verification and see results.
2. **Hourly background job:** Runs in the API process. Verifies the full chain for each org. Logs results.
3. **API endpoint:** `GET /api/audit/verify-chain` — programmatic verification. Returns chain integrity status.

```sql
CREATE TABLE chain_verification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  verified_at TIMESTAMPTZ DEFAULT now(),
  entries_checked INTEGER NOT NULL,
  chain_valid BOOLEAN NOT NULL,
  first_broken_entry_id UUID,
  verification_method TEXT NOT NULL        -- "dashboard", "background", "api"
);
```

**Legacy compatibility:**
- Phase 5 is a required upgrade. There is no degraded path for sidecars that haven't been updated.
- All sidecars must support `POST /execute` and DPoP authentication to function in a Phase 5 deployment.

**Lineage depth:** Hard limit of 5 levels (same as Phase 2, enforced at creation time).

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

**Dashboard: Audit chain page (`/audit/chain`):**
- Trigger chain verification
- Show verification results: entries checked, chain valid/broken, first broken entry

### Schema Changes (Phase 5)

```sql
-- Migration: 0005_phase5_execution

CREATE TABLE platform_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  tool_id UUID NOT NULL REFERENCES action_types(id),
  credential_type TEXT NOT NULL,
  encrypted_credentials JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, tool_id)
);

CREATE TABLE agent_spend_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  agent_id TEXT NOT NULL,
  period TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  total_spend NUMERIC(15,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, period, period_start)
);

CREATE TABLE spend_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  agent_id TEXT NOT NULL,
  tool_id UUID NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  decision_log_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chain_verification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  verified_at TIMESTAMPTZ DEFAULT now(),
  entries_checked INTEGER NOT NULL,
  chain_valid BOOLEAN NOT NULL,
  first_broken_entry_id UUID,
  verification_method TEXT NOT NULL
);

-- Extend decision_log (org_id and index may already exist from Phase 3)
ALTER TABLE decision_log ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE decision_log ADD COLUMN prev_hash TEXT;
ALTER TABLE decision_log ADD COLUMN entry_hash TEXT;
ALTER TABLE decision_log ADD COLUMN lineage_path JSONB;
ALTER TABLE decision_log ADD COLUMN runtime_context JSONB;
CREATE INDEX IF NOT EXISTS idx_decision_log_org_evaluated ON decision_log(org_id, evaluated_at);
```

Note: `decision_log.org_id` and its index may already exist from Phase 3 migration. The Phase 5 migration uses `IF NOT EXISTS` to handle this safely.

### Tests

- `POST /api/policies/execute-check` with valid identity + within envelope -> returns allowed + tool URL + credentials + auditRef
- `POST /api/policies/execute-check` exceeding numeric cap -> returns denied + auditRef, decision log entry with full reason
- `POST /execute` (sidecar) end-to-end: proxied to mock backend, response returned
- `POST /execute` (sidecar) denied: opaque refusal, no reason leaked to agent
- Sidecar authenticates to execute-check via DPoP proof (not shared secret)
- Rate counter: Lua script atomically increments agent AND all ancestors
- Rate counter: org-prefixed Redis keys with correct TTLs
- Spend tracking: `agent_spend_balances` + `spend_events` written in one transaction
- Spend tracking: nightly reconciliation detects discrepancy
- Hash-chained audit log: batch job chains entries; chain verification passes
- Hash-chained audit log: modified entry breaks chain; verification detects it
- Chain verification: dashboard, background job, and API endpoint all work
- Platform credentials: encrypted with per-org HKDF key, decrypted correctly
- Credential rotation: updated credential is used on next execute-check (no caching)
- Weather tool: end-to-end through sidecar -> execute-check -> credential injection -> OpenWeatherMap -> response
- Legacy sidecar without DPoP -> rejected (no degraded path)
- Existing 370 tests still pass

---

## Deferred (Post-Customer)

| Feature | Trigger | Dependency |
|---|---|---|
| **Instructional MCP** (LLM intent gate, RAG pipeline, capability tokens) | Customer requests natural-language agent interaction | Phase 4 (Registry MCP) + Phase 5 (API proxy) |
| **Content-addressed immutable policies** | Audit/compliance requirement from customer | Current version history + Cedar hash is sufficient until then |
| **Agent-spawns-agent** (sub-agents) | Customer needs autonomous agent hierarchies | Phase 2 lineage array already supports it structurally (depth limit 5) |
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

Redis is an explicit Phase 2 deliverable (agent status cache for SCIM suspension propagation). It is also used in Phase 5 for rate counters and session tracking.

---

## Environment Variables (New)

| Variable | Service | Phase | Description |
|---|---|---|---|
| `WORKOS_API_KEY` | API | 1 | WorkOS API key |
| `WORKOS_CLIENT_ID` | API, Dashboard | 1 | WorkOS AuthKit client ID |
| `WORKOS_WEBHOOK_SECRET` | API | 1 | Webhook signature verification |
| `INTERNAL_API_SECRET` | API, Sidecar | 1 | Shared secret for sidecar -> `/check` auth via `X-Internal-Token` header |
| `REDIS_URL` | API, Sidecar | 2 | Redis connection string |
| `AGENT_SEED_ENCRYPTION_KEY` | API | 2 | Master key for HKDF-based agent seed encryption (derived per-org) |
| `ED25519_PRIVATE_KEY` | Sidecar | 2 | Alternative to ED25519_SEED for provisioned agents |
| `REGISTRY_MCP_PORT` | Registry MCP | 4 | Port for MCP server (default 8200) |
| `CREDENTIAL_ENCRYPTION_KEY` | API | 5 | Master key for HKDF-based credential encryption (separate from seed key) |
| `OPENWEATHERMAP_API_KEY` | Weather tool | 5 | First tool integration credential (stored in platform_credentials) |

---

## Redis Key Namespace

| Key Pattern | TTL | Phase | Description |
|---|---|---|---|
| `{org_id}:rate:hourly:{entity_id}` | 3600 | 5 | Hourly rate counter per entity |
| `{org_id}:rate:daily:{entity_id}` | 86400 | 5 | Daily rate counter per entity |
| `{org_id}:status:{agent_id}` | none | 2 | Agent suspension status from SCIM |
| `{org_id}:session:{session_id}` | from expiry | 5 | Session data |

All keys are org-prefixed to prevent cross-tenant data leakage.

---

## Migration Path

Each phase is independently deployable but must be deployed in order (Phase 1 -> 2 -> 3 -> 4 -> 5). Phase 3 is required before Phase 4 or 5.

- **After Phase 1:** Dashboard requires login. Directory groups sync from IdP (landing as `unassigned`). Policies managed by authenticated admins. Webhooks at `/api/webhooks/workos`. (Same product, real identity.)
- **After Phase 2:** Admins provision agents through the dashboard. Each agent has a verifiable lineage (max depth 5) back to the human who authorized it. Seeds encrypted and re-downloadable. Redis provides sub-second suspension propagation. (Agent provisioning story.)
- **After Phase 3:** Multiple enterprises use the same deployment. Full data isolation with RLS. Org-scoped tools and decision logs. (Multi-tenant SaaS.)
- **After Phase 4:** Agents discover tools via MCP (streamable HTTP). Tool manifests are projected — agents see what they can do, not the rules governing them. Rate limits completely invisible. DPoP for agent authentication. (The tool manifest story.)
- **After Phase 5:** Agents execute tool calls through the sidecar. Single `/execute-check` call centralizes all gates. Credentials injected per-org. Rate limits enforced atomically across lineage. Hash-chained audit log with three verification mechanisms. Required upgrade — no legacy degraded path. (The execution gateway story.)
