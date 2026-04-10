# Warranted — Conversation Handoff Document

## What This Document Is

A complete summary of two extended conversations about the Warranted project. Use this to continue development with a new Claude instance without losing context.

---

## Project Identity

**Warranted** — compliance-first transaction infrastructure for enterprise AI agent commerce. "Ramp + Stripe for Agents."

- **GitHub:** https://github.com/zaarorg/warranted
- **Branch:** `feat/agent-governance-sidecar`
- **Organization:** zaarorg
- **Git remote:** `git@github.com:zaarorg/warranted.git`
- **Team members with write access:** jsquire4, ryoiwata, tomholz, sscotth
- **Team:** 5-person AI engineering team (Tom: Registry, Jacob: Transaction Engine, Ryo: SDK + Platform, Ray/Felipe: Demo, Gabriel: Testing)

---

## What's Been Built (All Working)

### Governance Sidecar (Python/FastAPI on port 8100)

A defense-in-depth identity and authorization service that runs as a separate process from the agent. The agent cannot tamper with it.

- **Ed25519 identity** derived deterministically from `ED25519_SEED` env var
- **DID format:** `did:mesh:<ed25519-pubkey-hash>` (e.g., `did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6` for seed `test-seed-123`)
- **Endpoints:** `/check_identity`, `/check_authorization`, `/sign_transaction`, `/verify_signature`, `/issue_token` (EdDSA JWT with 24h TTL)
- **Dependencies:** PyJWT[crypto], FastAPI, cryptography, httpx
- **Key file:** `sidecar/server.py`
- **Tests:** `sidecar/tests/test_seed_identity.py`, `sidecar/tests/test_issue_token.py` (10 Python tests passing)

### Storefront SDK (`@warranted/storefront-sdk`) — 174 Tests Passing

A TypeScript SDK that enables any vendor to accept governed agent transactions by mounting HTTP endpoints. Built in 5 phases.

**Package location:** `packages/storefront-sdk/`

**Phase 1 — Foundation:**
- Bun workspace, `types.ts` (20+ interfaces with Zod schemas), `errors.ts` (16 typed error classes), `sdk.ts` skeleton
- Sidecar deterministic keys + `/issue_token`
- 54 TS tests + 10 Python tests

**Phase 2 — Discovery:**
- `manifest.ts` (serves `/.well-known/agent-storefront.json`)
- `catalog.ts` (serves catalog from config)
- `handlers.ts` (Web Standard Request/Response routing)
- `hono-adapter.ts` (thin Hono wrapper)
- 78 total tests

**Phase 3 — Verification Middleware:**
- `jwt.ts` (Ed25519 via jose, key derivation matches sidecar exactly)
- `registry-client.ts` (`RegistryClient` interface + `SidecarRegistryClient` + `MockRegistryClient`)
- `verify.ts` (`verifyIdentity` 10-step chain, `verifyAuthorization`)
- `middleware.ts` (WeakMap for `VerifiedAgentContext`)
- 130 total tests

**Phase 4 — Sessions:**
- `session.ts` (`SessionStore` interface, `InMemorySessionStore`, `SessionManager`)
- `receipt.ts` (`ReceiptGenerator` with sidecar signing)
- `webhook.ts` (in-process callbacks)
- Fixed-price auto-transitions through `context_set`
- 170 total tests

**Phase 5 — Demo Integration:**
- `scripts/demo-vendor-server.ts` (3 catalog items, onSettlement logging)
- `scripts/demo-storefront.ts` (happy path + failure path with colored output)
- Updated SKILL.md for OpenClaw storefront purchasing
- Demo vendor Docker Compose service
- 174 total tests

**Key spec files:**
- `docs/plans/storefront-sdk-SPEC.md` — full specification
- `docs/plans/storefront-sdk-PLAN.md` — implementation plan with all design decisions

### OpenClaw Integration

- OpenClaw running in Docker (gateway on port 18789, v2026.3.29)
- Config: `gateway.controlUi.allowInsecureAuth: true`, `gateway.controlUi.dangerouslyDisableDeviceAuth: true`, `gateway.auth.mode: "token"`
- Agent uses `exec curl` for HTTP calls (avoids SSRF policy on internal hostnames)
- `pnpm` required for install (npm has 2026.4.x bug)
- Warranted-identity skill installed — agent successfully checks identity, gets authorization, and completes storefront purchases with human-in-the-loop approval for >$1,000

### Demo Results (Verified Working)

**Standalone demo (3 terminals):**
1. Sidecar: `ED25519_SEED=test-seed-123 uvicorn sidecar.server:app --port 8100`
2. Vendor: `bun run scripts/demo-vendor-server.ts`
3. Client: `bun run scripts/demo-storefront.ts`

**Happy path output:**
- Token → Manifest → Catalog (3 items) → Session (`txn_` ID) → Settle → Receipt (`rcpt_` ID)
- Receipt includes: Ed25519 platform signature, authority chain (CFO → VP Eng → Agent), 8 compliance rules passed, `internal-ledger` settlement method

**Failure path output:**
- OVER_LIMIT (403): $10,000 purchase against $5,000 limit
- NO_TOKEN (401): request without Authorization header
- INVALID_TOKEN (401): forged/garbage JWT

**OpenClaw live demo:**
- Agent discovers storefront, browses catalog, attempts $2,500 purchase
- Sidecar returns `requires_approval: true` (over $1,000 escalation threshold)
- Agent stops and asks human for approval — human-in-the-loop working
- After approval, settlement completes with signed receipt

**OpenClaw prompt that works:**
```
Use the warranted-identity skill to buy 100 GPU hours from the demo vendor storefront at http://demo-vendor:3001. Get a token from the sidecar, discover the storefront, browse the catalog, create a session for gpu-hours-100, and settle it. Use curl for all HTTP calls. Show me the receipt when done.
```

### Docker Compose Setup

Located at `~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/openclaw/docker-compose.yml`

Services:
- `openclaw-gateway` (port 18789)
- `warranted-sidecar` (port 8100, with `ED25519_SEED` env var)
- `demo-vendor` (port 3001, Bun image running demo-vendor-server.ts)

---

## Rules Engine Integration (In Progress)

### The Problem
The sidecar has hardcoded Python policy checks (spending limit, approved vendors, categories). These need to become formal Cedar authorization policies with hierarchical group policies.

### Teammate's Engine (Reference)
A teammate built a rules engine in Rust + Kotlin + Next.js:
- Rust Cedar evaluation service (axum, cedar-policy 4.9)
- Kotlin management API (Ktor, Exposed ORM, cedar-java)
- Next.js admin dashboard
- PostgreSQL with ltree for group hierarchy
- Fully functional as standalone Docker Compose stack
- Located at `packages/rules_engine/` in the repo
- Architecture documented at `docs/plans/rules-engine-ARCHITECTURE.md`

### Our Approach (TypeScript Cedar WASM)
Instead of adding Rust + Kotlin services, build a TypeScript-only package using `@cedar-policy/cedar-wasm`. Same Cedar policy model, one language, runs in-process.

**Spec created:** `docs/plans/rules-engine-SPEC.md` — comprehensive specification including:
- Cedar WASM evaluation (no Rust)
- Drizzle ORM (no Kotlin/Exposed/Flyway)
- Envelope model with intersection semantics
- Entity hierarchy loaded into Cedar (unlike teammate's `Entities::empty()`)
- 6 Cedar policies matching current sidecar config
- Seed data for Acme Corp with matching DIDs
- API endpoints (POST /check, GET /agents/:did/envelope, full CRUD)
- Sidecar integration (one Python function with fallback)
- Test strategy (6 test files)

**Next step:** Run the interview prompt to refine the spec, then build it phase by phase like the Storefront SDK.

**Interview prompt (ready to use):**
```
Read these files for full context before starting the interview:
- @docs/plans/rules-engine-SPEC.md
- @docs/plans/rules-engine-ARCHITECTURE.md
- @docs/plans/storefront-sdk-SPEC.md
- @docs/plans/storefront-sdk-PLAN.md
- @CLAUDE.md
- @packages/storefront-sdk/src/verify.ts
- @packages/storefront-sdk/src/middleware.ts
- @packages/storefront-sdk/src/registry-client.ts
- @sidecar/server.py
- @sidecar/policies/spending-policy.yaml

Then interview me in detail using the AskUserQuestionTool about literally anything: technical implementation, UI & UX, concerns, tradeoffs, etc. but make sure the questions are not obvious. Be very in-depth and continue interviewing me continually until it's complete, then write the spec to docs/plans/rules-engine-SPEC.md.
```

---

## Key Architecture Decisions Made

1. **USDC on Coinbase Base** for settlement (crypto invisible to users). GENIUS Act deadline July 2026.
2. **MCP servers** replacing traditional dashboards.
3. **Sidecar architecture** — governance runs as separate process, agent cannot tamper.
4. **Web Standard Request/Response API** for SDK portability (works with Bun, Deno, Cloudflare Workers, Hono).
5. **Cedar** for formal policy authorization (replacing hardcoded if/else).
6. **Agent OS (Microsoft AGT)** for Ed25519 identity, not custom crypto.
7. **Procurement use case** as strategic wedge, not real estate.
8. **In-memory session store** with `SessionStore` interface for swappability.
9. **Both sidecar + TypeScript** for JWT issuance (sidecar for integration, TS jose helpers for unit tests, same ED25519_SEED ensures compatible tokens).
10. **All 10 verification steps** implemented (not stubbed) — the full chain is the demo's value.
11. **Fixed-price auto-transitions** through `context_set` status.
12. **`exec curl`** for OpenClaw agent HTTP calls (avoids SSRF policy).
13. **Cedar WASM** instead of Rust service for rules engine (same stack, no language boundary).

---

## Files Created/Delivered

### Project Configuration
- `CLAUDE.md` — project instructions for Claude Code
- `.claude/rules/code-style.md` — TypeScript/Python/React code style
- `.claude/rules/testing.md` — testing strategy with required test cases
- `.claude/rules/security.md` — security rules
- `.claude/rules/prompts.md` — API contracts, schemas, endpoints

### Plans & Specs
- `docs/plans/storefront-sdk-SPEC.md` — Storefront SDK specification
- `docs/plans/storefront-sdk-PLAN.md` — implementation plan with all design decisions
- `docs/plans/rules-engine-ARCHITECTURE.md` — architecture map of teammate's engine
- `docs/plans/rules-engine-SPEC.md` — specification for TypeScript Cedar WASM engine

### Storefront SDK (packages/storefront-sdk/)
- `src/types.ts` — 20+ interfaces with Zod schemas (336 lines)
- `src/errors.ts` — 16 typed error classes (198 lines)
- `src/sdk.ts` — WarrantedSDK class
- `src/manifest.ts` — manifest generator
- `src/catalog.ts` — catalog response builder
- `src/handlers.ts` — Web Standard request handlers (371 lines)
- `src/hono-adapter.ts` — Hono adapter
- `src/jwt.ts` — JWT decode/verify with Ed25519 (168 lines)
- `src/registry-client.ts` — registry client interface + implementations
- `src/verify.ts` — 10-step identity verification + authorization (164 lines)
- `src/middleware.ts` — verification middleware with WeakMap context
- `src/session.ts` — session store + manager (231 lines)
- `src/receipt.ts` — receipt generator with sidecar signing (133 lines)
- `src/webhook.ts` — in-process callback system
- `src/index.ts` — barrel export (115 lines)
- 13 test files, 174 tests total

### Scripts
- `scripts/demo-vendor-server.ts` — vendor server using SDK (67 lines)
- `scripts/demo-storefront.ts` — demo client with happy + failure paths (200 lines)

### Sidecar
- `sidecar/server.py` — updated with deterministic keys + `/issue_token`
- `sidecar/policies/spending-policy.yaml` — spending policy (includes vendor-acme-001)
- `requirements.txt` — updated with PyJWT[crypto]
- `sidecar/tests/` — 10 Python tests

### Skills
- `skills/warranted-identity/SKILL.md` — OpenClaw skill with storefront purchasing commands

---

## Pending Action Items

### Immediate (Rules Engine)
- [ ] Run the interview prompt to refine rules-engine-SPEC.md
- [ ] Build rules engine package phase by phase
- [ ] Wire sidecar `/check_authorization` to rules engine `POST /check`
- [ ] Test full integration: OpenClaw → sidecar → rules engine → storefront

### Post-Demo
- [ ] Send outreach emails to Yuno and Peak6 contacts
- [ ] Record demo video of full agent purchasing flow
- [ ] Apply for YC with demo + open-source registry story
- [ ] Set up MCP servers for development (PostgreSQL, GitHub, Context7)
- [ ] Build Next.js dashboard (`apps/dashboard`)
- [ ] Real settlement (Stripe or USDC on Base)
- [ ] Multi-vendor discovery index
- [ ] Token hierarchy with cascade revocation
- [ ] Trust score that changes based on behavior

---

## Competitive Landscape (April 2026)

RSA 2026 shipped 5 agent identity frameworks but left 3 critical gaps: agent-to-agent delegation verification, self-modification risk, delegation path auditing.

Key competitors: Strata Maverics (OAuth-based), Microsoft Entra Agent ID (Azure-only, preview), Cisco Zero Trust (network-level), SailPoint (IGA/audit), Solo.io AgentGateway (RFC 8693).

IETF draft-klrc-aiagent-auth-00 (March 2026) is the emerging standard.

VentureBeat quote: "vendors verified who the agent was. None tracked what the agent did."

---

## How We Built Things (Pattern for Future Work)

Every feature followed this pattern:
1. **Spec** — write a detailed specification with all interfaces, flows, and types
2. **Interview** — Claude asks design questions, user picks from options or types custom answers
3. **Plan** — write implementation plan with phased delivery, each phase independently demoable
4. **Review** — evaluate the plan, list feedback to improve
5. **Build** — Claude Code prompt per phase, each with specific file deliverables, tests, and demo checkpoints
6. **Test** — `bun run test` for TypeScript, `python -m pytest` for Python, manual curl verification
7. **Push** — `git push origin feat/agent-governance-sidecar`

Claude Code prompts are detailed — they specify every file to read before coding, every file to create, every test case, every commit message, and a manual verification step at the end.

---

## Environment Notes

- **Machine:** Linux (Framework 13 laptop)
- **Python:** 3.12.7 in `.venv/` (conda-based, needed `ensurepip.bootstrap()` to install pip)
- **Bun:** 1.3.10
- **Node:** available but not primary
- **Docker:** Docker Desktop (sometimes not running — check before Docker commands)
- **OpenClaw:** v2026.3.29, gateway on port 18789
- **Sidecar port:** 8100 (check `lsof -i :8100` if address already in use)
- **Vendor server port:** 3001
- **pnpm** required for OpenClaw install (npm has 2026.4.x bug)
- **pytest-asyncio:** version 1.3.0 with strict mode from parent pyproject.toml — use `@pytest_asyncio.fixture` decorator for async fixtures