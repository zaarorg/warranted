# Vendor Integration Guide

Add governed AI agent checkout to your existing server. The Warranted Storefront SDK verifies agent identity, checks authorization, and produces signed receipts for every transaction.

## Quick Start

```bash
# 1. Install
npm install @warranted/storefront-sdk

# 2. Create server (save as server.ts)
cat << 'EOF' > server.ts
import { Hono } from "hono";
import { WarrantedSDK } from "@warranted/storefront-sdk";

const sdk = new WarrantedSDK({
  vendorId: "vendor-acme-001",
  registryUrl: "http://localhost:8100",
  webhookSecret: "whsec_test_secret",
  minTrustScore: 200,
  catalog: [
    { sku: "gpu-hours-100", name: "100 GPU Hours", price: 2500, category: "compute" }
  ],
});

const app = new Hono();
app.route("/", sdk.routes());
export default { port: 3001, fetch: app.fetch };
EOF

# 3. Start
bun run server.ts

# 4. Verify manifest
curl http://localhost:3001/.well-known/agent-storefront.json

# 5. Browse catalog
curl http://localhost:3001/agent-checkout/catalog
```

---

## Overview

The Warranted Storefront SDK handles the full agent verification pipeline for your server: identity verification (Ed25519 DID), JWT validation, trust score gating, spending limit checks, session management, and signed receipt generation. You configure it once, mount the routes, and your server accepts governed agent purchases.

---

## Install

```bash
npm install @warranted/storefront-sdk
# or
bun add @warranted/storefront-sdk
```

---

## Mount on Your Server

### Hono (primary)

```typescript
import { Hono } from "hono";
import { WarrantedSDK } from "@warranted/storefront-sdk";

const sdk = new WarrantedSDK({
  vendorId: "vendor-acme-001",
  registryUrl: "http://localhost:8100",
  webhookSecret: "whsec_your_secret",
  minTrustScore: 400,
  acceptedPayment: ["warranted-credits"],
  supportedTransactionTypes: ["fixed-price"],
  jurisdiction: "US",
  sessionTtlSeconds: 3600,
  catalog: [
    { sku: "gpu-hours-100", name: "100 GPU Hours", price: 2500, category: "compute" },
    { sku: "storage-1tb", name: "1TB Storage/Month", price: 500, category: "cloud-services" },
  ],
});

const app = new Hono();
app.route("/", sdk.routes());

export default { port: 3001, fetch: app.fetch };
```

### Express

```typescript
import express from "express";
import { WarrantedSDK } from "@warranted/storefront-sdk";

const sdk = new WarrantedSDK({
  vendorId: "vendor-acme-001",
  registryUrl: "http://localhost:8100",
  webhookSecret: "whsec_your_secret",
  minTrustScore: 400,
  catalog: [
    { sku: "gpu-hours-100", name: "100 GPU Hours", price: 2500, category: "compute" },
  ],
});

const app = express();
// Mount the SDK's Hono routes via adapter
app.use("/", sdk.expressAdapter());
app.listen(3001);
```

---

## Configuration Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `vendorId` | Yes | — | Your unique vendor identifier |
| `registryUrl` | Yes | — | Sidecar URL for identity verification |
| `webhookSecret` | Yes | — | Secret for webhook signature verification |
| `webhookUrl` | No | — | URL to receive settlement webhooks |
| `minTrustScore` | No | `0` | Minimum trust score (0-1000) to accept agents |
| `acceptedPayment` | No | `["warranted-credits"]` | Payment methods accepted |
| `supportedTransactionTypes` | No | `["fixed-price"]` | Transaction types: `fixed-price`, `negotiated` |
| `jurisdiction` | No | `"US"` | Legal jurisdiction for compliance |
| `sessionTtlSeconds` | No | `3600` | Session expiration (seconds) |
| `termsUrl` | No | — | URL to terms of service |
| `catalog` | No | — | Array of catalog items |

For full type definitions, see the [storefront-sdk README](../../packages/storefront-sdk/README.md).

---

## Verification Flow

When an agent calls your storefront, the SDK performs this verification chain:

```
Request → Extract JWT → Verify signature → Check expiry → Lookup DID in registry
→ Verify lifecycle (active) → Check trust score → Validate spending limit
→ Confirm vendor approval → Verify category → Create session
```

If any step fails, the SDK returns a structured error with one of these codes:

| Error Code | HTTP Status | Meaning |
|------------|-------------|---------|
| `NO_TOKEN` | 401 | Missing Authorization header |
| `INVALID_TOKEN` | 401 | JWT signature verification failed |
| `TOKEN_EXPIRED` | 401 | JWT `exp` claim is in the past |
| `UNKNOWN_AGENT` | 401 | DID not found in registry |
| `INVALID_SIGNATURE` | 401 | Ed25519 signature mismatch |
| `AGENT_INACTIVE` | 403 | Agent lifecycle state is not "active" |
| `TRUST_SCORE_LOW` | 403 | Trust score below `minTrustScore` |
| `OVER_LIMIT` | 403 | Amount exceeds agent's spending limit |
| `VENDOR_NOT_APPROVED` | 403 | Your vendor ID not in agent's approved list |
| `CATEGORY_DENIED` | 403 | Item category not in agent's permitted categories |
| `SESSION_NOT_FOUND` | 404 | Session ID does not exist |
| `SESSION_EXPIRED` | 403 | Session TTL exceeded |
| `SESSION_INVALID_STATE` | 403 | Session not in correct state for operation |
| `INVALID_ITEMS` | 400 | Invalid item data in request |
| `REGISTRY_UNREACHABLE` | 503 | Cannot reach sidecar/registry |
| `SETTLEMENT_FAILED` | 500 | Settlement processing error |

---

## Session Lifecycle

### 1. Create Session

```bash
curl -X POST http://localhost:3001/agent-checkout/session \
  -H "Authorization: Bearer <agent-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"items": [{"sku": "gpu-hours-100", "quantity": 1}]}'
```

**Response (201):**

```json
{
  "sessionId": "sess_a1b2c3d4",
  "status": "pending",
  "items": [{"sku": "gpu-hours-100", "name": "100 GPU Hours", "price": 2500, "category": "compute"}],
  "totalAmount": 2500,
  "expiresAt": "2026-04-11T16:00:00Z"
}
```

### 2. Get Session Status

```bash
curl http://localhost:3001/agent-checkout/session/sess_a1b2c3d4 \
  -H "Authorization: Bearer <agent-jwt>"
```

### 3. Settle

```bash
curl -X POST http://localhost:3001/agent-checkout/session/sess_a1b2c3d4/settle \
  -H "Authorization: Bearer <agent-jwt>"
```

**Response (200):**

```json
{
  "sessionId": "sess_a1b2c3d4",
  "status": "settled",
  "receipt": {
    "receiptId": "rcpt_x7y8z9",
    "totalAmount": 2500,
    "items": [{"sku": "gpu-hours-100", "name": "100 GPU Hours", "price": 2500}],
    "settledAt": "2026-04-11T15:05:00Z",
    "signature": "ed25519:base64-signature..."
  }
}
```

---

## Settlement Webhook

Configure `onSettlement` to be notified when a transaction settles (for order fulfillment):

```typescript
const sdk = new WarrantedSDK({
  vendorId: "vendor-acme-001",
  registryUrl: "http://localhost:8100",
  webhookSecret: "whsec_your_secret",
  webhookUrl: "https://your-server.com/webhooks/warranted",
  catalog: [...],
});

// In your webhook handler:
app.post("/webhooks/warranted", async (c) => {
  const event = await c.req.json();
  // event.type === "session.settled"
  // event.sessionId, event.receipt, event.items
  
  // Fulfill the order
  await fulfillOrder(event.items);
  await updateInventory(event.items);
  
  return c.json({ received: true });
});
```

---

## Testing Your Integration

### curl Protocol Walkthrough

Run these commands step by step to validate the full purchasing flow:

```bash
# Step 1: Get a JWT from the sidecar
TOKEN=$(curl -s -X POST http://localhost:8100/issue_token | jq -r '.token')
echo "Token: ${TOKEN:0:20}..."

# Step 2: Discover storefront
curl -s http://localhost:3001/.well-known/agent-storefront.json | jq .

# Step 3: Browse catalog
curl -s http://localhost:3001/agent-checkout/catalog \
  -H "Authorization: Bearer $TOKEN" | jq .

# Step 4: Create session
SESSION_ID=$(curl -s -X POST http://localhost:3001/agent-checkout/session \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"items": [{"sku": "gpu-hours-100", "quantity": 1}]}' | jq -r '.sessionId')
echo "Session: $SESSION_ID"

# Step 5: Settle
curl -s -X POST "http://localhost:3001/agent-checkout/session/$SESSION_ID/settle" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

### Automated Test Script

Use the included test script for CI or quick validation:

```bash
cd packages/storefront-sdk
bun run scripts/test-storefront.ts --url http://localhost:3001 --sidecar-url http://localhost:8100
```

Or with a pre-obtained token (for CI environments):

```bash
bun run scripts/test-storefront.ts --url http://localhost:3001 --token eyJhbGciOiJFZERTQSIs...
```

The script runs the full flow (discover → catalog → session → settle) and reports pass/fail for each step.

---

## Mock vs Production

### Development (MockRegistryClient)

No sidecar needed — use the built-in mock for development:

```typescript
import { WarrantedSDK, MockRegistryClient } from "@warranted/storefront-sdk";

const mockAgents = new Map([
  ["did:mesh:test-agent-001", {
    did: "did:mesh:test-agent-001",
    publicKey: "test-public-key",
    trustScore: 850,
    lifecycleState: "active",
    spendingLimit: 5000,
    approvedVendors: ["vendor-acme-001"],
    categories: ["compute", "cloud-services"],
  }],
]);

const sdk = new WarrantedSDK(
  {
    vendorId: "vendor-acme-001",
    registryUrl: "http://unused-in-mock",
    webhookSecret: "whsec_test",
    catalog: [...],
  },
  new MockRegistryClient(mockAgents)
);
```

### Production (Real Sidecar)

Point `registryUrl` at the running sidecar:

```typescript
const sdk = new WarrantedSDK({
  vendorId: "vendor-acme-001",
  registryUrl: "http://warranted-sidecar:8100",
  webhookSecret: process.env.WEBHOOK_SECRET!,
  minTrustScore: 400,
  catalog: [...],
});
```

The SDK calls `GET /check_identity` on the sidecar to verify agent DIDs, signatures, and trust scores.

---

## Next Steps

- [Agent Platform Integration Guide](./agent-platform-integration.md) — if you're building the agent side
- [Policy Administration Guide](./policy-admin.md) — if you need to manage policies centrally
- [Storefront SDK README](../../packages/storefront-sdk/README.md) — full API reference
