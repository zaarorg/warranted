# Enterprise Packaging — Specification

## Overview

The Warranted codebase is already modular — `packages/rules-engine/` is a library, `packages/storefront-sdk/` is a library, the sidecar is standalone, the dashboard is standalone, and the API is a separate service. The problem is that none of these components can be used without cloning the monorepo and understanding its internal structure. This spec defines the packaging, documentation, and deployment changes needed so each component stands alone and enterprises can adopt them independently.

**This spec does not change any application code.** It adds Dockerfiles, README files, integration guides, publishing configuration, and reorganizes the OpenClaw-specific demo material into an examples directory.

---

## What Changes

| Component | Current State | Target State |
|---|---|---|
| `packages/storefront-sdk/` | Workspace package, no README | `npm install @warranted/storefront-sdk`, vendor integration guide |
| `packages/rules-engine/` | Workspace package, no README | `npm install @warranted/rules-engine`, library usage guide |
| `sidecar/` | Python directory, runs via `uvicorn` manually | `docker pull warranted/governance-sidecar`, env var configured |
| `apps/api/` | Bun directory, runs via `bun run dev` | `docker pull warranted/rules-engine-api`, deploys to any cloud |
| `apps/dashboard/` | Next.js directory, runs via `bun run dev` | Standalone deployable (Vercel, Netlify, self-host), one env var |
| `skills/warranted-identity/` | OpenClaw-specific skill | Moved to `examples/openclaw/`, generic integration guide replaces it |
| `scripts/demo-*.ts` | Demo scripts at repo root | Moved to `examples/openclaw/` |
| Documentation | Handoff doc + specs only | Three integration guides for three personas |

---

## 1. npm Package Publishing

### `packages/storefront-sdk/package.json`

Add publishing configuration:

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
    "build": "tsc",
    "prepublishOnly": "bun run build"
  }
}
```

### `packages/rules-engine/package.json`

Same pattern. Note: the Cedar WASM artifact (`cedar.wasm` or the `@cedar-policy/cedar-wasm` dependency) must be included in the published package.

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
    "build": "tsc",
    "prepublishOnly": "bun run build"
  }
}
```

### Publishing Workflow

Add `.github/workflows/publish.yml` (or document the manual process):

```yaml
# Triggered on version tag (e.g., v0.1.0)
# Builds both packages
# Publishes to npm with --access public
```

Not automated in this spec — just the configuration so `npm publish` works from each package directory.

---

## 2. Dockerfiles

### `sidecar/Dockerfile`

```dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV ED25519_SEED=""
ENV RULES_ENGINE_URL=""
ENV PORT=8100

EXPOSE ${PORT}

CMD ["sh", "-c", "uvicorn sidecar.server:app --host 0.0.0.0 --port ${PORT}"]
```

**Configuration (env vars):**

| Variable | Required | Default | Description |
|---|---|---|---|
| `ED25519_SEED` | Yes | — | Deterministic seed for Ed25519 keypair. Defines the agent's DID. |
| `RULES_ENGINE_URL` | No | `""` | When set, `/check_authorization` proxies to this URL. When empty, falls back to hardcoded policy checks. |
| `PORT` | No | `8100` | Port the sidecar listens on. |

**No dependency on the monorepo.** The sidecar directory contains everything it needs: `server.py`, `requirements.txt`, and its own `tests/`.

### `apps/api/Dockerfile`

```dockerfile
FROM oven/bun:latest

WORKDIR /app

# Copy package files for dependency install
COPY package.json bun.lock ./
COPY packages/rules-engine/package.json packages/rules-engine/
COPY apps/api/package.json apps/api/

RUN bun install --frozen-lockfile

# Copy source
COPY packages/rules-engine/ packages/rules-engine/
COPY apps/api/ apps/api/

# Copy startup script
COPY apps/api/scripts/start.sh .
RUN chmod +x start.sh

ENV DATABASE_URL=""
ENV PORT=3000

EXPOSE ${PORT}

CMD ["./start.sh"]
```

**Startup script (`apps/api/scripts/start.sh`):**

```bash
#!/bin/bash
set -e

echo "Pushing schema..."
bun run apps/api/src/push-schema.ts

echo "Seeding database..."
bun run apps/api/src/seed-db.ts

echo "Starting API server on port ${PORT}..."
bun run apps/api/src/index.ts
```

**`apps/api/src/push-schema.ts`** — creates all tables and enums from the Drizzle schema. Idempotent (uses `CREATE TABLE IF NOT EXISTS` / `CREATE TYPE IF NOT EXISTS`).

**`apps/api/src/seed-db.ts`** — calls `seed(db)` from the rules engine package. Idempotent (checks if data already exists before inserting).

**Configuration (env vars):**

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | Postgres connection string. |
| `PORT` | No | `3000` | Port the API listens on. |

### `apps/dashboard/Dockerfile`

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY apps/dashboard/ .
RUN npm ci
RUN NEXT_PUBLIC_API_URL="" npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

ENV NEXT_PUBLIC_API_URL=""
ENV PORT=3001

EXPOSE ${PORT}
CMD ["node", "server.js"]
```

**Configuration (env vars):**

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | — | URL of the rules engine API (e.g., `https://api.warranted.io`). |
| `PORT` | No | `3001` | Port the dashboard listens on. |

**Note:** `NEXT_PUBLIC_API_URL` is baked into the build for client-side fetch calls. For runtime configuration, the dashboard should use a `/api/config` endpoint or `window.__ENV__` injection pattern. For the initial release, build-time env var is acceptable.

---

## 3. Component README Files

### `packages/storefront-sdk/README.md`

Target audience: **vendors** who want to accept governed agent transactions.

Contents:
- What it does (one paragraph)
- Installation: `npm install @warranted/storefront-sdk`
- Quick start: mount on existing Hono/Express/Fastify server, configure catalog
- Configuration options (vendorId, catalog, webhooks, trust score threshold)
- Example: minimal vendor server (10-15 lines)
- API reference: key exports (`WarrantedSDK`, `createVerificationMiddleware`, etc.)
- How agent purchasing works (high-level flow diagram in text)
- No mention of OpenClaw, Docker Compose, or the demo setup

### `packages/rules-engine/README.md`

Target audience: **developers** embedding the rules engine in their own API.

Contents:
- What it does (one paragraph)
- Installation: `npm install @warranted/rules-engine`
- Prerequisites: Postgres 16+, Cedar WASM (bundled)
- Quick start: connect to Postgres, push schema, seed, resolve envelope, evaluate
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
- API endpoints: `/check_identity`, `/check_authorization`, `/sign_transaction`, `/issue_token`, `/verify_signature`
- Request/response examples for each endpoint
- How to connect to the rules engine API (`RULES_ENGINE_URL`)
- How to run without Docker (Python 3.12+, pip install, uvicorn)

### `apps/api/README.md`

Target audience: **platform teams** self-hosting the rules engine.

Contents:
- What it does (one paragraph: HTTP API for policy management and Cedar evaluation)
- Quick start: `docker run -e DATABASE_URL=postgres://... warranted/rules-engine-api`
- Configuration (env var table)
- API endpoint summary (link to full spec)
- How to deploy (Railway, Fly, AWS ECS — just needs Postgres + the Docker image)
- How to seed initial data

### `apps/dashboard/README.md`

Target audience: **compliance/procurement teams** and **developers** setting up the admin UI.

Contents:
- What it does (one paragraph: admin dashboard for policy management, envelope visualization, REPL tester)
- Quick start: deploy to Vercel with `NEXT_PUBLIC_API_URL` pointing to the API
- Screenshots of key pages (policies, envelope, REPL, Cedar viewer)
- Self-hosting instructions (Docker or Next.js standalone)

---

## 4. Integration Guides

### `docs/guides/agent-platform-integration.md`

**Audience:** Teams deploying AI agents on any platform (not just OpenClaw).

**Contents:**

1. **Overview** — what Warranted provides for agent platforms (identity, authorization, audit trail)

2. **Deploy the sidecar** — Docker run command, env vars, health check

3. **Agent identity flow:**
   - On agent startup, call `GET /check_identity` → get the agent's DID
   - Store the DID for all subsequent calls

4. **Get a JWT:**
   - Call `POST /issue_token` → get an EdDSA JWT (24h TTL)
   - Include this JWT in `Authorization: Bearer <token>` headers when calling vendor storefronts

5. **Authorization check before any transaction:**
   - Call `POST /check_authorization?vendor=<id>&amount=<n>&category=<cat>`
   - If `authorized: true` → proceed
   - If `authorized: false` → abort, show reasons to human operator
   - If `requires_approval: true` → pause, escalate to human for approval

6. **Sign transactions:**
   - Call `POST /sign_transaction` → sidecar checks authorization AND signs if approved
   - The signed payload includes the authority chain for audit

7. **Integrate with your agent runtime:**
   - Before any purchase action, your agent should call the sidecar
   - Example: Python agent, TypeScript agent, curl-based agent
   - The sidecar is HTTP — any language works

8. **Connect to the rules engine (optional):**
   - Set `RULES_ENGINE_URL` to enable policy-based authorization instead of hardcoded limits
   - Without it, the sidecar uses built-in spending limits

### `docs/guides/vendor-integration.md`

**Audience:** E-commerce/SaaS vendors who want to accept governed agent purchases.

**Contents:**

1. **Overview** — what the storefront SDK does (adds agent checkout to your existing server)

2. **Install:** `npm install @warranted/storefront-sdk`

3. **Mount on your server:**
   ```typescript
   import { WarrantedSDK } from "@warranted/storefront-sdk";

   const sdk = new WarrantedSDK({
     vendorId: "your-vendor-id",
     registryUrl: "https://registry.warranted.io",
     webhookSecret: process.env.WEBHOOK_SECRET,
     minTrustScore: 600,
     catalog: [
       { sku: "gpu-hours-100", name: "100 GPU Hours", price: 2500, currency: "USD", category: "compute", available: true },
     ],
   });
   ```

4. **Add to your Hono/Express/Fastify routes:**
   - Discovery: `/.well-known/agent-storefront.json`
   - Catalog: `/agent-checkout/catalog`
   - Sessions: `/agent-checkout/sessions`
   - Settlement: `/agent-checkout/sessions/:id/settle`

5. **What happens when an agent purchases:**
   - Agent discovers your storefront via `.well-known`
   - Agent browses catalog
   - Agent creates a session (presents JWT)
   - SDK verifies identity (10-step chain) and authorization
   - Settlement produces a signed receipt

6. **Webhooks** — `onSettlement` callback for your fulfillment logic

7. **Testing** — how to test with a mock agent (curl examples)

### `docs/guides/policy-admin.md`

**Audience:** Compliance teams managing agent governance policies.

**Contents:**

1. **Overview** — what the policy system does (Cedar-based authorization with group hierarchy)

2. **Deploy the API + dashboard:**
   - API: Docker image + Postgres
   - Dashboard: Vercel/Netlify with `NEXT_PUBLIC_API_URL`

3. **Create your organization and group hierarchy:**
   - API calls to create org, departments, teams
   - Assign agents to groups

4. **Create policies:**
   - Spending limits, vendor allowlists, category restrictions
   - Explain the constraint format (numeric, set, boolean, temporal, rate)
   - Show how Cedar source is auto-generated

5. **Assign policies to groups:**
   - Org-level policies apply to everyone
   - Department-level narrows further
   - Team-level is most restrictive
   - Intersection semantics: constraints only narrow, never widen

6. **Test with the REPL:**
   - Open the dashboard → Agents → select agent → Test tab
   - Select action type, fill dimensions, click Test
   - See Allow/Deny with full breakdown

7. **Audit:**
   - Decision log: every authorization check is recorded
   - Bundle hash: proves which policies governed each decision
   - Envelope viewer: see exactly what an agent can do and why

8. **Advanced: deny policies, rate limits, expiry**

---

## 5. Production Docker Compose

### `docker-compose.production.yml`

Example production-like deployment using built images (not volume mounts).

```yaml
services:
  postgres:
    image: postgres:16
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
    image: warranted/rules-engine-api:latest
    environment:
      DATABASE_URL: postgresql://warranted:${POSTGRES_PASSWORD}@postgres:5432/warranted
      PORT: "3000"
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy

  sidecar:
    image: warranted/governance-sidecar:latest
    environment:
      ED25519_SEED: ${ED25519_SEED}
      RULES_ENGINE_URL: http://api:3000/api/policies/check
      PORT: "8100"
    ports:
      - "8100:8100"
    depends_on:
      - api

  dashboard:
    image: warranted/dashboard:latest
    environment:
      NEXT_PUBLIC_API_URL: http://api:3000
      PORT: "3001"
    ports:
      - "3001:3001"
    depends_on:
      - api

volumes:
  postgres_data:
```

This is a **reference deployment**, not the only way to run Warranted. Each service can be deployed independently.

---

## 6. Reorganize OpenClaw Material

### Move to `examples/openclaw/`

```
examples/
└── openclaw/
    ├── README.md              — how to run the OpenClaw demo
    ├── docker-compose.yml     — OpenClaw gateway + all Warranted services
    ├── skills/
    │   └── warranted-identity/
    │       └── SKILL.md       — OpenClaw skill for governed purchasing
    ├── scripts/
    │   ├── demo-vendor-server.ts
    │   └── demo-storefront.ts
    └── config/
        └── openclaw-gateway.yml
```

### What stays in the repo root

- `packages/` — npm packages (storefront-sdk, rules-engine)
- `apps/` — deployable services (api, dashboard)
- `sidecar/` — governance sidecar
- `docs/` — specs, plans, guides
- `docker-compose.production.yml` — reference deployment

### What moves

| From | To |
|---|---|
| `skills/warranted-identity/` | `examples/openclaw/skills/warranted-identity/` |
| `scripts/demo-vendor-server.ts` | `examples/openclaw/scripts/demo-vendor-server.ts` |
| `scripts/demo-storefront.ts` | `examples/openclaw/scripts/demo-storefront.ts` |

### `examples/openclaw/README.md`

Explains:
- What OpenClaw is
- How to run the full demo (Docker Compose with OpenClaw + all Warranted services)
- The demo purchasing prompt
- This is ONE integration example — Warranted works with any agent platform

---

## 7. Root README.md

Replace the current root README with a project overview that links to each component:

```markdown
# Warranted

Compliance-first transaction infrastructure for enterprise AI agent commerce.

## Components

| Component | Description | Quick Start |
|---|---|---|
| [@warranted/storefront-sdk](./packages/storefront-sdk/) | SDK for vendors to accept governed agent purchases | `npm install @warranted/storefront-sdk` |
| [@warranted/rules-engine](./packages/rules-engine/) | Cedar-based policy evaluation library | `npm install @warranted/rules-engine` |
| [Governance Sidecar](./sidecar/) | Defense-in-depth identity and authorization | `docker pull warranted/governance-sidecar` |
| [Rules Engine API](./apps/api/) | HTTP API for policy management | `docker pull warranted/rules-engine-api` |
| [Dashboard](./apps/dashboard/) | Admin UI for policy management | Deploy to Vercel |

## Guides

- [Agent Platform Integration](./docs/guides/agent-platform-integration.md)
- [Vendor Integration](./docs/guides/vendor-integration.md)
- [Policy Administration](./docs/guides/policy-admin.md)

## Examples

- [OpenClaw Integration](./examples/openclaw/) — demo of governed agent purchasing with OpenClaw
```

---

## Deliverables Summary

| # | Deliverable | Type |
|---|---|---|
| 1 | `packages/storefront-sdk/package.json` — publishConfig | Config |
| 2 | `packages/rules-engine/package.json` — publishConfig | Config |
| 3 | `sidecar/Dockerfile` | Docker |
| 4 | `sidecar/README.md` | Docs |
| 5 | `apps/api/Dockerfile` | Docker |
| 6 | `apps/api/scripts/start.sh` | Script |
| 7 | `apps/api/src/push-schema.ts` | Script |
| 8 | `apps/api/src/seed-db.ts` | Script |
| 9 | `apps/api/README.md` | Docs |
| 10 | `apps/dashboard/Dockerfile` | Docker |
| 11 | `apps/dashboard/README.md` | Docs |
| 12 | `packages/storefront-sdk/README.md` | Docs |
| 13 | `packages/rules-engine/README.md` | Docs |
| 14 | `docs/guides/agent-platform-integration.md` | Docs |
| 15 | `docs/guides/vendor-integration.md` | Docs |
| 16 | `docs/guides/policy-admin.md` | Docs |
| 17 | `docker-compose.production.yml` | Docker |
| 18 | `examples/openclaw/` — moved demo material | Reorg |
| 19 | `examples/openclaw/README.md` | Docs |
| 20 | `examples/openclaw/docker-compose.yml` | Docker |
| 21 | Root `README.md` — project overview | Docs |

**No application code changes.** This is packaging, documentation, and deployment configuration only.

---

## Phases

### Phase 1: Dockerfiles + Startup Scripts

Create Dockerfiles for sidecar, API, and dashboard. Create `push-schema.ts`, `seed-db.ts`, and `start.sh` for the API. Verify each image builds and runs independently.

### Phase 2: README Files

Write README for each component (storefront-sdk, rules-engine, sidecar, api, dashboard). Each README should let someone use that component without reading any other file in the repo.

### Phase 3: Integration Guides

Write the three guides (agent platform, vendor, policy admin). These are the primary documentation for enterprise adoption.

### Phase 4: Reorganize + Production Compose

Move OpenClaw material to `examples/openclaw/`. Create `docker-compose.production.yml`. Update root README.

---

## Out of Scope

- CI/CD pipelines (GitHub Actions for Docker builds, npm publish)
- Domain names, SSL, cloud deployment automation
- npm org setup (@warranted scope)
- Docker Hub org setup
- Changelog, versioning strategy
- License file (should exist but not specified here)
- API authentication (deferred per rules engine spec)
