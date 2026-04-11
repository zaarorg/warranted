# Enterprise Packaging — Specification (Updated)

## Overview

The Warranted codebase is already modular — `packages/rules-engine/` is a library, `packages/storefront-sdk/` is a library, the sidecar is standalone, the dashboard is standalone, and the API is a separate service. The problem is that none of these components can be used without cloning the monorepo and understanding its internal structure. This spec defines the packaging, documentation, and deployment changes needed so each component stands alone and enterprises can adopt them independently.

**This spec introduces no new features.** It adds Dockerfiles, README files, integration guides, publishing configuration, a production compose reference deployment, and reorganizes OpenClaw demo material into an examples directory. A Phase 0 contains minimal deployment-readiness code changes (relative URLs, Next.js config, Python dependency pinning) — no feature code changes.

---

## What Changes

| Component | Current State | Target State |
|---|---|---|
| `packages/storefront-sdk/` | Workspace package, no README | `npm install @warranted/storefront-sdk`, vendor integration guide, mock + production quick start |
| `packages/rules-engine/` | Workspace package, no README | `npm install @warranted/rules-engine`, library usage guide |
| `sidecar/` | Python directory, runs via `uvicorn` manually, incomplete requirements.txt | `docker pull warranted/governance-sidecar`, env var configured, pinned + locked deps |
| `apps/api/` | Bun directory, runs via `bun run dev`, uses `drizzle-kit push` | `docker pull warranted/rules-engine-api`, committed SQL migrations, start.sh with skip flags |
| `apps/dashboard/` | Next.js directory, hardcoded API URL, no standalone output | Standalone deployable, relative URLs + runtime injection escape hatch, reverse proxy docs |
| `skills/warranted-identity/` | OpenClaw-specific skill at repo root | Moved to `examples/openclaw/` |
| `scripts/demo-*.ts` | Demo scripts at repo root | Moved to `examples/openclaw/` |
| Docker Compose | Single dev compose (Postgres only) | Three compose files at root: dev, production (network-segmented), demo (builds from source) |
| Documentation | Handoff doc + specs only | Five component READMEs + three integration guides + root README with value prop |

---

## Phase 0: Deployment Readiness

Minimal code changes required before packaging can succeed. These are deployment prerequisites, not feature work.

### Dashboard Changes

**`apps/dashboard/src/lib/api.ts`** — change `apiFetch` base URL from `http://localhost:3000` to relative paths:
```typescript
// Before
const API_BASE = "http://localhost:3000";

// After
const API_BASE = "";  // relative URLs — /api/policies/... resolved by proxy
```

**`apps/dashboard/next.config.ts`** — add dev proxy and standalone output:
```typescript
const nextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://localhost:3000/api/:path*" },
    ];
  },
};
```

### Sidecar Changes

**`sidecar/__init__.py`** — create empty file. Makes sidecar a proper Python package so `uvicorn sidecar.server:app` works and test imports resolve.

**`sidecar/requirements.txt`** — fix missing dependencies and pin all versions:
```
fastapi==0.132.0
uvicorn==0.41.0
cryptography==46.0.7
inter-agent-trust-protocol==0.5.0
agent-os-kernel==3.0.1
PyJWT==2.10.1
httpx==0.28.1
```

**`sidecar/requirements-lock.txt`** — generated via `pip-compile requirements.txt`. Full transitive dependency tree for reproducible Docker builds. The Dockerfile installs from this lockfile.

### Route Verification

Before writing any Caddyfile or proxy config, verify:
1. `apps/api/src/index.ts` route mount paths (confirmed: `app.route("/api/policies", ...)`, `app.get("/health", ...)`)
2. `apps/dashboard/src/lib/api.ts` fetch paths match the API routes
3. Confirm the Caddy/nginx reverse proxy config will route correctly

---

## 1. npm Package Publishing

### `packages/storefront-sdk/package.json`

Update with publishing configuration and build pipeline:

```json
{
  "name": "@warranted/storefront-sdk",
  "version": "0.1.0",
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist/", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "prepublishOnly": "bun run build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

**`packages/storefront-sdk/tsconfig.build.json`** — extends base tsconfig, enables declaration emit, outDir `dist/`, excludes tests and `__tests__/`.

### `packages/rules-engine/package.json`

Same pattern. `@cedar-policy/cedar-wasm` remains a normal npm dependency — it is an implementation detail, not a user-facing choice. When users `npm install @warranted/rules-engine`, npm installs cedar-wasm into their `node_modules/` automatically and WASM file resolution works via standard module resolution.

```json
{
  "name": "@warranted/rules-engine",
  "version": "0.1.0",
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist/", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "prepublishOnly": "bun run build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

### License

Apache 2.0 license file at repo root and in each package directory. Enterprise legal teams prefer Apache 2.0 for the explicit patent grant — same license as Cedar, Kubernetes, and Apache Kafka.

### Build Verification

Run `npm pack --dry-run` for each package and verify the tarball contains: `dist/index.js`, `dist/index.d.ts`, `README.md`, `LICENSE`. This is the demo checkpoint for publishing readiness.

### Publishing Workflow

Not automated in this spec. The configuration enables `npm publish` from each package directory. CI/CD pipeline is out of scope.

---

## 2. Dockerfiles

### `sidecar/Dockerfile`

```dockerfile
# Base image pinned to minor. Review quarterly or on security advisory. Last reviewed: 2026-04.
FROM python:3.12-slim

RUN adduser --system --no-create-home sidecar

WORKDIR /app

COPY requirements-lock.txt .
RUN pip install --no-cache-dir -r requirements-lock.txt

COPY __init__.py .
COPY server.py .

USER sidecar

ENV ED25519_SEED=""
ENV RULES_ENGINE_URL=""
ENV PORT=8100

EXPOSE ${PORT}

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT}"]
```

**Note:** Explicit COPY of only the files needed. No `.dockerignore` — if a file is added to the sidecar, the developer consciously decides whether the Docker image needs it. Non-root user for security.

**Configuration (env vars):**

| Variable | Required | Default | Description |
|---|---|---|---|
| `ED25519_SEED` | Yes | — | Deterministic seed for Ed25519 keypair. Defines the agent's DID. |
| `RULES_ENGINE_URL` | No | `""` | When set, `/check_authorization` proxies to this URL. When empty, falls back to hardcoded policy checks. |
| `PORT` | No | `8100` | Port the sidecar listens on. |

**Resource minimum:** 128MB RAM.

### `apps/api/Dockerfile`

```dockerfile
# Base image pinned to minor. Review quarterly or on security advisory. Last reviewed: 2026-04.
FROM oven/bun:1.3

WORKDIR /app

# Copy workspace package files for dependency install
COPY package.json bun.lock ./
COPY packages/rules-engine/package.json packages/rules-engine/
COPY apps/api/package.json apps/api/

RUN bun install --frozen-lockfile

# Copy source
COPY packages/rules-engine/ packages/rules-engine/
COPY apps/api/ apps/api/
COPY drizzle/ drizzle/

# Copy startup script
COPY apps/api/scripts/start.sh .
RUN chmod +x start.sh

ENV DATABASE_URL=""
ENV PORT=3000
ENV SKIP_MIGRATE=""
ENV SKIP_SEED=""

EXPOSE ${PORT}

CMD ["./start.sh"]
```

**Build context:** Repository root (needs `packages/rules-engine/` and `drizzle/` alongside `apps/api/`).

**Startup script (`apps/api/scripts/start.sh`):**

```bash
#!/bin/bash
set -e

if [ -z "$SKIP_MIGRATE" ]; then
  echo "Running migrations..."
  bun run apps/api/src/migrate.ts
else
  echo "Skipping migrations (SKIP_MIGRATE is set)"
fi

if [ -z "$SKIP_SEED" ]; then
  echo "Seeding database..."
  bun run apps/api/src/seed-db.ts
else
  echo "Skipping seed (SKIP_SEED is set)"
fi

echo "Starting API server on port ${PORT}..."
bun run apps/api/src/index.ts
```

**`apps/api/src/migrate.ts`** — runs Drizzle `migrate()` with committed SQL migration files from `drizzle/migrations/`. Migrations are generated via `drizzle-kit generate`, committed to the repo, and are deterministic and reviewable in PRs.

**`apps/api/src/seed-db.ts`** — calls `seed(db)` from the rules engine package. Idempotent (checks if data already exists before inserting).

**Configuration (env vars):**

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | Postgres connection string. |
| `PORT` | No | `3000` | Port the API listens on. |
| `SKIP_MIGRATE` | No | `""` | Set to `1` to skip migrations on startup. |
| `SKIP_SEED` | No | `""` | Set to `1` to skip seeding on startup. |

**Resource minimum:** 512MB RAM (Cedar WASM evaluation).

### `apps/dashboard/Dockerfile`

```dockerfile
# Base image pinned to minor. Review quarterly or on security advisory. Last reviewed: 2026-04.
FROM node:20-alpine AS builder

WORKDIR /app
COPY apps/dashboard/ .
RUN npm ci
RUN NEXT_PUBLIC_API_URL="__NEXT_PUBLIC_API_URL_PLACEHOLDER__" npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY apps/dashboard/scripts/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

ENV NEXT_PUBLIC_API_URL=""
ENV PORT=3001

EXPOSE ${PORT}
ENTRYPOINT ["./entrypoint.sh"]
```

**Runtime env injection (`apps/dashboard/scripts/entrypoint.sh`):**

```bash
#!/bin/sh
if [ -n "$NEXT_PUBLIC_API_URL" ]; then
  echo "Injecting NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}"
  find /app/.next -name "*.js" -exec sed -i "s|__NEXT_PUBLIC_API_URL_PLACEHOLDER__|${NEXT_PUBLIC_API_URL}|g" {} +
else
  echo "Using relative URLs (no NEXT_PUBLIC_API_URL set)"
  find /app/.next -name "*.js" -exec sed -i "s|__NEXT_PUBLIC_API_URL_PLACEHOLDER__||g" {} +
fi
exec node server.js
```

**Configuration (env vars):**

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | `""` (relative) | External API URL. Empty = relative paths (requires reverse proxy on same domain). Set for cross-origin deployments. |
| `PORT` | No | `3001` | Port the dashboard listens on. |

**Note:** Default empty `NEXT_PUBLIC_API_URL` means relative URLs (`/api/policies/...`). This requires a reverse proxy routing `/api/*` to the API service. For cross-origin deployments (dashboard on Vercel, API on Railway), set `NEXT_PUBLIC_API_URL=https://api.warranted.io`.

---

## 3. Component README Files

All READMEs include a `> **v0.1 — API may change.** Core exports are stable but details may shift before v1.0.` banner.

### `packages/storefront-sdk/README.md`

Target audience: **vendors** who want to accept governed agent transactions.

Contents:
- What it does (one paragraph)
- **Try it (mock):** 5 lines with `MockRegistryClient`, `bun run`, `curl` the storefront — instant gratification, no Docker
- **Production setup:** install, configure with real sidecar URL, mount on Hono/Express/Fastify
- Installation: `npm install @warranted/storefront-sdk`
- Configuration options (all `WarrantedSDKConfig` fields)
- Verification flow (10-step chain, text diagram)
- Key exports: `WarrantedSDK`, `createVerificationMiddleware`, `MockRegistryClient`
- API reference: error codes table
- No mention of OpenClaw, Docker Compose, or the demo setup

### `packages/rules-engine/README.md`

Target audience: **developers** embedding the rules engine in their own API.

Contents:
- What it does (one paragraph)
- Installation: `npm install @warranted/rules-engine`
- Prerequisites: Postgres 16+, Cedar WASM (bundled as dependency)
- Quick start: connect to Postgres, run migrations, seed, resolve envelope, evaluate
- Key exports: `resolveEnvelope`, `CedarEvaluator`, `generateCedar`, `buildEntityStore`, schema tables
- Envelope resolution explained (intersection semantics table)
- Cedar policy format (with correct `containsAny` syntax)
- No mention of the API server, dashboard, or sidecar

### `sidecar/README.md`

Target audience: **platform teams** deploying AI agents.

Contents:
- What it does (one paragraph: defense-in-depth identity and authorization for AI agents)
- Quick start: `docker run -e ED25519_SEED=my-seed warranted/governance-sidecar`
- Configuration (env var table)
- **One sidecar per agent runtime** — this is a security design choice for cryptographic isolation, not a limitation. Same pattern as Envoy, Istio, Dapr.
- API endpoints with request/response examples: `/check_identity`, `/check_authorization`, `/sign_transaction`, `/issue_token`, `/verify_signature`
- How to connect to the rules engine API (`RULES_ENGINE_URL`)
- How to run without Docker (Python 3.12+, pip install, uvicorn)
- Resource minimum: 128MB RAM

### `apps/api/README.md`

Target audience: **platform teams** self-hosting the rules engine.

Contents:
- What it does (one paragraph: HTTP API for policy management and Cedar evaluation)
- Quick start: `docker run -e DATABASE_URL=postgres://... warranted/rules-engine-api`
- Configuration (env var table including `SKIP_MIGRATE`, `SKIP_SEED`)
- API endpoint summary (link to full spec)
- Deployment guidance (Railway, Fly, AWS ECS — needs Postgres + Docker image)
- Backup: `docker compose exec postgres pg_dump -U warranted warranted > backup.sql`
- Resource minimum: 512MB RAM (Cedar WASM evaluation)

### `apps/dashboard/README.md`

Target audience: **compliance/procurement teams** and **developers** setting up the admin UI.

Contents:
- What it does (one paragraph: admin dashboard for policy management, envelope visualization, REPL tester)
- Quick start: deploy to Vercel with relative URLs, or Docker with reverse proxy
- **Reverse proxy requirement:** dashboard uses relative URLs by default. Include example Caddyfile and nginx.conf snippet showing the proxy setup.
- **Cross-origin escape hatch:** set `NEXT_PUBLIC_API_URL` for deployments where dashboard and API are on different domains
- Self-hosting instructions (Docker or Next.js standalone)
- Screenshots of key pages (policies, envelope, REPL, Cedar viewer)

---

## 4. Integration Guides

Each guide follows the **quick start + deep dive** pattern: 5-command quick start at the top for immediate gratification, then detailed sections that link to component READMEs for configuration. No duplication of setup instructions across guides.

### `docs/guides/agent-platform-integration.md`

**Audience:** Teams deploying AI agents on any platform (not just OpenClaw).

**Quick start:** docker run sidecar → curl /check_identity → curl /issue_token → curl /check_authorization → curl /sign_transaction

**Contents:**

1. **Overview** — what Warranted provides for agent platforms (identity, authorization, audit trail)
2. **Deploy the sidecar** — Docker run command, env vars, health check
3. **Agent identity flow** — on startup, call `GET /check_identity` → get the agent's DID, store for subsequent calls
4. **Get a JWT** — call `POST /issue_token` → EdDSA JWT (24h TTL), include in Authorization headers
5. **Authorization check** — call `POST /check_authorization` before any transaction. Handle authorized, denied, and requires_approval responses.
6. **Sign transactions** — call `POST /sign_transaction` → sidecar checks authorization AND signs if approved. Signed payload includes authority chain for audit.
7. **One sidecar per agent runtime** — deploy one sidecar instance per agent. Each has its own Ed25519 identity derived from `ED25519_SEED`. Cryptographic isolation — no agent can sign as another agent. This is the sidecar pattern (Envoy, Istio, Dapr), not a limitation.
8. **Connect to the rules engine (optional)** — set `RULES_ENGINE_URL` to enable policy-based authorization instead of hardcoded limits
9. **Integration examples** — Python agent, TypeScript agent, curl-based agent

### `docs/guides/vendor-integration.md`

**Audience:** E-commerce/SaaS vendors who want to accept governed agent purchases.

**Quick start:** npm install → create server → mount SDK → start → curl manifest

**Contents:**

1. **Overview** — what the storefront SDK does (adds agent checkout to your existing server)
2. **Install:** `npm install @warranted/storefront-sdk`
3. **Mount on your server** — Hono/Express/Fastify examples with SDK config
4. **Verification flow** — what the SDK checks (10-step chain), all error codes
5. **Session lifecycle** — create → settle → receipt
6. **Settlement webhook** — `onSettlement` callback for fulfillment
7. **Testing:**
   - **curl commands** — step-by-step protocol walkthrough for learning and debugging
   - **Test script** — `bun run test-storefront.ts --url https://vendor.example.com` for CI verification. Accepts `--token` for pre-obtained JWT or `--sidecar-url` (default `http://localhost:8100`) to auto-obtain one.
8. **Mock vs production** — MockRegistryClient for instant dev, real sidecar for production

### `docs/guides/policy-admin.md`

**Audience:** Compliance teams managing agent governance policies.

**Quick start:** docker compose up → open dashboard → create org → create policy → test in REPL

**Contents:**

1. **Overview** — what the policy system does (Cedar-based authorization with group hierarchy)
2. **Deploy the API + dashboard** — Docker images + Postgres, dashboard behind reverse proxy
3. **Create your organization and group hierarchy** — API calls or dashboard UI
4. **Create policies** — tiered explanation:
   - **Dashboard tier:** UI walkthrough for day-to-day policy management (procurement manager audience)
   - **API tier:** JSON constraint format, REST API calls for automation and infrastructure-as-code (compliance engineer audience)
   - **Cedar tier:** generated Cedar source, how to read it, what it means for audit (auditor audience)
5. **Assign policies to groups** — intersection semantics: constraints only narrow, never widen
6. **Test with the REPL** — dashboard REPL tester walkthrough
7. **Audit** — decision log, bundle hash, envelope viewer
8. **Advanced** — deny policies, rate limits, temporal constraints, expiry

---

## 5. Production Docker Compose

### `docker-compose.production.yml`

Reference production deployment with network segmentation. All compose files live at the repo root.

```yaml
networks:
  backend:
    driver: bridge
  frontend:
    driver: bridge

services:
  postgres:
    image: postgres:16
    networks: [backend]
    environment:
      POSTGRES_USER: warranted
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: warranted
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U warranted"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    image: warranted/rules-engine-api:${API_VERSION:-0.1.0}
    networks: [backend, frontend]
    environment:
      DATABASE_URL: postgresql://warranted:${POSTGRES_PASSWORD}@postgres:5432/warranted
      PORT: "3000"
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy

  sidecar:
    image: warranted/governance-sidecar:${SIDECAR_VERSION:-0.1.0}
    networks: [backend]  # NOT on frontend — never exposed to public internet
    environment:
      ED25519_SEED: ${ED25519_SEED}
      RULES_ENGINE_URL: http://api:3000/api/policies/check
      PORT: "8100"
    depends_on:
      - api

  dashboard:
    image: warranted/dashboard:${DASHBOARD_VERSION:-0.1.0}
    networks: [frontend]
    environment:
      NEXT_PUBLIC_API_URL: ""  # empty = relative URLs, requires reverse proxy
      PORT: "3001"
    ports:
      - "3001:3001"
    depends_on:
      - api

  caddy:
    image: caddy:2-alpine
    profiles: [proxy]  # only with: docker compose --profile proxy up
    networks: [frontend]
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docs/proxy/Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on:
      - api
      - dashboard

volumes:
  postgres_data:
  caddy_data:
```

**Network design:**
- `backend`: postgres, api, sidecar. The sidecar is only reachable by the API and agent runtimes on the same network.
- `frontend`: api, dashboard, caddy. The API bridges both networks.
- The sidecar is **never** on the frontend network — it cannot be reached from the public internet.

**Image versioning:** Variables with defaults (`${API_VERSION:-0.1.0}`). Works out of the box for evaluation, overridable for CD pipelines via `.env` or environment variables.

**Reverse proxy:** Caddy is included as an optional Compose profile. `docker compose up` starts application services only. `docker compose --profile proxy up` includes Caddy.

### Proxy Configuration

**`docs/proxy/Caddyfile`:**
```
:80 {
  handle /api/* {
    reverse_proxy api:3000
  }
  handle {
    reverse_proxy dashboard:3001
  }
}
```

**`docs/proxy/nginx.conf`:** provided as an alternative for operators using nginx.

### Demo Compose

**`docker-compose.demo.yml`** — OpenClaw demo, builds all services from source:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: warranted_test
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/warranted_test
      PORT: "3000"
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy

  sidecar:
    build:
      context: ./sidecar
      dockerfile: Dockerfile
    environment:
      ED25519_SEED: demo-seed-123
      RULES_ENGINE_URL: http://api:3000/api/policies/check
      PORT: "8100"
    ports:
      - "8100:8100"
    depends_on:
      - api

  demo-vendor:
    image: oven/bun:1.3
    working_dir: /app
    volumes:
      - .:/app
    command: bun run examples/openclaw/scripts/demo-vendor-server.ts
    ports:
      - "3001:3001"
    depends_on:
      - sidecar
```

Builds from source — no pre-built images required. Developer clones the repo, runs `docker compose -f docker-compose.demo.yml up`, everything builds locally.

---

## 6. Reorganize OpenClaw Material

### Move to `examples/openclaw/`

```
examples/
└── openclaw/
    ├── README.md              — how to run the OpenClaw demo
    ├── skills/
    │   └── warranted-identity/
    │       └── SKILL.md       — OpenClaw skill for governed purchasing
    └── scripts/
        ├── demo-vendor-server.ts
        └── demo-storefront.ts
```

### What stays in the repo root

- `packages/` — npm packages (storefront-sdk, rules-engine)
- `apps/` — deployable services (api, dashboard)
- `sidecar/` — governance sidecar
- `docs/` — specs, plans, guides
- `docker-compose.yml` — dev (Postgres only)
- `docker-compose.production.yml` — reference production deployment
- `docker-compose.demo.yml` — OpenClaw demo

### What moves

| From | To |
|---|---|
| `skills/warranted-identity/` | `examples/openclaw/skills/warranted-identity/` |
| `scripts/demo-vendor-server.ts` | `examples/openclaw/scripts/demo-vendor-server.ts` |
| `scripts/demo-storefront.ts` | `examples/openclaw/scripts/demo-storefront.ts` |

Scripts keep their `@warranted/storefront-sdk` imports — Bun workspace resolution is name-based and works from any directory in the monorepo.

### `examples/openclaw/README.md`

Explains:
- What OpenClaw is
- How to run the full demo: `docker compose -f docker-compose.demo.yml up`
- The demo purchasing prompt
- This is ONE integration example — Warranted works with any agent platform

---

## 7. Root README.md

Replace the current root README:

```markdown
# Warranted

Compliance-first transaction infrastructure for enterprise AI agent commerce.

## Why Warranted

When AI agents transact autonomously — purchasing compute, negotiating contracts, 
settling invoices — enterprises need the same governance they'd require of any human 
employee: identity verification, spending limits, approved vendor lists, audit trails, 
and dispute resolution. Warranted provides this compliance layer as infrastructure, 
so every agent transaction is governed, auditable, and defensible.

The platform implements defense-in-depth: a cryptographic identity sidecar (Ed25519 
DIDs), a Cedar-based policy engine with Active Directory-style group hierarchy, a 
storefront SDK for vendors, and a management dashboard for compliance teams.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  AI Agent    │────▶│  Governance      │────▶│  Rules Engine   │
│  Runtime     │     │  Sidecar         │     │  API + Cedar    │
│              │     │  (Ed25519, DID)  │     │  (Postgres)     │
└──────┬───────┘     └──────────────────┘     └────────┬────────┘
       │                                                │
       ▼                                                ▼
┌──────────────┐                              ┌─────────────────┐
│  Vendor      │                              │  Dashboard      │
│  Storefront  │                              │  (Policy Admin) │
│  (SDK)       │                              │                 │
└──────────────┘                              └─────────────────┘
```

## Components

| Component | Description | Quick Start |
|---|---|---|
| [@warranted/storefront-sdk](./packages/storefront-sdk/) | SDK for vendors to accept governed agent purchases | `npm install @warranted/storefront-sdk` |
| [@warranted/rules-engine](./packages/rules-engine/) | Cedar-based policy evaluation library | `npm install @warranted/rules-engine` |
| [Governance Sidecar](./sidecar/) | Defense-in-depth identity and authorization | `docker pull warranted/governance-sidecar` |
| [Rules Engine API](./apps/api/) | HTTP API for policy management | `docker pull warranted/rules-engine-api` |
| [Dashboard](./apps/dashboard/) | Admin UI for policy management | Deploy to Vercel |

## Guides

- [Agent Platform Integration](./docs/guides/agent-platform-integration.md) — deploy governed agents on any platform
- [Vendor Integration](./docs/guides/vendor-integration.md) — accept governed agent purchases
- [Policy Administration](./docs/guides/policy-admin.md) — manage agent governance policies

## Examples

- [OpenClaw Integration](./examples/openclaw/) — demo of governed agent purchasing with OpenClaw

## License

Apache 2.0
```

---

## 8. Verification

### `scripts/verify-packaging.sh`

Smoke test script that validates the entire packaging:

1. Build all 3 Docker images from scratch (`--no-cache`)
2. `npm pack --dry-run` both packages, verify expected files present
3. `docker compose -f docker-compose.production.yml up -d` (with locally-built images)
4. Wait for health checks (postgres `pg_isready`, api `/health`)
5. `curl` each endpoint: api `/health`, api `/api/policies/rules`, sidecar `/check_identity`
6. Tear down all containers
7. Report pass/fail for each check

Run before any release. CI can wrap this script when GitHub Actions is set up.

### Storefront Test Script

**`packages/storefront-sdk/scripts/test-storefront.ts`** — CLI tool for vendors to validate their integration:

```
bun run test-storefront.ts --url https://vendor.example.com
bun run test-storefront.ts --url https://vendor.example.com --token eyJ...
bun run test-storefront.ts --url https://vendor.example.com --sidecar-url http://localhost:8100
```

Flags:
- `--url` (required): storefront URL to test
- `--token`: pre-obtained JWT (for CI where token comes from secrets store)
- `--sidecar-url` (default: `http://localhost:8100`): sidecar URL to auto-obtain a token

Runs the full flow: discover manifest → browse catalog → create session → settle → verify receipt.

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

## Out of Scope

- CI/CD pipelines (GitHub Actions for Docker builds, npm publish)
- Domain names, SSL, cloud deployment automation
- npm org setup (@warranted scope on npmjs.com)
- Docker Hub org setup (warranted/ namespace)
- Changelog, versioning strategy beyond `0.1.0`
- API authentication for the rules engine endpoints (deferred per rules engine spec)
- Load testing and production resource limit tuning
- Kubernetes manifests or Helm charts
