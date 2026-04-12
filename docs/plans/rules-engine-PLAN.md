# Rules Engine — Implementation Plan

## Overview

Build `packages/rules-engine/`, a TypeScript policy evaluation and management library that replaces the hardcoded authorization checks in the storefront SDK (`verifyAuthorization()`, steps 7-10) and the Python sidecar (`/check_authorization`). Uses Cedar authorization policies evaluated via WASM, an Active Directory-style group hierarchy with envelope resolution (constraints only narrow), and a management API for policy CRUD. The existing Rust/Kotlin rules engine is replaced entirely — its PostgreSQL schema concepts are reused but reimplemented in Drizzle, and its Cedar evaluation is brought in-process via WASM.

## Design Decisions

### Q: Rewrite, integrate, or hybrid?
**Tradeoff:** Integrate the existing Rust/Kotlin/Next.js services as-is (3 extra services, proven) vs. full TS rewrite (collapse stack, rebuild effort) vs. hybrid (TS engine, reuse schema concepts).
**Decision:** Hybrid — rewrite evaluation and management in TypeScript but reuse the PostgreSQL schema concepts (group hierarchy, policy versioning, dimension kinds) and seed data. Kill the Rust and Kotlin services. The operational cost of maintaining 3 additional services (Rust Cedar engine, Kotlin management API, standalone Next.js frontend) outweighs the rebuild effort.

### Q: How should Cedar evaluation work without the Rust engine?
**Tradeoff:** Cedar WASM in-process (experimental, single process) vs. thin Rust sidecar (proven, extra service) vs. pure TS policy evaluator (no Cedar, no formal language) vs. cedar-java via FFI (heavy).
**Decision:** Cedar WASM in-process. Compile `cedar-policy` to WASM, pre-build the artifact, check it into the repo. Runs in Bun's WASM runtime — no HTTP hop, sub-ms evaluation, no Rust toolchain needed for TS developers. Fallback: thin Rust sidecar if WASM has blockers in Bun.

### Q: How should group hierarchy be stored without ltree?
**Tradeoff:** Keep ltree (purpose-built, needs Postgres extension + custom Drizzle column type) vs. adjacency list + recursive CTE (standard, Drizzle-native) vs. closure table (fast reads, complex writes) vs. materialized path text column (simple, no DB-level operations).
**Decision:** Adjacency list with `parent_id` FK + Postgres recursive CTEs. No extension required. Drizzle handles it natively. The hierarchy depth for AI agent governance (org → department → team → agent) is shallow enough that recursive CTEs perform well.

### Q: Should Cedar entity loading be fixed so `principal in Group` works?
**Tradeoff:** Fix it and load agent-group relationships into Cedar's entity store (Cedar-idiomatic, requires entity sync) vs. keep flat evaluation where hierarchy is resolved outside Cedar (simpler, already working) vs. drop Cedar entirely (custom TS evaluator).
**Decision:** Fix it. Load entities into Cedar so `principal in Group::"uuid"` works natively. The entity store is rebuilt atomically whenever the organization's `policyVersion` counter increments (batch sync on policy version bump). This is consistent with the cache invalidation model.

### Q: Where does the rules engine live in the codebase?
**Tradeoff:** New `packages/rules-engine/` with its own routes vs. extend `apps/api/` directly vs. split library from routes.
**Decision:** Split. `packages/rules-engine/` is a pure library — evaluation, envelope resolution, Cedar WASM, schema. Policy management HTTP routes live in `apps/api/routes/policies/`. The library has no HTTP concerns. Dashboard pages go in `apps/dashboard/`.

### Q: Does the rules engine have its own agent table?
**Tradeoff:** Separate agent tables with FK (clean separation, sync burden) vs. single merged table (simple, wide) vs. rules engine references registry agents directly (no duplication, cross-package reference).
**Decision:** Rules engine uses registry agents directly. No separate agent table. Group memberships and policy assignments reference agents by DID (TEXT column, not a FK — cross-package reference). When the registry creates an agent, the rules engine can immediately assign it to groups.

### Q: What's the source of truth for policies after migration?
**Tradeoff:** Database only (YAML deleted) vs. YAML stays as source (GitOps, DB derived) vs. both valid (conflict resolution needed).
**Decision:** Database only. The existing `spending-policy.yaml` becomes a one-time seed migration script that loads initial policies into Postgres. After seeding, all policy management goes through the API or dashboard. YAML file is deleted from the repo.

### Q: How should the storefront SDK call the rules engine?
**Tradeoff:** Replace `verifyAuthorization()` entirely (engine-only) vs. delegate internally (same interface) vs. two-phase: fast local check + authoritative engine check.
**Decision:** Two-phase. The existing `verifyAuthorization()` runs first as a fast local check from JWT claims — fail-fast for obvious violations without any DB or WASM call. If it passes, the rules engine does the authoritative check with full envelope resolution. If local passes but engine denies (policy updated after JWT was issued), the response includes a `retryHint` suggesting the agent refresh its token.

### Q: How should the sidecar interact with the rules engine?
**Tradeoff:** Sidecar proxies to rules engine (backward compatible) vs. sidecar drops authorization entirely (callers go direct) vs. keep both paths with feature flag (migration period) vs. sidecar goes away (port everything to TS).
**Decision:** Sidecar proxies to the rules engine. `/check_authorization` becomes a thin proxy that translates its params into a rules engine check request and returns the result in the existing response format. `/sign_transaction` remains coupled — calls the rules engine before signing (sign-if-approved). Identity, trust scoring, and Ed25519 crypto remain unchanged in the sidecar.

### Q: Should the envelope cache use TTL or invalidation?
**Tradeoff:** No cache (always recompute) vs. TTL-based (simple, stale window) vs. invalidation-based (correct, complex).
**Decision:** Interface only with no-op default. The spec defines the `EnvelopeCache` interface but defers caching strategy to a future optimization phase. The default `NoOpEnvelopeCache` always recomputes (no caching). Envelope resolution is fast (a few DB queries + intersection logic). When caching becomes necessary, the `organizations.policyVersion` counter provides the staleness signal.

### Q: Who provides runtime state for stateful rules (daily spend, rate limits)?
**Tradeoff:** Rules engine queries the ledger internally (smart engine, I/O) vs. sidecar maintains accumulators (status quo) vs. caller provides context (pure engine, no I/O).
**Decision:** Caller provides context. The rules engine is pure evaluation — no I/O for runtime state. The storefront SDK (or whoever calls the engine) queries the ledger for `spend_last_24h` and `transactions_last_hour`, then passes them in the check request context. The engine evaluates them as regular dimensions.

### Q: Should Cedar source be a stable contract or an internal detail?
**Tradeoff:** Stable contract (deterministic, stored, testable, auditable) vs. internal only (ephemeral compilation target) vs. stored for audit but not user-facing.
**Decision:** Cedar source is a contract. Generated Cedar is deterministic (same constraints → same output), stored in `policy_versions.cedar_source`, exposed in the dashboard's Cedar tab, and snapshot-tested. The `bundle_hash` in decision logs proves exactly which rules governed each decision.

### Q: Should the spec include petitioning (one-time exception requests)?
**Tradeoff:** Full design (core governance differentiator) vs. API stubs only (schema ready, code later) vs. out of scope.
**Decision:** API stubs only. The spec defines the petition data model, API endpoints, and routing algorithm, but implementation is deferred post-demo. Phase 5 delivers endpoint stubs that return `501 Not Implemented` with the correct response shapes. The full workflow — routing, approval, expiry, envelope integration — is documented for future implementation.

### Q: What auth model for the management API?
**Tradeoff:** Platform JWT with admin role (simple, shared auth) vs. API keys (no JWT complexity) vs. entity-scoped JWT (org-level isolation, maps to authority chain) vs. internal-only/network auth.
**Decision:** Internal-only for now. Management endpoints are accessible only within the Docker network. No application-level authentication required. Entity-scoped JWT auth is deferred to a future phase when the API is exposed externally.

### Q: How should policy mutations (version create, Cedar gen, entity rebuild, cache invalidation) be coordinated?
**Tradeoff:** Atomic in a DB transaction (correct, synchronous) vs. eventual consistency with version fence (async, no partial reads) vs. async with staleness window (fast, brief inconsistency).
**Decision:** Atomic. All steps happen within a single DB transaction — Cedar generation, Cedar validation, bundle hash recalculation, `policyVersion` increment, and entity store rebuild trigger. No partial states. If any step fails, the entire mutation rolls back.

### Q: How should the rules engine report errors — its own codes, the SDK's existing codes, or both?
**Tradeoff:** Map to existing SDK codes (backward compatible, loses detail) vs. new engine codes (more descriptive, breaking) vs. return both (verbose, complete).
**Decision:** Return both. Denial responses include the SDK-compatible code (`OVER_LIMIT`, `VENDOR_NOT_APPROVED`) for backward compatibility and the engine-specific code (`DIMENSION_EXCEEDED`, `DIMENSION_NOT_IN_SET`) with dimension details for admin debugging and audit. The `engine` detail block is only included for admin-level callers.

### Q: What scope of action types should be seeded?
**Tradeoff:** Transaction-relevant only (purchase.initiate, purchase.approve — minimal) vs. all 14 from the existing engine (finance + communication + delegation) vs. extensible schema with transaction seed.
**Decision:** All 14 action types across all 3 domains. Communication controls (email.send limits) and delegation controls (agent.delegate scope) are part of the governance story. The full set demonstrates the engine's generality beyond just purchase transactions.

### Q: What should the dashboard include?
**Tradeoff:** All three features (envelope visualization, REPL tester, Cedar viewer) vs. envelope + REPL only vs. envelope only vs. defer entirely.
**Decision:** All three in the initial spec. Ported into `apps/dashboard/` using shadcn/ui — not kept as a standalone app. The envelope visualization (what can this agent do, with inheritance chain), REPL tester (test a check from the UI), and Cedar source viewer (syntax-highlighted, auditable) are the core value of the dashboard integration.

### Q: Should temporal dimensions (time-of-day windows, expiry dates) be supported?
**Tradeoff:** Full temporal support (windows + expiry + tightest-window resolution) vs. expiry only (simpler) vs. out of scope.
**Decision:** Expiry only. Support policy expiry dates (`temporalExpiry`) but not time-of-day windows. Earliest expiry across all sources wins (narrowing). Time-of-day windows deferred — nobody is blocking procurement because it's 6pm.

---

## Phases

### Phase 1: Schema + Types + WASM Build

**Goal:** Database schema in Drizzle, all TypeScript interfaces with Zod validation, engine error codes with SDK mapping, and Cedar WASM artifact loadable in Bun.

**Deliverables:**
- `packages/rules-engine/package.json` — package config with `@warranted/rules-engine` name, dependencies: `zod`, `drizzle-orm`, `drizzle-zod`
- `packages/rules-engine/tsconfig.json` — TypeScript config extending shared base
- `packages/rules-engine/src/index.ts` — barrel export
- `packages/rules-engine/src/schema.ts` — all Drizzle table definitions:
  - `organizations` (id, name, slug, policyVersion counter, createdAt)
  - `groups` (id, orgId, name, nodeType, parentId self-ref FK, createdAt) — adjacency list, no ltree
  - `agentGroupMemberships` (agentDid TEXT, groupId FK) — references registry agents by DID
  - `actionTypes` (id, domain enum, name, description) — 14 action types
  - `dimensionDefinitions` (id, actionTypeId FK, dimensionName, kind enum, numericMax, rateLimit, rateWindow, setMembers, boolDefault, boolRestrictive, temporalExpiry)
  - `policies` (id, orgId FK, name, domain enum, effect enum, activeVersionId FK, createdAt)
  - `policyVersions` (id, policyId FK, versionNumber, constraints JSONB, cedarSource TEXT, cedarHash TEXT, createdAt, createdBy)
  - `policyAssignments` (id, policyId FK, groupId FK nullable, agentDid TEXT nullable, assignedAt) — CHECK: exactly one of groupId or agentDid. Always uses policy's `activeVersionId`, no version pinning.
  - `decisionLog` (id, evaluatedAt, agentDid, actionTypeId FK, requestContext JSONB, bundleHash, outcome enum, reason, matchedVersionId FK, engineErrorCode, sdkErrorCode, envelopeSnapshot JSONB)
  - `petitions` (id, orgId FK, requestorDid, actionTypeId FK, requestedContext JSONB, violatedPolicyId FK, violatedDimension, requestedValue JSONB, justification, approverDid, approverGroupId FK, status enum, decisionReason, expiresAt, grantExpiresAt, createdAt, decidedAt)
  - Postgres enums: `domain`, `policy_effect`, `dimension_kind`, `decision_outcome`, `petition_status`
- `packages/rules-engine/src/types.ts` — all TypeScript interfaces + Zod schemas:
  - `CheckRequest`, `CheckResponse` (with dual error codes)
  - `ResolvedEnvelope`, `ResolvedAction`, `ResolvedDimension`, `DimensionSource`
  - `PolicyConstraint`, `DimensionConstraint` (union type for all 5 kinds)
  - `EngineErrorResponse` (with retryHint)
  - `CedarEntity`
  - `CachedEnvelope`
  - `PetitionRequest`, `PetitionDecision`
- `packages/rules-engine/src/errors.ts` — engine-specific error codes (`DIMENSION_EXCEEDED`, `DIMENSION_NOT_IN_SET`, `DIMENSION_OUTSIDE_WINDOW`, `DIMENSION_RATE_EXCEEDED`, `DIMENSION_BOOLEAN_BLOCKED`, `ENVELOPE_EMPTY`, `DENY_OVERRIDE`, `POLICY_EXPIRED`, `PETITION_REQUIRED`, `ENGINE_ERROR`) + mapping table to SDK codes (`OVER_LIMIT`, `VENDOR_NOT_APPROVED`, `CATEGORY_DENIED`, `TRUST_SCORE_LOW`)
- `packages/rules-engine/cedar.wasm` — pre-built Cedar WASM artifact (compiled from `cedar-policy` Rust crate)
- `packages/rules-engine/src/cedar-wasm.ts` — WASM loader: `initCedar()` returns a `CedarEngine` interface with `loadPolicies(sources)`, `loadEntities(entities)`, `check(request)`, `getBundleHash()`
- Top-level `package.json` update — verify `"workspaces": ["packages/*"]` picks up the new package
- `vitest.config.ts` update — include `packages/rules-engine/__tests__/`

**Dependencies:** None (first phase). Cedar WASM must be pre-built before this phase starts (one-time Rust compilation).

**Tests:**
- `packages/rules-engine/__tests__/schema.test.ts`:
  - Zod round-trip validation for all constraint types (numeric, set, boolean, temporal, rate)
  - Reject invalid constraint shapes (missing `max` on numeric, empty `members` on set, etc.)
  - Enum values match expected sets
  - `CheckRequest` / `CheckResponse` Zod validation
  - `ResolvedEnvelope` Zod validation with nested dimension sources
- `packages/rules-engine/__tests__/errors.test.ts`:
  - Every engine error code maps to an SDK error code
  - `DIMENSION_EXCEEDED` on "amount" → `OVER_LIMIT`
  - `DIMENSION_NOT_IN_SET` on "vendor" → `VENDOR_NOT_APPROVED`
  - `DIMENSION_NOT_IN_SET` on "category" → `CATEGORY_DENIED`
  - `DIMENSION_BOOLEAN_BLOCKED` on "trust_gate" → `TRUST_SCORE_LOW`
  - `ENGINE_ERROR` → `REGISTRY_UNREACHABLE`
  - Dual response includes both codes when engine detail is present
  - Agent-facing response omits engine detail block
- `packages/rules-engine/__tests__/cedar-wasm.test.ts`:
  - WASM loads successfully in Bun
  - `initCedar()` returns a CedarEngine with all expected methods
  - Simple permit policy evaluates to "Allow"
  - Simple deny (no matching permit) evaluates to "Deny"

**Demo checkpoint:** `bun run test` passes. All types validate via Zod. Cedar WASM loads in Bun and evaluates a trivial policy. Error code mapping is complete.

---

### Phase 2: Envelope Resolution + Cedar Generation

**Goal:** Given an agent DID, resolve their effective envelope from the group hierarchy using recursive CTEs. Generate deterministic Cedar source from structured constraints. Seed the database with Acme Corp hierarchy and Warranted spending policies.

**Deliverables:**
- `packages/rules-engine/src/envelope.ts` — `resolveEnvelope(db, agentDid, orgId)`:
  1. Recursive CTE to find agent's direct group memberships + all ancestor groups
  2. Collect all `policyAssignments` from ancestor groups + direct agent assignments
  3. Load active `policyVersions` with JSONB constraints
  4. *(Future)* Check for approved, non-expired petitions for this agent (widen dimensions temporarily)
  5. Resolve dimensions by kind: numeric → min, set → intersection, boolean → most restrictive (using `restrictive` flag), temporal → earliest expiry, rate → min limit
  6. Apply deny overrides: any deny-effect policy sets `denied: true` on its action
  7. Build `ResolvedEnvelope` with full provenance chain (`DimensionSource` per constraint)
- `packages/rules-engine/src/cedar-gen.ts` — `generateCedar(policy, constraints, assignmentTarget)`:
  - Converts `PolicyConstraint[]` into Cedar `permit` or `forbid` blocks
  - Deterministic output: same constraints → identical Cedar source (sorted dimensions, stable formatting)
  - Includes policy metadata as Cedar comments (policy name, version, assignment target)
  - Handles all 5 dimension kinds in `when` clause:
    - numeric: `context.amount <= 5000`
    - set: `[context.vendor].containsAny(["aws", "azure"])` (Cedar set membership)
    - boolean: `context.requires_human_approval == true`
    - temporal: expiry checked at envelope resolution time, not in Cedar
    - rate: `context.transactions_last_hour <= 10` (caller-provided numeric context)
  - Generates `forbid` blocks for deny-effect policies
- `packages/rules-engine/src/seed.ts` — seed migration function:
  - Creates Acme Corp organization
  - Creates group hierarchy: Acme Corp (org) → Finance/Engineering/Operations (departments) → AP/Treasury/Platform/ML-AI/Procurement (teams)
  - Creates 14 action types with 16+ dimension definitions
  - Creates policies mapping each rule from `spending-policy.yaml`:
    - `agent-spending-limit` (allow, purchase.initiate, amount max 5000)
    - `hard-transaction-cap` (deny, purchase.initiate, amount max 25000)
    - `approved-vendors` (allow, purchase.initiate, vendor set)
    - `sanctioned-vendors` (deny, purchase.initiate, vendor set)
    - `permitted-categories` (allow, purchase.initiate, category set)
    - `hourly-rate-limit` (allow, purchase.initiate, rate 10/hour)
    - `daily-spend-ceiling` (allow, purchase.initiate, amount daily max 10000)
    - `escalation-threshold` (allow, purchase.initiate, requires_human_approval boolean)
    - `cooling-off-period` (allow, purchase.initiate, temporal hold)
  - Creates cascading policies at different hierarchy levels (org: $5000, dept: $2000, team: $1000)
  - Assigns OpenClaw agent DID to Engineering → Platform group

**Dependencies:** Phase 1 (schema, types, Zod schemas).

**Tests:**
- `packages/rules-engine/__tests__/envelope.test.ts`:
  - Resolves numeric dimensions to minimum across hierarchy (org 5000, dept 2000 → 2000)
  - Resolves set dimensions to intersection (org [aws, azure, gcp], team [aws, gcp] → [aws, gcp])
  - Resolves boolean dimensions with `restrictive` flag (gate: org false + team true → true; permission: org true + team false → false)
  - Resolves temporal dimensions to earliest expiry (org 2026-12-31, team 2026-06-30 → 2026-06-30)
  - Resolves rate dimensions to minimum limit (org 10/hour, team 5/hour → 5/hour)
  - Deny policy overrides all permits (deny at any level → denied: true with denySource)
  - Includes full provenance chain — each dimension lists policy name, group name, level, and value
  - Handles agent in multiple groups (most restrictive intersection across all paths)
  - Direct agent assignment narrows further (group 5000, agent-level 1000 → 1000)
  - Returns empty envelope (no matching actions) when agent has no group memberships
- `packages/rules-engine/__tests__/cedar-gen.test.ts`:
  - Generates deterministic Cedar source (snapshot test — same constraints → identical string)
  - Generates `permit` block for allow policies with `when` clause
  - Generates `forbid` block for deny policies
  - Includes policy name, version, and assignment target as Cedar comments
  - Handles numeric dimension: `context.amount <= 5000`
  - Handles set dimension: `[context.vendor].containsAny(["aws", "azure", "gcp"])`
  - Handles boolean dimension: `context.requires_human_approval == true`
  - Handles temporal dimension: expiry checked at resolution time, not generated into Cedar
  - Handles rate dimension: `context.transactions_last_hour <= 10` (caller-provided numeric)
  - Handles policy with no dimensions (unconditional permit/forbid)
  - Handles policy with multiple action types (generates separate blocks)
- `packages/rules-engine/__tests__/seed.test.ts`:
  - All 9 spending-policy.yaml rules have corresponding policies in seed
  - Group hierarchy has correct parent-child relationships (6 levels deep)
  - All 14 action types seeded with correct domains
  - All 16+ dimension definitions seeded with correct kinds
  - OpenClaw agent DID is assigned to Engineering > Platform group
  - Policy assignments create correct cascading limits at different hierarchy levels

**Demo checkpoint:** Seed the database. Call `resolveEnvelope(db, "did:mesh:...", orgId)` → get a full envelope with provenance chains showing constraints narrowing from org → department → team. Call `generateCedar(...)` → get deterministic Cedar source matching snapshot. All intersection semantics verified by tests.

---

### Phase 3: Cedar Evaluation + Entity Store

**Goal:** Evaluate Cedar policies via WASM with full entity hierarchy support. `principal in Group::"uuid"` works natively. Bundle hash computation for audit trail.

**Deliverables:**
- `packages/rules-engine/src/evaluator.ts` — `CedarEvaluator` class:
  - `constructor(wasmEngine: CedarEngine)` — wraps the WASM interface
  - `loadPolicySet(db, orgId)` — queries all active policy versions, extracts `cedarSource`, loads into WASM engine
  - `check(request: CheckRequest): CheckResponse` — evaluates a request, maps Cedar Allow/Deny to `CheckResponse` with dual error codes (engine + SDK), diagnostics, and dimension details
  - `getBundleHash(): string` — SHA-256 of sorted active Cedar sources
  - `reload(db, orgId)` — reload policies and entities (called after policy version bump)
  - Internal error code mapping: parse Cedar diagnostics to determine which dimension caused the denial, map to engine code, then map to SDK code
- `packages/rules-engine/src/entity-store.ts` — `buildEntityStore(db, orgId)`:
  - Queries all agents with group memberships → builds `CedarEntity[]` with `uid: Agent::"did:mesh:..."` and `parents: [Group::"uuid"]`
  - Queries all groups with parent relationships → builds `CedarEntity[]` with `uid: Group::"uuid"` and `parents: [Group::"parent-uuid"]`
  - Queries all action types → builds `CedarEntity[]` with `uid: Action::"purchase.initiate"` (no parents)
  - Returns flat array of all entities for `CedarEngine.loadEntities()`
  - `rebuildOnVersionBump(db, orgId, currentVersion)` — compares against `organizations.policyVersion`, rebuilds if stale
- Update `packages/rules-engine/src/index.ts` — export `CedarEvaluator`, `buildEntityStore`, `resolveEnvelope`, `generateCedar`, all types

**Dependencies:** Phase 2 (envelope resolution, Cedar generation, seed data), Phase 1 (WASM loader, schema).

**Tests:**
- `packages/rules-engine/__tests__/cedar-eval.test.ts`:
  - Permits when all conditions met (amount within limit, vendor in set, category in set)
  - Denies when amount exceeds limit (returns `DIMENSION_EXCEEDED` / `OVER_LIMIT`)
  - Denies when vendor not in set (returns `DIMENSION_NOT_IN_SET` / `VENDOR_NOT_APPROVED`)
  - Denies when category not permitted (returns `DIMENSION_NOT_IN_SET` / `CATEGORY_DENIED`)
  - Forbid overrides permit (deny policy beats all allows)
  - `principal in Group::"uuid"` works with loaded entities (agent entity has group as parent)
  - Default deny when no matching permit policy (returns `ENVELOPE_EMPTY`)
  - Returns matching policy IDs in diagnostics array
  - Bundle hash is deterministic (same policies → same hash)
  - Bundle hash changes when policies are reloaded with different versions
  - Multiple permit policies — most specific match wins (Cedar semantics)
  - Context fields passed through correctly to Cedar evaluation
- `packages/rules-engine/__tests__/entity-store.test.ts`:
  - Builds agent entities with correct group parents
  - Builds group entities with correct parent-group parents
  - Builds action type entities (no parents)
  - Handles agent in multiple groups (multiple parents)
  - Handles deep group hierarchy (org → dept → team, 3 levels of parents)
  - `rebuildOnVersionBump` detects stale version and rebuilds
  - `rebuildOnVersionBump` skips rebuild when version is current

**Demo checkpoint:** Seed the database. Create the evaluator, load policies and entities. Evaluate a purchase check for the OpenClaw agent:
- `{ principal: 'Agent::"did:mesh:..."', action: 'Action::"purchase.initiate"', resource: 'Resource::"vendor-acme-001"', context: { amount: 2500, vendor: "vendor-acme-001", category: "compute" } }` → `Allow`
- Same with `amount: 6000` → `Deny` with `DIMENSION_EXCEEDED` / `OVER_LIMIT`
- Same with `vendor: "sketchy-vendor"` → `Deny` with `DIMENSION_NOT_IN_SET` / `VENDOR_NOT_APPROVED`
- Verify `principal in Group` works (agent is in Platform group → inherits Engineering dept policies → inherits Acme org policies)

---

### Phase 4: SDK + Sidecar Integration

**Goal:** The storefront SDK and sidecar use the rules engine for authorization. Two-phase check works end-to-end. Envelope cache interface delivered with no-op default.

**Deliverables:**
- `packages/rules-engine/src/cache.ts` — `EnvelopeCache` interface + `NoOpEnvelopeCache` default:
  - `EnvelopeCache` interface: `get(agentDid)`, `set(agentDid, envelope)`, `invalidate(agentDid)`, `invalidateAll()`
  - `NoOpEnvelopeCache`: always returns `null` on `get()`, forcing fresh resolution on every request
  - `CachedEnvelope` type with `policyVersion` field for future version-based implementations
- Update `packages/storefront-sdk/src/verify.ts`:
  - Rename existing `verifyAuthorization()` to `localAuthorizationCheck()` (unchanged logic)
  - Add `engineAuthorizationCheck(agentDid, action, context, callerContext?)` — calls `CedarEvaluator.check()` with envelope-resolved context
  - New `verifyAuthorization()` orchestrates two-phase:
    1. Call `localAuthorizationCheck()` — if fails, return denial immediately
    2. Call `engineAuthorizationCheck()` — if fails, return denial with `retryHint` field
    3. Both pass → return `{ authorized: true }`
  - `verifyAuthorization()` signature changes from sync to async (now does DB + WASM)
- Update `packages/storefront-sdk/src/middleware.ts`:
  - Middleware now calls `verifyAuthorization()` after `verifyIdentity()` (steps 7-10 replaced)
  - Pass transaction context from the request body when available (for session creation)
- Update `sidecar/server.py`:
  - `/check_authorization` becomes a proxy: builds `CheckRequest` from query params, calls rules engine HTTP endpoint (or internal URL), translates response to existing format
  - `/sign_transaction` calls the rules engine before signing — if denied, return `{ signed: false, reasons: [...] }` without producing a signature
  - Add `RULES_ENGINE_URL` environment variable (default: `http://localhost:3000/api/policies/check`)
- Delete `sidecar/policies/spending-policy.yaml` — policies are now in Postgres only
- Update `sidecar/server.py` — remove hardcoded `SPENDING_LIMIT`, `APPROVED_VENDORS`, `PERMITTED_CATEGORIES` constants (resolved from envelope)

**Dependencies:** Phase 3 (Cedar evaluator, entity store), Phase 2 (envelope resolution, seed data). The storefront SDK and sidecar changes depend on the evaluator being functional.

**Tests:**
- `packages/rules-engine/__tests__/cache.test.ts`:
  - `NoOpEnvelopeCache.get()` always returns null
  - `NoOpEnvelopeCache.set()` is a no-op (subsequent get still returns null)
  - `NoOpEnvelopeCache.invalidate()` and `invalidateAll()` are no-ops
  - `EnvelopeCache` interface is correctly implemented by `NoOpEnvelopeCache`
- `packages/rules-engine/__tests__/integration.test.ts`:
  - End-to-end: create policy → generate Cedar → assign to group → evaluate via evaluator → verify decision log entry written
  - Policy update: change spending limit → cache invalidated → next evaluation uses new limit
  - Two-phase check: local check passes with JWT claims, engine check verifies with full envelope
  - Two-phase gap: JWT claims say $5000 limit, but policy was updated to $3000 → engine denies → response includes `retryHint`
  - Decision log entry contains correct `bundleHash`, `engineErrorCode`, `sdkErrorCode`, and `envelopeSnapshot`
- Update `packages/storefront-sdk/__tests__/verify.test.ts`:
  - `verifyAuthorization()` is now async
  - Fast local check rejects obvious violations without engine call (no DB queries)
  - Engine check runs when local check passes
  - Retry hint included when local passes but engine denies
  - Engine denial includes engine-specific code for admin-level callers
  - Agent-facing response omits engine detail block
- Sidecar integration tests (Python, pytest):
  - `/check_authorization` proxies to rules engine and returns backward-compatible response
  - `/sign_transaction` calls rules engine, signs only if approved, returns `{ signed: false }` if denied
  - Backward-compatible response format: `{ authorized, reasons, requires_approval, agent_id, did, ... }`

**Demo checkpoint:** Start the full stack (Postgres with seed data, Hono API, sidecar). Get a JWT from sidecar `/issue_token`. Hit the storefront SDK with various scenarios:
1. Valid purchase within limits → `Allow` (both phases pass)
2. Over-limit purchase → denied by local check (fast, no engine call)
3. Change policy via direct DB update to lower limit → next request denied by engine (local passes with stale JWT claims, engine catches it) → response includes `retryHint`
4. Sidecar `/check_authorization?vendor=aws&amount=2500&category=compute` → proxied to rules engine → `{ authorized: true }`
5. Sidecar `/sign_transaction?vendor=sketchy&amount=100&item=test&category=compute` → engine denies → `{ signed: false, reasons: [...] }`

---

### Phase 5: Petitioning + Management API

**Goal:** Management API for policy CRUD, group hierarchy, assignments, envelope queries, and decision log. Petition endpoint stubs defined but not implemented. All endpoints internal-only (no auth).

**Deliverables:**
- `packages/rules-engine/src/petition.ts` — petition data model, Zod schemas, and types only. No routing algorithm, no approval logic, no envelope integration. These are documented in the spec for future implementation.
- `apps/api/src/routes/policies/` — management API routes (all internal-only, no auth middleware):
  - **Policy CRUD:** `GET/POST /api/policies/rules`, `GET/PUT/DELETE /api/policies/rules/:id`
  - **Versions:** `GET/POST /api/policies/rules/:id/versions`, `POST /api/policies/rules/:id/versions/:vid/activate`
    - Version creation is atomic: validates constraints → generates Cedar → validates Cedar → stores version → activates → increments `policyVersion` → all in one transaction
  - **Groups:** `GET/POST /api/policies/groups`, `GET/DELETE /api/policies/groups/:id`, `GET/POST/DELETE /api/policies/groups/:id/members`, `GET /api/policies/groups/:id/ancestors`, `GET /api/policies/groups/:id/descendants`
  - **Assignments:** `POST/DELETE /api/policies/assignments`, `GET /api/policies/assignments?groupId=&agentDid=`
  - **Envelope:** `GET /api/policies/agents/:did/envelope` (rich — full provenance), `GET /api/policies/agents/:did/policies`
  - **Check:** `POST /api/policies/check` (Cedar evaluation endpoint — used by sidecar proxy and SDK)
  - **Decisions:** `GET /api/policies/decisions` (filters: agentDid, outcome, dateRange; pagination), `GET /api/policies/decisions/:id`
  - **Action types:** `GET /api/policies/action-types`, `GET /api/policies/action-types/:id`
  - **Petitions (stubs):** `POST /api/policies/petitions`, `GET /api/policies/petitions`, `POST /api/policies/petitions/:id/decide`, `GET /api/policies/petitions/:id` — all return `501 Not Implemented` with documented response shapes

**Dependencies:** Phase 4 (evaluator integration, cache). Management API routes depend on the engine library being functional.

**Tests:**
- `packages/rules-engine/__tests__/petition.test.ts`:
  - Petition data model validates with Zod (correct input accepted, invalid rejected)
  - Petition Zod schemas match spec response shapes
- Management API endpoint tests:
  - Policy CRUD: create, read, update, delete with Zod validation
  - Version creation: atomic — constraints → Cedar gen → validate → store → activate → policyVersion bump
  - Version creation: rolls back if Cedar validation fails
  - Assignment: create assignment to group, create assignment to agent, CHECK constraint enforced (exactly one of groupId/agentDid)
  - Group hierarchy: create group with parent, ancestors query returns correct chain, descendants query returns correct tree
  - Membership: add agent to group, remove agent from group
  - Envelope: returns resolved envelope with full provenance for agent
  - Check endpoint: evaluates Cedar and returns CheckResponse with dual error codes
  - Decision log: filters by agentDid, outcome, dateRange; pagination works
  - Petition stub endpoints: all return 501 with documented response shapes

**Demo checkpoint:**
1. Admin creates a new policy via `POST /api/policies/rules` → gets policy ID
2. Admin creates a version with constraints → Cedar is auto-generated, validated, stored, activated
3. Admin assigns policy to a group → policyVersion bumps
4. Agent evaluates via `POST /api/policies/check` → uses the new policy
5. Query decision log → see evaluation entry with bundle hash and error codes
6. Petition endpoints return 501 with correct response shapes

---

### Phase 6: Dashboard + Polish

**Goal:** Admin dashboard with envelope visualization, REPL policy tester, and Cedar source viewer. All ported into `apps/dashboard/` using shadcn/ui. Production polish.

**Deliverables:**
- **Policy pages** (`apps/dashboard/src/app/policies/`):
  - `page.tsx` — searchable table of all policies (name, domain, effect, active version, assignment count, last updated). Create policy modal.
  - `[id]/page.tsx` — three-tab detail view:
    - **Constraints** tab — structured view of active version's dimension constraints. Form to create new version (validates constraints, shows generated Cedar preview before save).
    - **Cedar** tab — syntax-highlighted Cedar source viewer (read-only). Shows the deterministic output of `cedar-gen.ts`.
    - **History** tab — version timeline with version number, creation date, creator, SHA-256 hash. Click any version to view its constraints and Cedar source.
- **Agent envelope pages** (`apps/dashboard/src/app/agents/[did]/`):
  - **Envelope** tab — for each action type the agent has policies for:
    - Resolved dimension values (the intersection result) displayed prominently
    - Collapsible provenance chain: which policy at which group level contributed each constraint value
    - Deny override banner when a deny policy is active (shows source policy)
    - Approved petitions highlighted (shows what's temporarily widened and when it expires)
  - **Test** tab (REPL policy tester):
    - Dropdown to select action type
    - Auto-populated dimension input fields based on the action type's dimension definitions (numeric input for amount, multi-select for vendor/category, checkbox for boolean, time pickers for temporal)
    - "Test" button → calls `POST /api/policies/check` with agent DID + filled context
    - Result display: Allow/Deny badge, matching policy IDs, dimension-level breakdown (which passed, which failed), and expandable Cedar source that matched
- **Group pages** (`apps/dashboard/src/app/groups/`):
  - `page.tsx` — groups displayed as indented tree by depth. Each node shows member count and assigned policy count. Create group modal.
  - `[id]/page.tsx` — three tabs:
    - **Members** tab — agents in this group with envelope summary (key dimension values)
    - **Policies** tab — assigned policies with version info and effect
    - **Hierarchy** tab — visual tree showing ancestors above and descendants below
- **Petition pages** (`apps/dashboard/src/app/petitions/`):
  - Placeholder "Coming Soon" page. Petition implementation is deferred post-demo. Page explains the planned workflow and links to the spec.
- **Components** (`apps/dashboard/src/components/`):
  - `envelope/EnvelopeView.tsx` — main envelope visualization component
  - `envelope/DimensionDisplay.tsx` — renders dimension value by kind (numeric bar, set chips, boolean toggle, expiry date badge, rate gauge)
  - `envelope/InheritanceChain.tsx` — collapsible provenance chain (policy → group → level → value)
  - `envelope/DenyBanner.tsx` — deny override indicator with source policy link
  - `cedar/CedarSourceViewer.tsx` — syntax-highlighted Cedar source (keywords, strings, operators, comments)
  - `repl/PolicyREPL.tsx` — action type selector, dimension input fields, execute button, result display
  - `repl/DimensionInputField.tsx` — auto-generated input field based on dimension kind
  - `petitions/PetitionComingSoon.tsx` — placeholder page with planned workflow description

**Dependencies:** Phase 5 (management API endpoints, petition workflow). All dashboard pages call the management API.

**Tests:**
- Component tests (Vitest + Testing Library):
  - `EnvelopeView` renders resolved dimensions with correct values
  - `DimensionDisplay` renders each kind correctly (numeric shows max, set shows chips, etc.)
  - `InheritanceChain` shows provenance sources in correct order (agent → team → dept → org)
  - `DenyBanner` appears when action is denied and shows source policy
  - `CedarSourceViewer` highlights Cedar keywords
  - `PolicyREPL` auto-generates correct input fields for selected action type
  - `PolicyREPL` shows Allow/Deny result after executing check
  - `PetitionComingSoon` renders placeholder with link to spec
- End-to-end (manual verification):
  - Navigate to agent → see envelope with full inheritance chain
  - Open REPL → select purchase.initiate → fill amount=2500, vendor=aws, category=compute → Test → Allow
  - Change amount to 6000 → Test → Deny with OVER_LIMIT and dimension breakdown
  - Navigate to policy → view Cedar source → matches expected deterministic output
  - Navigate to policy → view history → see version timeline with hashes
  - Navigate to Petitions → see "Coming Soon" placeholder page

**Demo checkpoint:** Full dashboard walkthrough:
1. Open dashboard → navigate to Policies → see all seeded policies
2. Click a policy → Constraints tab shows structured view → Cedar tab shows syntax-highlighted source → History tab shows version timeline
3. Navigate to Agents → click OpenClaw agent → Envelope tab shows full permissions with inheritance chain from org → dept → team
4. Switch to Test tab → select purchase.initiate → fill context → click Test → see Allow/Deny with full breakdown
5. Navigate to Groups → see Acme Corp tree → click Engineering → see members and assigned policies
6. Navigate to Petitions → see "Coming Soon" placeholder with planned workflow description

---

## Open Questions

1. **Cedar WASM stability in Bun:** The `cedar-wasm` crate is experimental. If Bun's WASM runtime has edge cases (memory limits, async imports), the fallback is a thin Rust Cedar sidecar with the same `CheckRequest`/`CheckResponse` interface. The `CedarEngine` interface abstracts the backend, so swapping is a one-line change.

2. **Recursive CTE depth limits:** Postgres recursive CTEs have no default depth limit, but a pathological hierarchy (1000+ levels deep) could cause performance issues. Agent governance hierarchies are expected to be 3-5 levels deep. Add a `LIMIT 100` safety clause to the recursive CTE.

3. **Cross-package agent references:** `agentGroupMemberships.agentDid` is a TEXT column, not a FK to the registry package's agents table (different packages, potentially different schemas). Referential integrity is enforced at the application level, not the DB level. If an agent is deleted from the registry, a cleanup job should remove stale memberships.

4. **Petition routing when no admin exists:** The routing algorithm assumes each group has at least one admin. If no admin is found at the target level, the petition should escalate to the next level up. The spec should define an `admin_did` column on `groups` or use a convention (first agent in the group with admin role).

5. **Decision log storage growth:** Every policy check writes a decision log entry. At high throughput, this table grows fast. Consider: partitioning by `evaluatedAt`, retention policy (delete entries older than N days), or write to a separate analytics store. Not in scope for the initial implementation.

6. **Caching strategy (deferred):** The `EnvelopeCache` interface is defined with a `NoOpEnvelopeCache` default. When caching becomes necessary, the `organizations.policyVersion` counter provides the staleness signal. Cross-process invalidation (e.g., Postgres NOTIFY) is a further optimization for multi-process deployments — not in scope for initial implementation.

## References

- [Rules Engine Specification](./rules-engine-SPEC.md) — full spec with all interfaces, schemas, and flows
- [Rules Engine Decisions](./rules-engine-DECISIONS.md) — design interview questions and selected answers
- [Rules Engine Architecture Map](./rules-engine-ARCHITECTURE.md) — existing Rust/Kotlin engine analysis
- [Storefront SDK Spec](./storefront-sdk-SPEC.md) — 10-step verification flow
- [Storefront SDK Plan](./storefront-sdk-PLAN.md) — implementation patterns and phase structure
- [CLAUDE.md](../../CLAUDE.md) — project overview, stack, conventions
- [verify.ts](../../packages/storefront-sdk/src/verify.ts) — current authorization logic (steps 7-10, to be replaced)
- [middleware.ts](../../packages/storefront-sdk/src/middleware.ts) — verification middleware
- [registry-client.ts](../../packages/storefront-sdk/src/registry-client.ts) — registry interface
- [server.py](../../sidecar/server.py) — current sidecar implementation (to be updated)
- [spending-policy.yaml](../../sidecar/policies/spending-policy.yaml) — current policy rules (to be deleted)
- [Code Style Rules](../../.claude/rules/code-style.md) — TypeScript and Python conventions
- [Testing Rules](../../.claude/rules/testing.md) — test philosophy and required test cases
- [Security Rules](../../.claude/rules/security.md) — secrets, crypto, input validation
- [API Contracts](../../.claude/rules/prompts.md) — endpoint schemas and response shapes
- [Cedar Policy Language](https://www.cedarpolicy.com/) — Cedar documentation