# Warranted

Compliance-first transaction infrastructure for enterprise AI agent commerce.

## Why Warranted

AI agents are gaining the ability to spend money autonomously. Today, an agent with API access can negotiate prices, accept terms, and execute purchases without any human oversight. For enterprises, this is a compliance nightmare: unapproved vendors, exceeded budgets, missing audit trails, and no way to prove what happened when something goes wrong.

Warranted provides the infrastructure that makes enterprise agent commerce safe. Every transaction passes through a governance layer that enforces spending policies, verifies counterparty identity, records a complete audit trail, and produces cryptographically signed receipts. The platform sells the "yes" from the compliance department: agents can transact freely within the boundaries their organization defines, and every decision is explainable and auditable.

## Architecture

```
                    Agents                          Vendors
                      |                               |
                      v                               v
              +---------------+             +-------------------+
              |  Governance   |             |  Storefront SDK   |
              |  Sidecar      |             |  (@warranted/     |
              |  (per agent)  |             |   storefront-sdk) |
              +-------+-------+             +---------+---------+
                      |                               |
                      v                               v
              +-------+-------------------------------+---------+
              |              Rules Engine API                    |
              |         (policy management + Cedar eval)         |
              +---------------------------+---------------------+
                                          |
                                          v
              +---------------------------+---------------------+
              |                    PostgreSQL                    |
              +-------------------------------------------------+
                                          |
              +---------------------------+---------------------+
              |                   Dashboard                     |
              |        (policy admin, envelope viewer, REPL)     |
              +-------------------------------------------------+
```

- **Governance Sidecar** — one per agent runtime. Ed25519 identity, authorization checks, transaction signing. Never exposed to the public internet.
- **Rules Engine API** — Cedar-based policy evaluation. Manages organizations, groups, agents, and policies with hierarchical inheritance.
- **Storefront SDK** — vendors mount this on their server to accept governed agent purchases. Verifies identity, authorization, and trust score.
- **Dashboard** — admin UI for compliance teams. Visualize agent envelopes, test authorization decisions, inspect Cedar source.

## Components

| Component | Description | Quick Start |
|---|---|---|
| [@warranted/storefront-sdk](./packages/storefront-sdk/) | SDK for vendors to accept governed agent purchases | `npm install @warranted/storefront-sdk` |
| [@warranted/rules-engine](./packages/rules-engine/) | Cedar-based policy evaluation library | `npm install @warranted/rules-engine` |
| [Governance Sidecar](./sidecar/) | Defense-in-depth identity and authorization | `docker pull warranted/governance-sidecar` |
| [Rules Engine API](./apps/api/) | HTTP API for policy management | `docker pull warranted/rules-engine-api` |
| [Dashboard](./apps/dashboard/) | Admin UI for policy management | Deploy to Vercel |

## Guides

| Guide | Audience |
|---|---|
| [Agent Platform Integration](./docs/guides/agent-platform-integration.md) | Teams deploying AI agents on any platform |
| [Vendor Integration](./docs/guides/vendor-integration.md) | Vendors accepting governed agent purchases |
| [Policy Administration](./docs/guides/policy-admin.md) | Compliance teams managing agent governance |

## Examples

- [OpenClaw Integration](./examples/openclaw/) — governed agent purchasing demo with OpenClaw

## Quick Start (Production)

```bash
# 1. Clone and configure
git clone https://github.com/warranted/warranted.git
cd warranted
cp .env.example .env
# Edit .env with your values

# 2. Start all services
docker compose -f docker-compose.production.yml up -d

# 3. Open dashboard
open http://localhost:3001
```

For development or demo use:

```bash
docker compose -f docker-compose.demo.yml up
```

## License

Apache-2.0
