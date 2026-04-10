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
**Decision:** Demo script + OpenClaw skill. `scripts/demo-storefront.ts` acts as a standalone client that calls a separately running vendor server for testing. Update `skills/warranted-identity/SKILL.md` with storefront interaction commands for the live OpenClaw demo. No agent-sdk package yet.

### Q: Timeline?
**Decision:** Relaxed — quality over speed. Full demo scope from the spec. All error codes, full test coverage per testing.md, proper Zod validation, typed webhook callbacks. Build it like a real SDK.

### Q: How does the `context_set` session status work for fixed-price transactions?
**Tradeoff:** Auto-transition silently vs. pause and require explicit advancement vs. skip entirely.
**Decision:** Fixed-price transactions auto-transition through `context_set` to `settling`. The status exists in the state machine but the SDK advances through it immediately for fixed-price flows. Negotiated transactions pause at `context_set` waiting for the first offer. This avoids dead states in the common case while preserving the full lifecycle for negotiated flows.

### Q: How does the OpenClaw agent make HTTP calls to the vendor server?
**Tradeoff:** `web_fetch` tool (blocked by SSRF policy on internal hostnames) vs. `exec curl` (requires gateway exec access) vs. new sidecar proxy endpoint.
**Decision:** The OpenClaw agent uses `exec curl` on the gateway container, the same approach that already works for calling the sidecar. The vendor server runs as a Docker Compose service on the same network, accessible by service name. The SKILL.md instructions tell the agent to use shell commands (`curl`) rather than `web_fetch`, since we've already proven this path works and avoids the SSRF hostname blocking issue.

---

## Phases

### Phase 1: Foundation — Package Setup + SDK Skeleton + Sidecar Enhancements

**Goal:** Establish the SDK package structure with a runnable `WarrantedSDK` class, and make the sidecar capable of acting as a registry and JWT issuer.

**Deliverables:**
- `packages/storefront-sdk/package.json` — package config with `@warranted/storefront-sdk` name, including `jose` and `zod` as dependencies
- `packages/storefront-sdk/tsconfig.json` — TypeScript config extending shared base
- `packages/storefront-sdk/src/index.ts` — barrel export
- `packages/storefront-sdk/src/types.ts` — all TypeScript interfaces from the spec (WarrantedSDKConfig, StorefrontManifest, CatalogItem, TransactionSession, TransactionReceipt, VerifiedAgentContext, ErrorResponse, etc.) with Zod schemas
- `packages/storefront-sdk/src/errors.ts` — typed error classes for all error codes in the spec
- `packages/storefront-sdk/src/sdk.ts` — `WarrantedSDK` class skeleton: constructor validates config with Zod, exposes `.fetch(request)` stub (returns 404 for now), and `.routes()` returning a Hono adapter stub
- Top-level `package.json` update with Bun workspace config
- `vitest.config.ts` update to include the new package
- `sidecar/server.py` update: deterministic key derivation from `ED25519_SEED` env var
- `sidecar/server.py` update: new `POST /issue_token` endpoint that creates a signed JWT (EdDSA) with agent claims (DID, spending limit, categories, approved vendors, authority chain, expiration)

**Dependencies:** None (first phase).

**Tests:**
- `packages/storefront-sdk/__tests__/types.test.ts` — Zod schema validation for all config and response types (round-trip parse, reject invalid shapes)
- `packages/storefront-sdk/__tests__/sdk.test.ts` — SDK instantiation: valid config accepted, missing required fields rejected (vendorId, registryUrl, webhookSecret), default values applied for optional fields
- `sidecar/tests/test_seed_identity.py` — verify deterministic key derivation: same seed → same DID, different seed → different DID
- `sidecar/tests/test_issue_token.py` — verify JWT issuance: valid JWT with correct claims, EdDSA signature verifiable with public key, token expiration respected

**Demo checkpoint:** `bun run test` passes. `new WarrantedSDK({ ... })` instantiates without error and validates config. Sidecar starts with `ED25519_SEED=test-seed-123` and returns a stable DID. `POST /issue_token` returns a JWT that decodes to the expected claims.

---

### Phase 2: Manifest + Catalog — Discovery Endpoints

**Goal:** Agents can discover a storefront and browse its catalog. The "shop window" is open.

**Deliverables:**
- `packages/storefront-sdk/src/manifest.ts` — generates `StorefrontManifest` from SDK config, serves at `/.well-known/agent-storefront.json`
- `packages/storefront-sdk/src/catalog.ts` — serves static catalog from config, returns `CatalogResponse` with Zod-validated items
- `packages/storefront-sdk/src/handlers.ts` — Web Standard Request/Response handlers for manifest and catalog endpoints
- Update `sdk.ts` — `.fetch(request)` dispatches to manifest and catalog handlers based on URL path
- `packages/storefront-sdk/src/hono-adapter.ts` — thin Hono adapter wrapping the core `.fetch()` handler

**Dependencies:** Phase 1 (types, package setup, SDK class).

**Tests:**
- `packages/storefront-sdk/__tests__/manifest.test.ts` — manifest generation: all config fields mapped correctly, version is "1.0", required fields present, custom values reflected
- `packages/storefront-sdk/__tests__/catalog.test.ts` — catalog serving: returns all items, respects `available` flag, validates CatalogItem shape, handles empty catalog
- `packages/storefront-sdk/__tests__/handlers.test.ts` — `.fetch()` routing: manifest path returns manifest, catalog path returns catalog, unknown paths return 404

**Demo checkpoint:** Start a Hono server mounting the SDK. `curl http://localhost:3000/.well-known/agent-storefront.json` returns a valid manifest. `curl http://localhost:3000/agent-checkout/catalog` returns the catalog (no auth required yet — middleware comes in Phase 3).

---

### Phase 3: Verification Middleware — The 10-Step Chain

**Goal:** Every request to `/agent-checkout/*` passes through the full verification chain. Unauthorized agents are rejected with specific error codes.

**Deliverables:**
- `packages/storefront-sdk/src/verify.ts` — core verification functions: `verifyIdentity()`, `verifySignature()`, `verifyAuthorization()`, `verifyTrustScore()`. Each returns a typed result or error.
- `packages/storefront-sdk/src/registry-client.ts` — `RegistryClient` interface + `SidecarRegistryClient` implementation that calls the sidecar's `/check_identity` endpoint
- `packages/storefront-sdk/src/middleware.ts` — verification middleware implementing all 10 steps. Extracts JWT, decodes claims, checks expiry, calls registry, verifies Ed25519 signature (using `jose`), checks lifecycle, trust score, spending limit, vendor approval, category. Attaches `VerifiedAgentContext` to request on success. Short-circuits with the correct error code on failure.
- `packages/storefront-sdk/src/jwt.ts` — JWT decode/verify utilities using `jose`. EdDSA verification against the agent's registered public key. Also exports `createTestToken()` helper for unit tests using the same key material from `ED25519_SEED`.
- Update `handlers.ts` — catalog endpoint now requires middleware verification. Manifest endpoint remains public.

**Dependencies:** Phase 2 (handlers, SDK class), Phase 1 (sidecar JWT issuance for test tokens, `jose` dependency).

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
- `packages/storefront-sdk/__tests__/jwt.test.ts` — `createTestToken()` helper:
  - Generates valid JWT with correct claims
  - Token verifiable with public key derived from same seed
  - Expired token helper for testing expiry checks

**Demo checkpoint:** Start the SDK + sidecar. Get a JWT from the sidecar's `/issue_token`. `curl` the catalog with the JWT in the Authorization header → 200 with catalog. Omit the JWT → 401 `NO_TOKEN`. Use an expired JWT → 401 `TOKEN_EXPIRED`. Use a JWT with insufficient spending limit → 403 `OVER_LIMIT`.

---

### Phase 4: Transaction Sessions — Create + Settle + Receipt

**Goal:** Agents can create a transaction session and settle it, producing a signed receipt. The full happy-path flow works end to end.

**Deliverables:**
- `packages/storefront-sdk/src/session.ts` — `SessionManager` class: creates sessions (generates `txn_` IDs), stores in `Map<string, TransactionSession>` via `SessionStore` interface, validates items against catalog, tracks status transitions (auto-transitions through `context_set` for fixed-price), enforces TTL expiry
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
  - Fixed-price sessions auto-transition through `context_set`
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

### Phase 5: Demo Integration — Scripts + OpenClaw Skill + Docker

**Goal:** The full flow is demoable both as a standalone script and as an OpenClaw agent interaction. Includes both happy-path and failure scenarios. Everything comes together.

**Deliverables:**
- `scripts/demo-vendor-server.ts` — a minimal vendor server using the SDK that stays running:
  1. Mounts SDK routes on Hono
  2. Registers `onSettlement` callback that logs fulfillment
  3. Serves on a configurable port (default 3001)
  4. Can run with `bun run scripts/demo-vendor-server.ts`
- `scripts/demo-storefront.ts` — standalone TypeScript demo client (calls the separately running vendor server):
  1. Expects the vendor server to be running at a configurable URL
  2. Calls sidecar `/issue_token` to get an agent JWT
  3. **Happy path:** manifest discovery → catalog browse → session create → settle → prints receipt
  4. **Failure path:** attempts purchase with over-limit amount → shows 403 `OVER_LIMIT`, attempts purchase from unapproved vendor → shows 403 `VENDOR_NOT_APPROVED`
  5. Prints each step's request/response with colored output
  6. Verifies the receipt signature on the happy-path transaction
  7. Can run with `bun run scripts/demo-storefront.ts`
- Update OpenClaw `docker-compose.yml` — add `demo-vendor` service:
  ```yaml
  demo-vendor:
    image: oven/bun:latest
    working_dir: /app
    volumes:
      - ../warranted:/app
    command: bun run scripts/demo-vendor-server.ts
    ports:
      - "3001:3001"
  ```
  The OpenClaw agent reaches the vendor at `http://demo-vendor:3001` on the Docker network.
- Update `skills/warranted-identity/SKILL.md` — add storefront interaction commands using `exec curl`:
  - `discover_storefront` — `curl http://demo-vendor:3001/.well-known/agent-storefront.json`
  - `get_token` — `curl -X POST http://warranted-sidecar:8100/issue_token`
  - `browse_catalog` — `curl -H "Authorization: Bearer <jwt>" http://demo-vendor:3001/agent-checkout/catalog`
  - `create_session` — `curl -X POST -H "Authorization: Bearer <jwt>" -d '{"items":[...]}' http://demo-vendor:3001/agent-checkout/session`
  - `settle_session` — `curl -X POST -H "Authorization: Bearer <jwt>" http://demo-vendor:3001/agent-checkout/session/:id/settle`
- Update `sidecar/server.py` — ensure `/issue_token` response includes the raw JWT string for easy copy-paste into curl commands

**Dependencies:** Phase 4 (full SDK working), sidecar with `/issue_token`, Docker network connectivity.

**Tests:**
- `scripts/demo-storefront.test.ts` — integration test that starts the vendor server, runs the demo client, and asserts:
  - Happy path: all 5 steps complete, receipt is generated and valid
  - Failure path: over-limit attempt returns 403 with correct error code
  - Failure path: unapproved vendor attempt returns 403 with correct error code
  - No verification steps were skipped in happy path
- Manual test: run the vendor server + sidecar in Docker Compose, start OpenClaw, invoke the skill commands, observe the full flow including failure scenarios

**Demo checkpoint:** Three demo paths:
1. **Standalone happy path:** `bun run scripts/demo-vendor-server.ts` in one terminal, `bun run scripts/demo-storefront.ts` in another → full flow, receipt printed
2. **Standalone failure path:** demo script shows an agent getting blocked for exceeding spending limit and for unapproved vendor — the "before vs after" contrast
3. **OpenClaw live:** Start vendor server + sidecar via Docker Compose. OpenClaw agent uses the updated skill to discover and buy from the storefront. Agent then attempts a policy violation and gets blocked. Receipt and denial both logged by vendor server.

---

## Open Questions

1. **Catalog auth:** The spec shows the catalog endpoint behind the verification middleware. Should the manifest endpoint also require auth, or stay public for discovery? (Current plan: manifest is public, catalog requires JWT.)
2. **Multi-item sessions:** The spec supports arrays of items. Should we enforce single-item-only for demo simplicity, or implement the full cart? (Current plan: full cart, but test with single items.)
3. **Dynamic catalog:** The spec mentions `onCatalogRequest` for dynamic catalogs. This is listed as post-demo in the spec. Confirmed: skipping for demo.
4. **x402 headers:** The spec mentions returning `HTTP 402` with payment headers when no JWT is presented. Should this be in the demo, or is 401 sufficient? (Current plan: 401 only, x402 is post-demo.)
5. **Sidecar /issue_token claims:** What should the default token TTL be? The spec says 24h for agent tokens, 1h for session tokens. Using 24h for the demo token.

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