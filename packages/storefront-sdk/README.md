# @warranted/storefront-sdk

> **v0.1 — API may change.** Core exports are stable but details may shift before v1.0.

SDK for vendors to accept governed AI agent transactions. Adds agent checkout to your existing server with identity verification, authorization checks, and signed receipts.

## Installation

```bash
npm install @warranted/storefront-sdk
```

## Try It (Mock Mode)

```typescript
import { WarrantedSDK, MockRegistryClient } from "@warranted/storefront-sdk";

const mockRegistry = new MockRegistryClient(new Map());
const sdk = new WarrantedSDK({
  vendorId: "vendor-acme-001",
  registryUrl: "http://localhost:8100",
  webhookSecret: "test-secret",
}, mockRegistry);

// Mount on any server that supports the Fetch API
Bun.serve({ port: 4000, fetch: (req) => sdk.fetch(req) });
// GET http://localhost:4000/.well-known/agent-storefront.json
```

## Production Setup

```typescript
import { WarrantedSDK, SidecarRegistryClient } from "@warranted/storefront-sdk";

const registry = new SidecarRegistryClient("http://warranted-sidecar:8100");
const sdk = new WarrantedSDK({
  vendorId: "vendor-acme-001",
  registryUrl: "http://warranted-sidecar:8100",
  webhookSecret: process.env.WEBHOOK_SECRET!,
  minTrustScore: 400,
  acceptedPayment: ["warranted-credits", "usdc"],
  supportedTransactionTypes: ["fixed-price", "negotiated"],
  jurisdiction: "US",
  termsUrl: "https://acme.example/terms",
  sessionTtlSeconds: 1800,
  catalog: [
    { sku: "gpu-100", name: "100 GPU Hours", price: 2500, category: "compute" },
  ],
}, registry);

// Hono
import { Hono } from "hono";
const app = new Hono();
app.route("/", sdk.routes());
export default app;

// Or raw fetch
Bun.serve({ port: 4000, fetch: (req) => sdk.fetch(req) });
```

## Configuration

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `vendorId` | `string` | Yes | — | Unique vendor identifier |
| `registryUrl` | `string` (URL) | Yes | — | Warranted registry or sidecar URL |
| `webhookSecret` | `string` | Yes | — | Secret for signing webhook payloads |
| `webhookUrl` | `string` (URL) | No | — | URL to receive settlement/dispute webhooks |
| `minTrustScore` | `number` (0–1000) | No | `0` | Minimum agent trust score to transact |
| `acceptedPayment` | `string[]` | No | `["warranted-credits"]` | Accepted payment methods |
| `supportedTransactionTypes` | `("fixed-price" \| "negotiated")[]` | No | `["fixed-price"]` | Transaction types this storefront supports |
| `jurisdiction` | `string` | No | `"US"` | Legal jurisdiction for compliance |
| `termsUrl` | `string` (URL) | No | — | Link to vendor terms of service |
| `sessionTtlSeconds` | `number` | No | `3600` | Transaction session time-to-live |
| `catalog` | `CatalogItem[]` | No | — | Product catalog for the storefront |

## Verification Flow

When an agent makes a request, the SDK runs a 10-step verification chain:

**Identity (Steps 1–6)**
1. Extract `Authorization: Bearer <jwt>` header
2. Decode JWT claims (without verification) to get the agent DID
3. Check `exp` (expired?) and `iat` (clock skew attack?)
4. Look up agent in the registry by DID
5. Verify JWT signature against the registry's Ed25519 public key
6. Check lifecycle state — must be `active`

**Authorization (Steps 7–10)**
7. Check trust score against storefront's `minTrustScore`
8. Check transaction amount against agent's `spendingLimit`
9. Check vendor is in agent's `approvedVendors` list
10. *(Optional)* Forward to rules engine for Cedar policy evaluation

## Key Exports

| Export | Description |
|---|---|
| `WarrantedSDK` | Main SDK class — handles routing, sessions, receipts |
| `createVerificationMiddleware` | Standalone middleware for custom servers |
| `MockRegistryClient` | In-memory registry for testing (no sidecar needed) |
| `SidecarRegistryClient` | HTTP client for the governance sidecar |
| `verifyIdentity` | Identity verification (steps 1–6) |
| `verifyAuthorization` | Two-phase authorization (local + engine) |
| `localAuthorizationCheck` | JWT claims check only (no network) |
| `engineAuthorizationCheck` | Cedar policy evaluation via rules engine |
| `SessionManager` | Transaction session lifecycle |
| `ReceiptGenerator` | Signed transaction receipts |
| `WebhookEmitter` | Settlement, dispute, and refund event callbacks |

## Error Codes

| Code | HTTP | Description |
|---|---|---|
| `NO_TOKEN` | 401 | Missing Authorization header |
| `INVALID_TOKEN` | 401 | Malformed or unparseable JWT |
| `TOKEN_EXPIRED` | 401 | JWT has expired |
| `UNKNOWN_AGENT` | 401 | DID not found in registry |
| `INVALID_SIGNATURE` | 401 | Ed25519 signature verification failed |
| `AGENT_INACTIVE` | 403 | Agent lifecycle state is not active |
| `TRUST_SCORE_LOW` | 403 | Agent trust score below storefront minimum |
| `OVER_LIMIT` | 403 | Transaction amount exceeds spending limit |
| `VENDOR_NOT_APPROVED` | 403 | Vendor not in agent's approved list |
| `CATEGORY_DENIED` | 403 | Category not in agent's permitted list |
| `SESSION_NOT_FOUND` | 404 | Transaction session does not exist |
| `SESSION_EXPIRED` | 409 | Transaction session TTL has elapsed |
| `SESSION_INVALID_STATE` | 409 | Action not valid for current session status |
| `INVALID_ITEMS` | 422 | Requested SKUs not found or unavailable |
| `REGISTRY_UNREACHABLE` | 500 | Cannot reach the platform registry |
| `SETTLEMENT_FAILED` | 500 | Settlement processing error |

All errors extend `WarrantedError` and include `.toResponse()` (JSON) and `.toHTTPResponse()` (Web Response) methods.

## License

Apache-2.0
