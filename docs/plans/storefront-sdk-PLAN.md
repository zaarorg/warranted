# Storefront SDK — Implementation Plan

## Overview

Build `@warranted/storefront-sdk`, a TypeScript SDK that enables any vendor to accept governed agent transactions by mounting a set of HTTP endpoints. The SDK handles identity verification (10-step middleware), authorization enforcement, session management, and receipt generation — the vendor only implements fulfillment. Built on the Web Standard Request/Response API for portability, with the existing Python governance sidecar serving as the registry and identity source.

## Design Decisions

### Q: How should the SDK handle registry lookups since packages/registry/ doesn't exist?
**Tradeoff:** Stub registry (fast, isolated) vs. sidecar-as-registry (realistic, integration-ready) vs. build registry first (correct, heavy).
**Decision:** Use the sidecar as the registry. The sidecar's `/check_identity` endpoint already returns DID, public key, trust score, lifecycle state, and spending limits. The SDK's `RegistryClient` interface will call the sidecar. When packages/registry/ is built later, swap the implementation.

### Q: The sidecar generates a new Ed25519 keypair on every restart, making DIDs ephemeral. How to stabilize?
**Tradeoff:** File persistence (simple, stateful) vs. seed env var (deterministic, stateless) vs. accept ephemeral (punt).
**Decision:** Derive keys from an `ED25519_SEED` environment variable. Same seed = same keypair = same DID across restarts. No file I/O. Sidecar remains stateless.

### Q: Should the SDK be Hono-specific or framework-agnostic?
**Tradeoff:** Hono-only (simple, matches our stack) vs. Web Standard Request/Response (portable, slightly more work).
**Decision:** Build on Web Standard Request/Response API. Works natively with Bun, Deno, Cloudflare Workers, and Hono. Provide a thin Hono adapter (`warranted.routes()` returns a Hono app that delegates to the core handlers). Core logic never imports Hono.

### Q: Where should transaction session state live?
**Tradeoff:** In-memory Map (simple, ephemeral) vs. SQLite (persistent, heavier) vs. Postgres (shared, heavy SDK dependency).
**Decision:** In-memory `Map<string, TransactionSession>` with a `SessionStore` interface. Sessions are lost on restart — acceptable for demo. The interface allows swapping in a persistent store later without changing SDK internals.

### Q: Who issues the JWTs that agents present to the storefront?
**Tradeoff:** Sidecar-only (single source) vs. TypeScript-only (test convenience) vs. both.
**Decision:** Both. Add `/issue_token` to the sidecar for integration demos (signs a JWT with the Ed25519 key using the seed). TypeScript `jose`-based helpers generate tokens in unit tests using the same key material. The seed env var ensures both produce verifiable tokens.

### Q: Which of the 10 verification steps to implement for demo?
**Tradeoff:** Minimal (JWT + signature) vs. full chain (all 10 steps with sidecar as registry).
**Decision:** All 10 steps, with the sidecar as registry. Steps 4/6/7 (registry lookup, lifecycle check, trust score) call the sidecar's `/check_identity`. Full verification chain is the demo's value proposition — cutting steps would undermine it.

### Q: How should settlement work without a ledger?
**Tradeoff:** SDK generates receipt locally (realistic structure, no payment) vs. stub (placeholder) vs. build ledger (heavy).
**Decision:** SDK generates the receipt structure locally. Contains all fields from the spec (buyer, vendor, items, compliance snapshot, timestamps, signatures). The sidecar signs the receipt via `/sign_transaction`. No real payment processing — the receipt proves the transaction was governed, not that money moved.

### Q: Should we build real webhook delivery?
**Tradeoff:** In-process callbacks (simple) vs. HTTP webhooks with HMAC (realistic) vs. both.
**Decision:** In-process callbacks only. `warranted.onSettlement(handler)` registers a callback. When settlement completes, SDK calls the handler directly. No HTTP POST, no HMAC verification. Webhook infrastructure is post-demo.

### Q: What's the demo scenario?
**Decision:** OpenClaw agent buying from a storefront. Agent discovers storefront via `/.well-known/agent-storefront.json`, browses catalog, creates session, settles. Uses the sidecar for identity. Build a `scripts/demo-storefront.ts` as a reliable fallback (curl-equivalent in TypeScript), plus update the OpenClaw skill for the live demo.

### Q: Package structure?
**Decision:** Bun workspace member. Top-level workspace config. `packages/storefront-sdk/` has its own `package.json` with name `@warranted/storefront-sdk`. Shared tsconfig.

### Q: Buyer-side story?
**Decision:** Demo script + OpenClaw skill. `scripts/demo-storefront.ts` simulates the full agent flow for testing. Update `skills/warranted-identity/SKILL.md` with storefront interaction commands for the live OpenClaw demo. No agent-sdk package yet.

### Q: Timeline?
**Decision:** Relaxed — quality over speed. Full demo scope from the spec. All error codes, full test coverage per testing.md, proper Zod validation, typed webhook callbacks. Build it like a real SDK.

---

## Phases

### Phase 1: Foundation — Package Setup + Sidecar Enhancements

**Goal:** Establish the SDK package structure and make the sidecar capable of acting as a registry and JWT issuer.

**Deliverables:**
- `packages/storefront-sdk/package.json` — package config with `@warranted/storefront-sdk` name
- `packages/storefront-sdk/tsconfig.json` — TypeScript config extending shared base
- `packages/storefront-sdk/src/index.ts` — barrel export
- `packages/storefront-sdk/src/types.ts` — all TypeScript interfaces from the spec (WarrantedSDKConfig, StorefrontManifest, CatalogItem, TransactionSession, TransactionReceipt, VerifiedAgentContext, ErrorResponse, etc.)
- `packages/storefront-sdk/src/errors.ts` — typed error classes for all error codes in the spec
- Top-level `package.json` update with Bun workspace config
- `vitest.config.ts` update to include the new package
- `sidecar/server.py` update: deterministic key derivation from `ED25519_SEED` env var
- `sidecar/server.py` update: new `POST /issue_token` endpoint that creates a signed JWT (EdDSA) with agent claims (DID, spending limit, categories, approved vendors, authority chain, expiration)

**Dependencies:** None (first phase).

**Tests:**
- `packages/storefront-sdk/__tests__/types.test.ts` — Zod schema validation for all config and response types (round-trip parse, reject invalid shapes)
- `sidecar/tests/test_seed_identity.py` — verify deterministic key derivation: same seed → same DID, different seed → different DID
- `sidecar/tests/test_issue_token.py` — verify JWT issuance: valid JWT with correct claims, EdDSA signature verifiable with public key, token expiration respected

**Demo checkpoint:** `bun run test` passes. Sidecar starts with `ED25519_SEED=test-seed-123` and returns a stable DID. `POST /issue_token` returns a JWT that decodes to the expected claims.

---

### Phase 2: Manifest + Catalog — Discovery Endpoints

**Goal:** Agents can discover a storefront and browse its catalog. The "shop window" is open.

**Deliverables:**
- `packages/storefront-sdk/src/manifest.ts` — generates `StorefrontManifest` from SDK config, serves at `/.well-known/agent-storefront.json`
- `packages/storefront-sdk/src/catalog.ts` — serves static catalog from config, returns `CatalogResponse` with Zod-validated items
- `packages/storefront-sdk/src/handlers.ts` — Web Standard Request/Response handlers for manifest and catalog endpoints
- `packages/storefront-sdk/src/sdk.ts` — `WarrantedSDK` class: constructor takes config, `.fetch(request)` dispatches to handlers, `.routes()` returns a Hono app adapter
- `packages/storefront-sdk/src/hono-adapter.ts` — thin Hono adapter wrapping the core handlers

**Dependencies:** Phase 1 (types, package setup).

**Tests:**
- `packages/storefront-sdk/__tests__/manifest.test.ts` — manifest generation: all config fields mapped correctly, version is "1.0", required fields present, custom values reflected
- `packages/storefront-sdk/__tests__/catalog.test.ts` — catalog serving: returns all items, respects `available` flag, validates CatalogItem shape, handles empty catalog
- `packages/storefront-sdk/__tests__/sdk.test.ts` — SDK instantiation: valid config accepted, missing required fields rejected, `.fetch()` routes to correct handler, unknown paths return 404

**Demo checkpoint:** Start a Hono server mounting the SDK. `curl http://localhost:3000/.well-known/agent-storefront.json` returns a valid manifest. `curl http://localhost:3000/agent-checkout/catalog` returns the catalog (no auth required yet — middleware comes in Phase 3).

---

### Phase 3: Verification Middleware — The 10-Step Chain

**Goal:** Every request to `/agent-checkout/*` passes through the full verification chain. Unauthorized agents are rejected with specific error codes.

**Deliverables:**
- `packages/storefront-sdk/src/verify.ts` — core verification functions: `verifyIdentity()`, `verifySignature()`, `verifyAuthorization()`, `verifyTrustScore()`. Each returns a typed result or error.
- `packages/storefront-sdk/src/registry-client.ts` — `RegistryClient` interface + `SidecarRegistryClient` implementation that calls the sidecar's `/check_identity` endpoint
- `packages/storefront-sdk/src/middleware.ts` — verification middleware implementing all 10 steps. Extracts JWT, decodes claims, checks expiry, calls registry, verifies Ed25519 signature (using `jose`), checks lifecycle, trust score, spending limit, vendor approval, category. Attaches `VerifiedAgentContext` to request on success. Short-circuits with the correct error code on failure.
- `packages/storefront-sdk/src/jwt.ts` — JWT decode/verify utilities using `jose`. EdDSA verification against the agent's registered public key.
- Update `handlers.ts` — catalog endpoint now requires middleware verification. Manifest endpoint remains public.

**Dependencies:** Phase 2 (handlers, SDK class), Phase 1 (sidecar JWT issuance for test tokens).

**Tests:**
- `packages/storefront-sdk/__tests__/verify.test.ts` — individual verification functions:
  - Valid JWT → passes
  - Expired JWT → `TOKEN_EXPIRED`
  - Malformed JWT → `INVALID_TOKEN`
  - Missing Authorization header → `NO_TOKEN`
  - DID not in registry → `UNKNOWN_AGENT` (mock registry returns 404)
  - Invalid Ed25519 signature → `INVALID_SIGNATURE`
  - Inactive lifecycle state → `AGENT_INACTIVE`
  - Trust score below minimum → `TRUST_SCORE_LOW`
  - Amount exceeds spending limit → `OVER_LIMIT`
  - Vendor not approved → `VENDOR_NOT_APPROVED`
  - Category not permitted → `CATEGORY_DENIED`
- `packages/storefront-sdk/__tests__/middleware.test.ts` — full middleware chain:
  - All checks pass → request proceeds with `VerifiedAgentContext`
  - Each failure point short-circuits correctly
  - Error responses match the spec's `ErrorResponse` shape
- `packages/storefront-sdk/__tests__/registry-client.test.ts` — sidecar client:
  - Successful lookup returns agent identity
  - Sidecar unreachable → `REGISTRY_UNREACHABLE`

**Demo checkpoint:** Start the SDK + sidecar. Get a JWT from the sidecar's `/issue_token`. `curl` the catalog with the JWT in the Authorization header → 200 with catalog. Omit the JWT → 401 `NO_TOKEN`. Use an expired JWT → 401 `TOKEN_EXPIRED`. Use a JWT with insufficient spending limit → 403 `OVER_LIMIT`.

---

### Phase 4: Transaction Sessions — Create + Settle + Receipt

**Goal:** Agents can create a transaction session and settle it, producing a signed receipt. The full happy-path flow works end to end.

**Deliverables:**
- `packages/storefront-sdk/src/session.ts` — `SessionManager` class: creates sessions (generates `txn_` IDs), stores in `Map<string, TransactionSession>`, validates items against catalog, tracks status transitions, enforces TTL expiry
- `packages/storefront-sdk/src/receipt.ts` — `ReceiptGenerator`: builds `TransactionReceipt` from session data + compliance snapshot + sidecar signature. Receipt hash computed from all fields except signatures.
- `packages/storefront-sdk/src/webhook.ts` — in-process callback system: `onSettlement(handler)`, `onDispute(handler)`, `onRefund(handler)`. Calls handler after successful settlement.
- Update `handlers.ts` — add `POST /agent-checkout/session` (create), `POST /agent-checkout/session/:id/settle` (settle), `GET /agent-checkout/session/:id` (status)
- Update `sdk.ts` — wire up session and settlement handlers, callback registration

**Dependencies:** Phase 3 (verification middleware — sessions require verified agent context).

**Tests:**
- `packages/storefront-sdk/__tests__/session.test.ts`:
  - Create session with valid items → 201 with session ID, status `identity_verified`
  - Create session with invalid SKU → 422 `INVALID_ITEMS`
  - Create session with amount exceeding agent's limit → 403 `OVER_LIMIT`
  - Get session by ID → returns current state
  - Get nonexistent session → 404 `SESSION_NOT_FOUND`
  - Session TTL expiry → 409 `SESSION_EXPIRED` on subsequent access
  - Session status transitions follow spec lifecycle
- `packages/storefront-sdk/__tests__/receipt.test.ts`:
  - Receipt contains all required fields from spec
  - Receipt hash is deterministic (same inputs → same hash)
  - Receipt is immutable (no update/delete operations on the receipt store)
  - Signatures field populated after signing
- `packages/storefront-sdk/__tests__/settlement.test.ts`:
  - Settle valid session → 200 with receipt
  - Settle expired session → 409 `SESSION_EXPIRED`
  - Settle already-settled session → 409 `SESSION_INVALID_STATE`
  - Settlement triggers onSettlement callback with correct event data
  - Settlement re-verifies agent identity (fresh check)
- `packages/storefront-sdk/__tests__/webhook.test.ts`:
  - onSettlement callback fires on settlement
  - Multiple callbacks can be registered
  - Callback receives correct SettlementEvent shape

**Demo checkpoint:** Full happy-path flow:
1. Get JWT from sidecar `/issue_token`
2. `GET /.well-known/agent-storefront.json` → manifest
3. `GET /agent-checkout/catalog` (with JWT) → catalog items
4. `POST /agent-checkout/session` (with JWT + items) → session created
5. `POST /agent-checkout/session/:id/settle` (with JWT) → receipt generated
6. Verify receipt contains agent DID, vendor ID, items, compliance snapshot, and Ed25519 signature

---

### Phase 5: Demo Integration — Script + OpenClaw Skill

**Goal:** The full flow is demoable both as a standalone script and as an OpenClaw agent interaction. Everything comes together.

**Deliverables:**
- `scripts/demo-storefront.ts` — standalone TypeScript demo script:
  1. Starts a Hono server with the SDK mounted
  2. Calls sidecar `/issue_token` to get an agent JWT
  3. Walks through the full flow: manifest discovery → catalog browse → session create → settle
  4. Prints each step's request/response with colored output
  5. Verifies the receipt signature
  6. Can run with `bun run scripts/demo-storefront.ts`
- `scripts/demo-vendor-server.ts` — a minimal vendor server using the SDK that stays running for OpenClaw interaction:
  1. Mounts SDK routes on Hono
  2. Registers `onSettlement` callback that logs fulfillment
  3. Serves on a configurable port
- Update `skills/warranted-identity/SKILL.md` — add storefront interaction commands:
  - `discover_storefront` — GET `/.well-known/agent-storefront.json`
  - `browse_catalog` — GET `/agent-checkout/catalog` with JWT
  - `create_session` — POST `/agent-checkout/session` with items
  - `settle_session` — POST `/agent-checkout/session/:id/settle`
- Update `sidecar/server.py` — ensure `/issue_token` response includes the JWT string that OpenClaw can pass directly as a Bearer token

**Dependencies:** Phase 4 (full SDK working), sidecar with `/issue_token`.

**Tests:**
- `scripts/demo-storefront.test.ts` — integration test that runs the demo script end-to-end and asserts:
  - All 5 steps complete without error
  - Receipt is generated and valid
  - No verification steps were skipped
- Manual test: run the vendor server, start OpenClaw, invoke the skill, observe the full flow

**Demo checkpoint:** Two demo paths:
1. **Standalone:** `bun run scripts/demo-storefront.ts` runs the full flow, prints a receipt
2. **OpenClaw:** Start vendor server + sidecar in Docker. OpenClaw agent uses the updated skill to discover and buy from the storefront. Receipt logged by vendor server.

---

## Open Questions

1. **Catalog auth:** The spec shows the catalog endpoint behind the verification middleware. Should the manifest endpoint also require auth, or stay public for discovery? (Current plan: manifest is public, catalog requires JWT.)
2. **Multi-item sessions:** The spec supports arrays of items. Should we enforce single-item-only for demo simplicity, or implement the full cart? (Current plan: full cart, but test with single items.)
3. **Session status `context_set`:** The spec has a "context_set" status between identity_verified and negotiation. For fixed-price transactions that skip negotiation, should we transition through it automatically or skip it? (Current plan: auto-transition for fixed-price.)
4. **Dynamic catalog:** The spec mentions `onCatalogRequest` for dynamic catalogs. This is listed as post-demo in the spec. Confirm we're skipping it.
5. **x402 headers:** The spec mentions returning `HTTP 402` with payment headers when no JWT is presented. Should this be in the demo, or is 401 sufficient? (Current plan: 401 only, x402 is post-demo.)
6. **Sidecar /issue_token claims:** What should the default token TTL be? The spec says 24h for agent tokens, 1h for session tokens. Using 24h for the demo token.

## References

- [Storefront SDK Specification](./storefront-sdk-SPEC.md) — full spec with all interfaces and flows
- [CLAUDE.md](../../CLAUDE.md) — project overview, stack, conventions, rules
- [AGT Reference](../agent-governance-toolkit/README.md) — Agent Governance Toolkit documentation
- [Spending Policy](../../sidecar/policies/spending-policy.yaml) — current policy rules
- [Sidecar Server](../../sidecar/server.py) — current governance sidecar implementation
- [OpenClaw Skill](../../skills/warranted-identity/SKILL.md) — current skill definition
- [Code Style Rules](../../.claude/rules/code-style.md) — TypeScript and Python conventions
- [Testing Rules](../../.claude/rules/testing.md) — test philosophy and required test cases
- [Security Rules](../../.claude/rules/security.md) — secrets, crypto, input validation
- [API Contracts](../../.claude/rules/prompts.md) — endpoint schemas and response shapes
