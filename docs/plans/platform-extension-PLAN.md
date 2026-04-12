# Platform Extension — Implementation Plan

## Overview

Extend the Warranted platform with enterprise identity (WorkOS), agent provisioning with lineage tracking, multi-tenancy with full org isolation, tool manifest projection via MCP, and an execution gateway with credential injection and rate tracking. Five phases, linear dependency chain, each independently shippable and verifiable.

**Dependency chain:** Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5. Each phase is a prerequisite for the next.

**Service inventory after all phases:** Postgres, API, Sidecar, Dashboard, Redis, Registry MCP (6 services total).

## Design Decisions

All non-trivial design decisions are documented in [platform-extension-DECISIONS.md](./platform-extension-DECISIONS.md) with tradeoff analysis. Key decisions summarized here:

- **Auth pattern:** Hono middleware with selective per-route application. `/check` uses `INTERNAL_API_SECRET` shared secret. `/health` unauthenticated.
- **SCIM handling:** Event ID dedup + natural idempotency (upserts). Groups land as `'unassigned'` nodeType, admin maps in dashboard.
- **Sponsor envelope:** WorkOS `om_*` IDs treated as synthetic agent DIDs in `agentGroupMemberships`. `resolveEnvelope` works unchanged.
- **Key management:** Seed-based derivation with per-org HKDF encryption. Re-downloadable from dashboard.
- **Narrowing invariant:** Constraint value comparison — numeric ≤, set ⊆, boolean restrictive, temporal ≤, rate ≤.
- **Suspension propagation:** Redis status cache with sub-second propagation.
- **Multi-tenancy:** Org-scoped tables with Postgres RLS on `agentGroupMemberships`. `org_id` denormalized on `decisionLog` and `actionTypes`.
- **Registry MCP:** Separate process, Streamable HTTP transport, calls API over HTTP (no DB access).
- **DPoP:** Sidecar mints proofs via `POST /create_dpop_proof`. Explicit `issuedAt` parameters for testing.
- **Execution gateway:** Single `POST /api/policies/execute-check` endpoint centralizes all checks. Response includes tool URL + credentials.
- **Credential encryption:** Per-org HKDF keys from `CREDENTIAL_ENCRYPTION_KEY` master.
- **Rate counters:** Lua script for atomic ancestor increment. Org-prefixed Redis keys.
- **Hash chain:** Periodic batch chaining (5-10s), in-process with advisory locks. All three verification consumers.
- **Spend tracking:** Running balance + event log, both in one transaction.
- **Lineage depth:** Hard limit of 5 levels.
- **Migrations:** One migration per phase.

---

## Phase 1: WorkOS Integration

**Goal:** Replace hardcoded identity with real enterprise SSO. Dashboard requires login. Directory groups sync from IdP into the existing group hierarchy.

### Deliverables

| # | File | Type |
|---|---|---|
| 1 | `apps/api/src/middleware/auth.ts` | WorkOS AuthKit session middleware for management API |
| 2 | `apps/api/src/middleware/internal.ts` | `INTERNAL_API_SECRET` header verification for `/check` |
| 3 | `apps/api/src/webhooks/workos.ts` | SCIM Directory Sync webhook handler |
| 4 | `apps/api/src/index.ts` | Mount webhook routes at `/api/webhooks/workos`, apply auth middleware selectively |
| 5 | `apps/dashboard/src/middleware.ts` | WorkOS AuthKit Next.js middleware (login redirect) |
| 6 | `apps/dashboard/src/app/login/page.tsx` | Login page (WorkOS AuthKit redirect flow) |
| 7 | `packages/rules-engine/src/schema.ts` | Add `workosOrgId`, `workosDirectoryId` to organizations; update `groups` CHECK to include `'unassigned'` |
| 8 | `drizzle/migrations/0001_phase1_workos_integration.sql` | Migration: organizations columns, workos_sync_state table, workos_processed_events table, groups CHECK update |
| 9 | `apps/api/src/routes/policies/organizations.ts` | Update org creation to handle WorkOS first-login auto-create |
| 10 | `apps/dashboard/src/app/groups/setup/page.tsx` | Group Setup page for assigning nodeType to SCIM-synced groups |

### Schema Changes

```sql
-- Organizations: WorkOS binding
ALTER TABLE organizations ADD COLUMN workos_org_id TEXT UNIQUE;
ALTER TABLE organizations ADD COLUMN workos_directory_id TEXT;

-- SCIM sync state
CREATE TABLE workos_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  last_sync_at TIMESTAMPTZ,
  sync_cursor TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Webhook event dedup (idempotency + observability)
CREATE TABLE workos_processed_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TIMESTAMPTZ DEFAULT now()
);

-- Groups: allow 'unassigned' nodeType for SCIM-synced groups
ALTER TABLE groups DROP CONSTRAINT groups_node_type_check;
ALTER TABLE groups ADD CONSTRAINT groups_node_type_check
  CHECK (node_type IN ('org', 'department', 'team', 'unassigned'));
ALTER TABLE groups ALTER COLUMN node_type SET DEFAULT 'unassigned';
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `WORKOS_API_KEY` | Yes | WorkOS API key |
| `WORKOS_CLIENT_ID` | Yes | WorkOS AuthKit client ID |
| `WORKOS_WEBHOOK_SECRET` | Yes | Webhook signature verification |
| `INTERNAL_API_SECRET` | Yes | Shared secret for internal `/check` endpoint |

### Tests

- WorkOS AuthKit mock: middleware extracts `org_id`/`user_id` from session and sets on Hono context
- Auth middleware: authenticated request to `/api/policies/rules` succeeds; unauthenticated redirects to login
- Auth middleware: `/check` without `X-Internal-Token` returns 401; with correct token succeeds
- Auth middleware: `/health` works without any auth
- SCIM webhook: `dsync.group.created` → group appears in `groups` table with `nodeType = 'unassigned'`
- SCIM webhook: `dsync.group.updated` → group updated (upsert)
- SCIM webhook: duplicate event ID → skipped, logged
- SCIM webhook: invalid signature → 401
- Auto-org creation: first WorkOS login creates org with WorkOS name and kebab-case slug
- Auto-org creation: slug collision handled with numeric suffix
- Group Setup page: admin can change nodeType from 'unassigned' to 'department'
- Existing 370 tests still pass (auth middleware is selectively applied, test DB helper bypasses auth)

### Demo Checkpoint

1. Dashboard at `/` redirects to WorkOS login
2. After SSO login, dashboard shows org-scoped data
3. SCIM webhook creates groups in the groups table with `nodeType = 'unassigned'`
4. Admin navigates to Group Setup page and assigns nodeType
5. `/check` endpoint works with `X-Internal-Token` header
6. All existing tests pass

---

## Phase 2: Agent Identity Service + The Seam

**Goal:** Formalize agent creation with cryptographic identity, human-to-agent binding, lineage tracking, and policy narrowing enforcement.

### Deliverables

| # | File | Type |
|---|---|---|
| 1 | `packages/identity/src/index.ts` | Ed25519 keypair generation, agent ID derivation, DID derivation |
| 2 | `packages/identity/src/crypto.ts` | Seed-based key derivation, seed encryption/decryption via HKDF |
| 3 | `packages/identity/src/narrowing.ts` | Constraint value comparison for narrowing invariant |
| 4 | `packages/identity/package.json` | Package configuration |
| 5 | `packages/rules-engine/src/schema.ts` | Add `agent_identities`, `agent_lineage`, `agent_key_seeds` tables |
| 6 | `drizzle/migrations/0002_phase2_agent_identity.sql` | Migration: agent tables, Redis to compose |
| 7 | `apps/api/src/routes/agents/index.ts` | Agent CRUD routes |
| 8 | `apps/api/src/routes/agents/create.ts` | `POST /api/agents/create` — the seam (identity + policy binding in one atomic operation) |
| 9 | `apps/api/src/routes/agents/seed-download.ts` | `GET /api/agents/:did/seed` — re-download encrypted seed (org admin only) |
| 10 | `apps/api/src/index.ts` | Mount agent routes at `/api/agents` |
| 11 | `apps/dashboard/src/app/agents/new/page.tsx` | Agent provisioning form |
| 12 | `apps/dashboard/src/components/SeedModal.tsx` | Seed display modal with copy + .env download + confirmation |
| 13 | `apps/dashboard/src/app/agents/[did]/page.tsx` | Agent detail page (envelope, lineage, status) |
| 14 | `docker-compose.yml` | Add Redis service |
| 15 | `docker-compose.production.yml` | Add Redis service |
| 16 | `sidecar/server.py` | Accept `ED25519_PRIVATE_KEY` env var as alternative to `ED25519_SEED` |
| 17 | `apps/api/src/webhooks/workos.ts` | Extend: user suspension → cascade to agent suspension via Redis |

### Schema Changes

```sql
CREATE TABLE agent_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  agent_id TEXT NOT NULL UNIQUE,
  did TEXT NOT NULL UNIQUE,
  public_key BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE agent_lineage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id),
  parent_id TEXT NOT NULL,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('user', 'agent')),
  sponsor_user_id TEXT NOT NULL,
  sponsor_membership_id TEXT NOT NULL,
  sponsor_role_at_creation TEXT,
  sponsor_envelope_snapshot JSONB NOT NULL,
  lineage JSONB NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_key_seeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id) UNIQUE,
  encrypted_seed BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `REDIS_URL` | Yes | Redis connection string (default `redis://localhost:6379`) |
| `AGENT_SEED_ENCRYPTION_KEY` | Yes | Master key for HKDF-derived per-org seed encryption |

### Tests

- `createAgentIdentity()` generates valid Ed25519 keypair and deterministic agent ID
- `deriveAgentId()` and `deriveDid()` are deterministic (same pubkey → same ID)
- Seed encryption round-trip: encrypt with org key, decrypt with same key, derive same keypair
- Different orgs derive different encryption keys from the same master key
- `POST /api/agents/create` creates agent + lineage + group membership + policy assignment atomically
- `POST /api/agents/create` rejects policies exceeding sponsor's envelope (numeric, set, boolean, temporal, rate)
- Narrowing error message includes specific dimension and ceiling value
- Lineage array is correctly ordered: `[org_id, om_id, agent_id]`
- Lineage depth > 5 rejected at creation time
- Agent suspension cascades from WorkOS user suspension via Redis
- Redis status key written on suspension, read on `/check`
- Sidecar accepts `ED25519_PRIVATE_KEY` env var and derives correct DID
- Seed re-download: org admin can retrieve, non-admin cannot
- Synthetic om_* DID in agentGroupMemberships: resolveEnvelope works for user DIDs
- Existing 370 tests still pass

### Demo Checkpoint

1. Admin logs in, navigates to `/agents/new`
2. Fills in agent name, selects group, selects policies
3. Creates agent → modal shows seed, docker run command, .env download
4. Agent ID and DID displayed
5. Navigate to `/agents/[did]` → shows envelope, lineage chain
6. Suspend user in IdP → SCIM webhook → agent status changes to suspended in Redis → next `/check` call denied

---

## Phase 3: Multi-Tenancy + Org Isolation

**Goal:** Every query scoped by `org_id`. Two organizations cannot see or affect each other's data.

### Deliverables

| # | File | Type |
|---|---|---|
| 1 | `packages/rules-engine/src/schema.ts` | Add `org_id` to `agentGroupMemberships`, `actionTypes`, `decisionLog`; update unique constraints |
| 2 | `drizzle/migrations/0003_phase3_multi_tenancy.sql` | Migration: add org_id columns, backfill, RLS policies, constraint updates |
| 3 | `apps/api/src/routes/policies/rules.ts` | Add `.where(eq(...orgId, orgId))` |
| 4 | `apps/api/src/routes/policies/groups.ts` | Add org-scoping |
| 5 | `apps/api/src/routes/policies/assignments.ts` | Add org-scoping |
| 6 | `apps/api/src/routes/policies/envelope.ts` | Add org-scoping |
| 7 | `apps/api/src/routes/policies/decisions.ts` | Add org-scoping |
| 8 | `apps/api/src/routes/policies/check.ts` | Derive org from agent identity for internal check |
| 9 | `apps/api/src/routes/policies/action-types.ts` | Add org-scoping |
| 10 | `apps/api/src/routes/policies/petitions.ts` | Add org-scoping |
| 11 | `apps/api/src/routes/policies/organizations.ts` | Scope to authenticated org |
| 12 | `apps/api/__tests__/org-isolation.test.ts` | Cross-org isolation test suite (7-10 tests) |
| 13 | `packages/rules-engine/src/seed.ts` | Update seed to use `seedDefaultTools(db, orgId)` pattern |

### Schema Changes

```sql
-- agentGroupMemberships: add org_id + RLS
ALTER TABLE agent_group_memberships ADD COLUMN org_id UUID REFERENCES organizations(id);
-- Backfill from groups table
UPDATE agent_group_memberships agm SET org_id = g.org_id
  FROM groups g WHERE agm.group_id = g.id;
ALTER TABLE agent_group_memberships ALTER COLUMN org_id SET NOT NULL;

-- Postgres RLS on agentGroupMemberships
ALTER TABLE agent_group_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY agm_org_isolation ON agent_group_memberships
  USING (org_id = current_setting('app.current_org_id')::uuid);

-- actionTypes: add org_id, change unique constraint
ALTER TABLE action_types ADD COLUMN org_id UUID REFERENCES organizations(id);
UPDATE action_types SET org_id = '00000000-0000-0000-0000-000000000001'; -- Acme Corp
ALTER TABLE action_types ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE action_types DROP CONSTRAINT action_types_name_key;
ALTER TABLE action_types ADD CONSTRAINT action_types_org_name_unique UNIQUE(org_id, name);

-- decisionLog: add org_id
ALTER TABLE decision_log ADD COLUMN org_id UUID REFERENCES organizations(id);
-- Backfill from agent_identities (if exists) or default org
ALTER TABLE decision_log ALTER COLUMN org_id SET NOT NULL;
CREATE INDEX decision_log_org_time_idx ON decision_log(org_id, evaluated_at);
```

### Tests

- Create two orgs (Org A, Org B)
- Create policies in Org A → query from Org B returns empty
- Create agent in Org A, resolve envelope → works
- Query agent from Org B → not found
- Decision log entries from Org A not visible to Org B
- Group operations in Org A don't appear in Org B
- actionTypes in Org A not visible to Org B
- Petition in Org A not visible to Org B
- Existing 370 tests still pass (using seed org, auth bypassed in test helper)

### Demo Checkpoint

1. Log in as Org A admin → see Org A's policies, agents, groups
2. Log in as Org B admin → see empty state (no policies, no agents)
3. Create policy in Org A → verify Org B sees nothing
4. Create agent in Org A → resolve envelope → works from Org A, not found from Org B
5. Decision log from Org A scoped correctly

---

## Phase 4: Tool Catalog + Registry MCP

**Goal:** Agents discover available tools via MCP. Tool manifests are projected — agents see tools and enum-constrained parameters, not rules.

### Deliverables

| # | File | Type |
|---|---|---|
| 1 | `packages/rules-engine/src/schema.ts` | Extend `actionTypes`: `parameterSchema`, `toolBackendUrl`, `permissionCategory`, `status`, `description` |
| 2 | `drizzle/migrations/0004_phase4_tool_catalog.sql` | Migration: actionTypes extensions |
| 3 | `apps/api/src/routes/tools/index.ts` | Tool Catalog CRUD (POST, GET, PUT, DELETE) — org-scoped |
| 4 | `apps/api/src/routes/agents/envelope.ts` | `GET /api/agents/:did/envelope` — DID-only, API resolves org internally |
| 5 | `apps/api/src/index.ts` | Mount tool routes at `/api/tools`, agent envelope route at `/api/agents` |
| 6 | `packages/shared/dpop/src/index.ts` | DPoP proof creation and verification library |
| 7 | `packages/shared/dpop/src/types.ts` | DPoP types |
| 8 | `packages/shared/dpop/package.json` | Package configuration |
| 9 | `packages/registry-mcp/src/server.ts` | MCP server with Streamable HTTP transport |
| 10 | `packages/registry-mcp/src/projection.ts` | Envelope → projected tool manifest logic |
| 11 | `packages/registry-mcp/src/dpop-auth.ts` | DPoP verification for incoming MCP requests |
| 12 | `packages/registry-mcp/package.json` | Package configuration |
| 13 | `packages/registry-mcp/Dockerfile` | Docker build for Registry MCP service |
| 14 | `sidecar/server.py` | Add `POST /create_dpop_proof` endpoint |
| 15 | `docker-compose.yml` | Add Registry MCP service |
| 16 | `docker-compose.production.yml` | Add Registry MCP service |
| 17 | `apps/dashboard/src/app/tools/page.tsx` | Tool Catalog dashboard page |
| 18 | `apps/dashboard/src/app/tools/[id]/page.tsx` | Tool detail page |

### Schema Changes

```sql
ALTER TABLE action_types ADD COLUMN parameter_schema JSONB;
ALTER TABLE action_types ADD COLUMN permission_category TEXT;
ALTER TABLE action_types ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE action_types ADD COLUMN description TEXT;
ALTER TABLE action_types ADD COLUMN tool_backend_url TEXT;
```

### Environment Variables

| Variable | Required | Service | Description |
|---|---|---|---|
| `REGISTRY_MCP_PORT` | No | Registry MCP | Port for MCP server (default 8200) |
| `API_URL` | Yes | Registry MCP | URL of the management API |

### Tests

- DPoP: `createDPoP` + `verifyDPoP` round-trip with explicit `issuedAt` and `now`
- DPoP: expired proof rejected (`now` > `issuedAt` + `maxAge`)
- DPoP: wrong URL rejected (URL mismatch)
- DPoP: nonce uniqueness enforced
- Projection: set constraints → enum values in projected schema
- Projection: numeric bounds stripped from projected schema
- Projection: rate limits not present in projected schema
- Projection: temporal constraints not present in projected schema
- Projection: boolean flags not present in projected schema
- Registry MCP: agent connects with valid DPoP → receives projected manifest
- Registry MCP: agent with no permissions → empty manifest
- Registry MCP: two agents with different policies → different projections
- Registry MCP: invalid DPoP → 401
- `GET /api/agents/:did/envelope`: returns envelope for valid DID, 404 for unknown DID
- Tool Catalog CRUD: create, list, update, deprecate (all org-scoped)
- Sidecar `POST /create_dpop_proof`: returns valid DPoP proof for target URL
- Existing 370 tests still pass

### Demo Checkpoint

1. Admin creates tools in Tool Catalog dashboard
2. Agent's sidecar creates DPoP proof: `POST /create_dpop_proof`
3. Agent connects to Registry MCP with DPoP proof
4. MCP returns projected manifest — set constraints visible as enums, numeric bounds hidden
5. Two agents with different policies see different tool manifests
6. Tool detail page shows parameter schema and which policies reference the tool

---

## Phase 5: API Proxy as Sidecar Extension

**Goal:** Sidecar becomes the execution gate. Agents send tool calls through it. Sidecar verifies identity, checks authorization with runtime context, injects credentials, forwards to tool backend, logs the decision.

### Deliverables

| # | File | Type |
|---|---|---|
| 1 | `packages/rules-engine/src/schema.ts` | Add `platform_credentials`, `agent_spend_balances`, `spend_events`, extend `decisionLog` |
| 2 | `drizzle/migrations/0005_phase5_execution_gateway.sql` | Migration: all Phase 5 tables and columns |
| 3 | `apps/api/src/routes/policies/execute-check.ts` | `POST /api/policies/execute-check` — centralized enforcement |
| 4 | `apps/api/src/routes/audit/verify-chain.ts` | `GET /api/audit/verify-chain` — chain verification API endpoint |
| 5 | `apps/api/src/routes/tools/credentials.ts` | Credential CRUD (create, update, delete — encrypted) |
| 6 | `apps/api/src/lib/crypto.ts` | AES-256-GCM encryption with HKDF per-org key derivation |
| 7 | `apps/api/src/lib/rate-counter.ts` | Redis Lua script for atomic lineage counter increment |
| 8 | `apps/api/src/lib/spend-tracker.ts` | Spend balance + event log writer |
| 9 | `apps/api/src/lib/hash-chain.ts` | Periodic batch chaining logic + advisory lock |
| 10 | `apps/api/src/lib/chain-verifier.ts` | `verifyChain(db, orgId)` — core verification function |
| 11 | `apps/api/src/index.ts` | Mount execute-check, audit routes; start background chaining job |
| 12 | `sidecar/server.py` | Add `POST /execute` endpoint — DPoP auth, call execute-check, inject credentials, forward |
| 13 | `packages/tools/weather/src/index.ts` | Weather tool backend (OpenWeatherMap wrapper) |
| 14 | `packages/tools/weather/package.json` | Package configuration |
| 15 | `apps/dashboard/src/app/tools/[id]/credentials/page.tsx` | Credential management page |
| 16 | `apps/dashboard/src/app/audit/chain/page.tsx` | Hash chain verification dashboard page |
| 17 | `docker-compose.yml` | Add weather tool backend service (for demo) |

### Schema Changes

```sql
-- Platform credentials (encrypted at rest via HKDF per-org keys)
CREATE TABLE platform_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  tool_id UUID NOT NULL REFERENCES action_types(id),
  credential_type TEXT NOT NULL,
  encrypted_credentials BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, tool_id)
);

-- Spend tracking: running balance (fast reads)
CREATE TABLE agent_spend_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  entity_id TEXT NOT NULL,
  window TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  current_spend NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, entity_id, window, window_start)
);

-- Spend tracking: event log (audit trail / source of truth)
CREATE TABLE spend_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  agent_id TEXT NOT NULL,
  decision_id UUID NOT NULL,
  tool_id UUID NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Hash-chained audit log extensions
ALTER TABLE decision_log ADD COLUMN prev_hash TEXT;
ALTER TABLE decision_log ADD COLUMN entry_hash TEXT;
ALTER TABLE decision_log ADD COLUMN lineage_path JSONB;
ALTER TABLE decision_log ADD COLUMN runtime_context JSONB;

-- Chain verification log
CREATE TABLE chain_verification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  verified_at TIMESTAMPTZ DEFAULT now(),
  chain_intact BOOLEAN NOT NULL,
  entries_verified INTEGER NOT NULL,
  broken_at_entry UUID,
  verification_source TEXT NOT NULL -- 'background', 'dashboard', 'api'
);
```

### Environment Variables

| Variable | Required | Service | Description |
|---|---|---|---|
| `CREDENTIAL_ENCRYPTION_KEY` | Yes | API | Master key for HKDF per-org credential encryption |
| `OPENWEATHERMAP_API_KEY` | No | Weather tool | First tool integration credential (for demo) |

### Tests

- `POST /execute-check` with valid DPoP + within envelope → allow with toolBackendUrl and credentials
- `POST /execute-check` exceeding numeric cap → deny, decision log entry with full reason
- `POST /execute-check` rate limit exceeded → deny, opaque refusal
- `POST /execute-check` agent suspended → deny before Cedar evaluation
- Rate counter Lua script: increments all ancestors atomically
- Rate counter: TTL set correctly (3600 for hourly, 86400 for daily)
- Spend tracking: balance updated + event logged in one transaction
- Spend tracking: balance exceeding limit → deny
- Spend tracking: nightly reconciliation recomputes from event log
- Hash chain: entries chained every 5-10s by background job
- Hash chain: advisory lock prevents duplicate chaining across replicas
- Hash chain verification: intact chain returns `chain_intact: true`
- Hash chain verification: modified entry detected, `broken_at_entry` populated
- Chain verification: dashboard, background, and API all call `verifyChain()`
- Credential encryption: round-trip encrypt/decrypt with HKDF per-org key
- Credential encryption: different orgs produce different ciphertext for same plaintext
- Credential rotation: update credential → next execute-check returns new one
- Sidecar `POST /execute`: calls execute-check, injects credentials, forwards to tool backend
- Sidecar `POST /execute`: denied request returns opaque message, no constraint details
- Sidecar DPoP auth to credentials API: valid proof → credentials returned, invalid → 403
- Weather tool: end-to-end through sidecar → execute-check → credential injection → OpenWeatherMap → response
- Existing 370 tests still pass

### Demo Checkpoint

1. Admin uploads OpenWeatherMap API key in dashboard `/tools/[id]/credentials`
2. Agent calls sidecar `POST /execute` with tool_id and parameters
3. Sidecar calls `/execute-check` → allowed → gets tool URL + credentials
4. Sidecar forwards to weather backend with injected API key
5. Response returned to agent
6. Decision log entry created with runtime context
7. Rate counter incremented for agent + all ancestors
8. Spend balance updated
9. Navigate to `/audit/chain` → click "Verify Integrity" → green checkmark
10. Exceed rate limit → next request denied with opaque message
11. Decision log shows full denial reason (admin can see, agent cannot)

---

## Redis Key Namespace

```
# Rate counters (TTL = window duration)
{org_id}:rate:hourly:{entity_id}    TTL 3600
{org_id}:rate:daily:{entity_id}     TTL 86400

# Agent status (no TTL — explicit delete on reactivation)
{org_id}:status:{agent_id}          Values: "active", "suspended", "revoked"

# Sessions (TTL from session expiry)
{org_id}:session:{session_id}       TTL from session.expires_at
```

Rate counter Lua script (atomic ancestor increment):
```lua
for i, key in ipairs(KEYS) do
  redis.call('INCR', key)
  redis.call('EXPIRE', key, ARGV[1])
end
return true
```

---

## New Packages

| Package | Phase | Description |
|---|---|---|
| `packages/identity/` | 2 | Ed25519 keypair generation, agent ID derivation, seed encryption, narrowing validation |
| `packages/shared/dpop/` | 4 | DPoP proof creation and verification library |
| `packages/registry-mcp/` | 4 | MCP protocol server for tool manifest projection |
| `packages/tools/weather/` | 5 | Weather tool backend (first integration) |

---

## Environment Variables (All Phases)

| Variable | Phase | Service | Description |
|---|---|---|---|
| `WORKOS_API_KEY` | 1 | API | WorkOS API key |
| `WORKOS_CLIENT_ID` | 1 | API, Dashboard | WorkOS AuthKit client ID |
| `WORKOS_WEBHOOK_SECRET` | 1 | API | Webhook signature verification |
| `INTERNAL_API_SECRET` | 1 | API, Sidecar | Shared secret for `/check` endpoint |
| `REDIS_URL` | 2 | API | Redis connection string |
| `AGENT_SEED_ENCRYPTION_KEY` | 2 | API | Master key for per-org seed encryption |
| `REGISTRY_MCP_PORT` | 4 | Registry MCP | MCP server port (default 8200) |
| `API_URL` | 4 | Registry MCP | Management API URL |
| `CREDENTIAL_ENCRYPTION_KEY` | 5 | API | Master key for per-org credential encryption |
| `OPENWEATHERMAP_API_KEY` | 5 | Weather tool | Demo tool integration |

---

## Open Questions

1. **WorkOS AuthKit Next.js version compatibility:** The `@workos-inc/authkit-nextjs` package needs to be verified against the project's Next.js 16 version. Check for breaking changes.

2. **RLS and Drizzle ORM:** Postgres RLS requires setting `app.current_org_id` via `SET` before queries. Drizzle's connection pool needs to set this per-request. Verify this works with `postgres.js` driver. Alternative: enforce org_id via application-level WHERE clauses only, skip RLS.

3. **Cedar WASM and `@noble/ed25519` compatibility:** The identity package uses `@noble/ed25519` for key generation. Verify the generated keys are compatible with the sidecar's `cryptography` library Ed25519 implementation (same DID derivation from same seed).

4. **MCP SDK Streamable HTTP transport maturity:** The Streamable HTTP transport is newer than SSE. Verify it's stable in the `@modelcontextprotocol/sdk` version available. Fallback: SSE transport.

5. **Background chaining job interval tuning:** The 5-10 second interval for batch chaining needs load testing. At high throughput, the job may fall behind. Consider adaptive interval based on unchained entry count.

6. **Spend reconciliation job scheduling:** The nightly reconciliation job for spend balances needs a scheduling mechanism. Options: cron via OS, Postgres-based scheduler, or a simple setInterval with advisory lock (same pattern as chaining).

7. **Weather tool backend deployment:** The weather tool is the first integration. Should it run as a standalone service in Docker Compose, or as a function within the API server? Standalone is cleaner (separate service per tool) but adds a service.

---

## References

- [Platform Extension Specification](./platform-extension-SPEC.md) — source of truth
- [Platform Extension Decisions](./platform-extension-DECISIONS.md) — all design decisions with tradeoffs
- [Rules Engine Plan](./rules-engine-PLAN.md) — format reference
- [Enterprise Packaging Plan](./enterprise-packaging-PLAN.md) — format reference
- [CLAUDE.md](../../CLAUDE.md) — project conventions
