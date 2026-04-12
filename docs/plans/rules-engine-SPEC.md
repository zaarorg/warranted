# Rules Engine — Specification

## Overview

The Warranted Rules Engine (`packages/rules-engine/`) is a TypeScript policy evaluation and management library that replaces the existing Rust/Kotlin rules engine and the hardcoded authorization checks in both the storefront SDK (`verifyAuthorization()`, steps 7-10) and the Python governance sidecar (`/check_authorization`). It implements an Active Directory-style group policy model for AI agents using Cedar authorization policies evaluated via WASM, with an envelope model where constraints can only narrow (never widen) as they cascade down the group hierarchy.

This is **not** a new service. It is a library (`packages/rules-engine/`) consumed by the existing Hono API server (`apps/api/`) and the storefront SDK (`packages/storefront-sdk/`). Policy management routes are added to `apps/api/routes/policies/`. Dashboard pages are added to `apps/dashboard/`.

### What This Replaces

| Current component | Location | Replaced by |
|---|---|---|
| `verifyAuthorization()` steps 7-10 | `storefront-sdk/src/verify.ts:111-163` | Two-phase check: fast local JWT claims check + authoritative Cedar evaluation |
| `/check_authorization` endpoint | `sidecar/server.py:136-159` | Sidecar proxies to rules engine `POST /check` |
| `/sign_transaction` authorization gate | `sidecar/server.py:163-191` | Sidecar calls rules engine before signing (coupled sign-if-approved) |
| `spending-policy.yaml` | `sidecar/policies/spending-policy.yaml` | Policies stored in Postgres only. YAML is deleted. Seed migration loads initial data. |
| Hardcoded `SPENDING_LIMIT`, `APPROVED_VENDORS`, `PERMITTED_CATEGORIES` | `sidecar/server.py:64-66` | Resolved from agent's effective envelope via group hierarchy |

### What This Preserves

- **Identity verification (steps 1-6)** — unchanged in `verify.ts` and `middleware.ts`
- **Ed25519 crypto, DID, trust scoring** — unchanged in sidecar
- **Registry client interface** — rules engine references registry agents by DID, no separate agent table
- **JWT token hierarchy** — unchanged in `packages/registry/`
- **Storefront SDK external API** — same error codes, same HTTP responses for agents

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        apps/api/ (Hono)                         │
│                                                                 │
│  routes/policies/   ← Management API (CRUD, assignments,       │
│                       versioning, petitions)                    │
│  routes/decisions/  ← Decision log query API                   │
│                                                                 │
│  middleware/auth    ← Internal-only (deferred: entity-scoped   │
│                       JWT when exposed externally)             │
├─────────────────────────────────────────────────────────────────┤
│                   packages/rules-engine/ (library)              │
│                                                                 │
│  evaluator.ts      ← Cedar WASM in-process evaluation          │
│  envelope.ts       ← Envelope resolution (recursive CTE)       │
│  cedar-gen.ts      ← Structured constraints → Cedar source     │
│  entity-store.ts   ← Cedar entity store (batch sync)           │
│  cache.ts          ← Envelope cache interface (no-op default)  │
│  petition.ts       ← Petition data model + API stubs (impl    │
│                      deferred post-demo)                       │
│  schema.ts         ← Drizzle schema (fresh, no ltree)          │
│  types.ts          ← All TypeScript interfaces + Zod schemas   │
│  errors.ts         ← Engine-specific error codes                │
│                                                                 │
│  cedar.wasm        ← Pre-built Cedar WASM artifact (checked in)│
├─────────────────────────────────────────────────────────────────┤
│              packages/storefront-sdk/ (unchanged API)           │
│                                                                 │
│  verify.ts         ← Two-phase: fast local + engine check      │
│  middleware.ts     ← Unchanged (steps 1-6)                     │
├─────────────────────────────────────────────────────────────────┤
│                   sidecar/ (Python, reduced scope)              │
│                                                                 │
│  /check_authorization → proxy to rules engine                  │
│  /sign_transaction    → rules engine check, then sign           │
│  /check_identity      → unchanged                              │
│  /issue_token         → unchanged                              │
├─────────────────────────────────────────────────────────────────┤
│                   apps/dashboard/ (Next.js)                     │
│                                                                 │
│  policies/         ← Policy CRUD, Cedar source viewer,         │
│                      version history                           │
│  agents/[id]/      ← Envelope visualization, REPL tester       │
│  groups/           ← Group hierarchy management                │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Cedar WASM in-process** — The `cedar-policy` crate is compiled to WASM and loaded in Bun. No Rust sidecar, no HTTP hop. Sub-millisecond evaluation. Pre-built `.wasm` artifact checked into the repo. Fallback: thin Rust sidecar if WASM has blockers.

2. **Library, not service** — `packages/rules-engine/` exports functions and classes. It has no HTTP server. Management routes live in `apps/api/routes/policies/`. Evaluation is called in-process by the storefront SDK and sidecar proxy.

3. **Registry agents are the source of truth** — The rules engine does not maintain its own agent table. Group memberships and policy assignments reference agents by DID (FK to `packages/registry/` agent records).

4. **Adjacency list hierarchy** — Groups use `parent_id` FK instead of ltree. Ancestor/descendant queries use Postgres recursive CTEs. No extensions required. Drizzle handles it natively.

5. **Cedar source is a contract** — Generated Cedar source is deterministic, stored in `policy_versions.cedar_source`, exposed in the dashboard, and snapshot-tested. The `bundle_hash` in decision logs proves exactly which rules governed each decision.

6. **Atomic policy mutations** — Policy version creation, Cedar generation, validation, entity store rebuild, bundle hash recalculation, and cache invalidation happen within a single DB transaction. No partial states.

7. **Caller provides runtime state** — The rules engine is pure evaluation. Stateful context (`spend_last_24h`, `transactions_last_hour`) is computed by the caller (storefront SDK queries the ledger) and passed in the check request.

8. **Two-phase authorization** — The storefront SDK does a fast local check from JWT claims (fail-fast for obvious violations). If it passes, the rules engine does the authoritative check with full envelope resolution. Phase gap: if local passes but engine denies, the response includes a retry hint suggesting the agent refresh its token.

9. **YAML is deleted** — Policies are stored only in Postgres. The existing `spending-policy.yaml` becomes a one-time seed migration script.

---

## Database Schema (Drizzle)

All tables defined in `packages/rules-engine/src/schema.ts`. Fresh Drizzle schema — no ltree extension, no Flyway dependency. Custom Postgres enums via `pgEnum`.

### Enums

```typescript
export const domainEnum = pgEnum("domain", [
  "finance",
  "communication",
  "agent_delegation",
]);

export const policyEffectEnum = pgEnum("policy_effect", [
  "allow",
  "deny",
]);

export const dimensionKindEnum = pgEnum("dimension_kind", [
  "numeric",
  "rate",
  "set",
  "boolean",
  "temporal",
]);

export const decisionOutcomeEnum = pgEnum("decision_outcome", [
  "allow",
  "deny",
  "not_applicable",
  "error",
]);

export const petitionStatusEnum = pgEnum("petition_status", [
  "pending",
  "approved",
  "denied",
  "expired",
  "cancelled",
]);
```

### Tables

**`organizations`** — Multi-tenant root
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | `gen_random_uuid()` |
| `name` | TEXT | UNIQUE |
| `slug` | TEXT | UNIQUE |
| `policyVersion` | INTEGER | Global version counter, incremented on any policy mutation. Default 0. |
| `createdAt` | TIMESTAMPTZ | |

**`groups`** — Hierarchical group tree via adjacency list
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `orgId` | UUID (FK → organizations) | CASCADE delete |
| `name` | TEXT | |
| `nodeType` | TEXT | CHECK: `'org'`, `'department'`, `'team'` |
| `parentId` | UUID (FK → groups, nullable) | Self-referencing. Null = root group. |
| `createdAt` | TIMESTAMPTZ | |

UNIQUE constraint on `(orgId, name, parentId)`.

**`agent_group_memberships`** — Many-to-many: registry agent DID ↔ group
| Column | Type | Notes |
|--------|------|-------|
| `agentDid` | TEXT (PK) | References registry agent DID. Not a FK (cross-package). |
| `groupId` | UUID (PK, FK → groups) | CASCADE delete |

**`action_types`** — Typed agent actions (14 seeded)
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `domain` | domain_enum | |
| `name` | TEXT | e.g. `"purchase.initiate"`. UNIQUE. |
| `description` | TEXT (nullable) | |

**`dimension_definitions`** — Constraint schema per action type
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `actionTypeId` | UUID (FK → action_types) | CASCADE delete |
| `dimensionName` | TEXT | e.g. `"amount"`, `"vendor"`, `"category"` |
| `kind` | dimension_kind_enum | |
| `numericMax` | NUMERIC (nullable) | Default max for numeric kind |
| `rateLimit` | INTEGER (nullable) | Default limit for rate kind |
| `rateWindow` | TEXT (nullable) | e.g. `"1 hour"`, `"1 day"` |
| `setMembers` | TEXT[] (nullable) | Default allowed members for set kind |
| `boolDefault` | BOOLEAN (nullable) | Default for boolean kind |
| `boolRestrictive` | BOOLEAN (nullable) | Which boolean value is more restrictive (true = `true` is restrictive, e.g. `requires_approval`) |
| `temporalExpiry` | DATE (nullable) | Default expiry date for temporal kind |

UNIQUE constraint on `(actionTypeId, dimensionName)`.

**`policies`** — Policy definitions
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `orgId` | UUID (FK → organizations) | CASCADE delete |
| `name` | TEXT | UNIQUE per org: `UNIQUE(orgId, name)` |
| `domain` | domain_enum | |
| `effect` | policy_effect_enum | `"allow"` or `"deny"` |
| `activeVersionId` | UUID (FK → policy_versions, nullable) | |
| `createdAt` | TIMESTAMPTZ | |

**`policy_versions`** — Immutable version records
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `policyId` | UUID (FK → policies) | CASCADE delete |
| `versionNumber` | INTEGER | Auto-incremented per policy |
| `constraints` | JSONB | Structured constraint array (see Constraint Format) |
| `cedarSource` | TEXT | Generated Cedar policy source |
| `cedarHash` | TEXT | SHA-256 of `cedarSource` |
| `createdAt` | TIMESTAMPTZ | |
| `createdBy` | TEXT (nullable) | Agent DID or admin user who created this version |

**`policy_assignments`** — Policy ↔ target binding
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `policyId` | UUID (FK → policies) | CASCADE delete. The active version is always `policies.activeVersionId` — no version pinning on assignments. |
| `groupId` | UUID (FK → groups, nullable) | CHECK: exactly one of `groupId` or `agentDid` |
| `agentDid` | TEXT (nullable) | References registry agent DID |
| `assignedAt` | TIMESTAMPTZ | |

**`decision_log`** — Immutable audit trail
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `evaluatedAt` | TIMESTAMPTZ | Indexed |
| `agentDid` | TEXT | |
| `actionTypeId` | UUID (FK → action_types) | |
| `requestContext` | JSONB | Snapshot of evaluated context |
| `bundleHash` | TEXT | SHA-256 of all active `cedarSource` values. Indexed. |
| `outcome` | decision_outcome_enum | |
| `reason` | TEXT (nullable) | |
| `matchedVersionId` | UUID (FK → policy_versions, nullable) | |
| `engineErrorCode` | TEXT (nullable) | Engine-specific error code |
| `sdkErrorCode` | TEXT (nullable) | SDK-compatible error code (for backward compat) |
| `envelopeSnapshot` | JSONB (nullable) | Resolved envelope at time of decision (for admin queries) |

Indexes on `(agentDid, evaluatedAt)` and `(outcome, evaluatedAt)`.

**`petitions`** — One-time exception requests
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `orgId` | UUID (FK → organizations) | |
| `requestorDid` | TEXT | Agent DID who filed the petition |
| `actionTypeId` | UUID (FK → action_types) | |
| `requestedContext` | JSONB | The context that was denied (amount, vendor, etc.) |
| `violatedPolicyId` | UUID (FK → policies) | The policy that caused the denial |
| `violatedDimension` | TEXT | Which dimension was exceeded |
| `requestedValue` | JSONB | What the agent wants (e.g., `{"amount": 6000}`) |
| `justification` | TEXT | Agent's reason for the exception |
| `approverDid` | TEXT (nullable) | DID of the approver (routed by system) |
| `approverGroupId` | UUID (FK → groups, nullable) | Group the approver belongs to |
| `status` | petition_status_enum | |
| `decisionReason` | TEXT (nullable) | Approver's reason for approve/deny |
| `expiresAt` | TIMESTAMPTZ | Petition expiry (approval window) |
| `grantExpiresAt` | TIMESTAMPTZ (nullable) | If approved, when the exception expires |
| `createdAt` | TIMESTAMPTZ | |
| `decidedAt` | TIMESTAMPTZ (nullable) | |

Index on `(requestorDid, status)` and `(approverDid, status)`.

### Recursive CTE for Hierarchy

Ancestor query (used by envelope resolution):

```sql
WITH RECURSIVE ancestors AS (
  -- Base: agent's direct group memberships
  SELECT g.id, g.parent_id, g.name, g.node_type, 0 AS depth
  FROM groups g
  JOIN agent_group_memberships m ON m.group_id = g.id
  WHERE m.agent_did = $1

  UNION ALL

  -- Recurse: walk up parent chain
  SELECT g.id, g.parent_id, g.name, g.node_type, a.depth + 1
  FROM groups g
  JOIN ancestors a ON g.id = a.parent_id
)
SELECT * FROM ancestors;
```

Descendant query (used by cache invalidation):

```sql
WITH RECURSIVE descendants AS (
  SELECT id FROM groups WHERE id = $1
  UNION ALL
  SELECT g.id FROM groups g JOIN descendants d ON g.parent_id = d.id
)
SELECT agent_did FROM agent_group_memberships
WHERE group_id IN (SELECT id FROM descendants);
```

---

## Constraint Format

Structured constraints are stored as JSONB in `policy_versions.constraints`. Each constraint targets one dimension on one action type.

```typescript
interface PolicyConstraint {
  actionTypeId: string;              // UUID of the action type
  actionName: string;                // e.g. "purchase.initiate" (denormalized for readability)
  dimensions: DimensionConstraint[];
}

type DimensionConstraint =
  | { name: string; kind: "numeric"; max: number }
  | { name: string; kind: "rate"; limit: number; window: string }
  | { name: string; kind: "set"; members: string[] }
  | { name: string; kind: "boolean"; value: boolean; restrictive: boolean }
  | { name: string; kind: "temporal"; expiry: string };
```

**Example (org-level purchase policy):**

```json
[
  {
    "actionTypeId": "...",
    "actionName": "purchase.initiate",
    "dimensions": [
      { "name": "amount", "kind": "numeric", "max": 5000 },
      { "name": "vendor", "kind": "set", "members": ["aws", "azure", "gcp", "github", "vercel", "railway", "vendor-acme-001"] },
      { "name": "category", "kind": "set", "members": ["compute", "software-licenses", "cloud-services", "api-credits"] },
      { "name": "requires_human_approval", "kind": "boolean", "value": false, "restrictive": true },
      { "name": "budget_expiry", "kind": "temporal", "expiry": "2026-12-31" }
    ]
  }
]
```

---

## Envelope Resolution

The envelope is the computed effective permissions for an agent — the intersection of all inherited policies from its group hierarchy plus direct assignments. Computed by `packages/rules-engine/src/envelope.ts`.

### Resolution Algorithm

```typescript
interface ResolvedEnvelope {
  agentDid: string;
  actions: ResolvedAction[];
  policyVersion: number;            // org policyVersion at time of resolution
  resolvedAt: string;               // ISO 8601
}

interface ResolvedAction {
  actionId: string;
  actionName: string;
  denied: boolean;                   // true if any deny policy applies
  denySource: string | null;        // policy name that caused deny
  dimensions: ResolvedDimension[];
}

interface ResolvedDimension {
  name: string;
  kind: DimensionKind;
  resolved: unknown;                 // the computed intersection value
  sources: DimensionSource[];        // provenance chain
}

interface DimensionSource {
  policyName: string;
  groupName: string | null;          // null for direct agent assignment
  level: "org" | "department" | "team" | "agent";
  value: unknown;                    // the constraint value from this source
}
```

### Intersection Semantics by Kind

| Kind | Resolution | Example |
|------|-----------|---------|
| `numeric` | Minimum `max` across all sources | Org: 5000, Team: 2000 → **2000** |
| `set` | Intersection of `members` | Org: [aws, azure, gcp], Team: [aws, gcp] → **[aws, gcp]** |
| `boolean` | Most restrictive wins (see below) | Org: false, Team: true → depends on dimension semantics |
| `temporal` | Earliest `expiry` across all sources | Org: 2026-12-31, Team: 2026-06-30 → **2026-06-30** |
| `rate` | Minimum `limit` (same window) | Org: 10/hour, Team: 5/hour → **5/hour** |

### Boolean Dimension Semantics

Boolean dimensions require a `restrictive` flag in their dimension definition to indicate which value is "more restrictive." The envelope resolver always picks the more restrictive value (narrowing only).

- **Gate booleans** (`requires_human_approval`): `restrictive: true` — meaning `true` is the more restrictive value. Org: `false`, Team: `true` → resolved: **`true`** (approval required, narrower).
- **Permission booleans** (`allow_external_vendors`): `restrictive: false` — meaning `false` is the more restrictive value. Org: `true`, Team: `false` → resolved: **`false`** (external vendors blocked, narrower).

The `restrictive` field is stored on `dimension_definitions` and included in the `DimensionConstraint` type:

```typescript
  | { name: string; kind: "boolean"; value: boolean; restrictive: boolean }
```

### Deny Overrides

A `deny`-effect policy at any level beats `allow`-effect policies from all levels, regardless of specificity. This maps directly to Cedar's `forbid`-overrides-`permit` evaluation model.

### Resolution Steps

1. Find the agent's direct group memberships.
2. Walk ancestors using recursive CTE.
3. Collect all policy assignments from ancestor groups + direct agent assignments.
4. Load active policy versions with their JSONB constraints.
5. *(Future)* Check for approved petitions — if a petition grants a one-time exception for a dimension, temporarily widen that dimension for this evaluation.
6. Resolve dimensions using intersection semantics per kind.
7. Apply deny overrides — any deny-effect policy sets `denied: true` on its action.
8. Return the resolved envelope with full provenance chain.

---

## Cedar Evaluation

### WASM Integration

The `cedar-policy` Rust crate is compiled to WASM and checked into the repo at `packages/rules-engine/cedar.wasm`. The TypeScript wrapper loads the WASM module and exposes a typed evaluation interface.

```typescript
// packages/rules-engine/src/evaluator.ts

interface CheckRequest {
  principal: string;                 // e.g. Agent::"did:mesh:abc123"
  action: string;                    // e.g. Action::"purchase.initiate"
  resource: string;                  // e.g. Resource::"vendor-acme-001"
  context: Record<string, unknown>;  // runtime context (amount, vendor, category, etc.)
}

interface CheckResponse {
  decision: "Allow" | "Deny";
  diagnostics: string[];            // matching policy IDs or evaluation errors
  engineCode: string | null;        // engine-specific error code (DIMENSION_EXCEEDED, etc.)
  sdkCode: string | null;           // SDK-compatible error code (OVER_LIMIT, etc.)
  details: Record<string, unknown>; // dimension-level details for admin view
}

async function initCedar(): Promise<CedarEngine>;

interface CedarEngine {
  /** Load a policy set from Cedar source strings. */
  loadPolicies(sources: string[]): void;

  /** Load entity relationships for group hierarchy support. */
  loadEntities(entities: CedarEntity[]): void;

  /** Evaluate an authorization request. */
  check(request: CheckRequest): CheckResponse;

  /** Get the bundle hash (SHA-256 of all loaded policy sources). */
  getBundleHash(): string;
}

interface CedarEntity {
  uid: string;                       // e.g. Agent::"did:mesh:abc123"
  parents: string[];                 // e.g. [Group::"finance-team-uuid"]
  attrs: Record<string, unknown>;    // entity attributes
}
```

### Entity Store

The Cedar entity store is rebuilt atomically whenever the organization's `policyVersion` counter increments. This is triggered by any policy mutation (version creation, assignment change, membership change).

**Entity types loaded into Cedar:**

| Cedar Type | Source | Example UID |
|---|---|---|
| `Agent` | Registry agents by DID | `Agent::"did:mesh:7b2f4a91e3..."` |
| `Group` | `groups` table | `Group::"<uuid>"` |
| `Action` | `action_types` table | `Action::"purchase.initiate"` |
| `Resource` | Vendor IDs (from check request) | `Resource::"vendor-acme-001"` |

**Agent entities** have `parents` set to their group memberships. **Group entities** have `parents` set to their parent group (from `parentId`). This enables Cedar's native `principal in Group::"<uuid>"` operator.

### Cedar Source Generation

`packages/rules-engine/src/cedar-gen.ts` converts structured constraints into Cedar source. The generation is **deterministic** — same constraints always produce the same Cedar source, enabling snapshot testing.

**Generated Cedar format (permit policy):**

```cedar
// Policy: "org-spending-limits" (v3)
// Assigned to: Group::"acme-org-uuid"
permit (
  principal in Group::"acme-org-uuid",
  action == Action::"purchase.initiate",
  resource
)
when {
  context.amount <= 5000 &&
  [context.vendor].containsAny(["aws", "azure", "gcp", "github", "vercel", "railway", "vendor-acme-001"]) &&
  [context.category].containsAny(["compute", "software-licenses", "cloud-services", "api-credits"])
};
```

**Generated Cedar format (deny policy):**

```cedar
// Policy: "block-sanctioned-vendors" (v1)
// Assigned to: Group::"acme-org-uuid"
forbid (
  principal in Group::"acme-org-uuid",
  action == Action::"purchase.initiate",
  resource
)
when {
  [context.vendor].containsAny(["sanctioned-vendor-001"])
};
```

### Bundle Hash

The bundle hash is computed as `SHA-256(sort(all_active_cedar_sources).join('\n'))`. Every decision log entry records this hash, proving exactly which set of rules governed the decision.

### Rate Dimensions in Cedar

Cedar evaluates a single request — it has no concept of request frequency or rolling windows. Rate limits are enforced by the **caller providing runtime state** as numeric context values. The caller (sidecar or storefront SDK) queries the ledger or accumulator for the current count and passes it in the check request context.

For example, a rate limit of "10 transactions per hour" is expressed in Cedar as:

```cedar
permit (...)
when {
  context.transactions_last_hour <= 10
};
```

The caller is responsible for computing `transactions_last_hour` before calling the rules engine. The rules engine treats it as a plain numeric comparison.

---

## Error Codes

The rules engine returns **both** engine-specific codes and SDK-compatible codes. External consumers see the SDK code. Admins and decision logs see both.

### Engine-Specific Codes

| Code | Description |
|------|-------------|
| `POLICY_DENIED` | Cedar evaluation returned Deny |
| `DIMENSION_EXCEEDED` | Numeric dimension exceeded (amount > max) |
| `DIMENSION_NOT_IN_SET` | Set dimension violation (vendor/category not in allowed list) |
| `DIMENSION_OUTSIDE_WINDOW` | Temporal dimension violation (policy has expired) |
| `DIMENSION_RATE_EXCEEDED` | Rate limit exceeded |
| `DIMENSION_BOOLEAN_BLOCKED` | Boolean dimension blocks the action |
| `ENVELOPE_EMPTY` | Agent has no policies granting this action |
| `DENY_OVERRIDE` | Explicit deny policy overrides all permits |
| `POLICY_EXPIRED` | Temporal dimension expiry date has passed |
| `PETITION_REQUIRED` | Denial is petitionable — agent can request exception |
| `ENGINE_ERROR` | Internal evaluation error |

### SDK-Compatible Code Mapping

| Engine Code | SDK Code | HTTP |
|---|---|---|
| `DIMENSION_EXCEEDED` (amount) | `OVER_LIMIT` | 403 |
| `DIMENSION_NOT_IN_SET` (vendor) | `VENDOR_NOT_APPROVED` | 403 |
| `DIMENSION_NOT_IN_SET` (category) | `CATEGORY_DENIED` | 403 |
| `DIMENSION_BOOLEAN_BLOCKED` (trust_gate) | `TRUST_SCORE_LOW` | 403 |
| `ENVELOPE_EMPTY` | `CATEGORY_DENIED` | 403 |
| `DENY_OVERRIDE` | `VENDOR_NOT_APPROVED` or `CATEGORY_DENIED` | 403 |
| `ENGINE_ERROR` | `REGISTRY_UNREACHABLE` | 500 |

### Dual Error Response

```typescript
interface EngineErrorResponse {
  success: false;
  error: {
    // SDK-compatible (backward compat, what agents see)
    code: string;                    // e.g. "OVER_LIMIT"
    message: string;                 // e.g. "Transaction amount 6000 exceeds spending limit 5000"
    details: Record<string, unknown>;

    // Engine-specific (what admins and decision logs see)
    engine?: {
      code: string;                  // e.g. "DIMENSION_EXCEEDED"
      dimension: string;             // e.g. "amount"
      resolved: unknown;             // e.g. 5000 (the envelope limit)
      requested: unknown;            // e.g. 6000 (what the agent asked for)
      sources: DimensionSource[];    // provenance chain
      petitionable: boolean;         // whether the agent can file a petition
    };
  };

  // Retry hint for two-phase gap
  retryHint?: {
    reason: "policy_updated";
    message: "Policy changed since token was issued. Refresh your token and retry.";
  };
}
```

The `engine` field is included when the caller has admin-level access (determined by the management API auth middleware). Agent-facing responses omit it.

---

## Two-Phase Authorization

The storefront SDK's verification middleware implements a two-phase authorization check:

### Phase 1: Fast Local Check (JWT Claims)

Runs synchronously from the JWT claims already decoded by `verifyIdentity()`. Fails fast for obvious violations without any DB or WASM calls.

```typescript
// Unchanged from current verify.ts logic, but now called "local check"
function localAuthorizationCheck(
  agent: VerifiedAgentContext,
  transaction: { amount: number; vendorId: string; category: string },
  storefrontConfig: { minTrustScore: number; vendorId: string }
): AuthorizationResult;
```

**What it checks:**
- Trust score gate (agent.trustScore < storefront.minTrustScore)
- Spending limit from JWT claims (transaction.amount > agent.spendingLimit)
- Vendor approval from JWT claims (vendorId not in agent.approvedVendors)
- Category from JWT claims (category not in agent.categories)

**If this fails:** Return the denial immediately. No rules engine call needed.

### Phase 2: Authoritative Engine Check (Cedar Evaluation)

If Phase 1 passes, the rules engine does the full policy evaluation with envelope resolution, Cedar WASM evaluation, and entity hierarchy.

```typescript
async function engineAuthorizationCheck(
  agentDid: string,
  action: string,                    // e.g. "purchase.initiate"
  context: Record<string, unknown>,  // amount, vendor, category, hour, etc.
  callerContext?: {                   // optional runtime state from caller
    spendLast24h?: number;
    transactionsLastHour?: number;
  }
): Promise<CheckResponse>;
```

**If Phase 2 denies after Phase 1 passed:** The response includes a `retryHint` field:

```json
{
  "success": false,
  "error": {
    "code": "OVER_LIMIT",
    "message": "Transaction amount 6000 exceeds spending limit 5000",
    "details": { "limit": 5000, "requested": 6000 }
  },
  "retryHint": {
    "reason": "policy_updated",
    "message": "Policy changed since token was issued. Refresh your token and retry."
  }
}
```

This happens when a policy was updated after the JWT was issued, narrowing the agent's envelope below what the JWT claims indicate.

---

## Envelope Cache

### Strategy: Interface Now, Optimization Later

The spec defines the `EnvelopeCache` interface but defers caching strategy to a future optimization phase. The default implementation always recomputes (no caching). Implementations MAY cache resolved envelopes, but the spec does not prescribe how.

```typescript
interface EnvelopeCache {
  get(agentDid: string): CachedEnvelope | null;
  set(agentDid: string, envelope: ResolvedEnvelope): void;
  invalidate(agentDid: string): void;
  invalidateAll(): void;
}

interface CachedEnvelope {
  envelope: ResolvedEnvelope;
  policyVersion: number;             // org.policyVersion at time of caching
  cachedAt: number;                  // timestamp
}
```

### Default Implementation: No-Op Cache

The `NoOpEnvelopeCache` always returns `null` on `get()`, forcing fresh resolution on every request. This is correct and sufficient for demo/early-stage usage. Envelope resolution is fast (a few DB queries + intersection logic).

### Future: Version Counter + Invalidation

When caching becomes necessary, the `organizations.policyVersion` counter (already incremented atomically on every policy mutation) provides the staleness signal. A cached envelope whose `policyVersion` is less than the current org version is stale and must be recomputed. Cross-process invalidation (e.g., Postgres NOTIFY) is a further optimization for multi-process deployments.

---

## Petitioning (API Stubs Only — Implementation Post-Demo)

Agents can request one-time exceptions to policy denials. The spec defines the data model, API endpoints, and routing algorithm, but **implementation is deferred to post-demo**. Phase 5 delivers endpoint stubs that return `501 Not Implemented` with the correct response shapes.

### Design (for future implementation)

```
Agent denied (OVER_LIMIT, $6000 > $5000)
    │
    ├─ Agent files petition
    │   { action: "purchase.initiate",
    │     dimension: "amount",
    │     requested: 6000,
    │     justification: "Emergency server capacity for incident response" }
    │
    ├─ System routes to approver
    │   Walk up group hierarchy from agent's group:
    │   Team (limit: 2000) → Department (limit: 5000) → Org (limit: 25000)
    │   Org's envelope permits $6000 → route to Org-level admin
    │
    ├─ Approver reviews
    │   Sees: who requested, what was denied, why, agent's history
    │
    ├─ Decision
    │   ├─ Approve: grant one-time exception with expiry
    │   │   Creates a temporary policy override for this agent+dimension
    │   │   grantExpiresAt: 24 hours from approval
    │   │
    │   └─ Deny: petition rejected with reason
    │       Agent informed, no policy change
    │
    └─ Audit
        Petition record is immutable. Decision logged.
```

### Routing Algorithm

```typescript
async function routePetition(
  agentDid: string,
  violatedPolicyId: string,
  violatedDimension: string,
  requestedValue: unknown
): Promise<{ approverDid: string; approverGroupId: string }>;
```

1. Get the agent's group memberships.
2. Walk up the hierarchy (recursive CTE).
3. At each level, resolve the envelope for that level's policies.
4. Find the lowest level whose envelope would permit the requested value.
5. Route the petition to an admin of that group.

If no level in the hierarchy permits the request, the petition routes to the organization root admin.

### Approved Petition Integration

During envelope resolution (step 5), the resolver checks for approved, non-expired petitions for the agent+action+dimension. If found, the petitioned value temporarily replaces the resolved dimension value for that single evaluation.

### API Endpoints

```
POST /api/policies/petitions
Body: { actionTypeId, requestedContext, violatedDimension, requestedValue, justification }
Headers: Authorization: Bearer <agent-jwt>
→ 201: { petitionId, status: "pending", approverDid, expiresAt }

GET /api/policies/petitions?status=pending&approverDid=<did>
Headers: Authorization: Bearer <admin-jwt>
→ 200: { petitions: [...] }

POST /api/policies/petitions/:id/decide
Body: { decision: "approved" | "denied", reason, grantExpiresAt? }
Headers: Authorization: Bearer <admin-jwt>
→ 200: { petitionId, status, decidedAt }

GET /api/policies/petitions/:id
→ 200: { petition details }
```

---

## Management API

All management endpoints are internal-only for now — accessible only within the Docker network. No application-level authentication is required. Entity-scoped JWT auth for management endpoints is deferred to a future phase when the API is exposed externally.

### Policy CRUD

```
GET    /api/policies/rules                           → List all policies for org
POST   /api/policies/rules                           → Create policy
GET    /api/policies/rules/:id                       → Get policy by ID
PUT    /api/policies/rules/:id                       → Update policy metadata
DELETE /api/policies/rules/:id                       → Delete policy

GET    /api/policies/rules/:id/versions              → List versions
POST   /api/policies/rules/:id/versions              → Create version (constraints → Cedar gen → validate → activate)
POST   /api/policies/rules/:id/versions/:vid/activate → Activate specific version
```

### Group Hierarchy

```
GET    /api/policies/groups                          → List all groups
POST   /api/policies/groups                          → Create group
GET    /api/policies/groups/:id                      → Get group
DELETE /api/policies/groups/:id                      → Delete group (cascade memberships)
GET    /api/policies/groups/:id/members              → List agents in group
POST   /api/policies/groups/:id/members              → Add agent to group
DELETE /api/policies/groups/:id/members/:did         → Remove agent from group
GET    /api/policies/groups/:id/ancestors             → Get ancestor chain
GET    /api/policies/groups/:id/descendants           → Get descendant tree
```

### Assignments

```
POST   /api/policies/assignments                     → Assign policy to group or agent
DELETE /api/policies/assignments/:id                 → Remove assignment
GET    /api/policies/assignments?groupId=<id>         → List assignments for group
GET    /api/policies/assignments?agentDid=<did>       → List assignments for agent
```

### Envelope & Evaluation

```
GET    /api/policies/agents/:did/envelope             → Resolve effective envelope (rich)
GET    /api/policies/agents/:did/policies              → List all policies applying to agent
POST   /api/policies/check                            → Evaluate authorization (Cedar check)
```

### Decision Log

```
GET    /api/policies/decisions                        → List decisions (filters: agentDid, outcome, dateRange)
GET    /api/policies/decisions/:id                    → Get single decision with envelope snapshot
```

### Action Types

```
GET    /api/policies/action-types                     → List all action types with dimensions
GET    /api/policies/action-types/:id                 → Get action type with dimension definitions
```

---

## Sidecar Integration

The Python sidecar's authorization endpoints become thin proxies to the rules engine.

### `/check_authorization` → Rules Engine Proxy

```python
@app.post("/check_authorization")
async def check_authorization(vendor: str, amount: float, category: str):
    # Build rules engine check request
    check_request = {
        "principal": f'Agent::"{AGENT_DID}"',
        "action": 'Action::"purchase.initiate"',
        "resource": f'Resource::"{vendor}"',
        "context": {
            "amount": amount,
            "vendor": vendor,
            "category": category,
        }
    }

    # Call rules engine (in-process or via internal HTTP)
    response = await http_client.post(f"{RULES_ENGINE_URL}/api/policies/check", json=check_request)
    result = response.json()

    # Translate to existing response format (backward compatible)
    return {
        "authorized": result["decision"] == "Allow",
        "reasons": result.get("diagnostics", ["within policy"]) if result["decision"] == "Deny" else ["within policy"],
        "requires_approval": result.get("details", {}).get("requires_human_approval", False),
        "agent_id": AGENT_ID,
        "did": AGENT_DID,
        "trust_score": reputation_mgr.get_or_create_score(AGENT_ID).score,
        "vendor": vendor,
        "amount": amount,
        "category": category,
    }
```

### `/sign_transaction` — Coupled Sign-If-Approved

The sidecar calls the rules engine for authorization before signing. If the engine denies, no signature is produced.

```python
@app.post("/sign_transaction")
async def sign_transaction(vendor: str, amount: float, item: str, category: str = "compute"):
    # Step 1: Check authorization via rules engine
    auth = await check_authorization(vendor, amount, category)
    if not auth["authorized"]:
        return {"signed": False, "reasons": auth["reasons"]}

    # Step 2: Sign (unchanged)
    payload = json.dumps({...}, sort_keys=True)
    signature = _sign(payload.encode())
    return {"signed": True, "payload": json.loads(payload), "signature": signature, ...}
```

---

## Action Types (Seeded)

All 14 action types from the existing rules engine, organized by domain.

### Finance Domain

| Action | Dimensions |
|--------|-----------|
| `purchase.initiate` | amount (numeric), vendor (set), category (set), requires_human_approval (boolean), budget_expiry (temporal) |
| `purchase.approve` | amount (numeric), approval_level (set) |
| `budget.allocate` | amount (numeric), department (set) |
| `budget.transfer` | amount (numeric), source_department (set), target_department (set) |
| `expense.submit` | amount (numeric), category (set), vendor (set) |
| `expense.approve` | amount (numeric) |

### Communication Domain

| Action | Dimensions |
|--------|-----------|
| `email.send` | recipients (rate: count/hour), domain (set) |
| `email.send_external` | recipients (rate: count/day), domain (set), requires_approval (boolean) |
| `meeting.schedule` | attendee_count (numeric), external_attendees (boolean) |
| `document.share` | classification (set), external (boolean) |

### Agent Delegation Domain

| Action | Dimensions |
|--------|-----------|
| `agent.delegate` | scope (set), max_depth (numeric) |
| `agent.create` | domain (set), spending_limit (numeric) |
| `agent.revoke` | (no dimensions — always allowed if authorized) |
| `api.call` | endpoint (set), rate (rate: count/minute) |

---

## Dashboard Pages

All pages are added to `apps/dashboard/` using the existing shadcn/ui component library.

### Policy Management (`/policies`)

**List page:** Searchable table of all policies with columns: name, domain, effect, active version, assignment count, last updated.

**Detail page (`/policies/[id]`):** Three tabs:
- **Constraints** — Structured view of the active version's constraints. Editable form for creating new versions.
- **Cedar** — Syntax-highlighted Cedar source viewer. Read-only. Shows the deterministic output of `cedar-gen.ts`.
- **History** — Version timeline with version number, creation date, creator, and SHA-256 hash. Click to view any version's constraints or Cedar source.

### Agent Envelope (`/agents/[did]`)

**Envelope tab:** Visualization of the agent's effective permissions. For each action type:
- Shows resolved dimension values (the intersection result).
- Shows the provenance chain: which policy at which group level contributed each constraint.
- Highlights deny overrides with the source policy.
- Shows approved petitions that temporarily widen a dimension.

### REPL Policy Tester (`/agents/[did]`)

**Test tab:**
1. Select an action type from dropdown.
2. Dimension fields auto-populate based on the action type's dimension definitions.
3. Fill in context values (amount, vendor, category, etc.).
4. Click "Test" → calls `POST /api/policies/check` with the agent's DID and the filled context.
5. Shows: Allow/Deny decision, matching policy IDs, dimension-level breakdown, and the Cedar source that matched.

### Group Hierarchy (`/groups`)

**List page:** Groups displayed as a tree (indented by depth). Each node shows member count and assigned policy count.

**Detail page (`/groups/[id]`):**
- **Members** tab — list of agents in this group with envelope summary.
- **Policies** tab — assigned policies with version info.
- **Hierarchy** tab — visual tree of ancestors and descendants.

### Petition Management (`/petitions`)

**Admin view:** Pending petitions assigned to the current admin, with: requestor, action, dimension, requested value, justification, and approve/deny actions.

**Agent view:** Agent's own petitions with status tracking.

---

## Seed Data

The seed migration loads the existing rules engine demo data (Acme Corp, ~15 agents, 8 policies) plus the Warranted-specific policies that replace `spending-policy.yaml`.

### Warranted Policy Seed

Maps each rule from `spending-policy.yaml` to a structured policy:

| YAML Rule | Policy Name | Effect | Action | Dimension |
|---|---|---|---|---|
| `block-over-agent-limit` | `agent-spending-limit` | allow | `purchase.initiate` | amount: max 5000 |
| `block-over-single-transaction-limit` | `hard-transaction-cap` | deny | `purchase.initiate` | amount: max 25000 (deny if exceeded) |
| `block-unapproved-vendor` | `approved-vendors` | allow | `purchase.initiate` | vendor: [aws, azure, gcp, github, vercel, railway, vendor-acme-001] |
| `block-sanctioned-vendor` | `sanctioned-vendors` | deny | `purchase.initiate` | vendor: [sanctioned list] |
| `block-unauthorized-category` | `permitted-categories` | allow | `purchase.initiate` | category: [compute, software-licenses, cloud-services, api-credits] |
| `rate-limit-transactions-per-hour` | `hourly-rate-limit` | allow | `purchase.initiate` | rate: 10 per 1 hour |
| `rate-limit-daily-spend` | `daily-spend-ceiling` | allow | `purchase.initiate` | amount (daily): max 10000 |
| `escalate-high-value` | `escalation-threshold` | allow | `purchase.initiate` | requires_human_approval: true (for amount > 1000) |
| `cooling-off-large-purchase` | `cooling-off-period` | allow | `purchase.initiate` | (temporal hold, 30 min for amount > 2500) |

### Group Hierarchy Seed

```
Acme Corp (org)
├── Finance (department)
│   ├── Accounts Payable (team)
│   └── Treasury (team)
├── Engineering (department)
│   ├── Platform (team)
│   └── ML/AI (team)
└── Operations (department)
    └── Procurement (team)
```

Agent `did:mesh:...` (OpenClaw agent) is assigned to `Engineering > Platform`.

---

## Testing

Full test suite from day 1. Every policy rule has a test. Every hierarchy constraint has a test. Every dimension intersection has a test.

### Test Files

```
packages/rules-engine/__tests__/
├── schema.test.ts                   # Drizzle schema validation, enum values, constraints
├── envelope.test.ts                 # Envelope resolution: intersection semantics, deny overrides, provenance
├── cedar-gen.test.ts                # Cedar source generation: deterministic output, snapshot tests
├── cedar-eval.test.ts               # Cedar WASM evaluation: permit, deny, entity hierarchy
├── entity-store.test.ts             # Entity store: build from DB, batch sync, agent-group relationships
├── cache.test.ts                    # Cache: interface compliance, NoOpCache behavior
├── petition.test.ts                 # Petition: data model validation, stub endpoints return 501
├── errors.test.ts                   # Error code mapping: engine → SDK, dual response format
├── integration.test.ts              # End-to-end: policy CRUD → Cedar gen → evaluate → decision log
└── seed.test.ts                     # Seed data: all YAML rules represented, correct hierarchy
```

### Required Test Cases

#### Envelope Resolution

```typescript
describe("envelope resolution", () => {
  it("resolves numeric dimensions to minimum across hierarchy", async () => {
    // Org: amount max 5000, Dept: amount max 2000
    // Agent in Dept → resolved amount max: 2000
  });

  it("resolves set dimensions to intersection across hierarchy", async () => {
    // Org: vendors [aws, azure, gcp], Team: vendors [aws, gcp]
    // Agent in Team → resolved vendors: [aws, gcp]
  });

  it("resolves gate boolean dimensions (restrictive=true) to true if any source is true", async () => {
    // Org: requires_approval false, Team: requires_approval true (restrictive=true)
    // Agent in Team → requires_approval: true (true is more restrictive)
  });

  it("resolves permission boolean dimensions (restrictive=false) to false if any source is false", async () => {
    // Org: allow_external true, Team: allow_external false (restrictive=false)
    // Agent in Team → allow_external: false (false is more restrictive)
  });

  it("resolves temporal dimensions to earliest expiry", async () => {
    // Org: expiry 2026-12-31, Team: expiry 2026-06-30
    // Agent in Team → expiry: 2026-06-30
  });

  it("deny policy overrides all permits", async () => {
    // Org: allow purchase.initiate, Team: deny purchase.initiate
    // Agent in Team → denied: true, denySource: team policy
  });

  it("includes full provenance chain in sources", async () => {
    // Verify each dimension lists which policy at which level contributed
  });

  it("handles agent in multiple groups (most restrictive wins)", async () => {
    // Agent in both Finance and Engineering
    // Each has different spending limits → minimum of both
  });

  it("direct agent assignment overrides group policies (narrowing only)", async () => {
    // Group: amount max 5000, Agent-level: amount max 1000
    // Resolved: 1000 (narrower)
  });
});
```

#### Cedar Generation

```typescript
describe("cedar generation", () => {
  it("generates deterministic Cedar source from constraints", () => {
    // Same constraints → same Cedar source (snapshot test)
  });

  it("generates permit block for allow policies", () => {
    // Verify Cedar permit syntax with when clause
  });

  it("generates forbid block for deny policies", () => {
    // Verify Cedar forbid syntax
  });

  it("includes policy metadata as comments", () => {
    // Policy name, version, assignment target in Cedar comments
  });

  it("handles all dimension kinds in when clause", () => {
    // numeric: context.amount <= N
    // set: [context.vendor].containsAny([...])
    // boolean: context.requires_approval == true
    // temporal: (expiry checked at resolution time, not in Cedar)
    // rate: context.transactions_last_hour <= N (caller-provided numeric)
  });
});
```

#### Cedar Evaluation (WASM)

```typescript
describe("cedar evaluation", () => {
  it("permits when all conditions met", () => {});
  it("denies when amount exceeds limit", () => {});
  it("denies when vendor not in set", () => {});
  it("denies when category not permitted", () => {});
  it("forbid overrides permit", () => {});
  it("principal in Group works with loaded entities", () => {
    // Agent entity has Group as parent → principal in Group matches
  });
  it("default deny when no matching permit", () => {});
  it("returns matching policy IDs in diagnostics", () => {});
});
```

#### Two-Phase Authorization

```typescript
describe("two-phase authorization", () => {
  it("fast local check rejects obvious violations without engine call", () => {});
  it("engine check runs when local check passes", () => {});
  it("includes retryHint when local passes but engine denies", () => {});
  it("engine denial includes engine-specific code for admins", () => {});
  it("agent-facing response omits engine details", () => {});
});
```

#### Petitioning (Stubs)

```typescript
describe("petitioning", () => {
  it("petition data model validates with Zod", () => {
    // Verify petition schema validates correct input and rejects invalid input
  });

  it("petition endpoints return 501 Not Implemented", () => {
    // POST /api/policies/petitions → 501
    // POST /api/policies/petitions/:id/decide → 501
  });

  it("petition response shapes match spec", () => {
    // 501 response includes the documented response structure for future implementation
  });
});
```

#### Cache Interface

```typescript
describe("cache interface", () => {
  it("NoOpEnvelopeCache always returns null on get", () => {});
  it("NoOpEnvelopeCache set is a no-op", () => {});
  it("EnvelopeCache interface is implemented correctly", () => {});
});
```

#### Seed Data

```typescript
describe("seed data", () => {
  it("all spending-policy.yaml rules have corresponding policies", () => {});
  it("group hierarchy matches authority chain model", () => {});
  it("OpenClaw agent DID is assigned to correct group", () => {});
  it("action types cover all 14 definitions with correct dimensions", () => {});
});
```

---

## Phases

### Phase 1: Schema + Types + WASM Build

**Goal:** Database schema in Drizzle, all TypeScript interfaces with Zod validation, and Cedar WASM artifact ready.

**Deliverables:**
- `packages/rules-engine/package.json` — package config
- `packages/rules-engine/tsconfig.json` — extends shared base
- `packages/rules-engine/src/schema.ts` — all Drizzle table definitions (organizations, groups, memberships, action_types, dimension_definitions, policies, policy_versions, policy_assignments, decision_log, petitions)
- `packages/rules-engine/src/types.ts` — all TypeScript interfaces + Zod schemas (CheckRequest, CheckResponse, ResolvedEnvelope, PolicyConstraint, DimensionConstraint, etc.)
- `packages/rules-engine/src/errors.ts` — engine-specific error codes + SDK mapping
- `packages/rules-engine/cedar.wasm` — pre-built Cedar WASM artifact
- `packages/rules-engine/src/cedar-wasm.ts` — WASM loader and typed wrapper
- DB migration to create tables and enums

**Tests:**
- `schema.test.ts` — Zod round-trip validation for all types, enum values, constraint formats
- `errors.test.ts` — engine → SDK code mapping for all error codes

**Demo checkpoint:** `bun run test` passes. Schema types validate. WASM loads in Bun.

---

### Phase 2: Envelope Resolution + Cedar Generation

**Goal:** Given an agent DID, resolve their effective envelope from the group hierarchy. Generate deterministic Cedar source from structured constraints.

**Deliverables:**
- `packages/rules-engine/src/envelope.ts` — `resolveEnvelope(agentDid)`: recursive CTE to walk ancestors, collect assignments, resolve dimensions by kind (min/intersection/OR/tightest/min-rate), apply deny overrides
- `packages/rules-engine/src/cedar-gen.ts` — `generateCedar(policy, constraints, assignment)`: structured constraints → deterministic Cedar source with metadata comments
- `packages/rules-engine/src/seed.ts` — seed migration script: Acme Corp hierarchy, 14 action types, 16 dimension definitions, Warranted spending policy rules

**Tests:**
- `envelope.test.ts` — all intersection semantics, deny overrides, multi-group membership, provenance chains
- `cedar-gen.test.ts` — deterministic generation, snapshot tests for all dimension kinds, permit/forbid blocks
- `seed.test.ts` — all YAML rules represented, hierarchy correct, action types complete

**Demo checkpoint:** Seed the DB. Call `resolveEnvelope("did:mesh:...")` → get a full envelope with provenance. Call `generateCedar(...)` → get deterministic Cedar source.

---

### Phase 3: Cedar Evaluation + Entity Store

**Goal:** Evaluate Cedar policies via WASM with full entity hierarchy support. `principal in Group::` works natively.

**Deliverables:**
- `packages/rules-engine/src/evaluator.ts` — `CedarEngine` class: init WASM, load policies, load entities, evaluate check requests, compute bundle hash
- `packages/rules-engine/src/entity-store.ts` — `buildEntityStore(orgId)`: query agents, groups, memberships → build Cedar entity array with parent relationships. Batch rebuild on policy version bump.
- `packages/rules-engine/src/index.ts` — barrel export of the public API

**Tests:**
- `cedar-eval.test.ts` — permit/deny, entity hierarchy (`principal in Group`), forbid overrides permit, default deny, diagnostics
- `entity-store.test.ts` — entity build from DB, agent-group parents, group-group parents, batch rebuild

**Demo checkpoint:** Create policies in DB. Load into Cedar WASM. Evaluate a purchase check → Allow/Deny with diagnostics. Verify `principal in Group` works.

---

### Phase 4: SDK + Sidecar Integration

**Goal:** The storefront SDK and sidecar use the rules engine for authorization. Two-phase check works end-to-end.

**Deliverables:**
- Update `packages/storefront-sdk/src/verify.ts` — `verifyAuthorization()` becomes two-phase: local check + engine check. Add `retryHint` field to response.
- Update `sidecar/server.py` — `/check_authorization` proxies to rules engine. `/sign_transaction` calls engine before signing (coupled).
- `packages/rules-engine/src/cache.ts` — `EnvelopeCache` interface + `NoOpEnvelopeCache` default implementation
- Delete `sidecar/policies/spending-policy.yaml` — policies now in DB only

**Tests:**
- `integration.test.ts` — end-to-end: create policy → assign to group → evaluate via SDK middleware → verify decision log entry
- Two-phase tests in storefront SDK: local pass + engine deny → retryHint
- Sidecar proxy tests: backward-compatible response format

**Demo checkpoint:** Start the full stack. Get a JWT from sidecar. Hit the storefront with an over-limit purchase → denied by rules engine (not hardcoded check). Change a policy via management API → next request reflects the change.

---

### Phase 5: Petitioning + Management API

**Goal:** Management API for policy CRUD. Petition endpoint stubs defined but not implemented.

**Deliverables:**
- `packages/rules-engine/src/petition.ts` — petition data model and types only (routing/approval logic deferred)
- `apps/api/src/routes/policies/` — all management API routes (CRUD, assignments, versions, decisions, action types). Petition endpoints return `501 Not Implemented` with correct response shapes.
- Management API is internal-only (no auth middleware). Auth deferred to when API is exposed externally.

**Tests:**
- Management API endpoint tests: CRUD operations, assignment validation, version creation with Cedar gen
- `petition.test.ts` — data model validation, stub endpoints return 501

**Demo checkpoint:** Create and modify policies via the management API. Assign policies to groups. Create new policy versions with Cedar generation. Query decision log. Petition endpoints return 501 with documented response shapes.

---

### Phase 6: Dashboard + Polish

**Goal:** Admin dashboard with envelope visualization, REPL tester, and Cedar viewer. Production-ready.

**Deliverables:**
- `apps/dashboard/src/app/policies/` — policy list, detail with Constraints/Cedar/History tabs
- `apps/dashboard/src/app/agents/[did]/` — envelope visualization with provenance, REPL tester
- `apps/dashboard/src/app/groups/` — group hierarchy tree, members, assigned policies
- `apps/dashboard/src/app/petitions/` — admin petition management, agent petition status
- `apps/dashboard/src/components/envelope/` — EnvelopeView, DimensionDisplay, InheritanceChain, DenyBanner (ported from rules engine frontend, restyled with shadcn/ui)
- `apps/dashboard/src/components/cedar/` — CedarSourceViewer (syntax highlighting)
- `apps/dashboard/src/components/repl/` — PolicyREPL (action type selector, dimension fields, execute check)

**Tests:**
- Component tests for envelope visualization and REPL tester
- End-to-end: create policy in dashboard → test in REPL → verify Cedar output

**Demo checkpoint:** Open the dashboard. Navigate to an agent. See their effective envelope with full inheritance chain. Open the REPL, test a policy check, see the result. View the Cedar source for a policy. Approve a petition.

---

## Open Questions (Resolved)

| Question | Decision |
|---|---|
| Rewrite or integrate? | Hybrid — TS engine, reuse DB schema concepts |
| Cedar entity loading? | Fix it — load entities for native `principal in Group` |
| Testing bar? | Full test suite from day 1 |
| Cedar runtime? | WASM in-process (pre-built artifact) |
| Cache strategy? | Spec defines interface only; NoOpCache default. Caching deferred as optimization. |
| Runtime state owner? | Caller provides context |
| API surface? | Tiered — flat for agents, rich for admins |
| Management home? | Split — library + API routes |
| Agent model? | Rules engine uses registry agents (no separate table) |
| Entity store refresh? | Batch sync on policy version bump |
| Cedar source visibility? | Stable auditable contract |
| Dashboard? | Port into apps/dashboard/ with shadcn/ui |
| Sidecar fate? | Sidecar proxies to rules engine |
| Authorization call site? | Two-phase: fast local + authoritative engine |
| Policy source of truth? | Database only (YAML deleted) |
| Two-phase gap handling? | Soft deny with retry hint |
| Petitioning? | In scope — API stubs only (data model + endpoints defined, implementation deferred post-demo) |
| Management auth? | Deferred — internal-only (network-level). Entity-scoped JWT when exposed externally. |
| Policy mutation atomicity? | Atomic — all or nothing |
| Schema migration? | Fresh Drizzle schema, seed migration |
| Dashboard scope? | All three features (envelope, REPL, Cedar viewer) |
| Petition routing? | Lowest authority that covers the exception (design documented, implementation deferred) |
| Temporal dimensions? | Expiry only (no time-of-day windows). Time-of-day deferred. |
| Sign coupling? | Coupled — sign-if-approved |
| Hierarchy implementation? | Adjacency list + recursive CTE (no ltree) |
| Phasing? | 6 fine-grained phases |
| Error codes? | Return both (SDK-compatible + engine-specific) |

## References

- [Rules Engine Architecture Map](./rules-engine-ARCHITECTURE.md) — existing Rust/Kotlin engine analysis
- [Storefront SDK Spec](./storefront-sdk-SPEC.md) — 10-step verification flow
- [Storefront SDK Plan](./storefront-sdk-PLAN.md) — implementation patterns
- [CLAUDE.md](../../CLAUDE.md) — project overview, stack, conventions
- [verify.ts](../../packages/storefront-sdk/src/verify.ts) — current authorization logic (steps 7-10)
- [middleware.ts](../../packages/storefront-sdk/src/middleware.ts) — verification middleware
- [registry-client.ts](../../packages/storefront-sdk/src/registry-client.ts) — registry interface
- [server.py](../../sidecar/server.py) — current sidecar implementation
- [spending-policy.yaml](../../sidecar/policies/spending-policy.yaml) — current policy rules (to be deleted)
- [Code Style Rules](../../.claude/rules/code-style.md) — TypeScript and Python conventions
- [Testing Rules](../../.claude/rules/testing.md) — test philosophy and required test cases
- [Security Rules](../../.claude/rules/security.md) — secrets, crypto, input validation
- [API Contracts](../../.claude/rules/prompts.md) — endpoint schemas and response shapes
- [Cedar Policy Language](https://www.cedarpolicy.com/) — Cedar documentation
