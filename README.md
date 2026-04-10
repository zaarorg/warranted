# Warranted

Compliance-first transaction infrastructure for enterprise AI agent commerce — **Ramp + Stripe for Agents.**

Warranted enables enterprise agents to transact with any counterparty (other agents, storefronts, APIs, or humans) with full identity verification, authorization enforcement, audit trails, and dispute resolution.

## Why Warranted

AI agents are gaining the ability to spend money, but enterprises need guardrails before letting them transact autonomously. Warranted provides the "yes" from the compliance department by enforcing:

- **Hierarchical token authorization** — child agents can only narrow parent scope, never widen it
- **Policy-driven spending limits** — per-transaction caps, daily ceilings, vendor allowlists, category restrictions
- **Structured negotiation** — typed message protocol prevents prompt injection during price negotiation
- **Full audit trails** — every transaction phase is recorded with cryptographic receipts
- **Human-in-the-loop escalation** — high-value or first-time-vendor transactions require approval

## Architecture

```
                        +-----------------+
                        |   Dashboard     |
                        |   (Next.js)     |
                        +--------+--------+
                                 |
                        +--------v--------+
                        |   Hono API      |
                        |   (TypeScript)  |
                        +--------+--------+
                                 |
          +----------------------+----------------------+
          |                      |                      |
+---------v--------+  +----------v---------+  +---------v--------+
|  Registry        |  |  Transaction       |  |  Ledger          |
|  (Identity &     |  |  Engine            |  |  (Double-entry   |
|   JWT Tokens)    |  |  (XState v5)       |  |   bookkeeping)   |
+------------------+  +----------+---------+  +------------------+
                                 |
                      +----------v---------+
                      |  Governance        |
                      |  Sidecar (Python)  |
                      |  Ed25519 + AGT     |
                      +--------------------+
```

### Transaction Lifecycle (5 Phases)

1. **Identity & Verification** — verify counterparty identities via signed JWT tokens
2. **Acknowledgement & Context** — inject compliance context, enforce approved vendor lists
3. **Negotiation & Agreement** — structured protocol with compliance boundary guards
4. **Settlement** — receipt generation, transcript capture, SOX audit trail
5. **Dispute Resolution** — full transcript available for evidence review

### Governance Sidecar

A Python sidecar (Microsoft Agent Governance Toolkit) runs as a separate process so that agents cannot tamper with their own identity or policies:

- Ed25519 cryptographic identity (real DIDs, not human-readable labels)
- Policy enforcement via Agent OS StatelessKernel
- Transaction signing with verifiable Ed25519 signatures
- Trust scoring on a 0-1000 scale

### Storefront SDK

Vendor-side TypeScript SDK that verifies incoming agent requests:

- JWT extraction and DID verification against the platform registry
- Ed25519 signature validation
- Spending limit, vendor allowlist, and category enforcement
- Transaction session management with receipt generation

## Stack

| Layer | Technology |
|-------|-----------|
| Backend API | TypeScript, Bun, Hono |
| Transaction Engine | XState v5 |
| Database | PostgreSQL, Drizzle ORM |
| Auth / Tokens | jose (JWT with EdDSA) |
| Validation | Zod |
| Governance Sidecar | Python, FastAPI, Microsoft AGT |
| Frontend | Next.js, Tailwind, shadcn/ui |
| Containerization | Docker Compose |

## Project Structure

```
warranted/
├── packages/
│   └── storefront-sdk/          # Vendor-side SDK (identity verification, sessions, receipts)
├── apps/
│   ├── api/                     # Hono API server
│   └── dashboard/               # Next.js management UI
├── sidecar/                     # Python governance sidecar
│   ├── server.py                # FastAPI server (identity, auth, signing)
│   └── policies/
│       └── spending-policy.yaml # Agent spending rules
├── skills/
│   └── warranted-identity/      # OpenClaw skill for agent integration
├── scripts/
│   ├── demo-storefront.ts       # Demo client (happy + failure paths)
│   ├── demo-vendor-server.ts    # Demo vendor using storefront SDK
│   └── register_openclaw_agent.py
└── docs/                        # AGT reference documentation
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- [Python](https://www.python.org) (3.10+)
- [PostgreSQL](https://www.postgresql.org) (15+)
- [Docker](https://www.docker.com) (for sidecar integration)

### Setup

```bash
# Install TypeScript dependencies
bun install

# Set up environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL, JWT_SECRET, and ANTHROPIC_API_KEY

# Push database schema
bun run db:push
```

### Running

```bash
# Start the API server
bun run dev

# Start the governance sidecar (separate terminal)
cd sidecar
source ../.venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8100

# Start the dashboard (separate terminal)
cd apps/dashboard
bun run dev
```

### Docker (OpenClaw Integration)

```bash
cd ~/Documents/projects/ai_engineering/gauntlet-curriculum/capstone/openclaw
docker compose up -d
docker compose logs warranted-sidecar  # Verify sidecar is running
```

## Testing

```bash
bun run test              # All tests (Vitest)
bun run test:unit         # Unit tests only
bun run typecheck         # TypeScript type checking

# Sidecar tests
cd sidecar
pytest tests/
```

Tests cover:

- **Token hierarchy** — child cannot widen parent scope, cascade revocation
- **Transaction engine** — XState phase transitions, compliance guards
- **Spending policy** — limit enforcement, vendor/category restrictions, escalation
- **Storefront SDK** — identity verification, session lifecycle, receipt generation
- **Sidecar endpoints** — identity, authorization, signing, signature verification

## Spending Policy

Policies are defined in YAML and loaded at sidecar startup. The default policy includes:

| Rule | Action | Description |
|------|--------|-------------|
| Agent spending limit | Deny | Per-transaction cap (default $5,000) |
| Single transaction cap | Deny | Hard cap at $25,000 |
| Unapproved vendor | Deny | Only allowlisted vendors |
| Sanctioned vendor | Deny | Always blocked |
| Unauthorized category | Deny | Must be in permitted list |
| Rate limit | Deny | Max 10 transactions/hour |
| Daily spend ceiling | Deny | Rolling 24-hour limit (default $10,000) |
| High-value escalation | Escalate | Human approval above threshold |
| New vendor | Escalate | First transaction with a vendor |
| Large purchase hold | Hold | 30-minute cooling-off period |
| Price floor | Deny | Seller cannot accept below floor |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Yes | For agent LLM calls |
| `JWT_SECRET` | Yes | Platform JWT signing key |
| `PORT` | No | API server port (default: 3000) |
| `SIDECAR_URL` | No | Governance sidecar URL (default: http://localhost:8100) |
| `COINBASE_API_KEY` | No | For post-demo USDC integration |

## License

[MIT](LICENSE) - Copyright (c) 2026 Ryo "Leo" Iwata
