# Warranted Project — Complete Conversation Handoff

## Project Overview

**Warranted** is "Ramp + Stripe for Agents" — compliance-first AI agent commerce infrastructure.

- **GitHub:** https://github.com/zaarorg/warranted
- **Branch:** `feat/integrated-rules-engine`
- **Team:** 5-person AI engineering team, pre-revenue, applying to YC
- **Stack:** TypeScript/Bun, Python/FastAPI, Cedar WASM, Postgres, Next.js
- **Machine:** Linux (Framework 13), Bun 1.3.10, Python 3.12.7, Docker Desktop

---

## Part 1: What Was Built — Rules Engine (6 Phases, Complete)

### Phase 1: Schema + Types + WASM Build (224 tests)
- Drizzle schema, Zod schemas, error codes, Cedar WASM wrapper
- Prompt: `/mnt/user-data/outputs/phase-1-prompt.md`

### Phase 2: Envelope Resolution + Cedar Generation (261 tests)
- `resolveEnvelope()`, `generateCedar()`, seed data (Acme Corp)
- Docker Compose with Postgres 16, unique test schemas per file
- Prompt: `/mnt/user-data/outputs/phase-2-prompt.md`

### Phase 3: Cedar Evaluation + Entity Store (281 tests)
- `CedarEvaluator`, `buildEntityStore()`
- Bug fixes: deny policy numeric inversion, temporal-only unconditional permits

### Phase 4: SDK + Sidecar Integration (314 tests)
- `NoOpEnvelopeCache`, two-phase authorization:
  - `localAuthorizationCheck()` — fast JWT claims check
  - `engineAuthorizationCheck()` — envelope resolution + dimension checking
  - `verifyAuthorization()` — async orchestrator (local → engine)
- Sidecar: `RULES_ENGINE_URL` proxy with fallback, `httpx` added
- `spending-policy.yaml` deleted (policies in Postgres only)

### Phase 5: Management API (370 tests)
- `apps/api/` — Hono server: policy CRUD, atomic version creation, group hierarchy (recursive CTE), assignments, envelope, Cedar check, decision log, action types, petition stubs (501)
- `POST /api/policies/check` — sidecar proxy target

### Phase 6: Dashboard (370 root + 16 dashboard tests)
- `apps/dashboard/` — Next.js 16 + shadcn/ui
- Pages: Policies (Constraints/Cedar/History tabs), Agents (envelope + REPL), Groups (tree), Petitions (Coming Soon)
- Components: EnvelopeView, DimensionDisplay, InheritanceChain, DenyBanner, CedarSourceViewer, PolicyREPL, DimensionInputField

---

## Part 2: What Was Built — Enterprise Packaging (5 Phases, Complete)

### Phase 0: Deployment Readiness
- Dashboard: relative URLs, Next.js rewrites, `output: "standalone"`
- Sidecar: `__init__.py`, pinned deps, `requirements-lock.txt`
- Seed idempotency: `.onConflictDoNothing()` on all inserts
- `.gitignore` fix: `!apps/dashboard/src/lib/` exception

### Phase 1: Build Infrastructure
- **3 Dockerfiles:** sidecar (python:3.12-slim, non-root, package structure preserved), API (oven/bun:1.3, full workspace install, start.sh with SKIP_MIGRATE/SKIP_SEED), dashboard (multi-stage bun builder + node:20-alpine runner, runtime URL injection via entrypoint.sh sed)
- Startup scripts: `start.sh`, `migrate.ts`, `seed-db.ts`
- Drizzle migrations: `drizzle.config.ts`, generated SQL
- npm build: `tsconfig.build.json`, `publishConfig`, `npm pack --dry-run` verified
- Apache 2.0 LICENSE

**Bugs fixed:** Cedar-gen test assertions (conjunctive semantics), all 4 workspace package.jsons needed for lockfile, dashboard standalone paths (apps/dashboard/server.js not server.js), seed must run from packages/rules-engine/

### Phase 2: Component READMEs
- 5 READMEs (storefront-sdk, rules-engine, sidecar, api, dashboard)
- v0.1 API stability banner, self-contained, no OpenClaw references

### Phase 3: Integration Guides
- `docs/guides/agent-platform-integration.md`, `vendor-integration.md`, `policy-admin.md`
- `docs/proxy/Caddyfile` + `nginx.conf`
- `packages/storefront-sdk/scripts/test-storefront.ts`

### Phase 4: Reorganize + Production Compose
- OpenClaw moved to `examples/openclaw/`
- `docker-compose.production.yml` — network-segmented (backend + frontend), Caddy via `--profile proxy`
- `docker-compose.demo.yml` — builds from source
- `.env.example`, root `README.md`, `scripts/verify-packaging.sh`

---

## Part 3: Enterprise Packaging Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| API Dockerfile | Full workspace install | Cedar WASM compatibility |
| Schema management | Generated SQL migrations (drizzle-kit generate) | Production-standard, reviewable |
| Dashboard URLs | Relative default + runtime injection escape hatch | Works behind proxy, configurable |
| Network security | Separate Docker networks (backend + frontend) | Sidecar never public |
| Python deps | Pinned + lockfile (pip-compile) | Reproducible builds |
| License | Apache 2.0 | Patent grant, enterprise-preferred |
| Reverse proxy | Caddy optional via Compose profile | BYOP flexibility |
| Image tags | Pinned to minor + quarterly review | Security/stability balance |
| One sidecar per agent | Security design choice | Cryptographic isolation (Envoy pattern) |
| Compose files | All at repo root | Discoverability |
| npm build | Build + dry-run verification | Prove publishability |
| Cedar WASM | Normal npm dependency | Standard module resolution |
| Seed idempotency | `.onConflictDoNothing()` | Safe repeated startup |
| Dashboard builder | oven/bun:1.3 (not node) | Matches project's package manager |
| Sidecar Dockerfile | Preserve package structure, repo root context | `uvicorn sidecar.server:app` resolves |

---

## Part 4: Current Repo Structure

```
warranted/
├── packages/
│   ├── storefront-sdk/       — npm package, vendor SDK (191 tests)
│   └── rules-engine/         — npm package, Cedar evaluation (123 tests)
├── apps/
│   ├── api/                  — Hono API server (port 3000, 56 tests)
│   └── dashboard/            — Next.js admin dashboard (port 3001, 16 tests)
├── sidecar/                  — Python FastAPI sidecar (port 8100)
├── drizzle/                  — SQL migrations
├── docs/
│   ├── plans/                — specs, plans, decisions
│   ├── guides/               — 3 integration guides
│   └── proxy/                — Caddyfile, nginx.conf
├── examples/
│   └── openclaw/             — OpenClaw demo
├── scripts/
│   └── verify-packaging.sh
├── docker-compose.yml        — dev (Postgres only)
├── docker-compose.production.yml
├── docker-compose.demo.yml
├── .env.example
├── LICENSE                   — Apache 2.0
└── README.md
```

---

## Part 5: How to Run

```bash
# Tests
DOCKER_HOST=unix:///var/run/docker.sock docker compose up -d postgres
bun run test                              # 370 tests
cd apps/dashboard && npx vitest run       # 16 dashboard tests

# Docker builds
docker build -f sidecar/Dockerfile -t warranted/governance-sidecar .
docker build -f apps/api/Dockerfile -t warranted/rules-engine-api .
docker build -f apps/dashboard/Dockerfile -t warranted/dashboard .

# Seed DB
cd packages/rules-engine
bun -e "import postgres from 'postgres'; import { drizzle } from 'drizzle-orm/postgres-js'; import { seed } from './src/seed'; const c = postgres('postgresql://postgres:postgres@localhost:5432/warranted_test'); const db = drizzle(c); await seed(db); await c.end(); console.log('Seeded.');"

# Verify chain
curl http://localhost:8100/check_identity
curl http://localhost:3000/health
curl http://localhost:3000/api/policies/rules
curl http://localhost:3000/api/policies/agents/did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6/envelope
curl -X POST "http://localhost:8100/check_authorization?vendor=aws&amount=500&category=compute"
curl -sL http://localhost:3001
```

---

## Part 6: Platform Extension Spec (Created)

A comprehensive spec was created at `/mnt/user-data/outputs/platform-extension-SPEC.md` that extends the existing platform with 5 phases. This was the result of evaluating a new ground-up build plan (`JS_build_plan.md`) that proposed 13 services and Rust rewrites, and instead creating an incremental plan that builds on the existing 370-test codebase.

### The Incremental Plan (5 Phases)

**Phase 1: WorkOS Integration (2 weeks)** — Real enterprise identity. AuthKit dashboard login, SCIM directory sync, webhook handler.

**Phase 2: Agent Identity Service + The Seam (2 weeks)** — Formalized agent creation. `packages/identity/` library, `POST /api/agents/create` endpoint, lineage arrays, sponsor envelope snapshot.

**Phase 3: Multi-Tenancy + Org Isolation (2 weeks)** — Org-scoped queries on all tables, per-org data isolation, org isolation test suite.

**Phase 4: Tool Catalog + Registry MCP (2 weeks)** — Extend `actionTypes` → tool catalog, Registry MCP server (Streamable HTTP transport), DPoP verification library, tool manifest projection.

**Phase 5: API Proxy as Sidecar Extension (2 weeks)** — `/execute` and `/execute-check` endpoints, platform credentials (per-org encrypted with HKDF derivation), Redis rate counters (Lua script), hash-chained audit log, weather tool backend.

**Dependency chain:** Phase 1 → 2 → 3 → 4 → 5 (linear, each prerequisite for next)

**Service count:** Current 4 → target 6 (+ Redis in Phase 2, + Registry MCP in Phase 4). Not 13.

### What's Preserved from the New Architecture
- Two-zone identity (WorkOS upper, Ed25519 lower) ✓
- The seam (human → agent binding with envelope snapshot) ✓
- Lineage arrays with cryptographic verification ✓
- Tool manifest projection (agents see tools, not rules) ✓
- Org-level multi-tenancy ✓
- DAG-aware rate/spend tracking ✓
- Hash-chained audit log ✓
- DPoP proof verification ✓

### What's Deferred
- Instructional MCP (LLM intent gate, RAG pipeline) — after customer demand
- Content-addressed immutable policies — current versioning works
- Rust rewrite — when traffic data proves need
- Capability tokens — need Instructional MCP first
- Agent-spawns-agent — lineage structurally supports it, build on demand

---

## Part 7: Platform Extension Design Decisions (From Interview)

### Auth & Identity

| Decision | Choice | Reason |
|---|---|---|
| Auth middleware pattern | Hono context middleware + route-level opt-out | `c.set('orgId')`, /check stays unauthenticated, selective `app.use()` |
| Internal API auth (/check) | Shared secret header (X-Internal-Token) | Defense-in-depth on top of network segmentation |
| Webhook mount path | `/api/webhooks/workos` | Under /api prefix for Caddy routing, not under /policies |
| IdP group → nodeType mapping | Manual mapping in dashboard | Admin assigns nodeType after SCIM sync, one-time setup |
| Org auto-creation | Use WorkOS org name + generated slug | Zero-friction, name already correct from customer's IdP |
| Sponsor envelope resolution | Synthetic agent_did for users (`om_*` as DID) | "Every entity is a node" — users look like agents in the policy model, resolveEnvelope works unchanged |
| Key recovery | Seed-based derivation, encrypted seed stored | Recoverable from dashboard, backward compatible with ED25519_SEED |
| Narrowing invariant | Constraint value comparison (not policy ID subset) | Dimension-by-dimension: numeric ≤, set ⊆, boolean same-or-more-restrictive |
| WorkOS session storage | Cookies (AuthKit handles it), no Redis needed | Redis added in Phase 2 for agent status cache, not Phase 1 |
| Dashboard login | WorkOS AuthKit hosted page with custom branding | Zero custom UI, handles SSO/MFA/IdP edge cases |

### Multi-Tenancy

| Decision | Choice | Reason |
|---|---|---|
| Agent suspension propagation | Redis status cache | Sub-ms reads, sub-second propagation, written by SCIM webhook |
| Test strategy for multi-tenancy | Seed org for existing tests + new org-isolation test suite | 370 tests unchanged, new targeted tests prove isolation |
| Decision log org_id | Add org_id column (denormalize) | Fast audit queries, partition-ready for future |
| nodeType CHECK constraint | Add 'unassigned' value | Explicit state, no NULL ambiguity, consistent query patterns |
| actionTypes org-scoping | Add org_id, template function for defaults | Each org owns its own tool catalog |
| actionTypes migration | No additional policy migration needed | Existing UUIDs unchanged, org_id backfilled on existing rows |

### Registry MCP & DPoP

| Decision | Choice | Reason |
|---|---|---|
| MCP data access | Separate process, HTTP to API (no DB access) | API is access control boundary, MCP has no blast radius |
| MCP org lookup | New DID-only endpoint on API, API derives org internally | Agent identity → org is derived, not self-asserted |
| Rate limit visibility in manifest | Completely blind | "Agents see tools, not rules" — rate limits are rules |
| MCP transport | Streamable HTTP | Stateless request/response, no persistent connections needed |
| DPoP minting | Sidecar mints DPoP proofs | Private key stays in sidecar, agent never has signing key |
| DPoP testing | Explicit `issuedAt`/`now` parameters | Deterministic without global state, visible in type signature |

### Execution Gateway (Phase 5)

| Decision | Choice | Reason |
|---|---|---|
| Execution check flow | New `/execute-check` endpoint (API orchestrates all checks) | One HTTP call from sidecar, API does Redis + Postgres + Cedar internally |
| Credential encryption | Per-org keys via HKDF from master key | Multi-tenant isolation, one env var, derived per-org |
| Rate counter Redis writes | Lua script (atomic) | All-or-nothing ancestor increment, compliance can't undercount |
| Hash chain race condition | Periodic batch chaining (background job every 5-10s) | Zero contention on hot path, eventual consistency fine for audit |
| Sidecar credential auth | Per-sidecar DPoP proof | Per-agent credential scoping, no shared secrets |
| Lineage depth limit | Hard limit of 5 levels | Covers all real hierarchies, enforced at creation time |
| Credential rotation | Always fetch latest (no caching) | Credentials in /execute-check response, rotation is just a DB update |
| Tool backend URL source | In /execute-check response | One round-trip, API is authority for URLs |
| Spend tracking | Running balance + event log | Balance for speed, events for audit, reconciliation job as safety net |
| Hash chain job hosting | In-process setInterval + Postgres advisory lock | No separate worker process, scales to multiple API replicas |
| Chain verification | Dashboard + background job + API endpoint | Auditors, automation, and SIEM tools all served |
| SCIM idempotency | Event ID dedup + natural idempotency (upserts) | Dedup for observability, upserts for correctness |

### Infrastructure

| Decision | Choice | Reason |
|---|---|---|
| Redis timing | Phase 2 (not Phase 1) | WorkOS AuthKit uses cookies, Redis not needed until agent status cache |
| Redis key namespace | Org-prefixed with window TTL | Per-org operations, monitoring, debugging |
| Migration strategy | One migration per phase | Matches deployment boundary, clear changelog |
| Schema changes | Phase 3 required before 4/5 | Phases 4/5 assume org-scoping exists |
| Seed display UX | Modal display + downloadable .env file | DevOps copies seed, team lead downloads .env |
| MCP deployment | Separate process, calls API over HTTP | Clean separation, scalable independently |

---

## Part 8: Known Issues

1. **Pre-existing typecheck errors** — storefront-sdk tests (catalog, demo-integration, settlement, types) and dashboard (JSX config, module resolution)
2. **Dashboard tests run separately** — root vitest matches `.test.ts`, dashboard tests are `.test.tsx`
3. **OpenClaw skill not auto-installed** — volume mount path needs updating after move to examples/
4. **`host.docker.internal`** — works on Docker Desktop, may need `--network host` on Linux
5. **Policy creation UI not built** — API endpoints exist, DimensionInputField reusable, discussed but not implemented

---

## Part 9: Pending Work

### Immediate (Platform Extension)
- [ ] Claude Code interview generated design decisions — write DECISIONS.md, PLAN.md, update SPEC.md
- [ ] Phase 1: WorkOS Integration
- [ ] Phase 2: Agent Identity Service + The Seam
- [ ] Phase 3: Multi-Tenancy + Org Isolation
- [ ] Phase 4: Tool Catalog + Registry MCP
- [ ] Phase 5: API Proxy as Sidecar Extension

### Supporting
- [ ] Policy creation UI in dashboard (Create Policy modal + Create Version form)
- [ ] CI/CD pipelines (GitHub Actions)
- [ ] npm org setup (@warranted scope)
- [ ] Docker Hub org setup (warranted/ namespace)
- [ ] Load testing

### Post-Customer
- [ ] Instructional MCP (LLM intent gate)
- [ ] Content-addressed immutable policies
- [ ] Agent-spawns-agent
- [ ] Rust hot-path rewrite (if traffic justifies)
- [ ] Human-in-the-loop approval workflow

---

## Part 10: Claude Code Prompts Created

All prompts saved to `/mnt/user-data/outputs/`:

**Rules Engine:**
- `phase-1-prompt.md` through `phase-6-prompt.md` — all 6 phases
- `seed-and-verify-prompt.md` — DB seeding + full chain verification

**Enterprise Packaging:**
- `phase-0-1-prompt.md` — deployment readiness + build infrastructure (combined)
- `ep-phase-2-prompt.md` — component READMEs
- `ep-phase-3-prompt.md` — integration guides + proxy configs + test script
- `ep-phase-4-prompt.md` — reorganize + production compose + verification

**Specs:**
- `enterprise-packaging-SPEC.md` — original spec
- `enterprise-packaging-updated-SPEC.md` — spec with 10 engineering fixes applied
- `enterprise-packaging-PLAN.md` — implementation plan with 14 fixes applied
- `platform-extension-SPEC.md` — 5-phase incremental extension spec

**Interview Prompt (for platform extension):**
- Updated prompt ready for Claude Code to interview about the platform extension spec, then produce DECISIONS.md, PLAN.md, and updated SPEC.md
