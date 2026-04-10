# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Warranted is a compliance-first transaction infrastructure for enterprise AI agent commerce — "Ramp + Stripe for Agents." It enables enterprise agents to transact with any counterparty (other agents, storefronts with an SDK plugin, APIs, or humans) with full identity verification, authorization enforcement, audit trails, and dispute resolution.

**Stack:** TypeScript (Bun) · Hono · PostgreSQL · Drizzle ORM · XState v5 · jose (JWT) · Next.js · Tailwind · shadcn/ui · Python (governance sidecar) · Microsoft Agent Governance Toolkit · Docker

**Do not suggest switching frameworks or languages.** The stack was chosen deliberately for full TypeScript coverage across backend, frontend, and SDKs, with a Python sidecar for AGT integration.

## Commands

### Build & Run
```bash
bun install                                    # Install dependencies
bun run dev                                    # Start dev server (Hono API)
bun run build                                  # Production build
bun run db:push                                # Push schema changes to Postgres
bun run db:studio                              # Open Drizzle Studio
```

### Testing
```bash
bun run test                                   # All tests (Vitest)
bun run test:unit                              # Unit tests only
bun run test:integration                       # Integration tests (needs running services)
bun run test -- --run sidecar                  # Sidecar-specific tests
```

### Linting & Formatting
```bash
bun run lint                                   # ESLint
bun run format                                 # Prettier
bun run typecheck                              # TypeScript type checking
```

### Governance Sidecar (Python)
```bash
cd sidecar
source ../.venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8100  # Run sidecar locally
python ../scripts/register_openclaw_agent.py    # Register an agent identity
```

### Docker (OpenClaw + Sidecar)
```bash
cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/openclaw
docker compose up -d                           # Start OpenClaw + sidecar
docker compose logs warranted-sidecar          # Check sidecar logs
docker compose exec openclaw-gateway curl -s http://warranted-sidecar:8100/check_identity  # Verify
docker compose run --rm openclaw-cli dashboard --no-open  # Get dashboard URL
docker compose restart openclaw-gateway        # Restart after config changes
```

### Frontend (Dashboard)
```bash
cd apps/dashboard
bun run dev                                    # Next.js dev server
bun run build                                  # Production build
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Yes | — | For OpenClaw agent LLM calls |
| `JWT_SECRET` | Yes | — | Secret for signing platform JWTs |
| `COINBASE_API_KEY` | No | — | CDP API key (post-demo USDC integration) |
| `PORT` | No | `3000` | Hono API server port |
| `SIDECAR_URL` | No | `http://localhost:8100` | Governance sidecar URL |

## Project Structure

```
warranted/
├── packages/
│   ├── registry/                    # Identity & Registry Service
│   │   ├── src/
│   │   │   ├── schema.ts           # Drizzle schema (entities, agents, tokens)
│   │   │   ├── tokens.ts           # JWT token issuance with hierarchical claims
│   │   │   ├── hierarchy.ts        # Parent-child token derivation, cascade revocation
│   │   │   └── verification.ts     # Token validation middleware
│   ├── engine/                      # Transaction Engine
│   │   ├── src/
│   │   │   ├── machine.ts          # XState v5 state machine (5-phase lifecycle)
│   │   │   ├── phases/             # Phase implementations
│   │   │   │   ├── identity.ts     # Phase 1: Identity & Verification
│   │   │   │   ├── context.ts      # Phase 2: Acknowledgement & Context
│   │   │   │   ├── negotiation.ts  # Phase 3: Negotiation & Agreement
│   │   │   │   ├── settlement.ts   # Phase 4: Settlement
│   │   │   │   └── dispute.ts      # Phase 5: Dispute Resolution
│   │   │   ├── compliance.ts       # Compliance context service (rules engine)
│   │   │   └── protocol.ts         # Structured negotiation message types
│   ├── ledger/                      # Internal Balance Tracking
│   │   ├── src/
│   │   │   ├── schema.ts           # Double-entry bookkeeping schema
│   │   │   ├── operations.ts       # Hold/escrow, deposit/withdrawal
│   │   │   └── reconcile.ts        # Balance reconciliation
│   ├── storefront-sdk/              # Vendor-Side SDK (npm package)
│   │   ├── src/
│   │   │   ├── middleware.ts        # Express/Hono middleware for verification
│   │   │   ├── verify.ts           # Identity + auth + trust score verification
│   │   │   ├── manifest.ts         # /.well-known/agent-storefront.json generator
│   │   │   ├── session.ts          # Transaction session management
│   │   │   ├── webhook.ts          # Settlement/dispute webhook handlers
│   │   │   └── receipt.ts          # Structured receipt generation
│   ├── agent-sdk/                   # Buyer-Side TypeScript SDK
│   │   ├── src/
│   │   │   ├── client.ts           # AgentTransactionClient
│   │   │   ├── search.ts           # Vendor discovery
│   │   │   └── negotiate.ts        # Negotiation helpers
├── apps/
│   ├── api/                         # Hono API server
│   │   └── src/
│   │       ├── index.ts            # Server entry point
│   │       ├── routes/             # API route handlers
│   │       └── middleware/         # Auth, logging, CORS
│   └── dashboard/                   # Next.js management UI
│       └── src/
│           ├── app/                # Next.js app router pages
│           └── components/         # React components (shadcn/ui)
├── sidecar/                         # Python governance sidecar
│   ├── server.py                   # FastAPI server (identity, auth, signing)
│   └── policies/
│       └── spending-policy.yaml    # Agent OS policy rules
├── skills/                          # OpenClaw skills (distributable)
│   └── warranted-identity/
│       └── SKILL.md                # Skill definition for OpenClaw agents
├── scripts/
│   └── register_openclaw_agent.py  # Agent registration script
├── docs/
│   └── agent-governance-toolkit/   # AGT reference documentation
├── requirements.txt                 # Python dependencies for sidecar
├── drizzle.config.ts               # Drizzle ORM configuration
└── vitest.config.ts                # Vitest configuration
```

## Architecture

### Transaction Lifecycle (5 Phases)

The core is an XState v5 state machine implementing a 5-phase transaction lifecycle:
1. **Identity & Verification** — Verify counterparty identities via signed JWT tokens, confirm authorization scope
2. **Acknowledgement & Context** — Inject compliance context, declare transaction type, enforce approved vendor lists
3. **Negotiation & Agreement** — Structured protocol (typed messages, not free-form), compliance boundaries enforced
4. **Settlement** — Receipt generation, full transcript as structured data, SOX audit trail entry
5. **Dispute Resolution** — Full transaction transcript available, evidence for legal representatives

### Token Hierarchy

JWTs carry hierarchical claims using the `jose` library:
- Each token is derived from a parent's authority scope
- Child tokens can only narrow parent scope, never widen it
- Revoking a parent revokes all derived children
- Claims include: identity, spending limits, category restrictions, approved vendors, authority chain, expiration

### Governance Sidecar

The Python sidecar (using Microsoft Agent Governance Toolkit) handles:
- Ed25519 cryptographic identity (real DIDs, not human-readable labels)
- Policy enforcement via Agent OS StatelessKernel
- Transaction signing with verifiable Ed25519 signatures
- Trust scoring on 0-1000 scale

### Storefront SDK

The vendor-side SDK verifies incoming agent requests:
- Extracts JWT from Authorization header
- Verifies DID against the platform registry
- Validates Ed25519 signature
- Checks spending limit, approved vendors, permitted categories
- Creates transaction session if all checks pass

## Key Design Decisions

- **Compliance is the moat** — The platform sells the "yes" from the compliance department. Every design decision prioritizes auditability and governance.
- **Payment-rail agnostic** — Internal ledger for demo, designed for USDC migration via Coinbase CDP post-demo.
- **Structured negotiation protocol** — Typed message format, not free-form chat. Prevents prompt injection in negotiation.
- **XState v5 for transaction engine** — Typed states, guards, persistent state. Use v5 patterns only, not v4.
- **Agent OS for identity** — Ed25519 DIDs from Microsoft AGT, not custom crypto. Production-grade identity infrastructure.
- **Sidecar architecture** — Governance runs as a separate process. Agent cannot tamper with its own identity or policies.
- **x402 compatibility** — Storefront SDK endpoints designed to be compatible with Coinbase's x402 payment protocol.

## Testing

- **Framework:** Vitest
- **Pattern:** Describe blocks with focused test cases
- **Deterministic tests** (no external services): Token issuance/validation, hierarchy enforcement, policy evaluation, receipt generation, manifest serving
- **Integration tests** (needs running services): Full transaction lifecycle, sidecar communication, OpenClaw skill integration
- **XState tests:** Use XState v5 testing utilities for state machine transitions and guard evaluation
- **Run deterministic tests on every commit. Integration tests before PR.**

## Git Workflow

### Conventional Commits

```
<type>(<scope>): <description>
```

**Types:** feat, fix, test, docs, refactor, chore, perf

**Scopes:** registry, engine, ledger, storefront-sdk, agent-sdk, dashboard, api, sidecar, skills, docker, docs, tests

**Rules:**
- Lowercase type and description. No period at end.
- Imperative mood: "add", "fix", "update" — not "added", "fixes", "updated".
- Keep the first line under 72 characters.

**Examples:**
```
feat(registry): add JWT token issuance with hierarchical claims
feat(engine): implement 5-phase XState transaction state machine
feat(storefront-sdk): add identity verification middleware
feat(sidecar): integrate AGT Ed25519 identity creation
test(engine): add XState model tests for compliance boundary enforcement
fix(registry): handle cascade revocation for expired parent tokens
chore(docker): add warranted-sidecar service to compose
docs: update CLAUDE.md with project architecture
```

### Commit Cadence

One logical unit of work = one commit. Don't batch unrelated changes. Don't commit half-finished features.

### Auto-Commit Behavior

**After every meaningful change, Claude Code MUST `git add` all relevant files and `git commit` with a conventional commit message.** Do not wait for the user to ask.

**Commit workflow:**
1. Complete the logical unit of work
2. Run `bun run typecheck` — fix any issues before committing
3. Run relevant tests (`bun run test`) — do not commit failing tests
4. `git add` all changed files related to this unit of work
5. `git commit -m "<type>(<scope>): <description>"`

**Do NOT commit:**
- Files that should be gitignored (.env, node_modules, .venv, __pycache__)
- Failing tests or code that doesn't pass typecheck
- Unrelated changes bundled into one commit
- API keys, tokens, or credentials

## Rules

- Use Drizzle for all database operations — no raw SQL except in migrations
- Use XState v5 patterns for the transaction engine — not v4
- Use `jose` for all JWT operations — no other JWT library
- Use Zod for all input validation on API endpoints
- All API responses follow `{ success: boolean, data?: T, error?: string }` shape
- All negotiation messages use the typed protocol, never free-form strings
- Token hierarchy: child tokens can ONLY narrow parent scope, never widen
- Sidecar communication is always HTTP — never import Python code from TypeScript
- Evidence file paths in receipts must be validated against actual transaction records
- Spending policies are loaded from YAML — never hardcode limits in application code
- Policy evaluation happens in the sidecar (Python/AGT), not in the TypeScript backend
- Keep CLAUDE.md under 50 instructions — put details in code-style.md, testing.md, security.md
- Always use Context7 MCP to look up library/API documentation when doing code generation — do not rely on training data for docs that may be stale
- See docs/agent-governance-toolkit/ for AGT API reference before implementing any identity or policy features
