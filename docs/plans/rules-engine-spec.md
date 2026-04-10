# Rules Engine — Specification

## Overview

`@warranted/rules-engine` is a Cedar-based policy evaluation package for governing AI agent transactions. It replaces the sidecar's hardcoded Python policy checks with formal Cedar authorization, hierarchical group policies, and an envelope model where constraints only narrow down the org → team → agent hierarchy.

Built entirely in TypeScript on Bun using `@cedar-policy/cedar-wasm` for in-process Cedar evaluation. No Rust service, no Kotlin service. One language, one process. Runs as a Hono HTTP server on the Docker network or imported directly as a package.

## Design Decisions

### Cedar WASM, not Rust
The teammate's engine runs Cedar evaluation in a Rust axum service. We use `@cedar-policy/cedar-wasm` instead — same Cedar language, same evaluation semantics, runs in-process in TypeScript. Eliminates the Rust build toolchain, the separate service, and the network hop for every policy check.

### Cedar-only, no OPA
The teammate's design describes OPA/Rego for quantitative rules but never implemented it. We handle rate limits and rolling windows by injecting runtime state into Cedar's context bag. Cedar can evaluate `context.spend_last_24h + context.amount <= 20000` as a numeric comparison. No second policy engine needed.

### Drizzle, not Exposed/Flyway
Matches the Warranted stack. Same Postgres instance, `rules` schema. Drizzle Kit for migrations. No Kotlin, no Flyway, no HikariCP.

### Entity hierarchy in Cedar
The teammate's engine evaluates against `Entities::empty()` — no group hierarchy. We load entity relationships from the database into Cedar's entity store so that `principal in Group::"acme.engineering"` works natively. This is the whole point of Cedar's `in` operator.

### Envelope computed at query time
No caching. The envelope resolver walks the group tree, collects all applicable policies, and computes the intersection. For the demo scale (< 100 agents, < 50 policies), this is sub-millisecond.

---

## Package Structure

```
packages/rules-engine/
├── package.json                 @warranted/rules-engine
├── tsconfig.json
├── src/
│   ├── index.ts                 barrel export
│   ├── types.ts                 all types + Zod schemas
│   ├── cedar.ts                 Cedar WASM: load policies, build entities, evaluate
│   ├── envelope.ts              resolve effective policy for an agent
│   ├── groups.ts                org → team → agent hierarchy with path queries
│   ├── policies.ts              policy CRUD, versioning, Cedar source generation
│   ├── check.ts                 CheckRequest → permit/deny + reasons (the Gate)
│   ├── server.ts                Hono API server
│   └── db/
│       ├── schema.ts            Drizzle table definitions
│       ├── migrate.ts           migration runner
│       └── seed.ts              Warranted demo data
├── policies/
│   ├── base.cedar               org-level hard limits
│   └── procurement.cedar        purchase.initiate policies
├── drizzle/
│   └── 0001_initial.sql         generated migration
├── __tests__/
│   ├── cedar.test.ts
│   ├── envelope.test.ts
│   ├── check.test.ts
│   ├── groups.test.ts
│   ├── policies.test.ts
│   └── server.test.ts
└── scripts/
    └── seed-warranted.ts        seed agents matching sidecar DIDs
```

---

## Dependencies

```json
{
  "dependencies": {
    "@cedar-policy/cedar-wasm": "^4.0.0",
    "drizzle-orm": "^0.36.0",
    "hono": "^4.0.0",
    "postgres": "^3.4.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.30.0",
    "vitest": "^3.0.0",
    "typescript": "^5.8.0",
    "@types/node": "^22.0.0"
  }
}
```

---

## Types

### Core Domain Types

```typescript
// Organization — multi-tenant root
interface Organization {
  id: string;           // UUID
  name: string;
  slug: string;
  createdAt: Date;
}

// Group — hierarchical tree node
interface Group {
  id: string;
  orgId: string;
  name: string;
  nodeType: "org" | "department" | "team";
  path: string;         // dot-separated: "acme.engineering.infra"
  parentId: string | null;
  createdAt: Date;
}

// Agent — an AI agent registered in the system
interface Agent {
  id: string;
  orgId: string;
  name: string;
  did: string;          // Warranted DID (did:mesh:...)
  domain: string;       // "finance" | "communication" | "delegation"
  isActive: boolean;
  createdAt: Date;
}

// AgentGroupMembership — many-to-many
interface AgentGroupMembership {
  agentId: string;
  groupId: string;
}
```

### Policy Types

```typescript
// Policy — a named rule with an effect
interface Policy {
  id: string;
  orgId: string;
  name: string;
  domain: string;
  effect: "allow" | "deny";
  activeVersionId: string | null;
  createdAt: Date;
}

// PolicyVersion — immutable snapshot
interface PolicyVersion {
  id: string;
  policyId: string;
  versionNumber: number;
  constraints: PolicyConstraint[];  // structured constraints
  cedarSource: string;              // generated or hand-written Cedar
  cedarHash: string;                // SHA-256 of cedarSource
  createdAt: Date;
}

// PolicyConstraint — one dimension constraint
interface PolicyConstraint {
  dimension: string;      // "amount", "vendor", "category"
  kind: DimensionKind;
  value: DimensionValue;
}

type DimensionKind = "numeric" | "set" | "boolean" | "rate" | "temporal";

type DimensionValue =
  | { kind: "numeric"; max: number }
  | { kind: "set"; members: string[] }
  | { kind: "boolean"; value: boolean }
  | { kind: "rate"; limit: number; window: string }    // e.g. "1 day"
  | { kind: "temporal"; start?: string; end?: string; expiry?: string };

// PolicyAssignment — binds a policy to a group or agent
interface PolicyAssignment {
  id: string;
  policyId: string;
  policyVersionId: string;
  groupId: string | null;   // one of groupId or agentId must be set
  agentId: string | null;
  assignedAt: Date;
}
```

### Action Types

```typescript
// ActionType — a governed agent action
interface ActionType {
  id: string;
  domain: string;
  name: string;           // "purchase.initiate", "purchase.settle"
  description: string;
}

// DimensionDefinition — schema for a dimension on an action type
interface DimensionDefinition {
  id: string;
  actionTypeId: string;
  dimensionName: string;  // "amount", "vendor", "category"
  kind: DimensionKind;
}
```

### Check API Types

```typescript
// CheckRequest — input to the Gate
interface CheckRequest {
  agentDid: string;                     // did:mesh:... (resolved to agent ID internally)
  action: string;                       // "purchase.initiate"
  resource: string;                     // vendor ID or "any"
  context: Record<string, unknown>;     // { amount: 2500, vendor: "vendor-acme-001", category: "compute" }
}

// CheckResponse — output from the Gate
interface CheckResponse {
  decision: "allow" | "deny";
  reasons: CheckReason[];               // which policies matched and why
  requiresApproval: boolean;            // escalation threshold hit
  envelope: ResolvedEnvelope | null;    // the agent's effective permissions (optional, for debugging)
}

interface CheckReason {
  policyName: string;
  policyId: string;
  effect: "allow" | "deny";
  dimension?: string;                   // which dimension caused the deny
  message: string;                      // human-readable explanation
}
```

### Envelope Types

```typescript
// ResolvedEnvelope — an agent's effective permissions
interface ResolvedEnvelope {
  agentId: string;
  agentDid: string;
  agentName: string;
  actions: ResolvedAction[];
}

// ResolvedAction — effective permissions for one action type
interface ResolvedAction {
  actionName: string;
  denied: boolean;
  denySource: string | null;            // policy name if denied
  dimensions: ResolvedDimension[];
}

// ResolvedDimension — the computed intersection of all inherited constraints
interface ResolvedDimension {
  name: string;
  kind: DimensionKind;
  resolved: DimensionValue;             // the effective value after intersection
  sources: DimensionSource[];           // where each constraint came from
}

// DimensionSource — provenance for one contributing constraint
interface DimensionSource {
  policyName: string;
  groupName: string | null;
  level: "org" | "department" | "team" | "agent";
  value: DimensionValue;
}
```

### Decision Log Types

```typescript
interface DecisionLogEntry {
  id: string;
  evaluatedAt: Date;
  agentId: string;
  actionTypeId: string;
  requestContext: Record<string, unknown>;
  bundleHash: string;                   // SHA-256 of all active cedar sources
  outcome: "allow" | "deny" | "error";
  reason: string | null;
  matchedVersionId: string | null;
}
```

All types have corresponding Zod schemas exported alongside them.

---

## Database Schema (Drizzle)

Nine tables in the `rules` Postgres schema. Uses `pgcrypto` for UUID generation. Uses string `path` column with dot-separated hierarchy (no ltree dependency — simpler, works with standard Postgres, path queries use `LIKE 'acme.%'`).

### Tables

**`rules.organizations`**
- `id` UUID PK (default `gen_random_uuid()`)
- `name` TEXT UNIQUE NOT NULL
- `slug` TEXT UNIQUE NOT NULL
- `created_at` TIMESTAMPTZ default now()

**`rules.groups`**
- `id` UUID PK
- `org_id` UUID FK → organizations (CASCADE)
- `name` TEXT NOT NULL
- `node_type` TEXT CHECK ('org', 'department', 'team')
- `path` TEXT NOT NULL (dot-separated, indexed)
- `parent_id` UUID FK → groups (nullable)
- `created_at` TIMESTAMPTZ

**`rules.agents`**
- `id` UUID PK
- `org_id` UUID FK → organizations (CASCADE)
- `name` TEXT NOT NULL
- `did` TEXT UNIQUE NOT NULL (Warranted DID)
- `domain` TEXT NOT NULL
- `is_active` BOOLEAN default TRUE
- `created_at` TIMESTAMPTZ

**`rules.agent_group_memberships`**
- `agent_id` UUID FK → agents (CASCADE), PK
- `group_id` UUID FK → groups (CASCADE), PK

**`rules.action_types`**
- `id` UUID PK
- `domain` TEXT NOT NULL
- `name` TEXT UNIQUE NOT NULL
- `description` TEXT

**`rules.dimension_definitions`**
- `id` UUID PK
- `action_type_id` UUID FK → action_types (CASCADE)
- `dimension_name` TEXT NOT NULL
- `kind` TEXT CHECK ('numeric', 'set', 'boolean', 'rate', 'temporal')

**`rules.policies`**
- `id` UUID PK
- `org_id` UUID FK → organizations (CASCADE)
- `name` TEXT NOT NULL (unique per org)
- `domain` TEXT NOT NULL
- `effect` TEXT CHECK ('allow', 'deny')
- `active_version_id` UUID FK → policy_versions (nullable)
- `created_at` TIMESTAMPTZ

**`rules.policy_versions`**
- `id` UUID PK
- `policy_id` UUID FK → policies (CASCADE)
- `version_number` INT NOT NULL
- `constraints` JSONB NOT NULL
- `cedar_source` TEXT NOT NULL
- `cedar_hash` TEXT NOT NULL (SHA-256 of cedar_source)
- `created_at` TIMESTAMPTZ

**`rules.policy_assignments`**
- `id` UUID PK
- `policy_id` UUID FK → policies (CASCADE)
- `policy_version_id` UUID FK → policy_versions
- `group_id` UUID FK → groups (nullable)
- `agent_id` UUID FK → agents (nullable)
- CHECK: exactly one of group_id or agent_id is non-null
- `assigned_at` TIMESTAMPTZ

**`rules.decision_log`**
- `id` UUID PK
- `evaluated_at` TIMESTAMPTZ (indexed with agent_id)
- `agent_id` UUID FK → agents
- `action_type_id` UUID FK → action_types
- `request_context` JSONB NOT NULL
- `bundle_hash` TEXT NOT NULL
- `outcome` TEXT CHECK ('allow', 'deny', 'error')
- `reason` TEXT
- `matched_version_id` UUID FK → policy_versions (nullable)

---

## Cedar Policy Model

### Entity Types

```
entity Organization;
entity Group in [Organization, Group];
entity Agent in [Group];
entity Resource;

action "purchase.initiate" appliesTo {
  principal: Agent,
  resource: Resource,
  context: {
    amount: Long,
    vendor: String,
    category: String,
    spend_last_24h: Long,
    transactions_last_hour: Long,
    humanApproved: Bool,
    hour: Long,
  }
};

action "purchase.settle" appliesTo {
  principal: Agent,
  resource: Resource,
  context: {
    sessionId: String,
    amount: Long,
  }
};
```

### Entity Store

Unlike the teammate's engine which uses `Entities::empty()`, we load entity relationships from the database:

```typescript
// Build Cedar entity store from DB
function buildEntityStore(agents: Agent[], groups: Group[], memberships: AgentGroupMembership[]): CedarEntities {
  // Organization entities
  // Group entities with parent relationships (Group in [Organization] or Group in [Group])
  // Agent entities with group membership (Agent in [Group, Group, ...])
  // Resource entities (one per vendor ID)
}
```

This enables Cedar's `in` operator for hierarchical checks:

```cedar
// This WORKS because we load entity relationships
permit (
  principal in Group::"acme.engineering",
  action == Action::"purchase.initiate",
  resource
) when { ... };
```

### Warranted Cedar Policies

**`policies/base.cedar`** — Org-level hard limits (cannot be overridden):

```cedar
// Absolute ceiling: no single transaction over $20,000
forbid (
  principal in Organization::"acme-corp",
  action == Action::"purchase.initiate",
  resource
) when {
  context.amount > 20000
};

// Daily spend ceiling: $50,000 across all agents
forbid (
  principal in Organization::"acme-corp",
  action == Action::"purchase.initiate",
  resource
) when {
  context.spend_last_24h + context.amount > 50000
};

// Business hours only for transactions over $5,000
forbid (
  principal in Organization::"acme-corp",
  action == Action::"purchase.initiate",
  resource
) when {
  context.amount > 5000 &&
  (context.hour < 9 || context.hour >= 17)
};
```

**`policies/procurement.cedar`** — Team-level procurement rules:

```cedar
// Engineering procurement agents: up to $5,000, approved vendors, approved categories
permit (
  principal in Group::"acme.engineering",
  action == Action::"purchase.initiate",
  resource
) when {
  context.amount <= 5000 &&
  [context.vendor].containsAny(["aws", "azure", "gcp", "github", "vercel", "railway", "vendor-acme-001"]) &&
  [context.category].containsAny(["compute", "api-credits", "software-licenses", "infrastructure"])
};

// Finance team: higher limit, broader vendor access
permit (
  principal in Group::"acme.finance",
  action == Action::"purchase.initiate",
  resource
) when {
  context.amount <= 10000
};

// Escalation: any purchase over $1,000 requires human approval
forbid (
  principal in Organization::"acme-corp",
  action == Action::"purchase.initiate",
  resource
) when {
  context.amount > 1000 &&
  !context.humanApproved
};

// Rate limit: no more than 10 transactions per hour
forbid (
  principal in Organization::"acme-corp",
  action == Action::"purchase.initiate",
  resource
) when {
  context.transactions_last_hour >= 10
};
```

### Cedar Evaluation Flow

1. Load all active policy versions' `cedar_source` from DB
2. Concatenate into a single policy set string
3. Parse via `@cedar-policy/cedar-wasm`
4. Build entity store from agents, groups, memberships
5. Construct the request: `{ principal: Agent::"<uuid>", action: Action::"purchase.initiate", resource: Resource::"<vendor-id>", context: { ... } }`
6. Call `isAuthorized(policySet, entities, request)`
7. Return decision + diagnostics (matching policy IDs)

---

## Envelope Resolution

The envelope resolver computes an agent's effective permissions by walking the group hierarchy.

### Algorithm

```
resolveEnvelope(agentId):
  1. Get agent's direct group memberships
  2. For each group, collect ancestors by walking path prefixes:
     "acme.engineering.infra" → ["acme", "acme.engineering", "acme.engineering.infra"]
  3. Collect all policy assignments from:
     - ancestor groups (inherited)
     - direct groups (team-level)
     - agent-level assignments (most specific)
  4. Load active versions for each assigned policy
  5. For each action type, resolve dimensions by intersection:
     - numeric: take minimum max across all sources
     - set: take intersection of members across all sources
     - boolean: OR (any true wins)
     - rate: take minimum limit
     - temporal: take tightest window (latest start, earliest end)
  6. Apply deny overrides: any deny-effect policy from any level beats all allows
  7. Return ResolvedEnvelope with full provenance chain
```

### Example

Agent "procurement-agent-001" is in group "acme.engineering":

```
Org level (acme):
  - purchase.initiate: amount max $20,000, vendors: ["*"], categories: ["*"]

Department level (acme.engineering):
  - purchase.initiate: amount max $5,000, vendors: ["aws","azure","gcp","vendor-acme-001"], categories: ["compute","api-credits"]

Result (intersection):
  - purchase.initiate: amount max $5,000, vendors: ["aws","azure","gcp","vendor-acme-001"], categories: ["compute","api-credits"]
```

The org allows $20,000 but engineering narrows to $5,000. The org allows all vendors but engineering narrows to a specific set. Constraints only narrow.

---

## API Endpoints

Hono server on configurable port (default 8200).

### Policy Evaluation

**`POST /check`** — The Gate. Primary endpoint.

Request:
```json
{
  "agentDid": "did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6",
  "action": "purchase.initiate",
  "resource": "vendor-acme-001",
  "context": {
    "amount": 2500,
    "vendor": "vendor-acme-001",
    "category": "compute",
    "spend_last_24h": 1000,
    "transactions_last_hour": 3,
    "humanApproved": false,
    "hour": 14
  }
}
```

Response (allowed):
```json
{
  "decision": "allow",
  "reasons": [
    {
      "policyName": "engineering-procurement",
      "policyId": "uuid",
      "effect": "allow",
      "message": "Permitted by engineering procurement policy"
    }
  ],
  "requiresApproval": true,
  "envelope": null
}
```

Response (denied):
```json
{
  "decision": "deny",
  "reasons": [
    {
      "policyName": "org-spending-ceiling",
      "policyId": "uuid",
      "effect": "deny",
      "dimension": "amount",
      "message": "Transaction amount 25000 exceeds org ceiling of 20000"
    }
  ],
  "requiresApproval": false,
  "envelope": null
}
```

Note on `requiresApproval`: When the escalation policy fires (amount > $1,000 and `humanApproved` is false), the response is `decision: "deny"` with `requiresApproval: true`. The sidecar translates this to `{ authorized: false, requires_approval: true }` so the agent knows to ask for human approval rather than treating it as a hard block.

**`POST /check?envelope=true`** — Same as above but includes the full `ResolvedEnvelope` in the response (for debugging and dashboard display).

### Envelope

**`GET /agents/:did/envelope`** — Resolve an agent's effective permissions.

Response:
```json
{
  "agentId": "uuid",
  "agentDid": "did:mesh:8ae56e...",
  "agentName": "procurement-agent-001",
  "actions": [
    {
      "actionName": "purchase.initiate",
      "denied": false,
      "denySource": null,
      "dimensions": [
        {
          "name": "amount",
          "kind": "numeric",
          "resolved": { "kind": "numeric", "max": 5000 },
          "sources": [
            { "policyName": "org-ceiling", "groupName": "Acme Corp", "level": "org", "value": { "kind": "numeric", "max": 20000 } },
            { "policyName": "eng-procurement", "groupName": "Engineering", "level": "department", "value": { "kind": "numeric", "max": 5000 } }
          ]
        },
        {
          "name": "vendor",
          "kind": "set",
          "resolved": { "kind": "set", "members": ["aws", "azure", "gcp", "vendor-acme-001"] },
          "sources": [...]
        }
      ]
    }
  ]
}
```

### Management

**`GET /organizations`** — List organizations.
**`POST /organizations`** — Create organization `{ name, slug }`.

**`GET /groups`** — List groups (optional `?orgId=`).
**`POST /groups`** — Create group `{ name, nodeType, path, orgId, parentId }`.
**`GET /groups/:id`** — Get group.
**`GET /groups/:id/members`** — List agents in group.
**`POST /groups/:id/members`** — Add agent `{ agentId }`.
**`DELETE /groups/:id/members/:agentId`** — Remove agent.

**`GET /agents`** — List agents (optional `?orgId=`).
**`POST /agents`** — Create agent `{ name, did, domain, orgId }`.
**`GET /agents/:id`** — Get agent.
**`PUT /agents/:id`** — Update agent.
**`DELETE /agents/:id`** — Deactivate agent.
**`GET /agents/:did/envelope`** — Resolve effective envelope (by DID).
**`GET /agents/:did/decisions`** — Get decision history (by DID).

**`GET /policies`** — List policies (optional `?orgId=`).
**`POST /policies`** — Create policy `{ name, domain, effect, orgId }`.
**`GET /policies/:id`** — Get policy with active version.
**`PUT /policies/:id`** — Update policy metadata.
**`DELETE /policies/:id`** — Delete policy.
**`GET /policies/:id/versions`** — List versions.
**`POST /policies/:id/versions`** — Create version `{ constraints, cedarSource }`. Auto-activates. Validates Cedar before saving.

**`POST /assignments`** — Assign policy to group or agent `{ policyId, groupId?, agentId? }`.
**`DELETE /assignments/:id`** — Remove assignment.

**`GET /action-types`** — List action types with dimensions.
**`GET /decisions`** — Query decision log `?agentDid=&outcome=&limit=&offset=`.

**`POST /reload`** — Reload Cedar policy set from DB (hot reload without restart).
**`GET /health`** — Health check.

---

## Integration with Warranted Sidecar

### Current Flow (hardcoded Python)
```
OpenClaw agent → sidecar /check_authorization
  → if amount > SPENDING_LIMIT: deny
  → if vendor not in APPROVED_VENDORS: deny
  → if category not in PERMITTED_CATEGORIES: deny
  → if amount > 1000: requires_approval = true
  → return { authorized, requires_approval, reasons }
```

### New Flow (Cedar via rules engine)
```
OpenClaw agent → sidecar /check_authorization
  → sidecar calls rules-engine POST /check with:
    {
      agentDid: <from sidecar identity>,
      action: "purchase.initiate",
      resource: <vendor>,
      context: {
        amount: <from request>,
        vendor: <from request>,
        category: <from request>,
        spend_last_24h: <from sidecar state or 0>,
        transactions_last_hour: <from sidecar state or 0>,
        humanApproved: <from request, default false>,
        hour: <current hour>
      }
    }
  → rules engine evaluates Cedar policies against entity hierarchy
  → returns { decision, reasons, requiresApproval }
  → sidecar translates to existing response format
  → SDK middleware and OpenClaw skill see no change
```

### Sidecar Changes

Add one function to `sidecar/server.py`:

```python
RULES_ENGINE_URL = os.environ.get("RULES_ENGINE_URL", "http://rules-engine:8200")

async def check_via_rules_engine(agent_did, vendor, amount, category, human_approved=False):
    """Call the rules engine instead of hardcoded checks."""
    try:
        response = await httpx.post(f"{RULES_ENGINE_URL}/check", json={
            "agentDid": agent_did,
            "action": "purchase.initiate",
            "resource": vendor,
            "context": {
                "amount": amount,
                "vendor": vendor,
                "category": category,
                "spend_last_24h": 0,       # TODO: wire to ledger
                "transactions_last_hour": 0, # TODO: wire to ledger
                "humanApproved": human_approved,
                "hour": datetime.now().hour,
            }
        })
        result = response.json()
        return {
            "authorized": result["decision"] == "allow",
            "requires_approval": result.get("requiresApproval", False),
            "reasons": [r["message"] for r in result.get("reasons", [])],
        }
    except Exception:
        # Fallback to hardcoded checks if rules engine is unreachable
        return check_local(vendor, amount, category)
```

The `/check_authorization` endpoint calls `check_via_rules_engine()` instead of the hardcoded `if/else` chain. Fallback to local checks ensures the demo still works if the rules engine isn't running.

---

## Seed Data

The seed script creates the Acme Corp organization with groups, agents, policies, and assignments that match the current sidecar configuration.

### Organizations
- Acme Corp (slug: "acme-corp")

### Groups (hierarchy)
```
acme-corp (org)
├── acme.executive (department) — CFO, CTO
├── acme.engineering (department) — VP Engineering
│   └── acme.engineering.procurement (team) — procurement agents
└── acme.finance (department) — finance agents
```

### Agents
- procurement-agent-001 (did:mesh:8ae56e..., in acme.engineering.procurement)
  — matches ED25519_SEED=test-seed-123

### Policies
1. **org-ceiling** (deny, org-level) — amount > $20,000 → deny
2. **daily-spend-limit** (deny, org-level) — spend_last_24h + amount > $50,000 → deny
3. **engineering-procurement** (allow, department-level) — amount ≤ $5,000, vendors: [aws, azure, gcp, github, vercel, railway, vendor-acme-001], categories: [compute, api-credits, software-licenses]
4. **escalation-threshold** (deny, org-level) — amount > $1,000 && !humanApproved → deny (with requiresApproval flag)
5. **rate-limit** (deny, org-level) — transactions_last_hour ≥ 10 → deny
6. **business-hours** (deny, org-level) — amount > $5,000 outside 9-17 → deny

### Action Types
- `purchase.initiate` (domain: finance) — dimensions: amount (numeric), vendor (set), category (set), spend_last_24h (numeric), transactions_last_hour (rate), humanApproved (boolean), hour (numeric)
- `purchase.settle` (domain: finance) — dimensions: sessionId (set), amount (numeric)

---

## Docker Integration

Add to the OpenClaw `docker-compose.yml`:

```yaml
  rules-engine:
    image: oven/bun:latest
    working_dir: /app
    volumes:
      - ../warranted:/app
    environment:
      - DATABASE_URL=postgresql://warranted:warranted@rules-db:5432/warranted?schema=rules
      - PORT=8200
    command: bun run packages/rules-engine/src/server.ts
    ports:
      - "8200:8200"
    depends_on:
      - rules-db

  rules-db:
    image: postgres:16
    environment:
      - POSTGRES_DB=warranted
      - POSTGRES_USER=warranted
      - POSTGRES_PASSWORD=warranted
    volumes:
      - rules-db-data:/var/lib/postgresql/data
    ports:
      - "5433:5432"
```

Or share the existing Postgres instance with schema separation.

---

## Test Strategy

### Unit Tests

**cedar.test.ts** — Cedar WASM evaluation:
- Parse valid Cedar policy string → no errors
- Parse invalid Cedar → returns parse errors
- Evaluate permit policy with matching context → "allow"
- Evaluate permit policy with non-matching context → "deny" (default deny)
- Evaluate forbid policy → overrides matching permit
- Build entity store from agents/groups → entities resolve correctly
- `principal in Group::` works with loaded entity hierarchy

**envelope.test.ts** — Envelope resolution:
- Agent in one group → envelope matches group's policy
- Agent in nested group → inherits ancestor constraints
- Numeric intersection → takes minimum max
- Set intersection → takes intersection of members
- Deny override → deny from any level beats all allows
- Agent with no policies → empty envelope (default deny)
- Multiple groups → constraints narrow correctly

**check.test.ts** — Gate/PEP:
- Valid request within policy → allow
- Amount over limit → deny with OVER_LIMIT-equivalent reason
- Vendor not in approved set → deny
- Category not approved → deny
- Escalation threshold → deny with requiresApproval: true
- Unknown agent DID → deny with UNKNOWN_AGENT reason
- Inactive agent → deny with AGENT_INACTIVE reason
- Decision logged to decision_log table

**groups.test.ts** — Hierarchy:
- Create org → department → team chain
- Path query finds all ancestors
- Add agent to group → membership created
- Remove agent from group → membership deleted

**policies.test.ts** — Policy CRUD:
- Create policy with constraints → Cedar source generated
- Create version → auto-activates, old version preserved
- Cedar validation rejects invalid source
- Cedar hash is SHA-256 of source
- Delete policy → cascades to versions and assignments

**server.test.ts** — API integration:
- POST /check with valid request → correct response shape
- POST /check with unknown DID → deny
- GET /agents/:did/envelope → resolved envelope
- POST /reload → policies reloaded from DB
- GET /health → 200

### Integration Test (with sidecar)

- Start rules engine + sidecar + vendor server
- Agent gets token from sidecar
- Agent creates session (sidecar calls rules engine /check)
- Purchase within limits → allowed
- Purchase over limit → denied with correct reason
- Purchase requiring approval → denied with requiresApproval: true

---

## References

- [Warranted CLAUDE.md](/CLAUDE.md)
- [Storefront SDK Spec](/docs/plans/storefront-sdk-SPEC.md)
- [Spending Policy YAML](/sidecar/policies/spending-policy.yaml)
- [Rules Engine Architecture](/docs/plans/rules-engine-ARCHITECTURE.md)
- [Cedar Policy Language](https://www.cedarpolicy.com/)
- [`@cedar-policy/cedar-wasm` npm](https://www.npmjs.com/package/@cedar-policy/cedar-wasm)