# Enterprise Packaging — Design Decisions

## Docker Build Strategy

### Q: Should the API Dockerfile copy the entire monorepo workspace or just the relevant packages?
**Tradeoff:** Full workspace install (~200MB image, simple, reliable) vs. selective copy (smaller image, fragile with Bun hoisting) vs. Bun bundler (smallest, but Cedar WASM breaks — it loads `.wasm` via `fs.readFileSync` and `__dirname` which can't be inlined).
**Decision:** Full workspace install. Copy root `package.json` + `bun.lock`, then the relevant package directories, run `bun install --frozen-lockfile`. Image size doesn't matter for a backend API running on a server. Cedar WASM compatibility is non-negotiable. Optimize later if needed.

### Q: How should the API container handle database schema at startup?
**Tradeoff:** Drizzle Kit push at startup (dev tool, can prompt interactively on ambiguous diffs) vs. generated SQL migrations (deterministic, reviewable in PRs) vs. custom push script (hand-rolling what Drizzle Kit does).
**Decision:** Generated SQL migrations. Run `drizzle-kit generate` to produce SQL migration files, commit them, run them at startup with Drizzle's `migrate()` function. This is the production-standard approach — migrations are versioned, reviewable, and deterministic. `drizzle-kit push` is a dev tool, not a production deployment tool.

### Q: What startup sequence should the API container use?
**Tradeoff:** Linear start.sh (simple, re-runs everything on restart) vs. init containers (Kubernetes-native, overkill for Compose) vs. start.sh with skip flags (operator control).
**Decision:** start.sh with `SKIP_MIGRATE=1` and `SKIP_SEED=1` env var flags. First deploy: both run. Subsequent restarts: skip both. Multiple API replicas: only the first runs migrations. Seed may not be idempotent — operator control prevents re-running it on every container restart.

### Q: What base image tags should Dockerfiles pin to?
**Tradeoff:** `latest` (spec default, violates security rules) vs. exact digest (fully reproducible, manual update burden) vs. minor pin with update policy (security patches auto-apply, no breaking changes).
**Decision:** Pin to minor version: `oven/bun:1.3` and `node:20-alpine`. Add a comment in each Dockerfile: `# Base image pinned to minor. Review quarterly or on security advisory. Last reviewed: 2026-04.` Cedar WASM was tested on Bun 1.3.10 — don't risk a different minor version.

### Q: Should Dockerfiles use `.dockerignore` or explicit COPY?
**Tradeoff:** Global `.dockerignore` (doesn't work well in monorepos where build contexts differ) vs. per-service `.dockerignore` (3 more files to maintain) vs. explicit COPY (self-documenting, zero maintenance).
**Decision:** Explicit COPY in Dockerfiles. The sidecar is 3 files (`server.py`, `requirements.txt`, `__init__.py`). The API Dockerfile already uses explicit COPY. Anyone reading the Dockerfile knows exactly what's in the image. If a file is added, the developer consciously decides whether the Docker image needs it.

## Sidecar Packaging

### Q: Should the sidecar directory be restructured into a proper Python package?
**Tradeoff:** File-based `server:app` (flat, breaks test imports) vs. Python package `sidecar.server:app` (proper, enables test imports) vs. src layout (overkill for Docker-only service).
**Decision:** Python package with `__init__.py`. The sidecar tests already import from the sidecar module — without `__init__.py`, those imports break. `sidecar.server:app` is the correct uvicorn module path. Adding `__init__.py` is one empty file.

### Q: How should sidecar Python dependencies be managed?
**Tradeoff:** Fix missing deps only (unpinned transitives can drift) vs. pin everything flat (hard to maintain, can't distinguish direct from transitive) vs. direct deps + lockfile (human-readable + reproducible).
**Decision:** Fix requirements.txt with all direct imports (inter-agent-trust-protocol, agent-os-kernel, fastapi, uvicorn, cryptography, PyJWT, httpx) pinned to exact versions. Generate `requirements-lock.txt` via `pip-compile` for the full dependency tree. Dockerfile installs from the lockfile. This is the Python equivalent of `package.json` + `bun.lock`. Reproducible builds are non-negotiable for a compliance product.

### Q: How does the IATP dependency get installed in Docker?
**Tradeoff:** Unknown install source (could be local, git, or PyPI).
**Decision:** Verified: `inter-agent-trust-protocol==0.5.0` is pip-installable from PyPI. All sidecar dependencies (`agent-os-kernel==3.0.1`, `agentmesh-runtime==3.0.2`, `PyJWT==2.10.1`, `httpx==0.28.1`, etc.) are on PyPI. Pin in requirements.txt, lock in requirements-lock.txt.

## Dashboard Deployment

### Q: How should the dashboard handle API URL configuration?
**Tradeoff:** Build-time `NEXT_PUBLIC_API_URL` (rebuild per environment) vs. runtime injection (same image, different config) vs. relative URLs (requires reverse proxy).
**Decision:** Relative URLs as default + runtime injection as escape hatch. Dashboard code uses relative paths (`/api/policies/...`). Next.js rewrites proxy to `localhost:3000` during dev. In production behind a reverse proxy, relative URLs work with zero config. If someone deploys dashboard and API on different domains, `NEXT_PUBLIC_API_URL` can be set and the entrypoint script injects it into the built JS files. Default empty = relative URLs.

### Q: How should the dashboard handle dev vs. production API routing?
**Tradeoff:** Env var branching in components (leaks infrastructure into code) vs. Next.js rewrites (infrastructure-level, transparent) vs. fetch wrapper (adds abstraction).
**Decision:** Next.js rewrites in `next.config.ts`. Add `rewrites()` that proxies `/api/:path*` to `http://localhost:3000/api/:path*` during development. Components always use relative URLs. Zero env var branching in application code.

### Q: Does the dashboard need `output: 'standalone'` in next.config.ts?
**Tradeoff:** Assume it's configured (it isn't — `create-next-app` doesn't set it) vs. check and add.
**Decision:** Add `output: 'standalone'` to `next.config.ts` as a Phase 0 deployment-readiness change. The Dockerfile copies from `.next/standalone` — without this config, that directory doesn't exist and the Docker build fails.

## Network Architecture

### Q: Should the production compose expose the sidecar to the public internet?
**Tradeoff:** Exposed (convenient for debugging) vs. internal-only (secure) vs. separate network segments (demonstrates security posture).
**Decision:** Separate Docker networks: `backend` (postgres, api, sidecar) and `frontend` (api, dashboard). API is on both networks. Sidecar is only on `backend` — never reachable from the public internet. The Caddy reverse proxy (on `frontend`) routes external traffic to the API and dashboard only. This demonstrates network segmentation to enterprise evaluators — table stakes for compliance infrastructure.

### Q: Should the production compose include a reverse proxy?
**Tradeoff:** Include always (opinionated) vs. BYOP (flexible) vs. optional via Compose profile (both).
**Decision:** Caddy reverse proxy included as an optional Compose profile. `docker compose up` starts application services only (for operators with their own proxy). `docker compose --profile proxy up` includes Caddy with automatic HTTPS. Caddyfile and example nginx.conf provided in docs/ for the BYOP crowd.

### Q: How should the production compose handle API URL for the dashboard since browsers can't resolve Docker hostnames?
**Tradeoff:** Placeholder with docs (error-prone) vs. require explicit config (hostile to quick start) vs. relative URL default (requires reverse proxy).
**Decision:** Relative URL default (empty `NEXT_PUBLIC_API_URL`). In production, dashboard and API are behind the same reverse proxy on the same domain. Relative URLs work with zero config. The reverse proxy requirement is documented. Without a proxy, fetch to `/api/policies/rules` returns 404 — a clear signal, not a silent misconfiguration.

## npm Publishing

### Q: Should the build pipeline for npm packages be fully functional or config-only?
**Tradeoff:** Config fields only (untested, false confidence) vs. full build pipeline (tsconfig.build.json, tsc, verify) vs. build + dry-run publish (most thorough).
**Decision:** Build + dry-run publish. Set up `tsconfig.build.json`, run `tsc` for declaration emit, verify `npm pack --dry-run` produces correct contents (dist/index.js, dist/index.d.ts, README.md, LICENSE). Shipping a broken package to the public npm registry with your company name is worse than shipping no package.

### Q: How should the published rules-engine package handle Cedar WASM?
**Tradeoff:** Bundle WASM into dist (fragile, couples to cedar-wasm internals) vs. normal npm dependency (standard, cedar-wasm handles its own packaging) vs. peer dependency (adds user friction for an implementation detail).
**Decision:** Normal npm dependency. `@cedar-policy/cedar-wasm` stays in `dependencies`. When users `npm install @warranted/rules-engine`, npm installs cedar-wasm automatically. The WASM file resolution is cedar-wasm's responsibility, not ours.

### Q: What license should the packages use?
**Tradeoff:** MIT (simple, standard) vs. Apache 2.0 (patent grant, enterprise-preferred) vs. defer to legal.
**Decision:** Apache 2.0. Enterprise legal teams prefer it for the explicit patent grant. Cedar, Kubernetes, Terraform (pre-BSL), and Apache Kafka all use Apache 2.0. Create LICENSE files in each package and repo root. This is a hard blocker for npm publish — the `files` array references LICENSE.

## Documentation Strategy

### Q: How deep should integration guides go?
**Tradeoff:** Fully self-contained (duplication, maintenance hell) vs. link to READMEs (reader bounces between docs) vs. quick start + deep dive (zero-friction onboarding + proper depth).
**Decision:** Quick start + deep dive. Each guide opens with a 5-command quick start that gets the reader to a working state in under 2 minutes. Detailed sections follow, linking to component READMEs for configuration. No duplication of setup instructions across guides.

### Q: How should the storefront-sdk README present the quick start?
**Tradeoff:** Mock registry only (instant but not realistic) vs. real sidecar (realistic but friction) vs. both paths (serves both audiences).
**Decision:** Both paths. "Try it" section uses `MockRegistryClient` — 5 lines, no Docker, instant gratification. "Production" section uses the real sidecar. Like Stripe's test mode vs. live mode. The SDK already has `MockRegistryClient` built in.

### Q: How technical should the Cedar explanation be in the policy-admin guide?
**Tradeoff:** Hide Cedar behind UI (misses selling point) vs. show alongside UI (may overwhelm) vs. tiered depth (reader stops at comfort level).
**Decision:** Tiered: UI → API → Cedar. Dashboard UI for the procurement manager, API JSON format for the compliance engineer automating deployment, Cedar source for the auditor. Cedar auditability is the selling point — hiding it undermines the pitch.

### Q: How should the agent-platform guide handle the one-sidecar-per-agent model?
**Tradeoff:** Document as a limitation vs. present idealized multi-agent vision vs. present as a design choice.
**Decision:** Present as a design choice, no apologies. One sidecar per agent IS the security model — cryptographic isolation, agent can't sign as another agent. Same pattern as Envoy, Istio, Dapr. The guide says: "Deploy one sidecar instance per agent runtime. Each sidecar has its own Ed25519 identity. This ensures cryptographic isolation."

### Q: Should component READMEs document APIs comprehensively given they may change?
**Tradeoff:** Full docs now (may drift) vs. version caveat (honest + useful) vs. minimal README (useless for adoption).
**Decision:** Document with `v0.1 — API may change` banner. Core exports are stable. Undocumented packages don't get adopted. The banner sets expectations for early adopters.

### Q: What should the root README contain?
**Tradeoff:** Minimal table (internal-repo feel) vs. value prop + architecture (product landing page) vs. full landing page with badges/screenshots (maintenance overhead).
**Decision:** Value prop + architecture. Two paragraphs explaining why Warranted exists, a text architecture diagram, then the component table with links. Visitors need context to decide which guide to click. Text diagrams don't go stale.

## Vendor Testing

### Q: How should the storefront test script handle JWT authentication?
**Tradeoff:** Require sidecar (realistic but high friction) vs. `--token` flag (flexible but requires JWT knowledge) vs. both flags (serves both audiences).
**Decision:** `--token` OR `--sidecar-url` flags. Default to `--sidecar-url http://localhost:8100` for local dev with sidecar. `--token eyJ...` for CI where the token comes from a secrets store. Two code paths, both audiences served.

## Repository Organization

### Q: Where should the OpenClaw demo compose file live?
**Tradeoff:** New compose in warranted repo only (simple) vs. update both repos (coordination cost) vs. symlink compatibility (deferred breakage).
**Decision:** New compose in warranted repo. The OpenClaw repo is separate — updating it is a coordination cost outside this spec's scope. Old paths will break; the README explains the new location. Demo setups aren't production integrations.

### Q: Where should compose files be located?
**Tradeoff:** Three files in three directories (hard to find) vs. all at root (discoverable) vs. deploy/ directory (clean but non-standard).
**Decision:** All compose files at repo root, clearly named: `docker-compose.yml` (dev), `docker-compose.production.yml` (production), `docker-compose.demo.yml` (OpenClaw demo). `examples/openclaw/` keeps its README, skills, and scripts — just not the compose file.

### Q: How should example scripts import the SDK after moving to examples/openclaw/?
**Tradeoff:** Relative imports (ugly, path-coupled) vs. workspace resolution (name-based, path-independent) vs. published package import (same in practice).
**Decision:** Keep workspace resolution. Bun resolves `@warranted/storefront-sdk` by package name from anywhere in the monorepo. Moving files to `examples/openclaw/scripts/` doesn't break workspace resolution. Verify with `bun run examples/openclaw/scripts/demo-vendor-server.ts` after the move.

## Scope Clarification

### Q: The spec says "no application code changes" but the interview surfaced required changes. How to handle?
**Tradeoff:** Update spec statement (muddy) vs. prerequisite fixes (artificial separation) vs. Phase 0 (explicit and honest).
**Decision:** Add Phase 0: Deployment Readiness. Contains the 5 small code changes required before packaging can work: (1) relative URLs in apiFetch, (2) Next.js rewrites in next.config.ts, (3) `output: 'standalone'` in next.config.ts, (4) sidecar `__init__.py`, (5) pinned Python dependencies. Spec updated to say "minimal deployment-readiness code changes in Phase 0, no feature code changes."

### Q: Should the production compose include image version tags?
**Tradeoff:** Hardcoded version (auditable but requires compose edits to upgrade) vs. variable with default (flexible, CD-friendly) vs. variable without default (forces explicit config).
**Decision:** Variable with default: `${API_VERSION:-0.1.0}`, `${SIDECAR_VERSION:-0.1.0}`, `${DASHBOARD_VERSION:-0.1.0}`. Works out of the box for evaluation, overridable for CD pipelines.

## Verification

### Q: Should the plan include automated tests for packaging?
**Tradeoff:** Demo checkpoints only (manual, forgettable) vs. smoke test script (automated, catches regressions) vs. CI-ready test matrix (script + future CI YAML).
**Decision:** Smoke test script (`scripts/verify-packaging.sh`). Builds all Docker images from scratch (`--no-cache`), runs `npm pack --dry-run` for both packages, starts the production compose, waits for health checks, curls each endpoint, tears down. Run before any release. CI YAML can wrap this script later.

### Q: Should the API routing paths be verified before writing the Caddyfile?
**Tradeoff:** Assume from spec vs. verify actual code.
**Decision:** Verify in Phase 0. Read `apps/api/src/index.ts` route mounts and `apps/dashboard/src/lib/api.ts` fetch paths. Confirm they match. Then write the Caddyfile. Don't guess when you can read two files in 10 seconds.

### Q: Should backup/restore be included in the production compose?
**Tradeoff:** Out of scope vs. pg_dump one-liner vs. backup script + cron.
**Decision:** pg_dump one-liner in the API README. One command: `docker compose exec postgres pg_dump -U warranted warranted > backup.sql`. Enterprise deployments use managed Postgres with automated backups — the one-liner covers the reference deployment crowd evaluating on a VPS.
