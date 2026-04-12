# Warranted Project — Conversation Handoff Document

## Project Overview

**Warranted** is "Ramp + Stripe for Agents" — compliance-first AI agent commerce infrastructure.

- **GitHub:** https://github.com/zaarorg/warranted
- **Branch:** `feat/integrated-rules-engine`
- **Team:** 5-person AI engineering team, pre-revenue, applying to YC
- **Stack:** TypeScript/Bun, Python/FastAPI, Cedar WASM, Postgres, Next.js
- **Machine:** Linux (Framework 13), Bun 1.3.10, Python 3.12.7, Docker Desktop

---

## What Was Built (Rules Engine — 6 Phases, All Complete)

### Phase 1: Schema + Types + WASM Build
- Drizzle schema (`schema.ts`), types/Zod schemas (`types.ts`), error codes (`errors.ts`), Cedar WASM wrapper (`cedar-wasm.ts`)
- 224 total tests

### Phase 2: Envelope Resolution + Cedar Generation
- `envelope.ts` (resolveEnvelope), `cedar-gen.ts` (generateCedar), `seed.ts` (Acme Corp demo data)
- Docker Compose with Postgres 16, unique test schemas per file
- 261 total tests

### Phase 3: Cedar Evaluation + Entity Store
- `evaluator.ts` (CedarEvaluator), `entity-store.ts` (buildEntityStore)
- Bug fixes: deny policy numeric inversion, temporal-only unconditional permits
- 281 total tests

### Phase 4: SDK + Sidecar Integration
- `cache.ts` (NoOpEnvelopeCache), two-phase authorization in `verify.ts`:
  - `localAuthorizationCheck()` — fast JWT claims check (Phase 1)
  - `engineAuthorizationCheck()` — envelope resolution + dimension checking (Phase 2)
  - `verifyAuthorization()` — async orchestrator (local → engine)
- `handlers.ts` updated to `await` async verifyAuthorization
- Sidecar `server.py` updated: `RULES_ENGINE_URL` proxy with fallback, `httpx` added
- `spending-policy.yaml` deleted (policies in Postgres only)
- 314 total tests (123 rules-engine + 191 storefront SDK)

### Phase 5: Management API
- `apps/api/` — Hono server with routes:
  - Policy CRUD + atomic version creation (constraints → Cedar gen → validate → store → activate → policyVersion bump)
  - Group hierarchy with recursive CTE ancestors/descendants
  - Policy assignments with CHECK constraint validation
  - Agent envelope resolution
  - `POST /api/policies/check` — Cedar evaluation (sidecar proxy target)
  - Decision log with filtering/pagination
  - Action types with dimensions
  - Petition stubs (501 with documented response shapes)
- `packages/rules-engine/src/petition.ts` — Zod schemas
- Root workspaces updated: `["packages/*", "apps/*"]`
- 370 total tests

### Phase 6: Dashboard
- `apps/dashboard/` — Next.js 16 + shadcn/ui
- Pages: Policies (list + detail with Constraints/Cedar/History tabs), Agents (envelope + REPL tester), Groups (tree + detail), Petitions (Coming Soon)
- Components: EnvelopeView, DimensionDisplay, InheritanceChain, DenyBanner, CedarSourceViewer, PolicyREPL, DimensionInputField
- 16 dashboard component tests (separate vitest config with jsdom + esbuild JSX)
- 370 root tests still passing

---

## What Was Built (Enterprise Packaging — 5 Phases, All Complete)

### Phase 0: Deployment Readiness
- Dashboard: relative URLs in `apiFetch`, Next.js rewrites for dev proxy, `output: "standalone"`
- Sidecar: `__init__.py`, pinned `requirements.txt`, `requirements-lock.txt` via pip-compile
- Seed idempotency: `.onConflictDoNothing()` on all insert calls
- Route verification: confirmed `/api/policies` mount and `/health` endpoint
- `.gitignore` fix: `!apps/dashboard/src/lib/` exception for Python `lib/` rule

### Phase 1: Build Infrastructure
- **3 Dockerfiles:**
  - `sidecar/Dockerfile` — python:3.12-slim, non-root user, package structure preserved (`sidecar/__init__.py`, `sidecar/server.py`), build context repo root
  - `apps/api/Dockerfile` — oven/bun:1.3, full workspace install (all 4 package.jsons copied for lockfile match), `start.sh` with `SKIP_MIGRATE`/`SKIP_SEED` flags
  - `apps/dashboard/Dockerfile` — multi-stage (oven/bun:1.3 builder + node:20-alpine runner), standalone output, runtime URL injection via `entrypoint.sh` placeholder sed
- **Startup scripts:** `apps/api/scripts/start.sh`, `apps/api/src/migrate.ts`, `apps/api/src/seed-db.ts`
- **Drizzle migrations:** `drizzle.config.ts`, `drizzle/migrations/` generated SQL
- **npm build pipeline:** `tsconfig.build.json` for both packages, `publishConfig`, `npm pack --dry-run` verified
- **Apache 2.0 LICENSE** at root and in both packages
- Placeholder READMEs for npm pack

**Bugs fixed during Phase 1:**
1. Cedar-gen tests: assertions updated for conjunctive semantics (permit + forbid-when-violated)
2. Both Dockerfiles: all 4 workspace `package.json` files must be COPYed for `bun install --frozen-lockfile`
3. Dashboard standalone paths: Next.js preserves monorepo structure (`apps/dashboard/server.js`, not `server.js`)
4. Seed idempotency: run from `packages/rules-engine/`, not root (postgres dep resolves there)

### Phase 2: Component READMEs
- 5 READMEs written (storefront-sdk, rules-engine, sidecar, api, dashboard)
- Each self-contained with v0.1 API stability banner
- Storefront SDK: mock + production quick starts
- Sidecar: one-per-agent design rationale
- Dashboard: reverse proxy requirement + Caddyfile snippet

### Phase 3: Integration Guides
- `docs/guides/agent-platform-integration.md` — sidecar API walkthrough, Python/TS/curl examples
- `docs/guides/vendor-integration.md` — SDK setup, session lifecycle, mock vs production
- `docs/guides/policy-admin.md` — tiered (Dashboard → API → Cedar), REPL testing, audit
- `docs/proxy/Caddyfile` + `docs/proxy/nginx.conf` — proxy configs with `/health` rule
- `packages/storefront-sdk/scripts/test-storefront.ts` — CLI vendor test tool

### Phase 4: Reorganize + Production Compose
- Moved OpenClaw material to `examples/openclaw/` (skills, demo scripts)
- `docker-compose.production.yml` — network-segmented (backend: postgres+api+sidecar, frontend: api+dashboard+caddy), Caddy optional via `--profile proxy`
- `docker-compose.demo.yml` — builds from source, no pre-built images
- `.env.example` — required/optional env vars
- Root `README.md` — Why Warranted, architecture diagram, component table, guide links
- `scripts/verify-packaging.sh` — smoke test script

---

## Key Design Decisions (Enterprise Packaging)

| Decision | Choice | Reason |
|---|---|---|
| API Dockerfile strategy | Full workspace install | Cedar WASM compatibility |
| Schema management | Generated SQL migrations (drizzle-kit generate), committed | Production-standard, reviewable in PRs |
| Dashboard URLs | Relative by default + runtime injection escape hatch | Works behind proxy, configurable for cross-origin |
| Network security | Separate Docker networks (backend + frontend) | Sidecar never exposed to public internet |
| Python deps | Direct deps pinned + lockfile (pip-compile) | Reproducible builds for compliance product |
| License | Apache 2.0 | Patent grant, enterprise-preferred |
| Reverse proxy | Caddy optional via Compose profile | Flexible — BYOP or use included Caddy |
| Image tags | Pinned to minor + quarterly review comment | Balance security patches vs stability |
| Seed idempotency | `.onConflictDoNothing()` | Safe for repeated startup |
| One sidecar per agent | Security design choice, not limitation | Cryptographic isolation (Envoy/Istio pattern) |
| OpenClaw material | Moved to `examples/openclaw/` | One integration example, not the core product |
| Compose files | All at repo root (dev, production, demo) | Discoverability |

---

## Current Repo Structure

```
warranted/
├── packages/
│   ├── storefront-sdk/       — npm package, vendor-side SDK
│   └── rules-engine/         — npm package, Cedar policy evaluation library
├── apps/
│   ├── api/                  — Hono API server (port 3000)
│   └── dashboard/            — Next.js admin dashboard (port 3001)
├── sidecar/                  — Python FastAPI governance sidecar (port 8100)
├── drizzle/                  — SQL migrations
├── docs/
│   ├── plans/                — specs, plans, decisions
│   ├── guides/               — 3 integration guides
│   └── proxy/                — Caddyfile, nginx.conf
├── examples/
│   └── openclaw/             — OpenClaw demo (skills, scripts)
├── scripts/
│   └── verify-packaging.sh   — smoke test
├── docker-compose.yml        — dev (Postgres only)
├── docker-compose.production.yml — reference production deployment
├── docker-compose.demo.yml   — OpenClaw demo (builds from source)
├── .env.example
├── LICENSE                   — Apache 2.0
└── README.md                 — enterprise-ready root README
```

---

## How to Run

### Tests
```bash
DOCKER_HOST=unix:///var/run/docker.sock docker compose up -d postgres
bun run test                    # 370 tests (rules-engine + storefront SDK + API)
cd apps/dashboard && npx vitest run   # 16 dashboard component tests
```

### Docker Services
```bash
# Build images
docker build -f sidecar/Dockerfile -t warranted/governance-sidecar .
docker build -f apps/api/Dockerfile -t warranted/rules-engine-api .
docker build -f apps/dashboard/Dockerfile -t warranted/dashboard .

# Run individually
docker run -e ED25519_SEED=test-seed-123 -p 8100:8100 warranted/governance-sidecar
docker run -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/warranted_test -p 3000:3000 warranted/rules-engine-api
docker run -p 3001:3001 warranted/dashboard

# Or use demo compose (builds from source)
docker compose -f docker-compose.demo.yml up -d
```

### Seed the DB
```bash
cd packages/rules-engine
bun -e "
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { seed } from './src/seed';
const client = postgres('postgresql://postgres:postgres@localhost:5432/warranted_test');
const db = drizzle(client);
await seed(db);
await client.end();
console.log('Seeded.');
"
```

### Verify Full Chain
```bash
curl http://localhost:8100/check_identity                    # sidecar → DID
curl http://localhost:3000/health                            # API → OK
curl http://localhost:3000/api/policies/rules                # API → 11 seeded policies
curl http://localhost:3000/api/policies/agents/did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6/envelope  # envelope
curl -X POST "http://localhost:8100/check_authorization?vendor=aws&amount=500&category=compute"  # authorized
curl -sL http://localhost:3001                               # dashboard HTML
```

---

## Known Issues

1. **Pre-existing typecheck errors** — `storefront-sdk/__tests__/` (catalog, demo-integration, settlement, types) and `apps/dashboard/` (JSX config, module resolution). Not from rules engine or packaging changes.
2. **Dashboard tests run separately** — root vitest config only matches `.test.ts`, dashboard tests are `.test.tsx` with their own vitest config.
3. **OpenClaw skill not auto-installed** — after moving to `examples/openclaw/`, the OpenClaw gateway needs its volume mount path updated: `../warranted/examples/openclaw/skills/warranted-identity:/skills/warranted-identity`
4. **`host.docker.internal`** — works on Docker Desktop (macOS/Windows), may need `--network host` on Linux.

---

## Lineage-Based Rule Inheritance Architecture (Future)

A future architecture doc was discussed that extends the current system with:
- **WorkOS integration** — upper zone identity (org/user/role) replacing hardcoded DIDs
- **Human-to-agent binding seam** — WorkOS `om_*` membership sponsors agent, recorded with envelope snapshot
- **Agent-spawns-agent** — unlimited depth sub-agents, same narrowing semantics
- **Lineage array** — `["org_01H...", "om_01H...", "agent_7Xk...", "agent_Qp4..."]` with cryptographic verification
- **Tool manifest projection** — agents see tools not rules, constraints enforced server-side
- **SCIM webhook revocation** — user deprovisioned → cascade suspend all agents

This is **compatible with the current system** — the rules engine, envelope resolver, Cedar evaluation, and sidecar are the foundation. WorkOS, lineage arrays, and tool manifest projection are additive.

---

## Pending / Not Yet Done

- [ ] **Policy creation UI** in dashboard (Create Policy modal + Create Version form) — discussed but not implemented. The API endpoints exist, the `DimensionInputField` component can be reused.
- [ ] **OpenClaw gateway integration** with moved skill path — volume mount needs updating
- [ ] **CI/CD pipelines** — GitHub Actions for Docker builds, npm publish (out of scope for packaging spec)
- [ ] **npm org setup** — `@warranted` scope on npmjs.com
- [ ] **Docker Hub org setup** — `warranted/` namespace
- [ ] **Load testing** — resource limits are documented minimums from development, not load-tested
- [ ] **API authentication** — all management API endpoints are internal-only (no auth middleware)
- [ ] **Lineage-based architecture** — WorkOS, agent-spawns-agent, tool manifest projection