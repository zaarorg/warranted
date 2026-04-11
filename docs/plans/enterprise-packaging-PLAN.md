# Enterprise Packaging — Implementation Plan

## Overview

Package the Warranted monorepo so each component (storefront SDK, rules engine, governance sidecar, API, dashboard) can be adopted independently by enterprises without cloning the repo. Deliverables: Dockerfiles for all services, npm build pipelines for both packages, README for each component, three integration guides for three personas (agent platform team, vendor, compliance admin), a production-grade Docker Compose reference deployment with network segmentation and optional reverse proxy, and reorganization of OpenClaw demo material into an examples directory.

This work introduces no new features. It makes existing features deployable, documentable, and adoptable.

## Design Decisions

All non-trivial design decisions are documented in [enterprise-packaging-DECISIONS.md](./enterprise-packaging-DECISIONS.md) with tradeoff analysis. Key decisions summarized here:

- **Docker build strategy:** Full workspace install for API (Cedar WASM compatibility). Explicit COPY for sidecar (3 files, self-documenting). Multi-stage build with standalone output for dashboard.
- **Schema management:** Generated SQL migrations via `drizzle-kit generate`, committed to repo, run at startup with `migrate()`. Not `drizzle-kit push` (dev tool).
- **Dashboard URLs:** Relative paths by default (requires reverse proxy), runtime `NEXT_PUBLIC_API_URL` injection as escape hatch for cross-origin deployments. Next.js rewrites for dev proxy.
- **Network security:** Separate Docker networks (`backend` + `frontend`). Sidecar never on frontend network. Caddy proxy optional via Compose profile.
- **npm publishing:** Full build pipeline with `tsconfig.build.json` + `npm pack --dry-run` verification. Cedar WASM as normal npm dependency. Apache 2.0 license.
- **Python deps:** Direct deps in `requirements.txt` (pinned), full tree in `requirements-lock.txt` (via pip-compile). Dockerfile installs from lockfile.
- **Documentation:** Quick start + deep dive pattern for guides. Both mock and real paths in SDK README. Tiered Cedar explanation (UI → API → Cedar) in policy guide. v0.1 API stability caveat on package READMEs.
- **Compose organization:** All compose files at repo root: `docker-compose.yml` (dev), `docker-compose.production.yml` (prod), `docker-compose.demo.yml` (OpenClaw demo).
- **Phase 0:** Deployment-readiness code changes (relative URLs, Next.js rewrites, standalone output, sidecar `__init__.py`, pinned deps) done before packaging phases.

---

## Phase 0: Deployment Readiness

**Goal:** Make minimal code changes required for packaging to succeed. No feature work — only deployment prerequisites.

**Deliverables:**
- `apps/dashboard/src/lib/api.ts` — change `apiFetch` base URL from `http://localhost:3000` to relative paths (`/api/policies/...`)
- `apps/dashboard/next.config.ts` — add `rewrites()` proxying `/api/:path*` to `http://localhost:3000/api/:path*` for dev; add `output: 'standalone'`
- `sidecar/__init__.py` — create empty file to make sidecar a proper Python package
- `sidecar/requirements.txt` — add all missing direct dependencies with version pins: `inter-agent-trust-protocol==0.5.0`, `agent-os-kernel==3.0.1`, `PyJWT==2.10.1`, `httpx==0.28.1`, plus pin existing deps: `fastapi==0.132.0`, `uvicorn==0.41.0`, `cryptography==46.0.7`
- `sidecar/requirements-lock.txt` — generated via `pip-compile requirements.txt`, full transitive dependency tree
- Verify route paths: confirm `apps/api/src/index.ts` mounts match `apps/dashboard/src/lib/api.ts` fetch paths

**Dependencies:** None (first phase).

**Demo checkpoint:** `bun run dev` in dashboard still works (proxied via rewrites). `bun run build` in dashboard produces `.next/standalone/` directory. Sidecar starts with `uvicorn sidecar.server:app`. `pip install -r sidecar/requirements-lock.txt` in a fresh venv succeeds.

---

## Phase 1: Build Infrastructure — Dockerfiles + npm Build Pipeline

**Goal:** Every component can be built into a deployable artifact. Docker images build and run. npm packages build and pack correctly.

**Deliverables:**

### Dockerfiles

- `sidecar/Dockerfile` — Python 3.12-slim base. Explicit COPY of `server.py`, `requirements-lock.txt`, `__init__.py`. Installs from lockfile. Env vars: `ED25519_SEED`, `RULES_ENGINE_URL`, `PORT`. Non-root user.
  ```
  # Base image pinned to minor. Review quarterly or on security advisory. Last reviewed: 2026-04.
  FROM python:3.12-slim
  ```

- `apps/api/Dockerfile` — `oven/bun:1.3` base. Full workspace install: copy root `package.json` + `bun.lock`, relevant package.jsons, `bun install --frozen-lockfile`, then copy source. Includes `start.sh`. Env vars: `DATABASE_URL`, `PORT`, `SKIP_MIGRATE`, `SKIP_SEED`.

- `apps/api/scripts/start.sh` — Startup script with skip flags:
  1. If `SKIP_MIGRATE` is not set: run `bun run apps/api/src/migrate.ts`
  2. If `SKIP_SEED` is not set: run `bun run apps/api/src/seed-db.ts`
  3. Start server: `bun run apps/api/src/index.ts`

- `apps/api/src/migrate.ts` — runs Drizzle `migrate()` with committed migration files

- `drizzle/migrations/` — SQL migration files generated by `drizzle-kit generate`, committed to repo

- `apps/dashboard/Dockerfile` — Multi-stage: `node:20-alpine` builder runs `npm ci && npm run build` with `NEXT_PUBLIC_API_URL=__NEXT_PUBLIC_API_URL_PLACEHOLDER__`. Runner copies standalone output. Entrypoint script does `sed` replacement of placeholder with runtime `NEXT_PUBLIC_API_URL` value (if set, otherwise leaves relative paths).

- `apps/dashboard/scripts/entrypoint.sh` — Runtime env injection:
  ```bash
  #!/bin/sh
  if [ -n "$NEXT_PUBLIC_API_URL" ]; then
    find /app/.next -name "*.js" -exec sed -i "s|__NEXT_PUBLIC_API_URL_PLACEHOLDER__|${NEXT_PUBLIC_API_URL}|g" {} +
  else
    find /app/.next -name "*.js" -exec sed -i "s|__NEXT_PUBLIC_API_URL_PLACEHOLDER__||g" {} +
  fi
  exec node server.js
  ```

### npm Build Pipeline

- `packages/storefront-sdk/tsconfig.build.json` — extends base tsconfig, enables declaration emit, outDir `dist/`, excludes tests
- `packages/rules-engine/tsconfig.build.json` — same pattern
- `packages/storefront-sdk/package.json` — add `publishConfig`, `main: "dist/index.js"`, `types: "dist/index.d.ts"`, `files: ["dist/", "README.md", "LICENSE"]`, `scripts.build: "tsc -p tsconfig.build.json"`, `scripts.prepublishOnly: "bun run build"`
- `packages/rules-engine/package.json` — same pattern
- `LICENSE` — Apache 2.0 license file at repo root and in each package

**Demo checkpoint:**
1. `docker build -f sidecar/Dockerfile -t warranted/governance-sidecar ./sidecar` succeeds
2. `docker build -f apps/api/Dockerfile -t warranted/rules-engine-api .` succeeds (context is repo root)
3. `docker build -f apps/dashboard/Dockerfile -t warranted/dashboard ./apps/dashboard` succeeds
4. Each image runs: `docker run -e ED25519_SEED=test warranted/governance-sidecar` starts and responds to `/check_identity`
5. `cd packages/storefront-sdk && bun run build && npm pack --dry-run` shows correct files (dist/index.js, dist/index.d.ts, README.md, LICENSE)
6. `cd packages/rules-engine && bun run build && npm pack --dry-run` shows correct files including that `@cedar-policy/cedar-wasm` is listed in dependencies

---

## Phase 2: Component READMEs

**Goal:** Each component has a self-contained README that lets someone use it without reading any other file in the repo.

**Deliverables:**

- `packages/storefront-sdk/README.md`
  - Target audience: vendors accepting governed agent transactions
  - v0.1 API stability banner
  - Two quick start paths: "Try it" (MockRegistryClient, 5 lines, no Docker) and "Production" (real sidecar)
  - Installation: `npm install @warranted/storefront-sdk`
  - SDK configuration reference (all WarrantedSDKConfig fields)
  - Verification flow diagram (10-step chain, text)
  - Key exports: `WarrantedSDK`, `createVerificationMiddleware`, `MockRegistryClient`
  - No mention of OpenClaw, Docker Compose, or demo setup

- `packages/rules-engine/README.md`
  - Target audience: developers embedding the rules engine
  - v0.1 API stability banner
  - Prerequisites: Postgres 16+, Cedar WASM (bundled as dependency)
  - Quick start: connect to Postgres, run migrations, seed, resolve envelope, evaluate
  - Key exports: `resolveEnvelope`, `CedarEvaluator`, `generateCedar`, `buildEntityStore`, schema tables
  - Envelope resolution explained (intersection semantics table)
  - Cedar policy format with correct `containsAny` syntax
  - No mention of the API server, dashboard, or sidecar

- `sidecar/README.md`
  - Target audience: platform teams deploying AI agents
  - Quick start: `docker run -e ED25519_SEED=my-seed warranted/governance-sidecar`
  - Configuration env var table (ED25519_SEED, RULES_ENGINE_URL, PORT)
  - API endpoints with request/response examples: `/check_identity`, `/check_authorization`, `/sign_transaction`, `/issue_token`, `/verify_signature`
  - Running without Docker (Python 3.12+, pip, uvicorn)
  - Resource minimum: 128MB RAM

- `apps/api/README.md`
  - Target audience: platform teams self-hosting the rules engine
  - Quick start: `docker run -e DATABASE_URL=... warranted/rules-engine-api`
  - Configuration env var table (DATABASE_URL, PORT, SKIP_MIGRATE, SKIP_SEED)
  - API endpoint summary with link to full spec
  - Deployment guidance (Railway, Fly, AWS ECS — needs Postgres + Docker image)
  - Backup one-liner: `docker compose exec postgres pg_dump -U warranted warranted > backup.sql`
  - Resource minimum: 512MB RAM (Cedar WASM evaluation)

- `apps/dashboard/README.md`
  - Target audience: compliance teams and developers
  - Quick start: deploy to Vercel with relative API URL, or Docker with reverse proxy
  - Reverse proxy requirement documented with example Caddyfile and nginx.conf snippet
  - `NEXT_PUBLIC_API_URL` escape hatch for cross-origin deployments
  - Self-hosting instructions (Docker standalone or behind proxy)

**Demo checkpoint:** A developer reading only one README can install/deploy that component. No broken links, no references to files that don't exist, no stale API examples. Each README's quick start works as documented.

---

## Phase 3: Integration Guides

**Goal:** Three guides for three personas. Each guide has a 5-command quick start at the top and deep-dive sections below.

**Deliverables:**

### `docs/guides/agent-platform-integration.md`

Audience: teams deploying AI agents on any platform.

1. **Quick start** — 5 commands: docker run sidecar → curl /check_identity → curl /issue_token → curl /check_authorization → curl /sign_transaction
2. **Sidecar deployment** — Docker run, env vars, health check
3. **Agent identity flow** — on startup, call `/check_identity`, store DID
4. **Get a JWT** — call `/issue_token`, use in Authorization header
5. **Authorization check** — call `/check_authorization` before any transaction
6. **Sign transactions** — call `/sign_transaction`, signed payload includes authority chain
7. **One sidecar per agent** — design choice for cryptographic isolation (not a limitation)
8. **Connect to rules engine (optional)** — set `RULES_ENGINE_URL` for policy-based authorization
9. **Examples** — Python agent, TypeScript agent, curl-based agent

### `docs/guides/vendor-integration.md`

Audience: vendors accepting governed agent purchases.

1. **Quick start** — 5 commands: npm install → create server → mount SDK → start → curl manifest
2. **Install and configure** — SDK config options, catalog setup
3. **Mount on your server** — Hono/Express/Fastify examples
4. **Verification flow** — what the SDK checks (10 steps), error codes
5. **Session lifecycle** — create → settle → receipt
6. **Settlement webhook** — `onSettlement` callback
7. **Testing** — curl commands for protocol learning, `test-storefront.ts` for CI verification
8. **Mock vs production** — MockRegistryClient for dev, real sidecar for production

### `docs/guides/policy-admin.md`

Audience: compliance teams managing agent governance policies.

1. **Quick start** — 5 commands: docker compose up (API + dashboard) → open dashboard → create org → create policy → test in REPL
2. **Deploy API + dashboard** — Docker images + Postgres, dashboard behind proxy
3. **Organization and group hierarchy** — create org, departments, teams, assign agents
4. **Create policies** — tiered explanation:
   - **UI tier:** dashboard screenshots and walkthrough
   - **API tier:** JSON constraint format, REST API calls for automation/IaC
   - **Cedar tier:** generated Cedar source, how to read it, what it means for audit
5. **Assign policies to groups** — intersection semantics (constraints only narrow)
6. **Test with the REPL** — dashboard REPL tester walkthrough
7. **Audit** — decision log, bundle hash, envelope viewer
8. **Advanced** — deny policies, rate limits, temporal constraints, expiry

### Supporting files

- `docs/proxy/Caddyfile` — example Caddy reverse proxy config
- `docs/proxy/nginx.conf` — example nginx reverse proxy config
- `packages/storefront-sdk/scripts/test-storefront.ts` — CLI test tool with `--url`, `--token`, `--sidecar-url` flags

**Demo checkpoint:** Each guide's quick start section can be followed top to bottom by someone with Docker and Node.js installed, producing a working result in under 2 minutes. The vendor test script runs successfully against a storefront running the SDK.

---

## Phase 4: Reorganize + Production Compose + Verification

**Goal:** OpenClaw material moved to examples. Production compose with network segmentation. Demo compose builds from source. Smoke test script validates everything.

**Deliverables:**

### File Moves

| From | To |
|---|---|
| `skills/warranted-identity/` | `examples/openclaw/skills/warranted-identity/` |
| `scripts/demo-vendor-server.ts` | `examples/openclaw/scripts/demo-vendor-server.ts` |
| `scripts/demo-storefront.ts` | `examples/openclaw/scripts/demo-storefront.ts` |

- `examples/openclaw/README.md` — how to run the OpenClaw demo, what OpenClaw is, this is one integration example
- Verify workspace resolution: `bun run examples/openclaw/scripts/demo-vendor-server.ts` resolves `@warranted/storefront-sdk`

### Compose Files (all at repo root)

- `docker-compose.yml` — unchanged (dev, Postgres only)

- `docker-compose.production.yml` — reference production deployment:
  ```yaml
  networks:
    backend:    # postgres, api, sidecar
    frontend:   # api, dashboard, caddy

  services:
    postgres:
      networks: [backend]
      # healthcheck with pg_isready
    api:
      image: warranted/rules-engine-api:${API_VERSION:-0.1.0}
      networks: [backend, frontend]
      depends_on: postgres (healthy)
    sidecar:
      image: warranted/governance-sidecar:${SIDECAR_VERSION:-0.1.0}
      networks: [backend]        # NOT on frontend
    dashboard:
      image: warranted/dashboard:${DASHBOARD_VERSION:-0.1.0}
      networks: [frontend]
    caddy:
      profiles: [proxy]          # only with --profile proxy
      networks: [frontend]
  ```

- `docker-compose.demo.yml` — OpenClaw demo (builds from source):
  - postgres (tmpfs)
  - api (build from `apps/api/Dockerfile`)
  - sidecar (build from `sidecar/Dockerfile`)
  - demo-vendor (bun run examples/openclaw/scripts/demo-vendor-server.ts)
  - All use local build contexts, no pre-built images required

### Root README

- `README.md` — replace current content:
  - One-line description: "Compliance-first transaction infrastructure for enterprise AI agent commerce"
  - "Why Warranted" — 2 paragraphs on the problem and solution
  - Text architecture diagram showing how components connect
  - Component table with links (SDK, rules engine, sidecar, API, dashboard)
  - Guide links (agent platform, vendor, policy admin)
  - Examples link (OpenClaw demo)

### Verification

- `scripts/verify-packaging.sh` — smoke test script:
  1. Build all 3 Docker images from scratch (`--no-cache`)
  2. `npm pack --dry-run` both packages, verify expected files
  3. `docker compose -f docker-compose.production.yml up -d` (with local images)
  4. Wait for health checks (postgres pg_isready, api /health)
  5. `curl` each endpoint: api /health, api /api/policies/rules, sidecar /check_identity
  6. Tear down
  7. Report pass/fail for each check

**Demo checkpoint:**
1. `scripts/verify-packaging.sh` passes all checks
2. `docker compose -f docker-compose.demo.yml up` starts all services, demo scripts run
3. `docker compose -f docker-compose.production.yml --profile proxy up` starts all services including Caddy, dashboard accessible via Caddy
4. Root README renders correctly on GitHub with architecture diagram and links

---

## Deliverables Summary

| # | Deliverable | Type | Phase |
|---|---|---|---|
| 1 | Dashboard relative URLs + rewrites + standalone output | Code | 0 |
| 2 | Sidecar `__init__.py` + pinned deps + lockfile | Code | 0 |
| 3 | Route path verification | Verification | 0 |
| 4 | `sidecar/Dockerfile` | Docker | 1 |
| 5 | `apps/api/Dockerfile` + `start.sh` + `migrate.ts` | Docker | 1 |
| 6 | `drizzle/migrations/` (generated SQL) | Migrations | 1 |
| 7 | `apps/dashboard/Dockerfile` + `entrypoint.sh` | Docker | 1 |
| 8 | `tsconfig.build.json` for both packages | Build | 1 |
| 9 | `package.json` publishConfig for both packages | Config | 1 |
| 10 | `LICENSE` (Apache 2.0) at root and in packages | Legal | 1 |
| 11 | npm pack --dry-run verification | Verification | 1 |
| 12 | `packages/storefront-sdk/README.md` | Docs | 2 |
| 13 | `packages/rules-engine/README.md` | Docs | 2 |
| 14 | `sidecar/README.md` | Docs | 2 |
| 15 | `apps/api/README.md` | Docs | 2 |
| 16 | `apps/dashboard/README.md` | Docs | 2 |
| 17 | `docs/guides/agent-platform-integration.md` | Docs | 3 |
| 18 | `docs/guides/vendor-integration.md` | Docs | 3 |
| 19 | `docs/guides/policy-admin.md` | Docs | 3 |
| 20 | `docs/proxy/Caddyfile` + `docs/proxy/nginx.conf` | Config | 3 |
| 21 | `packages/storefront-sdk/scripts/test-storefront.ts` | Script | 3 |
| 22 | `examples/openclaw/` (moved demo material) | Reorg | 4 |
| 23 | `docker-compose.production.yml` | Docker | 4 |
| 24 | `docker-compose.demo.yml` | Docker | 4 |
| 25 | Root `README.md` | Docs | 4 |
| 26 | `scripts/verify-packaging.sh` | Script | 4 |

---

## Open Questions

1. **Drizzle migration generation:** Does `drizzle-kit generate` produce correct output for the current schema with Cedar-specific column types and enums? Need to verify the generated SQL before committing.
2. **Dashboard static assets:** The standalone Next.js output may not include the `public/` directory correctly. Verify during Phase 1 Docker build.
3. **Bun workspace resolution from examples/:** Confirmed Bun resolves by package name, but needs verification after the move. If it fails, add `"examples/*"` to the root workspace config.
4. **Cedar WASM in tsc build:** TypeScript compilation of the rules engine may need special handling for the `@cedar-policy/cedar-wasm/nodejs` import path. Verify `tsc -p tsconfig.build.json` succeeds.
5. **Sidecar non-root user:** The Dockerfile should use a non-root user per security rules. Need to verify that `inter-agent-trust-protocol` and `agent-os-kernel` don't require root permissions.

## References

- [Enterprise Packaging Specification](./enterprise-packaging-SPEC.md) — original spec
- [Enterprise Packaging Decisions](./enterprise-packaging-DECISIONS.md) — all design decisions with tradeoffs
- [Rules Engine Plan](./rules-engine-PLAN.md) — reference for plan format
- [Storefront SDK Plan](./storefront-sdk-PLAN.md) — reference for plan format
- [CLAUDE.md](../../CLAUDE.md) — project overview, stack, conventions
- [Code Style Rules](../../.claude/rules/code-style.md) — TypeScript and Python conventions
- [Security Rules](../../.claude/rules/security.md) — secrets, Docker security, image tags
