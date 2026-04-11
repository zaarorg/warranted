# OpenClaw Integration Example

This example demonstrates governed AI agent purchasing using [OpenClaw](https://openclaw.dev) as the agent platform and Warranted for compliance governance.

> This is **one integration example**. Warranted works with any agent platform that can make HTTP calls. See the [Agent Platform Integration Guide](../../docs/guides/agent-platform-integration.md) for the generic integration pattern.

## Running the Demo

From the repo root:

```bash
docker compose -f docker-compose.demo.yml up
```

This starts:
- **Postgres** — database for the rules engine
- **Rules Engine API** (port 3000) — policy management and Cedar evaluation
- **Governance Sidecar** (port 8100) — agent identity and authorization
- **Demo Vendor** (port 3001) — sample storefront running the Warranted SDK

## Demo Purchasing Flow

Once all services are running, open the OpenClaw gateway at `http://localhost:18789` and use this prompt:

```
Use the warranted-identity skill to buy 100 GPU hours from the demo vendor
storefront at http://demo-vendor:3001. Get a token from the sidecar, discover
the storefront, browse the catalog, create a session for gpu-hours-100, and
settle it. Use curl for all HTTP calls. Show me the receipt when done.
```

## What's in This Example

- `skills/warranted-identity/SKILL.md` — OpenClaw skill definition for governed purchasing
- `scripts/demo-vendor-server.ts` — demo vendor storefront using @warranted/storefront-sdk
- `scripts/demo-storefront.ts` — demo storefront discovery and test purchasing script
