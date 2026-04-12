# Platform Extension — Design Decisions

All non-trivial design decisions from the platform extension interview, organized by phase. Each decision includes the tradeoffs considered and the rationale for the chosen approach.

---

## Phase 1: WorkOS Integration

### Q: How should the auth middleware integrate with the existing route factory?

**Tradeoff:** Hono context middleware only (simple, idiomatic) vs. auth-aware route factory that threads org context through every handler (explicit, changes signatures) vs. both (middleware sets context, factory validates per-route opt-in).

**Decision:** Both: middleware sets, factory validates. Hono middleware sets `c.set('orgId', orgId)` on authenticated routes. The route factory keeps its `db` argument — no signature changes. Individual routes call `c.get('orgId')` and throw if missing on routes that require auth. Sidecar-facing `/check` and `/health` skip the middleware entirely. Standard Hono pattern: `app.use('/api/policies/rules/*', authMiddleware)` on protected paths, no middleware on internal paths. One middleware, selective application.

### Q: How should the internal `/check` endpoint be protected in dev and production?

**Tradeoff:** Skip auth on `/check` (accept dev risk, rely on production network segmentation) vs. shared secret header (defense-in-depth, testable) vs. network-only in production with open dev.

**Decision:** Shared secret header (`X-Internal-Token`). New env var `INTERNAL_API_SECRET`. API middleware checks the header on `/check` only. Sidecar sends it via `httpx`. This is defense-in-depth on top of network segmentation, not instead of it. A compliance product cannot rely on network configuration alone — a misconfigured Docker network shouldn't silently expose the Cedar evaluation endpoint.

### Q: Where should the WorkOS webhook handler be mounted?

**Tradeoff:** `/webhooks/workos` (clean separation but breaks Caddy routing — catch-all sends non-`/api` paths to dashboard) vs. `/api/webhooks/workos` (under `/api` prefix, proxy routes correctly) vs. `/api/policies/webhooks/workos` (semantically wrong — webhooks aren't policy operations).

**Decision:** `/api/webhooks/workos`. Stays under the `/api` prefix so the existing Caddy proxy config routes it to the API service without additional rules. Separate route group in `apps/api/src/index.ts`: `app.route("/api/webhooks/workos", workosWebhookRoutes(db))`. Auth middleware doesn't apply — webhook routes use WorkOS signature verification (`WORKOS_WEBHOOK_SECRET`).

### Q: How should IdP groups map to the nodeType hierarchy (org/department/team)?

**Tradeoff:** Convention-based naming (fragile — breaks when customer names groups differently) vs. manual mapping in dashboard (robust, one-time setup) vs. IdP metadata attribute (requires IdP configuration before onboarding).

**Decision:** Manual mapping in dashboard. SCIM syncs groups with `nodeType = 'unassigned'`. Admin assigns nodeType in the dashboard after sync — a one-time setup step during onboarding (5 minutes of clicking). The envelope resolver walks `parentId` relationships via recursive CTE, not nodeType — `'unassigned'` groups are functional in the hierarchy. Dashboard shows a "Setup Required" badge on unassigned groups.

### Q: Where do org name and slug come from for auto-created organizations on first WorkOS login?

**Tradeoff:** Use WorkOS org name directly (zero friction, correct) vs. prompt admin on first login (extra form for information they already provided) vs. generated placeholder like "Org a1b2c3" (looks broken until renamed).

**Decision:** Use WorkOS org name. Pull name from WorkOS organization object via `workos.organizations.getOrganization(orgId)`. Generate slug via kebab-case (`Acme Corporation` → `acme-corporation`), handle collisions with numeric suffix. One API call during first login. 99% of admins won't rename because the name is already correct.

### Q: How should SCIM webhook handlers ensure idempotency?

**Tradeoff:** Event ID dedup table (guaranteed dedup, adds one table) vs. timestamp-based skip (misses late-arriving events) vs. natural idempotency via upserts (correct but blind to duplicates) vs. both dedup + upserts.

**Decision:** Both event ID dedup + natural idempotency. All handlers use `INSERT ... ON CONFLICT DO UPDATE` (correctness layer — even if the dedup table is cleared, state is correct). A `workos_processed_events` table tracks event IDs for observability (know when duplicates arrive, detect webhook replay storms). Upserts guarantee correctness, event ID tracking provides observability.

### Q: Should Redis be added in Phase 1 for WorkOS session management?

**Tradeoff:** Phase 1 (WorkOS needs it) vs. Phase 2 (WorkOS uses cookies, Redis only needed for agent status) vs. Phase 1 with minimal config (available but not load-bearing).

**Decision:** Phase 2. WorkOS AuthKit's Next.js package (`@workos-inc/authkit-nextjs`) manages sessions via encrypted HTTP-only cookies — no server-side session store. Redis is first needed in Phase 2 for the agent status cache. Add infrastructure when it's load-bearing, not speculatively. Avoids debugging Redis connection issues during a phase focused on WorkOS integration.

### Q: How should the groups nodeType CHECK constraint handle SCIM-synced groups?

**Tradeoff:** Allow NULL (ambiguous, inconsistent query patterns) vs. add `'unassigned'` to allowed values (explicit state, consistent queries) vs. remove CHECK entirely (loses DB-level validation).

**Decision:** Add `'unassigned'` to the CHECK constraint. Explicit state, no null ambiguity. `WHERE nodeType = 'unassigned'` finds groups needing admin attention — same query pattern as every other nodeType filter. Default value set to `'unassigned'` for new rows. The CHECK constraint stays as a safety net against invalid values.

### Q: What login UX should the dashboard use?

**Tradeoff:** WorkOS AuthKit hosted redirect (zero custom UI, handles all IdP edge cases) vs. embedded AuthKit widget (stays on domain, more frontend code) vs. hosted with custom branding (zero custom UI, on-brand experience).

**Decision:** Hosted with custom branding. AuthKit's hosted page handles SSO negotiation, MFA, Directory Sync consent, and every IdP-specific edge case. Configure branding (logo, colors) in WorkOS dashboard. Implementation is ~10 lines via `@workos-inc/authkit-nextjs` middleware. Building an embedded version reimplements what a package install gives you.

---

## Phase 2: Agent Identity + The Seam

### Q: How should the sponsor's envelope be resolved when the sponsor is a WorkOS user, not an agent with a DID?

**Tradeoff:** Synthetic agent_did for WorkOS users (resolveEnvelope works unchanged) vs. new resolver function for user context (parallel resolution path) vs. role-based delegation limits (breaks narrowing invariant).

**Decision:** Synthetic agent_did. WorkOS `om_*` IDs go into `agentGroupMemberships` as `agent_did`. `resolveEnvelope(db, "om_01HXYZ...", orgId)` works unchanged — same function, same intersection semantics, same recursive CTE walk, same 370 tests passing. This implements the core lineage principle: "Every entity — org, group, user, agent — is a node." No parallel resolution path to maintain.

### Q: What happens when an admin loses the agent's private key and needs to redeploy?

**Tradeoff:** Re-provision on key loss (clean but operationally brutal — new DID, re-assign policies) vs. encrypted escrow (stores actual private key, bigger blast radius) vs. seed-based derivation (recoverable, smaller blast radius).

**Decision:** Seed-based derivation. Generate a cryptographically random seed, derive keypair from it deterministically. Store the seed encrypted in a new `agent_key_seeds` table using AES-256-GCM. Encryption key derived per-org via HKDF: `hkdf(sha256, AGENT_SEED_ENCRYPTION_KEY, orgId, "warranted-agent-seeds-v1", 32)`. Admin can re-download from dashboard. Backward compatible with existing `ED25519_SEED` sidecars. Seed is smaller and single-purpose compared to storing raw private keys.

### Q: What exactly does "subset of the sponsor's envelope" mean for the narrowing invariant?

**Tradeoff:** Constraint value comparison (full dimension-by-dimension check) vs. policy ID subset (simpler but misses constraint widening from different policies) vs. skip enforcement for v1 (defeats product promise).

**Decision:** Constraint value comparison. Resolve the sponsor's effective envelope, then for every dimension in the agent's requested policies, the agent's value must be equal to or more restrictive: numeric max ≤ sponsor max, set members ⊆ sponsor members, boolean (restrictive) can only add restrictions, temporal expiry ≤ sponsor expiry, rate limit ≤ sponsor limit. Error message tells the admin which dimension failed and what the ceiling is: "You tried to set amount limit to $6000 but your effective limit is $5000."

### Q: How should agent suspension propagate when a WorkOS user is suspended via SCIM?

**Tradeoff:** Check agent status in Postgres on every /check call (adds DB query to hot path) vs. Redis status cache (sub-millisecond reads) vs. eventual via sidecar polling (propagation window).

**Decision:** Redis status cache. On SCIM suspension webhook, write `{org_id}:status:{agent_id} = suspended` to Redis for each affected agent. `/check` and `/execute-check` read Redis before Cedar evaluation — denied immediately if suspended. Sub-millisecond reads, sub-second propagation. No Postgres per-request on the hot path. The spec says "revocation blocks next operation" — a polling interval means unauthorized activity during the propagation window.

### Q: What should the agent provisioning seed display UX look like?

**Tradeoff:** Modal with copy + confirm (like GitHub PATs) vs. downloadable .env file vs. both.

**Decision:** Both modal display + .env download. Modal shows: agent ID/DID (reference), `ED25519_SEED` in masked field with show/copy, full `docker run` command (copyable), "Download sidecar.env" button, "I have saved this seed" checkbox (required before dismissing). Re-downloadable by org admin from dashboard. Different admins have different workflows — DevOps copies to `kubectl create secret`, team lead downloads `.env` next to compose file.

### Q: What's the maximum lineage depth?

**Tradeoff:** Hard limit of 5 (covers all real hierarchies) vs. 10 (generous) vs. no limit with soft warning vs. partial counter tracking.

**Decision:** Hard limit of 5 levels: org → department/group → user → agent → sub-agent. Enforced at creation time in `POST /api/agents/create`. This is a product decision — compliance products prevent unbounded agent delegation. Matters for: envelope resolution cost (5 levels = 5 group walks), audit comprehensibility (humans can read 5-level chains), rate counter atomicity (5 INCRs in the Lua script). Raise to 7 if a customer proves they need it.

---

## Phase 3: Multi-Tenancy + Org Isolation

### Q: How should agentGroupMemberships be org-scoped?

**Tradeoff:** Join through groups (normalized, more complex queries) vs. add org_id column (denormalized, simpler WHERE) vs. add org_id + Postgres RLS (strongest isolation).

**Decision:** Add org_id + Postgres row-level security. Denormalize for query simplicity. RLS ensures every query is automatically scoped — even a missed WHERE clause can't leak cross-org data. This is the strongest isolation guarantee, appropriate for a multi-tenant compliance product.

### Q: How should multi-tenancy be tested without rewriting all 370 existing tests?

**Tradeoff:** Fresh org per test suite (full isolation, touches every test) vs. global test orgId from seed (minimal changes, no cross-org coverage) vs. both seed org + dedicated cross-org tests.

**Decision:** Both. Existing 370 tests keep using the Acme Corp seed org with the existing `ORG_ID` constant — no changes. New `apps/api/__tests__/org-isolation.test.ts` creates two orgs and verifies isolation with 7-10 targeted tests: policies in Org A not visible from Org B, agents scoped, decision log scoped, group operations scoped. Best coverage with least disruption.

### Q: How should the decision log be org-scoped?

**Tradeoff:** Add org_id (denormalize, fast audit queries) vs. derive from agent lineage (normalized, slow for exports) vs. add org_id + partition by org (best at scale, complex now).

**Decision:** Add org_id to decisionLog. Every INSERT stamps the org. Audit queries are simple: `WHERE org_id = $1 AND evaluated_at BETWEEN $2 AND $3`. One extra UUID per write is negligible. Add index on `(org_id, evaluated_at)`. Partition later when traffic justifies it — the column exists for when you're ready. The migration from denormalized to partitioned is straightforward.

### Q: Should actionTypes become org-scoped?

**Tradeoff:** Org-scoped tools (full customization) vs. global + org overlay (two-table resolution) vs. global only (no custom tools) vs. global + per-org config (two rows per tool per org).

**Decision:** Org-scoped. Add `org_id` to `actionTypes`. Unique constraint becomes `UNIQUE(org_id, name)`. Existing seed data backfilled with Acme Corp org_id — UUIDs don't change, so existing policies and decision log references are unaffected. New orgs get tools via `seedDefaultTools(db, orgId)` template function. Different orgs can define entirely different tool catalogs.

### Q: Does the actionTypes org-scoping migration require updating policies or decision logs?

**Tradeoff:** No additional migration (UUIDs unchanged) vs. policy constraint JSONB migration vs. deterministic UUIDs per org.

**Decision:** No additional migration needed. Existing rows get `org_id` backfilled, UUIDs don't change. Policies reference `actionTypeId` (UUID), not name. New orgs get new UUIDs via `gen_random_uuid()`. Each org has distinct UUIDs — no cross-org reference collisions.

### Q: What's the phase dependency order?

**Tradeoff:** Phase 3 required before 4/5 (linear) vs. single-org fallback mode (two code paths) vs. merge Phase 3 into Phase 1 (doubles Phase 1 scope).

**Decision:** Linear: Phase 1 → 2 → 3 → 4 → 5. Each phase is a prerequisite for the next. Phase 4 needs org-scoped envelope resolution, Phase 5 needs org-scoped credentials and rate counters. No single-org fallback (two code paths maintained forever). No merging Phase 3 into Phase 1 (already a 2-week effort). Five phases, clean dependency chain.

---

## Phase 4: Tool Catalog + Registry MCP

### Q: How does the Registry MCP resolve the agent's org_id when it only has a DID from the DPoP proof?

**Tradeoff:** New API endpoint with DID-only (API looks up org internally) vs. MCP has read-only DB access (blast radius) vs. sidecar passes org context (trusts self-asserted claim).

**Decision:** New API endpoint: `GET /api/agents/:did/envelope`. API looks up `org_id` from `agent_identities` table internally, then calls `resolveEnvelope(db, did, orgId)`. MCP has zero DB access — the API is the single authority for all data access. Prevents blast radius from MCP compromise and prevents misconfigured sidecar org_id from enabling cross-org access.

### Q: Should the projected tool manifest include any rate limit information?

**Tradeoff:** Completely blind (maximum information hiding) vs. boolean hint per tool (knows to expect throttling) vs. window hint without numbers (can pace itself).

**Decision:** Completely blind. No rate limit information in the manifest. "Agents see tools, not rules." Rate limits are rules. A boolean hint tells the agent "I should retry after delays." A window hint tells the agent "batch calls at the top of each hour." Both are information leaks enabling constraint optimization. Opaque denials are the design. The Instructional MCP (deferred) is where rate-awareness gets smarter.

### Q: Should the Registry MCP be a separate process or mounted in the API?

**Tradeoff:** Separate process with HTTP to API (clean, scalable) vs. separate process with shared DB (tight coupling, blast radius) vs. route in API process (no new service, mixes protocols).

**Decision:** Separate process, HTTP to API. The API is the single authority — sidecar calls API, dashboard calls API, MCP calls API. MCP calls `GET /api/agents/:did/envelope` once per agent connection (1-2ms on local Docker network). No DB access in MCP. Independently scalable. Service count goes to 6 as planned.

### Q: Who mints DPoP proofs — the agent or the sidecar?

**Tradeoff:** Agent creates DPoP directly (agent has private key — defeats defense-in-depth) vs. sidecar mints DPoP (private key stays in sidecar) vs. sidecar issues short-lived JWT for MCP (simpler but builds DPoP separately later).

**Decision:** Sidecar mints DPoP. New sidecar endpoint: `POST /create_dpop_proof`. Takes target URL, signs with Ed25519 private key, returns proof. Agent sends proof to MCP. Private key never leaves sidecar process. Same security model as `/sign_transaction`. Build DPoP once in Phase 4, reuse in Phase 5.

### Q: What MCP transport should the Registry MCP use?

**Tradeoff:** SSE (persistent connections, standard remote transport) vs. Streamable HTTP (request/response, no persistent connections) vs. both (doubles implementation).

**Decision:** Streamable HTTP. The Registry MCP is stateless — agent requests manifest, server returns it, connection closes. No streaming, no subscriptions, no server-initiated pushes. SSE wastes sockets holding idle connections for a service that returns a JSON manifest. Streamable HTTP is the MCP transport designed for request/response patterns.

### Q: How should the DPoP library handle time for testing?

**Tradeoff:** Injectable clock function (abstract) vs. Vitest fake timers (fragile global state) vs. explicit issuedAt parameter (precise, no magic).

**Decision:** Explicit `issuedAt` parameter. `createDPoP(key, url, { issuedAt?, nonce? })` and `verifyDPoP(proof, url, { maxAge?, now? })`. Tests pass fixed values. No global state manipulation. Time dependency visible in the type signature. Boring and correct — impossible to leak across test boundaries.

---

## Phase 5: API Proxy as Sidecar Extension

### Q: What encryption scheme for platform credentials?

**Tradeoff:** Shared AES-256-GCM key (single point of compromise) vs. separate key from seed encryption (two keys) vs. per-org keys via HKDF (isolation by derivation) vs. Postgres pgcrypto (key in DB config).

**Decision:** Per-org encryption keys via HKDF. One master key env var (`CREDENTIAL_ENCRYPTION_KEY`). Derive per-org keys: `hkdf(sha256, masterKey, orgId, "warranted-credentials-v1", 32)`. One compromised org's data doesn't expose other orgs. Application-level encryption — a `pg_dump` gets ciphertext, not plaintext. Separate from `AGENT_SEED_ENCRYPTION_KEY` (different threat models, different blast radii).

### Q: How should rate counter Redis writes handle the lineage array?

**Tradeoff:** Redis pipeline (fast, partial failure possible) vs. Lua script (atomic, all-or-nothing) vs. fire-and-forget (fastest, may undercount).

**Decision:** Lua script. 5-line script increments all ancestor counters atomically in one Redis round-trip. Rate counters are enforcement inputs, not analytics — partial failure means agents exceed limits, which is the thing the product prevents. Called with: `EVALSHA <hash> N rate:hourly:agent rate:hourly:om rate:hourly:org TTL`.

### Q: How should the hash-chained audit log handle concurrent writes from the same org?

**Tradeoff:** Postgres SERIALIZABLE (bottleneck on hot path) vs. Redis sequence counter (lockless but adds dependency) vs. periodic batch chaining (zero contention) vs. per-agent chains (fragments audit trail).

**Decision:** Periodic batch chaining. Entries are written unchained (no `prev_hash`, no `entry_hash` at INSERT time). A background job runs every 5-10 seconds per org: reads unchained entries ordered by `created_at`, computes hash chain sequentially, writes hashes back. Zero contention on the authorization hot path. Chain is eventually consistent (5-10s lag) — fine for audit, which is verified after the fact, not in real time.

### Q: How does the sidecar authenticate to the credentials API?

**Tradeoff:** INTERNAL_API_SECRET shared secret (any sidecar can request any org's credentials) vs. per-sidecar DPoP proof (cryptographic agent identity, per-agent credential scoping) vs. both.

**Decision:** Per-sidecar DPoP proof. Sidecar uses its private key to create a DPoP proof for the credentials API endpoint. API verifies against the agent's public key in `agent_identities`, confirms agent belongs to the org that owns the credential. A misconfigured sidecar gets 403 — its DID doesn't exist in the target org. `INTERNAL_API_SECRET` retained only for the `/check` endpoint (legacy JWT flow).

### Q: How should the execution check be structured — sidecar orchestration or API-side?

**Tradeoff:** Three sequential gates in sidecar (Redis rate, Postgres spend, Cedar eval — 3 round-trips) vs. extended /check with runtime context in Cedar vs. new /execute-check endpoint (API orchestrates internally).

**Decision:** New `POST /api/policies/execute-check` endpoint. The API server does everything internally: (1) Redis agent status check, (2) Redis rate counter check, (3) Postgres spend-to-date check, (4) envelope resolution + Cedar evaluation, (5) if allow: Lua script rate counter increment + spend balance update. One HTTP call from sidecar. Response includes `{ allowed, toolBackendUrl, credentials, auditRef }`. The sidecar handles credential injection and forwarding only.

### Q: How does the sidecar get the tool backend URL?

**Tradeoff:** In /execute-check response (one round-trip) vs. separate tool catalog lookup (extra HTTP call) vs. from MCP manifest (security violation — internal URLs exposed to agents).

**Decision:** In the `/execute-check` response. The API already queries `actionTypes` during evaluation — adding `tool_backend_url` is one more column. Response: `{ allowed: true, toolBackendUrl: "http://weather-backend:3002/...", credentials: {...}, auditRef: "dec_..." }`. Internal URLs never exposed via MCP manifest (option 3 would let a compromised agent redirect the sidecar with injected credentials to an attacker endpoint).

### Q: How should credential rotation work?

**Tradeoff:** Immediate replacement (in-flight failures) vs. grace period overlap (old + new for N hours) vs. always fetch latest (no caching).

**Decision:** Always fetch latest. The sidecar already calls `/execute-check` per execution, and that response includes the current credential. No caching to invalidate, no rotation ceremony. Admin updates credential in dashboard, next request gets the new one. AES-256-GCM decryption per request is microseconds — noise compared to Postgres + Redis + Cedar in the same request.

### Q: Who verifies the hash chain, and when?

**Tradeoff:** Dashboard page only (manual) vs. background job + alert (automated) vs. all three (dashboard + background + API endpoint).

**Decision:** All three. Core function: `verifyChain(db, orgId)`. Background job verifies hourly — catches tampering within an hour, not at next quarterly audit. Dashboard page (`/audit/chain`) — auditor clicks "Verify Integrity," sees green/red. API endpoint (`GET /api/audit/verify-chain`) — enterprise SIEM tools (Splunk, Datadog) poll daily. Three triggers, one function, three audiences.

### Q: What's the Redis key namespace design?

**Tradeoff:** Org-prefixed keys (operational benefits for monitoring and cleanup) vs. flat keys (simpler, agent IDs are globally unique) vs. hash-per-agent (breaks Lua script).

**Decision:** Org-prefixed keys with window TTLs. Rate counters: `{org_id}:rate:hourly:{entity_id}` TTL 3600, `{org_id}:rate:daily:{entity_id}` TTL 86400. Agent status: `{org_id}:status:{agent_id}` TTL none (explicit delete). Sessions: `{org_id}:session:{session_id}` TTL from expiry. Org prefix enables per-org operations (`SCAN {org_id}:*` for cleanup/monitoring).

### Q: What's the spend tracking schema?

**Tradeoff:** Running balance only (fast, no audit trail) vs. spend event log + SUM (accurate, slow at scale) vs. running balance + event log (fast reads + audit) vs. reuse decision_log.

**Decision:** Running balance + event log. `agent_spend_balances` table for fast reads during `/execute-check` (one indexed lookup per check). `spend_events` table for audit trail (itemized record of every spend). Both written in one Postgres transaction. Nightly reconciliation job recomputes balances from event log as safety net. Balance is the cache, event log is the source of truth.

### Q: How should the background chaining job be hosted?

**Tradeoff:** In-process setInterval (races with replicas) vs. separate worker process (7th service) vs. in-process + Postgres advisory lock (scales to multiple replicas, no new service).

**Decision:** In-process + Postgres advisory lock. `setInterval` in the API server. Each iteration acquires `pg_try_advisory_lock(hashtext('chain:' || org_id))` per org. Multiple replicas naturally distribute work — one chains each org. No separate worker process at current scale. Extract to `apps/api/src/worker.ts` when workload justifies it.

### Q: How are legacy sidecars (pre-Phase 4) handled?

**Tradeoff:** Degraded path (no credential injection, no rate tracking) vs. required upgrade at Phase 5 vs. transparent proxy upgrade.

**Decision:** Required upgrade at Phase 5. Phase 5 deployment requires all sidecars to support DPoP. Migration guide provided. Legacy sidecars continue working through Phase 4 (using `/check` with shared secret) but must upgrade for `/execute` functionality. No degraded path — feature parity or not available.

---

## References

- [Platform Extension Specification](./platform-extension-SPEC.md) — updated spec incorporating all decisions
- [Platform Extension Plan](./platform-extension-PLAN.md) — implementation plan referencing these decisions
- [Rules Engine Decisions](./rules-engine-PLAN.md) — format reference
- [Enterprise Packaging Decisions](./enterprise-packaging-DECISIONS.md) — format reference
