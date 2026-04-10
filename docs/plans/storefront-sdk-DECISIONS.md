# Storefront SDK — Design Decisions

Captured during the planning interview on 2026-04-09. Each decision includes the question asked, the options considered, and the rationale for the choice made.

---

## 1. Registry Strategy

**Q:** The spec's verification flow (steps 4-5) requires a registry service that the SDK calls to look up agent DIDs and public keys. Since `packages/registry/` doesn't exist yet, how should the SDK handle registry lookups in Phase 1?

**Options considered:**
- **Stub registry in the SDK** — In-memory mock registry inside the test harness. SDK calls a `RegistryClient` interface with a `StubRegistryClient` for now.
- **Use the sidecar as the registry** — The sidecar's `/check_identity` already returns DID, public key, trust score. Treat it as the registry.
- **Build a minimal registry first** — Stand up `packages/registry/` with an in-memory agent store before touching the SDK.

**Decision:** Use the sidecar as the registry. The sidecar already exposes the data the SDK needs. The SDK defines a `RegistryClient` interface so the implementation is swappable when `packages/registry/` is built later.

**Rationale:** Avoids blocking SDK work on building a separate service. The sidecar is already running and tested. The interface boundary keeps things clean for future migration.

---

## 2. Key Stability

**Q:** The sidecar currently generates a new Ed25519 keypair on every restart, which means the agent's DID changes each time. For the SDK's signature verification to work, it needs a stable DID/key pair. Should we fix this now or work around it?

**Options considered:**
- **Persist keys to file** — Save keypair to `sidecar/identity.json` on first boot, reload on subsequent boots.
- **Derive from a seed env var** — Add `ED25519_SEED` environment variable. Deterministic derivation: same seed = same keypair = same DID.
- **Accept ephemeral keys for now** — Don't fix it. SDK tests create their own keypairs inline.

**Decision:** Derive from a seed env var (`ED25519_SEED`). The sidecar deterministically derives the keypair from this seed. No file I/O, sidecar remains stateless.

**Rationale:** Stateless is better for Docker deployments. Environment-based config aligns with the existing pattern (DATABASE_URL, JWT_SECRET, etc.). Deterministic derivation makes testing predictable.

---

## 3. Framework Coupling

**Q:** The spec says the SDK mounts routes via `warranted.routes()` on Hono. But the SDK is supposed to be an npm package vendors install. Should the SDK be Hono-specific, or framework-agnostic with a Hono adapter?

**Options considered:**
- **Hono-only for demo** — Build directly on Hono. Simple, matches our stack.
- **Framework-agnostic with adapters** — Core SDK is pure functions. Provide thin Hono/Express adapters.
- **Standard Request/Response (Web API)** — Build on the Web Standard Request/Response API that Hono uses under the hood.

**Decision:** Standard Request/Response (Web API). Core SDK logic uses `Request` and `Response` from the Web API standard. A thin Hono adapter (`hono-adapter.ts`) wraps the core handlers for `warranted.routes()`.

**Rationale:** Web Standard API works natively with Bun, Deno, Cloudflare Workers, and Hono without any framework dependency in the core. The Hono adapter is trivial (~20 lines). This makes the SDK genuinely portable without adding complexity.

---

## 4. Session Storage

**Q:** Transaction sessions need to be stored somewhere. The spec shows sessions with IDs, status, expiry, etc. For the demo, where should session state live?

**Options considered:**
- **In-memory Map** — Simple `Map<string, TransactionSession>`. Sessions lost on restart. Fast, no deps.
- **SQLite via Drizzle** — Persistent sessions, queryable. Adds a real dependency.
- **PostgreSQL via Drizzle** — Shared state visible to the dashboard. Heavy ask for an SDK dependency.

**Decision:** In-memory `Map<string, TransactionSession>` behind a `SessionStore` interface. Sessions are ephemeral — acceptable for demo. The interface allows swapping in a persistent store later.

**Rationale:** An SDK should minimize dependencies on the vendor's infrastructure. Requiring a database just to accept agent transactions would hurt adoption. The interface boundary keeps the door open for persistence without mandating it.

---

## 5. JWT Issuance

**Q:** The spec's verification middleware verifies JWTs signed with Ed25519 (EdDSA). Who issues these JWTs? The sidecar currently doesn't issue JWTs — it generates raw Ed25519 signatures. We need a JWT issuer for agents.

**Options considered:**
- **Add JWT issuance to the sidecar** — New `/issue_token` endpoint using PyJWT or python-jose, signed with the sidecar's Ed25519 key.
- **Build JWT issuance in TypeScript** — Utility using `jose` for test fixtures. Platform registry would issue them in production.
- **Both** — Sidecar for integration demos, TypeScript for unit tests. Both use the same key material via the seed env var.

**Decision:** Both. The sidecar gets `/issue_token` for integration demos. TypeScript `jose`-based helpers generate tokens in unit tests. The `ED25519_SEED` env var ensures both produce tokens verifiable against the same public key.

**Rationale:** Unit tests need fast, in-process token generation (no sidecar dependency). Integration demos need realistic tokens from the governance layer. The seed env var is the bridge — same key material in both environments.

---

## 6. Verification Scope

**Q:** The spec lists 10 verification steps in order. For the demo, which should be fully implemented vs. stubbed?

**Options considered:**
- **6 of 10 steps** — JWT decode/expiry/signature + spending limit/vendor/category. Skip registry lookup, lifecycle, and trust score (hardcode "pass").
- **All 10 steps, sidecar as registry** — Full chain. Steps 4/6/7 call the sidecar's `/check_identity`.
- **JWT decode + signature only** — Minimal. All authorization checks delegated to sidecar's `/check_authorization`.

**Decision:** All 10 steps, with the sidecar as registry. The SDK implements the complete verification chain. Registry lookup, lifecycle check, and trust score validation all call the sidecar.

**Rationale:** The full verification chain is the SDK's value proposition. Cutting steps would undermine the demo — the whole point is showing that every agent request passes through rigorous, multi-step governance checks. The sidecar already returns all the data needed.

---

## 7. Settlement Strategy

**Q:** Settlement in the spec calls the platform to process payment and generate a receipt. Since there's no ledger or platform payment service yet, how should settlement work in the demo?

**Options considered:**
- **SDK generates receipt locally** — Creates the full receipt structure (buyer, vendor, items, compliance snapshot, timestamps). Sidecar signs it. No real payment.
- **Stub settlement** — Returns a mock receipt with hardcoded data. Focus on verification flow.
- **Build minimal ledger + settlement** — Stand up `packages/ledger/` with in-memory balances for real debit/credit.

**Decision:** SDK generates receipt locally. Contains all fields from the spec. The sidecar signs the receipt via `/sign_transaction`. The receipt proves the transaction was governed, not that money moved.

**Rationale:** The receipt structure is the audit trail — it's core to the compliance story. Building the full structure now means the ledger integration later is just adding the payment step, not restructuring the receipt. Stubbing would leave too much unproven.

---

## 8. Webhook Delivery

**Q:** The spec mentions webhook delivery for settlement events. For the demo, should we build real webhook delivery (HTTP POST with HMAC signing), or just emit events in-process?

**Options considered:**
- **In-process callbacks only** — `warranted.onSettlement(handler)` registers a callback. Direct invocation, no HTTP.
- **Real HTTP webhooks with HMAC** — POST to configured URL with HMAC-SHA256 signature. Full webhook story.
- **Both** — Build HMAC infrastructure but default to callbacks. Fire HTTP webhook if `webhookUrl` is configured.

**Decision:** In-process callbacks only. `warranted.onSettlement(handler)` calls the handler directly when settlement completes. No HTTP POST, no HMAC verification.

**Rationale:** Webhooks add complexity (retry logic, delivery guarantees, HMAC verification) without advancing the core demo story. The callback API is the same shape as the webhook handler — upgrading to HTTP delivery later doesn't change the vendor's code.

---

## 9. Demo Scenario

**Q:** What's the primary demo scenario for the SDK?

**Options considered:**
- **Curl-driven walkthrough** — Terminal commands hitting SDK endpoints. Good for technical audiences.
- **OpenClaw agent buying from a storefront** — Full agent-to-vendor flow using the sidecar for identity.
- **Side-by-side: unprotected vs protected** — Before/after contrast showing the platform's value.

**Decision:** OpenClaw agent buying from a storefront. Agent discovers the storefront via `/.well-known/agent-storefront.json`, browses catalog, creates session, and settles.

**Rationale:** This is the most realistic demo — an actual AI agent transacting with governance in place. It proves the whole stack works together, not just the SDK in isolation.

---

## 10. Package Structure

**Q:** Should the SDK be set up as part of a Bun workspace monorepo, or as a standalone package?

**Options considered:**
- **Bun workspace member** — Top-level workspace config. SDK has its own `package.json` as `@warranted/storefront-sdk`. Shared tsconfig.
- **Standalone package** — Fully self-contained with its own tsconfig, dependencies, and build step. No workspace config.

**Decision:** Bun workspace member. Other packages (registry, engine, ledger when built) will also be workspace members.

**Rationale:** Workspace setup enables cross-package imports without npm link, shared dev dependencies, and consistent tooling. The monorepo is the long-term structure anyway — start it now.

---

## 11. Buyer-Side Story

**Q:** The OpenClaw demo requires the agent to interact with the storefront. What's the plan for the buyer side?

**Options considered:**
- **Demo script only** — `scripts/demo-storefront.ts` simulates an agent via HTTP calls. No agent-sdk package.
- **Minimal agent-sdk package** — `packages/agent-sdk/` with `AgentTransactionClient`. Demo script uses this client.
- **OpenClaw skill integration** — Update the skill definition with storefront interaction commands.

**Decision:** Both demo script AND OpenClaw skill. `scripts/demo-storefront.ts` is the reliable fallback that always works (no OpenClaw dependency). The updated skill in `SKILL.md` is for the live demo.

**Rationale:** OpenClaw can be flaky. The demo script guarantees a working demo regardless. The skill integration proves the real-world use case. Having both means we're covered either way.

---

## 12. Timeline & Quality Bar

**Q:** What's the timeline pressure?

**Options considered:**
- **Tight (2-3 sessions)** — Happy path only, skip edge cases and error handling.
- **Moderate (4-5 sessions)** — Full verification flow with tests, skip negotiated transactions and disputes.
- **Relaxed — quality over speed** — Full demo scope, all error codes, full test coverage, proper Zod validation.

**Decision:** Relaxed — quality over speed. Build it like a real SDK.

**Rationale:** The SDK is the "Stripe side" of the platform — it needs to feel production-grade even in demo. Cutting corners on error handling or validation would undermine the compliance narrative. Every error code in the spec gets implemented and tested.
