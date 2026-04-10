# Rules Engine — Design Interview Decisions

Record of design decisions made during the rules engine specification interview. Each section captures the question, the options considered, and the selected approach.

---

## 1. Overall Strategy

**Q: The architecture doc frames this as 'replacing' the Rust/Kotlin engine, but the existing engine has working Cedar evaluation, envelope resolution, group hierarchy, and a dashboard. What's the actual goal?**

| Option | Description |
|--------|-------------|
| Rewrite in TypeScript | Port Cedar evaluation (via WASM or pure TS policy engine), envelope resolver, and management API into the existing Bun/Hono stack. Kill the Rust and Kotlin services entirely. |
| Integrate as-is | Add the existing Rust/Kotlin/Next.js services to Docker Compose. Wire the sidecar and SDK to call them. Accept 3 additional services in the stack. |
| **Hybrid — TS engine, keep DB schema** | **Rewrite evaluation and management in TypeScript but reuse the PostgreSQL schema (ltree hierarchy, policy versioning, dimension kinds) and seed data.** |

**Selected: Hybrid — TS engine, keep DB schema**

---

## 2. Cedar Entity Loading

**Q: The existing rules engine evaluates against `Entities::empty()` — Cedar's group membership operator (`principal in Group::"acme.finance"`) doesn't work. The ltree hierarchy is resolved outside Cedar (in Kotlin) and Cedar just gets flat permit/forbid blocks. If you're keeping Cedar, do you want to fix this?**

| Option | Description |
|--------|-------------|
| **Fix it — load entities** | **Load agent-group relationships into Cedar's entity store so `principal in Group` works natively. More Cedar-idiomatic but requires entity sync.** |
| Keep flat evaluation | Continue resolving hierarchy outside Cedar. Cedar gets pre-resolved permit/forbid blocks. Simpler, already working. |
| Drop Cedar entirely | Use a custom TypeScript policy evaluator with the same envelope/intersection semantics. No Cedar dependency at all. |

**Selected: Fix it — load entities**

---

## 3. Testing Bar

**Q: The rules engine has zero unit tests across all three services. The only test is a bash smoke test. Given testing.md requires 'every policy rule has a test, every hierarchy constraint has a test' — what's the testing expectation?**

| Option | Description |
|--------|-------------|
| **Full test suite from day 1** | **Spec requires comprehensive tests for envelope resolution, Cedar generation, dimension intersection, deny-overrides, and all API endpoints before any integration.** |
| Tests follow integration | Get the integration working first, then backfill tests for the critical paths. |
| Only test the new code | Test the TypeScript integration layer and new endpoints. Don't retroactively test the existing Rust/Kotlin code if keeping it. |

**Selected: Full test suite from day 1**

---

## 4. Cedar Runtime

**Q: Cedar has a WASM target (`cedar-wasm`) but it's experimental and not officially published to npm. Since you want to collapse the stack into TS, how do you want Cedar evaluation to work?**

| Option | Description |
|--------|-------------|
| **Cedar WASM in-process** | **Compile cedar-policy to WASM via cedar-wasm crate. Run in Bun's WASM runtime. Single process, no HTTP hop, sub-ms evaluation. Risk: experimental, may have edge cases in Bun's WASM support.** |
| Keep Rust engine as thin sidecar | Keep only the Rust evaluator (kill Kotlin). It becomes a stateless Cedar evaluation service. TS handles hierarchy, management, everything else. |
| Pure TS policy evaluator | Don't use Cedar at all. Implement the same permit/forbid/envelope semantics in TypeScript with Zod-validated policy objects. |
| cedar-java via GraalJS/Bun FFI | Use the cedar-java bindings via Java interop. Heavy, but the Kotlin management service already uses cedar-java 4.2.2. |

**Selected: Cedar WASM in-process**

---

## 5. Envelope Cache Performance Model

**Q: The envelope resolver currently recomputes from scratch on every request (no caching). For the storefront SDK, every `/agent-checkout/*` request runs the verification middleware, which would now include envelope resolution. Should the spec include a caching strategy?**

| Option | Description |
|--------|-------------|
| Always recompute, no cache | Envelope resolution is fast. Cache invalidation is harder than the computation. Accept the latency hit. |
| Cache with TTL | Cache resolved envelopes per agent with a short TTL (30s-5min). Stale policy changes are acceptable within the window. |
| **Cache with invalidation** | **Cache envelopes and invalidate on policy/assignment/membership changes via DB triggers or event bus. Correct but complex.** |
| Spec should punt on caching | Define the interface, leave caching as an optimization for later. |

**Selected: Cache with invalidation**

---

## 6. Runtime State Ownership

**Q: The existing spending-policy.yaml has stateful rules (daily spend limit via `context.spend_last_24h`, rate limit via `context.transactions_last_hour`). The rules engine's `rate` dimension kind exists in the schema but has no runtime state integration. Who owns computing and injecting this runtime state?**

| Option | Description |
|--------|-------------|
| Ledger package computes, engine injects | The ledger tracks spend state. The rules engine queries the ledger at evaluation time. |
| Sidecar keeps state | The Python sidecar maintains spend accumulators (as it does now with hardcoded values). |
| **Caller provides context** | **The storefront SDK (or whoever calls the rules engine) is responsible for querying the ledger and passing runtime state in the check request. The engine is pure evaluation, no I/O.** |
| Defer stateful rules | Spec covers only stateless rules. Stateful rules are post-demo. |

**Selected: Caller provides context**

---

## 7. WASM Build Strategy

**Q: The `cedar-wasm` crate exists in the cedar-policy repo but isn't published. You'd need to compile it yourself from the Rust source. What's the plan, and what's the fallback?**

| Option | Description |
|--------|-------------|
| Spec includes WASM build pipeline | Define a `packages/cedar-wasm/` package with a Rust build step. Fallback to thin Rust sidecar if WASM doesn't work. |
| **Pre-built WASM artifact checked in** | **Build the WASM once, check the .wasm file into the repo. No Rust toolchain needed for TS developers. Update manually when Cedar version changes.** |
| Fallback-first: thin Rust sidecar | Start with the proven Rust sidecar. Attempt WASM migration as an optimization later. |
| Already built | The WASM artifact already exists. |

**Selected: Pre-built WASM artifact checked in**

---

## 8. Cache Invalidation Mechanism

**Q: When a policy assignment changes, you need to invalidate all agents affected (potentially through group hierarchy). What's the invalidation trigger mechanism?**

| Option | Description |
|--------|-------------|
| Postgres LISTEN/NOTIFY | DB triggers fire NOTIFY events. The TS engine listens and invalidates affected agent caches. |
| Application-level events | Management API emits events via EventEmitter. Only works within the same process. |
| Write-through with version counter | Every mutation increments a global policy version counter. Stale entries are recomputed on read. |
| **Hybrid: version counter + NOTIFY** | **Version counter for in-process staleness checks, plus Postgres NOTIFY for multi-process deployments.** |

**Selected: Hybrid: version counter + NOTIFY for cross-process**

---

## 9. Action Type Scope

**Q: The existing rules engine has 14 action types across 3 domains. For the Warranted integration, do you want the spec to cover all 14, or scope down to transaction-relevant ones only?**

| Option | Description |
|--------|-------------|
| **All 14 action types** | **Port the full action type set. Communication controls and delegation controls are part of the governance story even if not used by the storefront SDK today.** |
| Transaction actions only | Scope to purchase.initiate, purchase.approve, and maybe 1-2 others directly used by the storefront SDK. |
| Extensible schema, seed transactions | Define the extensible system but only seed transaction-relevant actions. |

**Selected: All 14 action types**

---

## 10. Authorization Response Surface

**Q: The storefront SDK's `verifyAuthorization()` currently returns a simple `AuthorizationResult`. The rules engine returns rich data: resolved dimensions with inheritance chains, deny sources, and per-dimension provenance. Should the SDK's response get richer?**

| Option | Description |
|--------|-------------|
| Rich response — expose envelope | The authorization check returns the full resolved envelope with provenance. |
| Flat response + audit log | The SDK returns the same simple authorized/denied + error code. Rich data goes into audit log only. |
| **Tiered — flat for agents, rich for admins** | **Agent-facing endpoints get the simple response. A separate admin/debug endpoint exposes the full envelope and decision reasoning.** |

**Selected: Tiered — flat for agents, rich for admins**

---

## 11. Management API Location

**Q: The Kotlin management service is a full CRUD API with 25+ endpoints. In the TS rewrite, where does policy management live?**

| Option | Description |
|--------|-------------|
| New `packages/rules-engine/` | Dedicated package with its own Hono routes, Drizzle schema, and business logic. |
| Extend `apps/api/` | Add policy management routes directly to the existing Hono API server. |
| **Split: engine lib + API routes** | **`packages/rules-engine/` is a pure library (evaluation, envelope resolution, Cedar WASM). Policy management routes live in `apps/api/routes/policies/`.** |

**Selected: Split: engine lib + API routes**

---

## 12. Agent Model Reconciliation

**Q: The existing Drizzle schema has registry agents (DID, publicKey). The rules engine has its own agents (domain, email). How do you reconcile?**

| Option | Description |
|--------|-------------|
| Single agent table, superset columns | Merge into one table with all fields from both. |
| Separate tables, FK relationship | Keep both tables linked by a foreign key. |
| **Rules engine uses registry agents** | **The rules engine doesn't have its own agent table. It references registry agents by DID. Group memberships and policy assignments reference the registry's agent records directly.** |
| Registry agents are source of truth | Rules engine syncs from registry on agent creation/update. |

**Selected: Rules engine uses registry agents**

---

## 13. Cedar Entity Store Lifecycle

**Q: You want `principal in Group::"acme.finance"` to work natively. This means the WASM Cedar evaluator needs an entity store. Who builds and maintains it, and when is it refreshed?**

| Option | Description |
|--------|-------------|
| Eager load on startup + NOTIFY refresh | Load all entities at boot. NOTIFY triggers reload on changes. |
| Lazy load per evaluation | Query relevant entities on each check request. No persistent store. |
| **Batch sync on policy version bump** | **Rebuild the full entity store whenever the policy version counter increments. Immutable between policy changes. Consistent with cache invalidation.** |

**Selected: Batch sync on policy version bump**

---

## 14. Cedar Source as Contract

**Q: Should the spec define Cedar source format as a stable contract (deterministic and testable), or is it an internal implementation detail?**

| Option | Description |
|--------|-------------|
| **Cedar source is a contract** | **Generated Cedar source is deterministic, stored in the DB, and exposed in the dashboard. Users can view, copy, and audit. The generator has snapshot tests.** |
| Cedar is internal only | Users interact with structured constraints. Cedar is an ephemeral compilation target. |
| Hybrid — stored for audit, not user-facing | Cedar source stored for reproducibility and audit, but dashboard shows structured constraints. |

**Selected: Cedar source is a contract**

---

## 15. Dashboard Strategy

**Q: The existing rules engine dashboard is a standalone Next.js 14 app with its own design system (614 lines of neumorphic CSS). Warranted already has a Next.js dashboard with shadcn/ui. What happens to the rules engine dashboard?**

| Option | Description |
|--------|-------------|
| **Port into apps/dashboard/** | **Rebuild the rules engine UI as pages/components within the existing Warranted dashboard. Uses shadcn/ui, shares auth, consistent look and feel.** |
| Keep separate, link from Warranted | The rules engine dashboard stays standalone. Two dashboards, two design systems. |
| Defer dashboard entirely | Focus on the backend first. Dashboard is a separate spec/phase. |
| Embed as micro-frontend | Mount the rules engine dashboard as an iframe or module federation chunk. |

**Selected: Port into apps/dashboard/**

---

## 16. Sidecar Fate

**Q: The sidecar currently does double duty: identity AND authorization. The rules engine replaces authorization. What happens to `/check_authorization` and `/sign_transaction`?**

| Option | Description |
|--------|-------------|
| **Sidecar calls rules engine** | **The sidecar's /check_authorization becomes a thin proxy. Translates params into a rules engine check request. Backward compatible.** |
| Sidecar drops authorization | Remove /check_authorization entirely. SDK and API call rules engine directly. Sidecar only handles identity/signing/trust. |
| Keep both paths (migration period) | Both old and new run in parallel with a feature flag. |
| Sidecar goes away entirely | Port identity + signing to TypeScript too. |

**Selected: Sidecar calls rules engine**

---

## 17. SDK Authorization Call Site

**Q: The storefront SDK's `verifyAuthorization()` is currently pure/fast. The rules engine makes it async/IO-bound. How should this integration point work?**

| Option | Description |
|--------|-------------|
| Replace verifyAuthorization() entirely | Delete the function. Steps 7-10 become a single rules engine check. |
| verifyAuthorization() delegates to engine | Same signature, different guts. Callers don't change. |
| **Two-phase: fast local + async engine** | **verifyAuthorization() does a fast local check from JWT claims (fail-fast for obvious violations). If it passes, the rules engine does the authoritative check with full envelope resolution.** |
| Middleware handles both | The verification middleware calls the rules engine once for both identity and authorization. |

**Selected: Two-phase: fast local + async engine**

---

## 18. Policy Source of Truth

**Q: The `spending-policy.yaml` is currently the source of truth. The rules engine stores policies in Postgres. During and after migration, what's the source of truth?**

| Option | Description |
|--------|-------------|
| Database is SoT, YAML is seed-only | YAML becomes a seed file. After initial load, management API is the only way to modify policies. |
| YAML stays SoT, DB is derived | Policies always defined in YAML. A sync process reads YAML and upserts into DB. GitOps style. |
| Both are valid sources | YAML for infrastructure-as-code, API for runtime changes. Conflict resolution needed. |
| **Drop YAML entirely** | **Policies are only in the database. The YAML file is deleted. All policy management goes through the API or dashboard.** |

**Selected: Drop YAML entirely**

---

## 19. Two-Phase Gap Handling

**Q: An agent could pass the fast local JWT-claims check but fail the authoritative rules engine check (policy updated after JWT was issued). What should happen?**

| Option | Description |
|--------|-------------|
| Identical denial response | Same 403 regardless of which phase caught it. No information leakage. |
| Include policy version context | Denial response includes policy version and last update time. |
| **Soft deny with retry hint** | **If local passes but engine denies, return a 403 with an additional field suggesting the agent refresh its token.** |

**Selected: Soft deny with retry hint**

---

## 20. Petitioning Scope

**Q: The petitioning primitive (agents request one-time policy exceptions) is described in the README but has zero implementation. Should the spec include it?**

| Option | Description |
|--------|-------------|
| **In scope — full design** | **The spec defines the petitioning workflow: request schema, approval chain, expiry, audit trail.** |
| In scope — API stubs only | Define the data model and API endpoints, mark implementation as post-demo. |
| Out of scope | Petitioning is not part of this spec. |

**Selected: In scope — full design**

---

## 21. Management API Authentication

**Q: The rules engine management API currently has zero authentication. What's the auth model for the integrated system?**

| Option | Description |
|--------|-------------|
| Platform JWT with admin role | Reuse Warranted JWT with an `admin` role claim. Same auth middleware, different role gate. |
| Separate API key | Management API uses API keys. Simple, no JWT complexity. |
| **Entity-scoped JWT** | **Management endpoints require a JWT scoped to the entity (organization). A CFO's token can modify policies for their org only. Maps to the authority chain model.** |
| Defer auth — internal only | Management API is internal-only (Docker network). Auth is network-level. |

**Selected: Entity-scoped JWT**

---

## 22. Policy Mutation Atomicity

**Q: A policy update triggers: new version, Cedar regeneration, entity store rebuild, bundle hash recalculation, cache invalidation. Should this be atomic or eventually consistent?**

| Option | Description |
|--------|-------------|
| **Atomic — all or nothing** | **Policy mutations are wrapped in a DB transaction. Cedar generation, validation, and bundle hash update happen synchronously before commit. No partial states.** |
| Eventual consistency with version fence | Mutation commits immediately. Regeneration happens async. Version fence prevents evaluation until complete. |
| Async with staleness window | Mutation commits. Other steps happen async. Brief window where evaluations may use old policy. Decision log captures which version was used. |

**Selected: Atomic — all or nothing**

---

## 23. Schema Migration Strategy

**Q: The existing schema uses Flyway (Java). You're porting to Drizzle. The schema has 9 tables with custom types (ltree, pgEnum). How do you handle the migration?**

| Option | Description |
|--------|-------------|
| **Fresh Drizzle schema, seed migration** | **Define all tables in Drizzle from scratch. Write a one-time data migration script. Clean break.** |
| Drizzle introspects existing schema | Use `drizzle-kit introspect` to generate Drizzle schema from existing tables. |
| Coexist — separate Postgres schemas | Keep Flyway tables in `rules` schema. Drizzle tables in `public`. Both systems run independently. |
| Rewrite schema to match Warranted conventions | Redesign tables to match Warranted's Drizzle conventions. Breaking change. |

**Selected: Fresh Drizzle schema, seed migration**

---

## 24. Dashboard Feature Scope

**Q: The rules engine dashboard has: envelope visualization, REPL policy tester, and Cedar source viewer. When porting to apps/dashboard/, should all three ship in the initial spec?**

| Option | Description |
|--------|-------------|
| **All three in initial spec** | **Envelope visualization, REPL tester, and Cedar viewer all ship. They're the core value of having a rules engine dashboard.** |
| Envelope + REPL only | Envelope view and REPL tester are essential. Cedar viewer can come later. |
| Envelope only | Envelope visualization is the killer feature. REPL and Cedar viewer are dev tools. |
| Defer all dashboard work | Spec covers engine and API only. Dashboard is a separate phase. |

**Selected: All three in initial spec**

---

## 25. Petition Approval Routing

**Q: An agent hits a policy denial and files a petition. Who approves — immediate parent, top of chain, or something else?**

| Option | Description |
|--------|-------------|
| Immediate parent first, escalate on timeout | Petition goes to direct parent. If no response, escalates up. |
| **Lowest authority that covers the exception** | **Route to the lowest level in the hierarchy whose policy envelope would permit the requested exception.** |
| Always top of chain | Petitions always go to the top (CFO). Simple but bottleneck-prone. |
| Policy-defined approver | Each policy rule specifies who approves exceptions for it. |

**Selected: Lowest authority that covers the exception**

---

## 26. Temporal Dimension Support

**Q: The rules engine's dimension kinds include `temporal` (time-of-day windows + expiry dates). Should the spec support this for agent commerce transactions?**

| Option | Description |
|--------|-------------|
| **Full temporal support** | **Time-of-day windows, date expiry, and tightest-window resolution. Useful for 'no purchases after hours' or 'policy expires end of quarter'.** |
| Expiry only, no time-of-day | Support policy expiry dates but not time-of-day windows. Simpler, covers the most common case. |
| Out of scope | No temporal dimensions. Policies are always active until manually deactivated. |

**Selected: Full temporal support**

---

## 27. Transaction Signing Coupling

**Q: The `sign_transaction` endpoint currently checks authorization AND signs in one call. With the rules engine replacing authorization, should these be decoupled?**

| Option | Description |
|--------|-------------|
| **Coupled — sign-if-approved** | **The sidecar calls the rules engine before signing. If denied, no signature. Single endpoint, atomic operation.** |
| Decoupled — separate concerns | Authorization and signing are independent. Caller is responsible for checking authorization before requesting signature. |
| Sign always, attach decision | Sidecar always signs, but signed payload includes the authorization decision. Signature proves what decision was made, not that it was approved. |

**Selected: Coupled — sign-if-approved**

---

## 28. Hierarchy Implementation

**Q: The existing rules engine uses `ltree` for group hierarchy, requiring the Postgres extension. Warranted's existing schema doesn't use ltree. Is ltree worth the complexity?**

| Option | Description |
|--------|-------------|
| Keep ltree | Purpose-built for hierarchies. GiST indexing makes queries fast. Custom Drizzle column type is manageable. |
| **Adjacency list + recursive CTE** | **Standard parent_id FK. Use Postgres recursive CTEs for ancestor/descendant queries. No extensions needed. Drizzle handles it natively.** |
| Closure table | Pre-computed ancestor-descendant pairs. O(1) lookups but insert/move requires table updates. |
| Materialized path (text column) | Store path as plain text. Parse in application code. No DB-level hierarchy operations. |

**Selected: Adjacency list + recursive CTE**

---

## 29. Implementation Phasing

**Q: Given everything discussed — Cedar WASM, fresh Drizzle schema, envelope resolution, cache invalidation, petitioning, dashboard, 14 action types, full test suite — how many phases?**

| Option | Description |
|--------|-------------|
| 4 phases | Foundation → Engine → Integration → Dashboard |
| 3 phases | Core → Integration → Polish |
| **6 fine-grained phases** | **Schema, WASM, Envelope, Cedar Gen, Integration, Dashboard. Each phase has a tight deliverable and demo checkpoint.** |
| 2 phases | Build → Integrate |

**Selected: 6 fine-grained phases** (Schema+Types+WASM → Envelope+CedarGen → CedarEval+EntityStore → SDK+Sidecar Integration → Petitioning+MgmtAPI → Dashboard+Polish)

---

## 30. Error Code Strategy

**Q: The storefront SDK has error codes (OVER_LIMIT, VENDOR_NOT_APPROVED, etc.). The rules engine's Cedar evaluator returns generic Allow/Deny. How should error codes work?**

| Option | Description |
|--------|-------------|
| Map to existing SDK codes | Rules engine translates Cedar denials into existing SDK error codes. External consumers see no change. |
| New engine-specific codes | Rules engine defines its own codes (POLICY_DENIED, DIMENSION_EXCEEDED, etc.). SDK maps at the boundary. |
| **Return both** | **Denial response includes both SDK-compatible code (backward compat) and engine-specific code with dimension details (debugging/audit).** |

**Selected: Return both**
