# Session Log: Storefront SDK Phase 1 — Foundation, Package Setup, and Sidecar Enhancements

**Date:** 2026-04-09 ~20:10–20:35 UTC
**Duration:** ~25 minutes
**Focus:** Implement Phase 1 of the Storefront SDK plan — package scaffolding, types/schemas, error classes, SDK skeleton, sidecar deterministic keys, and JWT issuance.

## What Got Done

- Created top-level `package.json` with Bun workspace config (`packages/*`)
- Created top-level `tsconfig.json` with strict mode, ES2022 target, bundler module resolution
- Created `vitest.config.ts` for test runner (includes `packages/*/__tests__/**/*.test.ts`)
- Created `packages/storefront-sdk/package.json` (`@warranted/storefront-sdk`, deps: jose, zod)
- Created `packages/storefront-sdk/tsconfig.json` extending shared base
- Ran `bun install` — resolved 112 packages successfully
- Created `packages/storefront-sdk/src/types.ts` — 20+ interfaces with matching Zod schemas: WarrantedSDKConfig, StorefrontManifest, CatalogItem, CatalogResponse, TransactionSession, SessionStatus, CartItem, VerifiedAgentContext, TransactionReceipt, ErrorResponse, ErrorCode, SettlementEvent, DisputeEvent, RefundEvent, WebhookPayload, NegotiationMessage (discriminated union), CreateSessionRequest, SettleSessionRequest
- Created `packages/storefront-sdk/src/errors.ts` — WarrantedError base class + 16 typed error subclasses (NoTokenError, InvalidTokenError, TokenExpiredError, UnknownAgentError, InvalidSignatureError, AgentInactiveError, TrustScoreLowError, OverLimitError, VendorNotApprovedError, CategoryDeniedError, SessionNotFoundError, SessionExpiredError, SessionInvalidStateError, InvalidItemsError, RegistryUnreachableError, SettlementFailedError). Each has `toResponse()` and `toHTTPResponse()`.
- Created `packages/storefront-sdk/src/sdk.ts` — WarrantedSDK class with Zod config validation in constructor, `.fetch()` stub (returns 404), `.routes()` stub, `.onSettlement()/.onDispute()/.onRefund()` callback registration
- Created `packages/storefront-sdk/src/index.ts` — barrel export of all types, schemas, errors, and SDK class
- Created `packages/storefront-sdk/__tests__/types.test.ts` — 41 tests covering all Zod schemas
- Created `packages/storefront-sdk/__tests__/sdk.test.ts` — 13 tests covering SDK construction, config validation, defaults, `.fetch()` 404, callback registration
- Updated `sidecar/server.py` — deterministic Ed25519 key derivation from `ED25519_SEED` env var using `hashlib.sha256(seed).digest()` as 32-byte private key seed; falls back to random with warning
- Added `POST /issue_token` endpoint to sidecar — creates EdDSA-signed JWT via PyJWT with claims: sub (DID), iss, iat, exp (24h), agentId, spendingLimit, dailySpendLimit, categories, approvedVendors, authorityChain
- Added `PyJWT[crypto]` to `requirements.txt`
- Created `sidecar/tests/__init__.py`, `conftest.py`, `test_seed_identity.py` (5 tests), `test_issue_token.py` (5 tests)
- All tests passing: 54 TypeScript (vitest), 10 Python (pytest)
- 7 conventional commits on `feat/agent-governance-sidecar` branch

## Issues & Troubleshooting

- **Problem:** `python -m pytest` reported "No module named pytest" even after `pip install pytest`.
- **Cause:** The `.venv` was created by conda/mamba, not standard `python -m venv`. The `pip` on `$PATH` (from `source .venv/bin/activate`) was actually the conda base `pip`, which installed packages to `miniforge3/lib/python3.12/site-packages/` — outside the venv's `sys.path`. The venv had no `pip` binary of its own.
- **Fix:** Ran `.venv/bin/python -c "import ensurepip; ensurepip.bootstrap()"` to install pip directly into the venv, then `.venv/bin/python -m pip install pytest pytest-asyncio httpx` to install into the correct site-packages.

- **Problem:** pytest-asyncio tests for `/issue_token` all errored with `PytestRemovedIn9Warning` about async fixtures not being handled.
- **Cause:** The project inherits `asyncio_mode = strict` from a parent `pyproject.toml` (in the gauntlet-curriculum monorepo). In strict mode with pytest-asyncio 1.3.0, async fixtures must use the `@pytest_asyncio.fixture` decorator instead of plain `@pytest.fixture`.
- **Fix:** Changed `conftest.py` to import `pytest_asyncio` and decorate the async `client` fixture with `@pytest_asyncio.fixture` instead of `@pytest.fixture`.

## Decisions Made

- **Zod schemas alongside interfaces, not separate:** Each TypeScript interface has a co-located Zod schema (e.g., `CatalogItemSchema` next to `CatalogItem`). Types are inferred from schemas via `z.infer<>` — single source of truth.
- **StorefrontManifest uses snake_case keys:** The spec's JSON manifest uses `warranted_registry`, `min_trust_score`, etc. (snake_case), so the Zod schema matches the wire format rather than converting to camelCase.
- **WarrantedSDK constructor accepts `unknown`:** Config is validated with `safeParse` at runtime — no trust of input shape. Throws descriptive error listing all validation issues.
- **Deterministic key derivation via SHA-256 of seed string:** `hashlib.sha256(ED25519_SEED.encode()).digest()` produces the 32-byte seed for `Ed25519PrivateKey.from_private_bytes()`. Simple, stateless, reproducible.
- **PyJWT for sidecar JWT issuance:** PyJWT with `[crypto]` extra supports EdDSA natively via the `cryptography` library (already a dependency). No need for `python-jose`.
- **Used `ensurepip` to fix venv:** Rather than recreating the venv or switching to a different Python environment, bootstrapped pip directly into the existing conda-created venv.

## Current State

- **Working:** SDK package initializes, all types/schemas validate, error classes serialize to spec format, sidecar produces stable DIDs from seed, `/issue_token` returns valid EdDSA JWTs, all 64 tests pass (54 TS + 10 Python).
- **Branch:** `feat/agent-governance-sidecar` — 7 new commits on top of prior work.
- **Not yet built:** Manifest/catalog endpoints (Phase 2), verification middleware (Phase 3), session management (Phase 4), demo integration (Phase 5). The SDK `.fetch()` returns 404 for all paths — routing comes in Phase 2.

## Next Steps

1. **Phase 2: Manifest + Catalog** — Implement `manifest.ts` (serves `/.well-known/agent-storefront.json`), `catalog.ts` (serves static catalog), `handlers.ts` (Web Standard Request/Response routing), and `hono-adapter.ts`. Add tests for manifest generation, catalog serving, and `.fetch()` routing.
2. **Phase 3: Verification Middleware** — The 10-step verification chain: JWT extraction, decode, expiry, registry lookup (via sidecar), Ed25519 signature verification (using `jose`), lifecycle check, trust score, spending limit, vendor approval, category check. This is the core value of the SDK.
3. **Phase 4: Transaction Sessions** — Session creation, state machine (auto-transition through `context_set` for fixed-price), settlement, receipt generation with sidecar signing, in-process webhook callbacks.
4. **Phase 5: Demo Integration** — Vendor server script, demo client script, Docker Compose service, OpenClaw SKILL.md updates.
