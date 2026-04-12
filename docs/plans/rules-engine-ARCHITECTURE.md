# Rules Engine — Architecture Map & Integration Plan

## Package Overview

The rules engine is a multi-service policy evaluation and management system that implements an Active Directory-style group policy model for AI agents. It evaluates Cedar authorization policies at runtime via a Rust-native Cedar engine (`POST /check`), manages policy CRUD/versioning/hierarchy through a Kotlin/Ktor management API, and provides a Next.js admin dashboard for policy authoring, envelope visualization, and testing. The core abstraction is the **envelope model**: every agent's effective permissions are the intersection of all inherited policies from its group hierarchy, where constraints can only narrow (never widen) as they cascade down.

- **Version:** 0.1.0 (all three services)
- **Dependencies:** Rust (`cedar-policy` 4.9, axum, sqlx, tokio), Kotlin (Ktor 3.0.3, Exposed ORM 0.58, `cedar-java` 4.2.2, Flyway 10.22), Next.js 14 (React 18, Radix UI)
- **Current state:** Fully built and functional as a standalone Docker Compose stack. Wave 1 (services + DB) and Wave 2 (structured builder, REPL, RSoP, versioning) are complete. Wave 3 (agent-assisted builder / LLM chat) is stubbed (UI placeholder only). Wave 4 (dry-run replay, batch test, rollback preview) is not started. OPA/Rego integration is described in docs but **not implemented** — Cedar is the sole policy engine.

---

## Directory Structure

```
packages/rules_engine/
├── README.md                          # Project overview and concept description
├── BUILD_PLAN.md                      # 4-wave architecture plan (Rust/Kotlin/React)
├── DEVLOG.md                          # Architecture decisions and research synthesis
├── NEXT_STEPS.md                      # Phased implementation roadmap
├── schema.sql                         # Reference PostgreSQL schema (source of truth)
├── seed.sql                           # Acme Corp demo data (~15 agents, 8 policies)
├── Makefile                           # Docker Compose shortcuts (up, down, db-reset, test-smoke)
├── docker-compose.yml                 # 4-service stack: postgres, engine, management, frontend
├── .gitignore                         # Standard ignores
├── db/
│   └── init/
│       └── 01_extensions.sql          # pgcrypto + ltree extensions (Docker entrypoint)
├── engine/                            # Rust Cedar evaluation service
│   ├── Cargo.toml                     # Workspace root (cedar-policy 4.9, axum, sqlx)
│   ├── Cargo.lock
│   ├── Dockerfile / Dockerfile.dev    # Production (multi-stage) / dev (cargo-watch)
│   └── crates/
│       ├── engine/                    # Core library
│       │   ├── Cargo.toml
│       │   └── src/
│       │       ├── lib.rs             # Module exports
│       │       └── evaluator.rs       # CheckRequest/CheckResponse + check() function [NO TESTS]
│       └── api-server/                # HTTP server
│           ├── Cargo.toml
│           └── src/
│               ├── main.rs            # Axum server, policy loading with retry loop [NO TESTS]
│               ├── routes.rs          # /check, /reload, /health handlers [NO TESTS]
│               └── db.rs              # load_policy_sources() from Postgres [NO TESTS]
├── management/                        # Kotlin/Ktor management API
│   ├── build.gradle.kts               # Ktor + Exposed + cedar-java + Flyway deps
│   ├── settings.gradle.kts            # Project name
│   ├── Dockerfile / Dockerfile.dev    # Production (shadow JAR) / dev (gradle run)
│   ├── gradlew                        # Gradle wrapper
│   ├── gradle/wrapper/
│   │   └── gradle-wrapper.properties
│   └── src/main/
│       ├── kotlin/com/rulesengine/
│       │   ├── Application.kt         # Entry point, module wiring [NO TESTS]
│       │   ├── models/
│       │   │   └── Models.kt          # All @Serializable request/response data classes [NO TESTS]
│       │   ├── plugins/
│       │   │   ├── Database.kt        # HikariCP + Flyway + Exposed config [NO TESTS]
│       │   │   ├── Routing.kt         # CORS + route mounting under /api/v1 [NO TESTS]
│       │   │   ├── Serialization.kt   # kotlinx.json content negotiation [NO TESTS]
│       │   │   └── StatusPages.kt     # Error handling (400/404/500) [NO TESTS]
│       │   ├── routes/
│       │   │   ├── RouteUtils.kt      # uuidParam() helper [NO TESTS]
│       │   │   ├── PolicyRoutes.kt    # CRUD + versioning + Cedar generation [NO TESTS]
│       │   │   ├── AgentRoutes.kt     # CRUD + effective-envelope + effective-policies [NO TESTS]
│       │   │   ├── GroupRoutes.kt     # CRUD for hierarchical groups [NO TESTS]
│       │   │   ├── AssignmentRoutes.kt # Policy-to-group/agent assignment [NO TESTS]
│       │   │   ├── MembershipRoutes.kt # Agent-group membership management [NO TESTS]
│       │   │   ├── ActionTypeRoutes.kt # Action type + dimension definitions [NO TESTS]
│       │   │   ├── DecisionLogRoutes.kt # Decision log querying [NO TESTS]
│       │   │   └── HealthRoutes.kt    # GET /health [NO TESTS]
│       │   ├── services/
│       │   │   ├── EnvelopeResolver.kt # Core business logic — RSoP + envelope resolution [NO TESTS]
│       │   │   ├── CedarGenerator.kt  # Structured constraints → Cedar source [NO TESTS]
│       │   │   └── CedarValidator.kt  # Cedar source validation via cedar-java [NO TESTS]
│       │   └── tables/
│       │       ├── Tables.kt          # 9 Exposed table definitions [NO TESTS]
│       │       └── ColumnTypes.kt     # Custom ltree + pgEnum column types [NO TESTS]
│       └── resources/
│           ├── application.conf       # Ktor config (port 8080)
│           ├── logback.xml            # Logging config
│           └── db/migration/
│               ├── V1__initial_schema.sql   # DDL: extensions, enums, 9 tables
│               └── R__seed_data.sql         # Repeatable: Acme Corp demo data
├── frontend/                          # Next.js 14 admin dashboard
│   ├── package.json                   # next 14.2.21, react 18, radix-ui, tailwind
│   ├── tsconfig.json
│   ├── next.config.mjs                # API rewrites to management:8080 and engine:3001
│   ├── tailwind.config.ts             # Configured but unused (CSS custom properties instead)
│   ├── postcss.config.js
│   ├── Dockerfile.dev                 # node:20-alpine dev image
│   ├── app/
│   │   ├── layout.tsx                 # Root layout with Header [NO TESTS]
│   │   ├── page.tsx                   # Dashboard: OrgOverview + RecentDecisions + QuickActions [NO TESTS]
│   │   ├── globals.css                # 614-line neumorphic design system [NO TESTS]
│   │   ├── agents/
│   │   │   ├── page.tsx               # Agent list with EntityList [NO TESTS]
│   │   │   └── [id]/page.tsx          # Agent detail: Envelope/Decisions/Test tabs [NO TESTS]
│   │   ├── groups/
│   │   │   ├── page.tsx               # Group list [NO TESTS]
│   │   │   └── [id]/page.tsx          # Group detail: Members/Policies tabs [NO TESTS]
│   │   └── policies/
│   │       ├── page.tsx               # Policy list [NO TESTS]
│   │       └── [id]/page.tsx          # Policy detail: Constraints/Cedar/History tabs [NO TESTS]
│   ├── lib/
│   │   └── api.ts                     # Typed API client (234 lines) [NO TESTS]
│   └── components/
│       ├── Icons.tsx                   # 28 SVG icon components
│       ├── ChatPanel.tsx              # Stub: "AI assistant coming in Phase 2"
│       ├── layout/
│       │   ├── Header.tsx             # Nav bar with entity counts + CMD+K search
│       │   ├── Breadcrumb.tsx         # Breadcrumb navigation
│       │   └── SearchDialog.tsx       # Global search overlay (CMD+K)
│       ├── entity/
│       │   └── EntityList.tsx         # Generic typed table with search/filter
│       ├── dashboard/
│       │   ├── OrgOverview.tsx        # Stat cards grid
│       │   ├── RecentDecisions.tsx    # Recent decision log table
│       │   └── QuickActions.tsx       # Quick action buttons
│       ├── envelope/
│       │   ├── EnvelopeView.tsx       # Effective envelope visualization
│       │   ├── DimensionDisplay.tsx   # Dimension value renderer by kind
│       │   ├── InheritanceChain.tsx   # Policy source chain visualization
│       │   └── DenyBanner.tsx         # Deny override indicator
│       └── create/
│           ├── CreateModal.tsx        # Reusable modal wrapper
│           ├── CreateAgentFlow.tsx    # Agent creation form
│           ├── CreateGroupFlow.tsx    # Group creation form
│           └── CreatePolicyFlow.tsx   # 3-step policy creation wizard
└── tests/
    └── smoke.sh                       # Docker Compose integration smoke test (health, seed, CRUD, Cedar /check)
```

**Test coverage note:** There are **zero unit tests** across all three services. The only test is `tests/smoke.sh`, a bash-based Docker Compose integration smoke test that validates health endpoints, seed data presence, CRUD operations, and a basic Cedar `/check` call.

---

## Core Primitives (from actual code)

### Gate (PEP) — Cedar Engine

The gate is implemented as the Rust `api-server` crate. The core evaluation function:

```rust
// engine/crates/engine/src/evaluator.rs

pub struct CheckRequest {
    pub principal: String,   // e.g. Agent::"20000000-..."
    pub action: String,      // e.g. Action::"purchase.initiate"
    pub resource: String,    // e.g. Resource::"any"
    pub context: serde_json::Value,  // arbitrary JSON context
}

pub struct CheckResponse {
    pub decision: String,       // "Allow" or "Deny"
    pub diagnostics: Vec<String>, // matching policy IDs or error messages
}

pub fn check(policy_set: &PolicySet, request: &CheckRequest) -> Result<CheckResponse, EvalError>
```

**How it's called:** HTTP `POST /check` with JSON body. The Axum handler deserializes the request, reads the in-memory `Arc<RwLock<PolicySet>>`, calls `engine::evaluator::check()`, and returns JSON. Policies are loaded from Postgres at startup (with a 30-attempt retry loop, 2s apart) and can be hot-reloaded via `POST /reload`.

**What it accepts:** Cedar entity UIDs as strings (parsed via `.parse::<EntityUid>()`), plus arbitrary JSON context. Context is passed through to Cedar's `Context::from_json_value()`.

**What it returns:** `"Allow"` or `"Deny"` with diagnostics listing matching policy IDs or evaluation errors.

### Check API

The Check API is the `POST /check` endpoint on port 3001. It is:
- **Synchronous** per request (Cedar evaluation is sub-millisecond)
- **In-process** Cedar evaluation (no subprocess or sidecar)
- **Stateless** per request — all state is in the pre-loaded `PolicySet`

**Permit example response:**
```json
{ "decision": "Allow", "diagnostics": ["policy0"] }
```

**Deny example response (default deny — no matching permit policy):**
```json
{ "decision": "Deny", "diagnostics": [] }
```

### Group Policy Hierarchy

**Data model (from Exposed/Kotlin `Tables.kt` and `schema.sql`):**

```
organizations (id, name, slug)
    └── groups (id, org_id, name, node_type, path LTREE, parent_id)
            └── agent_group_memberships (agent_id, group_id)  -- many-to-many
    └── agents (id, org_id, name, email, domain, is_active)
```

Groups use PostgreSQL `ltree` for hierarchical path queries. Example paths:
- `acme` (org root)
- `acme.finance` (department)
- `acme.finance.ap` (team)

**Policy inheritance** is implemented in `EnvelopeResolver.kt` (403 lines):

1. Find the agent's direct group memberships
2. Walk ancestors using ltree `@>` operator (custom `LtreeOp` Exposed expression)
3. Collect all policy assignments from ancestor groups + direct agent assignments
4. Load active policy versions with their JSON constraints
5. Resolve dimensions using **intersection semantics** per kind:
   - **numeric:** take minimum `max` across all sources
   - **set:** take intersection of `members` across all sources
   - **boolean:** OR (any `true` wins)
   - **temporal:** take tightest window (latest start, earliest end)
   - **rate:** take minimum `limit`
6. **Deny overrides:** explicit deny policies from any level beat inherited allows

**"Constraints only narrow" enforcement:** The structured constraint model inherently narrows — numeric takes min, set takes intersection, temporal takes tightest. The `CedarGenerator` generates Cedar `forbid` blocks for deny-effect policies, which in Cedar's evaluation model always override `permit` blocks regardless of specificity.

### Envelope Model

The envelope is computed **at query time** by `EnvelopeResolver.resolve()`. There is no caching.

**Response shape (`EffectiveEnvelopeResponse`):**
```kotlin
data class EffectiveEnvelopeResponse(
    val agentId: String,
    val agentName: String,
    val actions: List<ResolvedAction>,  // one per action type
)

data class ResolvedAction(
    val actionId: String,
    val actionName: String,
    val denied: Boolean,           // true if any deny policy applies
    val denySource: String?,       // policy name that caused the deny
    val dimensions: List<ResolvedDimension>,
)

data class ResolvedDimension(
    val name: String,
    val kind: String,
    val resolved: JsonElement,     // the computed intersection value
    val sources: List<DimensionSource>,  // where each constraint came from
)

data class DimensionSource(
    val policyName: String,
    val groupName: String?,
    val level: String,            // "org" | "department" | "team" | "agent"
    val value: JsonElement,
)
```

### Petitioning

**Not implemented.** Described in the README as a core primitive ("agents can request one-time exceptions that escalate up the authority chain") but there is no code, schema, or API endpoint for it. No `petitions` table exists.

---

## Policy Engines

### Cedar Integration

**How policies are loaded:** At startup, the Rust engine queries:
```sql
SELECT pv.cedar_source
FROM policy_versions pv
JOIN policies p ON p.active_version_id = pv.id
```
All Cedar sources are concatenated and parsed into a single `PolicySet`.

**How they're evaluated:** The `cedar-policy` 4.9 Rust crate's `Authorizer::is_authorized()` method evaluates against `Entities::empty()` (no entity hierarchy loaded — principals, actions, and resources are matched by exact UID only).

**Cedar validation:** The Kotlin management service validates Cedar source using `cedar-java` 4.2.2 (`com.cedarpolicy.model.policy.PolicySet.parsePolicies()`). Validation runs on every version creation.

**Cedar generation from structured constraints:** `CedarGenerator.kt` converts JSON constraint arrays into Cedar `permit`/`forbid` blocks. Example generated output (from seed data):
```cedar
permit (
  principal in Group::"acme",
  action == Action::"purchase.initiate",
  resource
)
when {
  context.amount <= 5000 &&
  context.vendor in ["AWS", "Azure", "GCP"] &&
  context.hour >= 9 && context.hour < 17 &&
  context.request_date < "2026-06-01"
};
```

**No `.cedar` files exist** in the repository. All Cedar source is stored in the `policy_versions.cedar_source` database column.

**npm package:** N/A for Cedar (Rust native). The Kotlin side uses `cedar-java` 4.2.2 via Gradle.

### OPA/Rego Integration

**Not implemented.** The README and DEVLOG describe OPA/Rego as the "quantitative" engine for budgets, rate limits, and rolling windows. No Rego files, no OPA dependency, no OPA sidecar, and no code for OPA evaluation exist anywhere in the codebase. The dimension kinds `rate` and `temporal` are handled in the Cedar constraint model and `EnvelopeResolver` instead.

---

## API Endpoints

### Rust Cedar Engine (port 3001)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `POST` | `/check` | Evaluate Cedar authorization request | None |
| `POST` | `/reload` | Reload policies from Postgres into memory | None |
| `GET` | `/health` | Health check (returns `"ok"`) | None |

**`POST /check` request:**
```json
{
  "principal": "Agent::\"uuid\"",
  "action": "Action::\"purchase.initiate\"",
  "resource": "Resource::\"any\"",
  "context": { "amount": 100, "vendor": "AWS", "hour": 10 }
}
```

**`POST /check` response:**
```json
{ "decision": "Allow", "diagnostics": ["policy0"] }
```

### Kotlin Management API (port 8080, prefix `/api/v1`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/policies` | List all policies |
| `POST` | `/policies` | Create policy (name, domain, effect, orgId) |
| `GET` | `/policies/{id}` | Get policy by ID |
| `PUT` | `/policies/{id}` | Update policy |
| `DELETE` | `/policies/{id}` | Delete policy |
| `GET` | `/policies/{id}/versions` | List policy versions |
| `POST` | `/policies/{id}/versions` | Create version (cedarSource, constraints) — validates Cedar, auto-activates |
| `POST` | `/policies/{id}/versions/generate` | Generate Cedar from structured constraints, validate, store, activate |
| `POST` | `/policies/{id}/versions/{versionId}/activate` | Set specific version as active |
| `GET` | `/agents` | List all agents |
| `POST` | `/agents` | Create agent (name, domain, orgId, email) |
| `GET` | `/agents/{id}` | Get agent by ID |
| `PUT` | `/agents/{id}` | Update agent |
| `DELETE` | `/agents/{id}` | Delete agent |
| `GET` | `/agents/{id}/effective-envelope` | Resolve agent's effective envelope (full RSoP) |
| `GET` | `/agents/{id}/effective-policies` | List all policies applying to agent |
| `GET` | `/agents/{id}/assignments` | List policy assignments for agent |
| `GET` | `/agents/{id}/groups` | List groups agent belongs to |
| `GET` | `/groups` | List all groups |
| `POST` | `/groups` | Create group (name, nodeType, path, orgId, parentId) |
| `GET` | `/groups/{id}` | Get group by ID |
| `DELETE` | `/groups/{id}` | Delete group |
| `GET` | `/groups/{id}/members` | List agents in group |
| `POST` | `/groups/{id}/members` | Add agent to group |
| `DELETE` | `/groups/{id}/members/{agentId}` | Remove agent from group |
| `POST` | `/assignments` | Create policy assignment (policyId, groupId or agentId) |
| `DELETE` | `/assignments/{id}` | Remove assignment |
| `GET` | `/decisions` | List decision logs (filters: agentId, outcome; pagination) |
| `GET` | `/decisions/{id}` | Get single decision log entry |
| `GET` | `/action-types` | List all action types with dimension definitions |
| `GET` | `/action-types/{id}` | Get single action type with dimensions |
| `GET` | `/action-types/{id}/dimensions` | Get dimensions for action type |
| `GET` | `/health` | Health check |

**Authentication/authorization on endpoints:** **None.** All endpoints are unauthenticated. CORS allows localhost:3100, :3000, :8080.

---

## Database Schema

### Tables (PostgreSQL 16 + pgcrypto + ltree)

**`organizations`** — Multi-tenant root
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | gen_random_uuid() |
| name | TEXT | UNIQUE |
| slug | TEXT | UNIQUE |
| created_at | TIMESTAMPTZ | |

**`groups`** — Hierarchical group tree via ltree
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| org_id | UUID (FK → organizations) | CASCADE delete |
| name | TEXT | |
| node_type | TEXT | CHECK: 'org', 'department', 'team' |
| path | LTREE | Materialized path, GIST indexed |
| parent_id | UUID (FK → groups, nullable) | |
| created_at | TIMESTAMPTZ | |

**`agents`** — Individual AI agents
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| org_id | UUID (FK → organizations) | CASCADE delete |
| name | TEXT | |
| email | TEXT (nullable) | |
| domain | domain_enum | finance, communication, agent_delegation |
| is_active | BOOLEAN | default TRUE |
| created_at | TIMESTAMPTZ | |

**`agent_group_memberships`** — Many-to-many agent ↔ group
| Column | Type | Notes |
|--------|------|-------|
| agent_id | UUID (FK → agents, PK) | CASCADE delete |
| group_id | UUID (FK → groups, PK) | CASCADE delete |

**`action_types`** — Typed agent actions (14 seeded)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| domain | domain_enum | |
| name | TEXT | e.g. "purchase.initiate" |
| description | TEXT (nullable) | |

**`dimension_definitions`** — Constraint schema per action type (16 seeded)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| action_type_id | UUID (FK → action_types) | CASCADE delete |
| dimension_name | TEXT | e.g. "amount", "vendor" |
| kind | dimension_kind | numeric, rate, set, boolean, temporal |
| numeric_max | NUMERIC (nullable) | |
| rate_window | TEXT (nullable) | e.g. "1 day" |
| set_members | TEXT[] (nullable) | |
| bool_default | BOOLEAN (nullable) | |
| temporal_start | TIME (nullable) | |
| temporal_end | TIME (nullable) | |
| temporal_expiry | DATE (nullable) | |

**`policies`** — Policy definitions
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| org_id | UUID (FK → organizations) | CASCADE delete |
| name | TEXT | UNIQUE per org |
| domain | domain_enum | |
| effect | policy_effect | allow, deny |
| created_at | TIMESTAMPTZ | |
| active_version_id | UUID (FK → policy_versions, nullable) | |

**`policy_versions`** — Immutable version records
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| policy_id | UUID (FK → policies) | CASCADE delete |
| version_number | INT | Auto-incremented per policy |
| constraints | JSONB | Structured constraint array |
| cedar_source | TEXT | Raw Cedar policy source |
| cedar_hash | TEXT | `GENERATED ALWAYS AS SHA-256(cedar_source)` |
| created_at | TIMESTAMPTZ | |
| created_by | UUID (FK → agents, nullable) | |

**`policy_assignments`** — Policy ↔ target binding
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| policy_id | UUID (FK → policies) | CASCADE delete |
| policy_version_id | UUID (FK → policy_versions) | |
| group_id | UUID (FK → groups, nullable) | CHECK: exactly one of group_id or agent_id |
| agent_id | UUID (FK → agents, nullable) | |
| assigned_at | TIMESTAMPTZ | |

**`decision_log`** — Immutable audit trail
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| evaluated_at | TIMESTAMPTZ | Indexed with agent_id, and with outcome |
| agent_id | UUID (FK → agents) | |
| action_type_id | UUID (FK → action_types) | |
| request_context | JSONB | Snapshot of evaluated context |
| bundle_hash | TEXT | SHA-256 of all active cedar_sources (indexed) |
| outcome | decision_outcome | allow, deny, not_applicable, error |
| reason | TEXT (nullable) | |
| matched_version_id | UUID (FK → policy_versions, nullable) | |

### Relationships
- Organization owns groups, agents, and policies
- Groups form a tree via `parent_id` + ltree `path`
- Agents belong to groups via `agent_group_memberships`
- Policies have immutable versions; one is active
- Assignments bind a policy (at a specific version) to either a group or an agent
- Decision log references the agent, action type, and optionally the matching policy version

### Migrations
Flyway runs from the Kotlin management service (`V1__initial_schema.sql` for DDL, `R__seed_data.sql` as repeatable for demo data). The Rust engine depends on `management` being healthy (i.e., migrations complete) before starting.

---

## Dashboard

### Pages

| Page | Path | Purpose |
|------|------|---------|
| Dashboard | `/` | Overview: policy/agent/group/decision counts, recent decisions, quick actions |
| Agents list | `/agents` | Searchable table of all agents with domain, email, status |
| Agent detail | `/agents/[id]` | Three tabs: **Envelope** (effective permissions visualization), **Decisions** (audit history), **Test** (policy REPL — select action type, fill context, execute check) |
| Groups list | `/groups` | Searchable table with name, type, ltree path |
| Group detail | `/groups/[id]` | Two tabs: **Members** (agents in group), **Policies** (assigned policies) |
| Policies list | `/policies` | Searchable table with name, domain, effect, active version |
| Policy detail | `/policies/[id]` | Three tabs: **Constraints** (structured view), **Cedar** (syntax-highlighted source), **History** (version timeline) |

### What an admin can do

- **Create** agents, groups, and policies (via modal flows)
- **Assign** policies to groups or agents
- **Author** policies via a 3-step structured wizard (name/domain/effect → dimension constraints → assignment)
- **View** the effective envelope for any agent (resolved permissions with inheritance chain)
- **Test** policies via the REPL (agent detail → Test tab → select action type → fill dimensions → run check against Cedar engine)
- **View** Cedar source with syntax highlighting
- **Browse** version history with version numbers and checksums
- **Search** globally across agents, groups, and policies (CMD+K)

### API routes the dashboard calls

The Next.js app proxies all API calls:
- `/api/v1/*` → `management:8080/api/v1/*` (Kotlin management API)
- `/engine/*` → `engine:3001/*` (Rust Cedar engine)

---

## Integration Points with Warranted

### Replacing the Sidecar's Policy Evaluation

**Current flow:**
```
Agent JWT → SDK middleware (verify.ts) → verifyIdentity() [steps 1-6]
                                       → verifyAuthorization() [steps 7-10: hardcoded TypeScript checks]
                                       
Separately: sidecar /check_authorization → hardcoded Python checks (SPENDING_LIMIT, APPROVED_VENDORS, etc.)
```

**Proposed flow:**
```
Agent JWT → SDK middleware → verifyIdentity() [steps 1-6, unchanged]
                           → rules-engine POST /check [Cedar evaluation replaces steps 7-10]
                           
Management UI → rules-engine management API [admin configures policies via dashboard]
```

**Specific replacements:**

| Current check | Location | Rules engine replacement |
|---|---|---|
| Spending limit (`amount > agent.spendingLimit`) | `verify.ts:130` | Cedar `when { context.amount <= N }` condition on `purchase.initiate` action. The numeric `amount` dimension with `numeric_max` enforces this. The limit comes from the agent's effective envelope (resolved from group hierarchy), not hardcoded. |
| Approved vendors (`agent.approvedVendors.includes(vendorId)`) | `verify.ts:143` | Cedar `when { context.vendor in ["AWS", "Azure", ...] }` condition. The set `vendor` dimension resolves via intersection of all ancestor policies. |
| Category restriction (`agent.categories.includes(category)`) | `verify.ts:153` | Not currently in the rules engine's seeded dimensions but maps directly to a `set` dimension on `purchase.initiate`. Add a `category` dimension with `kind: set`. |
| Escalation threshold (`amount > 1000 → requires_approval`) | `sidecar/server.py:152` | The `requires_human_approval` boolean dimension plus the `amount` numeric dimension. Currently in the rules engine as a boolean flag; could be extended to a threshold-based rule. |
| Trust score gate (`trustScore < minTrustScore`) | `verify.ts:117` | Not in the rules engine. Trust score is an identity-layer concept from AGT. Could be added as a `numeric` dimension on action types, but may be better left in the identity verification layer (steps 1-6). |
| Daily spend limit (`spend_last_24h + amount > daily_spend_limit`) | `spending-policy.yaml:60` | The `rate` dimension kind supports `count per time_window`. Map to a rate dimension on `purchase.initiate` with `rate_window: "1 day"`. Requires runtime state (spend accumulator) not yet wired. |
| Cooling-off period (`amount > cooling_off_threshold → hold 30min`) | `spending-policy.yaml:88` | The `temporal` dimension kind supports time windows. Could model as a hold action type or add a `cooling_off` dimension. Not directly implemented in the rules engine. |

**How deny-overrides maps:** Cedar's evaluation model is `forbid`-overrides-`permit` by default. The sidecar's sequential check logic (check spending, then vendor, then category — fail on first) maps to multiple Cedar `when` conditions within a single `permit` block, or separate `forbid` blocks for each denial reason. The rules engine's `EnvelopeResolver` already implements deny-overrides: a `deny`-effect policy at any hierarchy level beats `allow`-effect policies from all levels.

### Mapping Warranted Concepts to Rules Engine Concepts

| Warranted concept | Rules Engine equivalent | Status |
|---|---|---|
| Agent's spending limit | `numeric` dimension `amount` with `max` on `purchase.initiate` | Ready — seeded as $5000/$2000/$1000/$500 cascade |
| Approved vendors list | `set` dimension `vendor` with intersection semantics | Ready — seeded as ["AWS","Azure","GCP"] |
| Permitted categories | `set` dimension (add `category` to `purchase.initiate`) | Schema ready, needs new dimension definition |
| Authority chain (CFO → VP → Agent) | Group hierarchy: org → department → team → agent-level assignment. Ltree paths model the chain. | Ready — maps directly to `acme.finance.ap` hierarchy |
| Escalation threshold | `boolean` dimension `requires_human_approval` | Partially ready — exists but is a simple flag, not threshold-based |
| Cooling-off period | `temporal` dimension or custom action type | Not implemented — needs design |
| Trust score gate | No direct equivalent | Not covered — identity-layer concern |
| Token hierarchy (child narrows parent) | Envelope model: constraints only narrow via intersection semantics | Architectural match — same principle, different implementation |
| Sanctioned vendors list | Cedar `forbid` policy with vendor set | Expressible but not seeded |
| Rate limit (10 txn/hour) | `rate` dimension kind with `rate_window` | Schema ready, needs runtime state integration |
| Transaction signing (Ed25519) | Not covered | Out of scope — identity/crypto layer |

### What the Rules Engine Adds That Warranted Doesn't Have

| Capability | Status |
|---|---|
| **Multi-level group hierarchy** with ltree path queries | Ready |
| **Envelope visualization** — see exactly what an agent can do, with inheritance chain | Ready |
| **Policy versioning** with immutable versions and SHA-256 checksums | Ready |
| **Cedar policy evaluation** — formal authorization language with forbid-overrides-permit | Ready |
| **Cedar source generation** from structured constraints (no hand-writing Cedar) | Ready |
| **Bundle hash** on decision log (prove which rules governed each decision) | Ready |
| **Decision audit log** with structured query support | Ready |
| **RSoP (Resultant Set of Policy)** — conflict visualization | Ready |
| **14 typed action types** across 3 domains (finance, communication, delegation) | Ready |
| **5 dimension kinds** (numeric, rate, set, boolean, temporal) with kind-aware resolution | Ready |
| **Admin dashboard** for policy management, testing, and visualization | Ready |
| **REPL policy tester** — test a policy check from the UI | Ready |
| **OPA/Rego for quantitative rules** (budgets, rate limits, rolling windows) | Not implemented |
| **Petitioning** (agent exception requests) | Not implemented |
| **Agent-assisted policy authoring** (NL → Cedar) | Stubbed (UI only) |
| **Dry-run replay** (test rule changes against historical decisions) | Not implemented |
| **Batch test mode** (regression test suites) | Not implemented |

### What Warranted Has That the Rules Engine Doesn't

| Capability | Notes |
|---|---|
| **Ed25519 cryptographic identity** (DIDs, key generation, signing) | Entirely in the sidecar |
| **JWT token issuance and verification** | Registry package + sidecar |
| **Token hierarchy** with cascade revocation | Registry package |
| **Storefront SDK** (verification middleware, manifest, sessions, receipts, webhooks) | Storefront-sdk package |
| **Agent SDK** (buyer-side transaction client) | Agent-sdk package |
| **Transaction engine** (XState 5-phase state machine) | Engine package |
| **Internal ledger** (double-entry bookkeeping, hold/escrow) | Ledger package |
| **Negotiation protocol** (typed structured messages) | Engine package |
| **Receipt generation** with immutable audit trail | Storefront-sdk package |
| **Trust scoring** (0-1000 scale via AGT ReputationManager) | Sidecar |
| **Governance sidecar** (Ed25519 signing, identity, authorization) | Python sidecar |

### Shared Database

**Can both packages share the same Postgres instance?** Yes, with caveats:

- **Schema conflicts:** The rules engine uses `ltree` and `pgcrypto` extensions. Warranted's Drizzle schema doesn't use `ltree`. Both use `pgcrypto` (or equivalent for UUID generation). No table name conflicts — the rules engine uses `groups`, `agents`, `policies`, etc. while Warranted uses `entities`, `tokens`, etc. (from the registry schema).
- **Separate schemas recommended:** Run the rules engine tables in a `rules` PostgreSQL schema and Warranted tables in `public` (or `warranted`). This avoids any future naming conflicts and allows independent migrations.
- **Migration ordering:** The rules engine uses Flyway (Java-based, runs from the Kotlin management service). Warranted uses Drizzle Kit. These are independent migration systems. If sharing a Postgres instance, ensure extensions (`ltree`, `pgcrypto`) are created before either migration system runs (the rules engine's `db/init/01_extensions.sql` handles this for Docker).
- **Connection pooling:** The rules engine's HikariCP pool (10 connections, REPEATABLE_READ isolation) and Warranted's connection pool need to fit within Postgres' `max_connections`. Default 100 is sufficient.

---

## Integration Steps (Ordered)

### Phase 1: Run alongside (no code changes)

1. **Add rules engine to Warranted's Docker Compose** — add postgres, management, engine, and frontend services. Use a separate Postgres instance (or shared instance with schema separation) to avoid migration conflicts.
2. **Seed Warranted-specific policies** — create new action types (`purchase.initiate` with `amount`, `vendor`, `category` dimensions), policies, and groups that mirror Warranted's current spending policy YAML.
3. **Map Warranted agents to rules engine agents** — create rules engine agent records for each Warranted DID, assign to groups matching the authority chain.

### Phase 2: Wire sidecar to rules engine (parallel with Phase 1)

4. **Add HTTP client to sidecar** — the Python sidecar calls the rules engine's `POST /check` endpoint instead of (or in addition to) its hardcoded checks. Translate the sidecar's `(vendor, amount, category)` parameters into a Cedar `CheckRequest`.
5. **Map sidecar response format** — translate the rules engine's `{"decision":"Allow/Deny","diagnostics":[...]}` back to the sidecar's existing `{"authorized":true/false,"reasons":[...]}` response format. The storefront SDK and agent SDK don't need to change.
6. **Add decision logging** — POST decision results to the management API's decision log endpoint for audit trail.

### Phase 3: Extend the rules engine for Warranted-specific needs

7. **Add `category` dimension** to `purchase.initiate` action type (set kind).
8. **Add trust score dimension** or keep it in the identity layer (design decision needed).
9. **Add daily spend rate limiting** — wire runtime spend state into the Cedar context (requires querying the ledger for `spend_last_24h`).
10. **Add escalation threshold** — extend the boolean `requires_human_approval` to a threshold-based rule (amount > N → escalate).

### Phase 4: Dashboard integration

11. **Embed or link to rules engine dashboard** from the Warranted management dashboard.
12. **Sync agent lifecycle** — when Warranted creates/revokes an agent (via registry), propagate to the rules engine.

### Parallelizable work:
- Steps 1-3 (Docker + seeding) can run in parallel with step 7-8 (schema extensions)
- Step 4-6 (sidecar wiring) depends on steps 1-3
- Step 11-12 (dashboard) can start anytime after step 1

---

## Open Questions

1. **Language boundary:** The rules engine is Rust + Kotlin + TypeScript. Warranted is TypeScript + Python. Adding a Kotlin management service and Rust engine to the stack is a significant operational complexity increase. Is the Cedar evaluation valuable enough to justify three additional services, or should we port the `evaluator.rs` logic to a TypeScript Cedar WASM integration?

2. **Entity hierarchy in Cedar:** Currently, the Rust engine evaluates against `Entities::empty()`. This means Cedar's built-in `in` operator for group membership (e.g., `principal in Group::"acme.finance"`) doesn't work — only exact UID matching works. To use Cedar's native hierarchy, the engine needs to load entity relationships from the database. Is this needed for Warranted's use case?

3. **Trust score placement:** Trust score is currently checked in `verifyAuthorization()` (step 7) as an identity-layer gate. Should it move to the rules engine (as a numeric dimension on action types) or stay in the verification middleware?

4. **Runtime state for rate limits:** The rules engine's `rate` dimension kind is defined in the schema but there's no mechanism to inject runtime state (e.g., "this agent has spent $3,000 in the last 24 hours") into the Cedar context. The sidecar's `spending-policy.yaml` references `context.spend_last_24h` and `context.transactions_last_hour`. Who computes and injects this state?

5. **Policy sync:** If Warranted admins update spending limits via the Warranted dashboard (or sidecar config), how do those changes propagate to the rules engine? Manual sync? Event-driven? Single source of truth?

6. **Authentication on rules engine APIs:** All rules engine endpoints are currently unauthenticated. In a shared deployment, the management API should require admin auth. The `/check` endpoint should be internal-only (not exposed to agents).

7. **Cedar vs the current approach:** The current sidecar + storefront-SDK checks are simple sequential if/else statements (~50 lines of TypeScript, ~30 lines of Python). Cedar adds formal authorization semantics but at the cost of a Rust service, policy compilation, and Cedar-specific tooling. Is the formalism needed now, or is it a post-demo investment?

8. **OPA gap:** Rate limits, rolling windows, and budget tracking are described as OPA/Rego concerns in the rules engine design docs, but OPA is not implemented. These are exactly the stateful checks Warranted needs (daily spend limit, transactions per hour). What fills this gap?

9. **Test coverage:** The rules engine has zero unit tests. Before integrating, should we add tests for `EnvelopeResolver`, `CedarGenerator`, and the `/check` endpoint?

---

## References

- [Warranted CLAUDE.md](/CLAUDE.md) — project overview, stack, architecture
- [Storefront SDK Spec](/docs/plans/storefront-sdk-SPEC.md) — 10-step verification flow
- [Spending Policy YAML](/sidecar/policies/spending-policy.yaml) — current policy rules
- [Rules Engine README](/packages/rules_engine/README.md) — concept and primitives
- [Rules Engine BUILD_PLAN.md](/packages/rules_engine/BUILD_PLAN.md) — 4-wave implementation plan
- [Rules Engine DEVLOG.md](/packages/rules_engine/DEVLOG.md) — architecture decisions and research
- [Rules Engine NEXT_STEPS.md](/packages/rules_engine/NEXT_STEPS.md) — phased roadmap
- [Cedar Policy Language](https://www.cedarpolicy.com/) — Cedar documentation
