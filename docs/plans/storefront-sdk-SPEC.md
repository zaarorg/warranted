# Storefront SDK Specification

## Overview

The Warranted Storefront SDK (`@warranted/storefront-sdk`) enables any vendor to accept governed agent transactions with a few lines of code. It handles identity verification, authorization enforcement, session management, and receipt generation — the vendor only implements fulfillment.

This is the "Stripe side" of the platform. Stripe abstracts payment complexity. This SDK abstracts compliance complexity.

## Installation

```bash
npm install @warranted/storefront-sdk
# or
bun add @warranted/storefront-sdk
```

## Quick Start

```typescript
import { WarrantedSDK } from '@warranted/storefront-sdk';
import { Hono } from 'hono';

const app = new Hono();

const warranted = new WarrantedSDK({
  vendorId: 'vendor-acme-001',
  registryUrl: 'https://api.warranted.dev/registry',
  webhookUrl: 'https://acme.com/webhooks/warranted',
  webhookSecret: 'whsec_...',
  catalog: [
    {
      sku: 'gpu-hours-100',
      name: '100 GPU Hours (A100)',
      price: 2500,
      currency: 'usd',
      category: 'compute',
      available: true,
    },
  ],
});

// Mounts all SDK routes including /.well-known/agent-storefront.json
app.route('/', warranted.routes());

// Vendor implements fulfillment only
warranted.onSettlement(async (transaction) => {
  await provisionComputeHours(transaction.sku, transaction.agentDid);
});
```

---

## SDK Configuration

```typescript
interface WarrantedSDKConfig {
  // Required
  vendorId: string;                    // Vendor's registered ID on the platform
  registryUrl: string;                 // Platform registry API URL
  webhookSecret: string;               // HMAC secret for webhook signature verification

  // Optional
  webhookUrl?: string;                 // URL where the platform sends settlement/dispute events
  minTrustScore?: number;              // Minimum agent trust score to transact (default: 0)
  acceptedPayment?: string[];          // Accepted payment methods (default: ["warranted-credits"])
  supportedTransactionTypes?: string[];// "fixed-price" | "negotiated" (default: ["fixed-price"])
  jurisdiction?: string;               // Legal jurisdiction (default: "US")
  termsUrl?: string;                   // URL to machine-readable terms
  sessionTtlSeconds?: number;          // Transaction session expiry (default: 3600)
  catalog?: CatalogItem[];             // Static product catalog (alternative: dynamic catalog endpoint)
}
```

---

## Storefront Manifest

### `GET /.well-known/agent-storefront.json`

Auto-served by `warranted.routes()`. This is the discovery endpoint — agents and agent frameworks read this to understand what the storefront offers and what auth is required.

**Response:**

```json
{
  "name": "Acme Cloud Compute",
  "version": "1.0",
  "warranted_registry": "https://api.warranted.dev/registry",
  "requires_auth": true,
  "min_trust_score": 600,
  "accepted_payment": ["usdc", "warranted-credits"],
  "catalog_endpoint": "/agent-checkout/catalog",
  "session_endpoint": "/agent-checkout/session",
  "supported_transaction_types": ["fixed-price", "negotiated"],
  "terms_url": "/agent-checkout/terms.json",
  "jurisdiction": "US"
}
```

**Schema:**

```typescript
interface StorefrontManifest {
  name: string;                        // Human-readable storefront name
  version: "1.0";                      // Manifest spec version
  warranted_registry: string;          // Registry URL for identity verification
  requires_auth: boolean;              // Whether agents must present a JWT
  min_trust_score: number;             // Minimum trust score (0-1000) to transact
  accepted_payment: string[];          // Payment methods accepted
  catalog_endpoint: string;            // Relative path to catalog API
  session_endpoint: string;            // Relative path to session creation API
  supported_transaction_types: string[];// Transaction types supported
  terms_url: string;                   // Machine-readable terms of service
  jurisdiction: string;                // Legal jurisdiction code
}
```

---

## Verification Flow

Every request to `/agent-checkout/*` passes through the verification middleware. The middleware executes these steps in order and short-circuits on the first failure:

```
Agent request with Authorization: Bearer <jwt>
    │
    ├─[1] Extract JWT ─── missing? → 401 { code: "NO_TOKEN" }
    │
    ├─[2] Decode JWT claims ─── malformed? → 401 { code: "INVALID_TOKEN" }
    │     Extract: sub (DID), spendingLimit, categories,
    │     approvedVendors, authorityChain, exp, iat
    │
    ├─[3] Check expiration ─── expired? → 401 { code: "TOKEN_EXPIRED" }
    │     Reject if exp < now or iat > now + 24h
    │
    ├─[4] Registry lookup ─── not found? → 401 { code: "UNKNOWN_AGENT" }
    │     GET {registryUrl}/agents/{did}
    │     Returns: public_key, trust_score, lifecycle_state, owner
    │
    ├─[5] Verify signature ─── invalid? → 401 { code: "INVALID_SIGNATURE" }
    │     Ed25519 verification against registered public key
    │
    ├─[6] Check lifecycle ─── not active? → 403 { code: "AGENT_INACTIVE", state }
    │     Must be "active" (not "suspended" or "revoked")
    │
    ├─[7] Check trust score ─── too low? → 403 { code: "TRUST_SCORE_LOW", score, min }
    │     agent.trust_score >= storefront.min_trust_score
    │
    ├─[8] Check spending limit ─── insufficient? → 403 { code: "OVER_LIMIT", limit, requested }
    │     request.amount <= agent.spendingLimit
    │
    ├─[9] Check vendor approval ─── not approved? → 403 { code: "VENDOR_NOT_APPROVED", vendor }
    │     storefront.vendorId in agent.approvedVendors
    │
    ├─[10] Check category ─── not permitted? → 403 { code: "CATEGORY_DENIED", category }
    │      item.category in agent.categories
    │
    └─[✓] All checks pass → attach verified context to request, continue
```

### Verification Functions

```typescript
// Core verification — called by middleware, also available standalone

async function verifyIdentity(
  jwt: string,
  registryUrl: string
): Promise<VerifiedAgent | VerificationError>;

function verifySignature(
  jwt: string,
  publicKey: Uint8Array
): boolean;

function verifyAuthorization(
  agent: VerifiedAgent,
  transaction: { amount: number; vendorId: string; category: string }
): AuthorizationResult;

function verifyTrustScore(
  agentScore: number,
  minimumScore: number
): boolean;
```

### Verified Agent Context

After verification passes, the middleware attaches this context to the request for downstream handlers:

```typescript
interface VerifiedAgentContext {
  did: string;                         // Agent's DID (did:mesh:...)
  agentId: string;                     // Human-readable agent name
  owner: string;                       // Entity that owns this agent
  authorityChain: string[];            // Full delegation chain
  spendingLimit: number;               // Max transaction amount
  dailySpendLimit: number;             // Rolling 24h ceiling
  categories: string[];                // Permitted purchase categories
  approvedVendors: string[];           // Allowed vendor IDs
  trustScore: number;                  // Current trust score (0-1000)
  lifecycleState: "active";            // Always "active" post-verification
  publicKey: string;                   // Base64-encoded Ed25519 public key
  tokenExp: number;                    // Token expiration timestamp
}
```

---

## Catalog

### `GET /agent-checkout/catalog`

**Headers:** `Authorization: Bearer <agent-jwt>` (verified by middleware)

Returns the storefront's product catalog in a structured, agent-readable format.

**Response:**

```json
{
  "vendor": "vendor-acme-001",
  "pricing": "fixed",
  "items": [
    {
      "sku": "gpu-hours-100",
      "name": "100 GPU Hours (A100)",
      "price": 2500,
      "currency": "usd",
      "category": "compute",
      "available": true,
      "metadata": {
        "gpu_type": "A100",
        "region": "us-east-1"
      }
    }
  ]
}
```

**Schema:**

```typescript
interface CatalogItem {
  sku: string;                         // Unique product identifier
  name: string;                        // Human/agent-readable name
  price: number;                       // Price in smallest currency unit (cents for USD)
  currency: string;                    // ISO 4217 currency code
  category: string;                    // Category for authorization checks
  available: boolean;                  // Current availability
  metadata?: Record<string, unknown>;  // Vendor-specific product data
}

interface CatalogResponse {
  vendor: string;
  pricing: "fixed" | "negotiable";
  items: CatalogItem[];
}
```

**Static vs Dynamic Catalog:**

- Static: Pass `catalog` array in SDK config. Served directly from memory.
- Dynamic: Omit `catalog` from config. Implement `warranted.onCatalogRequest(handler)` to serve from your database.

```typescript
// Dynamic catalog example
warranted.onCatalogRequest(async (agentContext) => {
  const items = await db.products.findAvailable({
    category: { in: agentContext.categories },
    price: { lte: agentContext.spendingLimit },
  });
  return items;
});
```

---

## Transaction Sessions

### `POST /agent-checkout/session`

**Headers:** `Authorization: Bearer <agent-jwt>` (verified by middleware)

**Request:**

```json
{
  "items": [
    { "sku": "gpu-hours-100", "quantity": 1 }
  ],
  "transactionType": "fixed-price"
}
```

**Response (201):**

```json
{
  "sessionId": "txn_a1b2c3d4e5",
  "status": "identity_verified",
  "items": [
    {
      "sku": "gpu-hours-100",
      "name": "100 GPU Hours (A100)",
      "price": 2500,
      "category": "compute"
    }
  ],
  "totalAmount": 2500,
  "agentDid": "did:mesh:7b2f4a91e3...",
  "vendorId": "vendor-acme-001",
  "createdAt": "2026-04-09T15:30:00Z",
  "expiresAt": "2026-04-09T16:30:00Z"
}
```

### Session Schema

```typescript
interface TransactionSession {
  sessionId: string;                   // Unique session identifier (txn_ prefix)
  status: SessionStatus;               // Current phase
  
  // Parties
  agentDid: string;                    // Buyer agent's DID
  vendorId: string;                    // Vendor's registered ID
  
  // Cart
  items: CartItem[];                   // Items in the transaction
  totalAmount: number;                 // Total price
  
  // Governance (captured at session creation)
  agentAuthorityChain: string[];       // Full delegation chain snapshot
  agentSpendingLimit: number;          // Spending limit at time of session
  agentTrustScore: number;             // Trust score at time of session
  
  // Compliance
  jurisdiction: string;                // Vendor's jurisdiction
  transcriptHash: string | null;       // Hash of negotiation transcript (if negotiated)
  receiptId: string | null;            // Receipt ID (set after settlement)
  
  // Timestamps
  createdAt: string;                   // Session creation time (ISO 8601)
  expiresAt: string;                   // Session expiry (ISO 8601)
  settledAt: string | null;            // Settlement time (ISO 8601)
}

type SessionStatus =
  | "identity_verified"                // Agent verified, session created
  | "context_set"                      // Compliance context injected
  | "negotiating"                      // Active negotiation (negotiated transactions only)
  | "settling"                         // Settlement in progress
  | "complete"                         // Transaction finalized, receipt generated
  | "disputed"                         // Dispute opened
  | "cancelled"                        // Session cancelled or expired
  ;
```

### Session Lifecycle

```
POST /session         → identity_verified
                             │
                      ┌──────┴──────┐
                      │             │
               (fixed-price)  (negotiated)
                      │             │
                      │      POST /negotiate
                      │      ← → messages
                      │             │
                      └──────┬──────┘
                             │
                      POST /settle
                             │
                         settling
                             │
                    ┌────────┴────────┐
                    │                 │
               (success)          (failure)
                    │                 │
                complete          cancelled
                    │
              receipt generated
                    │
              webhook fired → vendor fulfills
```

### `POST /agent-checkout/session/:sessionId/settle`

**Headers:** `Authorization: Bearer <agent-jwt>`

Triggers settlement. The SDK verifies the agent's identity again (replay check with fresh nonce), confirms the session is still valid, and initiates settlement through the platform.

**Request:**

```json
{
  "paymentMethod": "warranted-credits",
  "signedPayload": "<base64-ed25519-signature-of-settlement-terms>"
}
```

**Response (200):**

```json
{
  "sessionId": "txn_a1b2c3d4e5",
  "status": "complete",
  "receiptId": "rcpt_x9y8z7w6",
  "settledAt": "2026-04-09T15:35:00Z",
  "confirmationId": "ledger_001_abc123"
}
```

---

## Receipts

Every completed transaction generates an immutable, structured receipt. Both the agent and vendor receive it.

```typescript
interface TransactionReceipt {
  receiptId: string;                   // Unique receipt ID (rcpt_ prefix)
  transactionHash: string;             // On-chain anchor hash (post-demo: empty string)
  
  buyer: {
    did: string;                       // Agent's DID
    agentId: string;                   // Human-readable agent name
    owner: string;                     // Entity owner
    authorityChain: string[];          // Full delegation chain at time of transaction
  };
  
  vendor: {
    id: string;                        // Vendor ID
    name: string;                      // Vendor display name
    jurisdiction: string;              // Legal jurisdiction
  };
  
  items: Array<{
    sku: string;
    name: string;
    amount: number;                    // Price per unit
    quantity: number;
    category: string;
  }>;
  
  totalAmount: number;                 // Total transaction amount
  currency: string;                    // Currency code
  
  compliance: {
    policyVersion: string;             // Version of spending policy evaluated
    rulesEvaluated: string[];          // Names of rules that were checked
    allPassed: boolean;                // Whether all rules passed
    transcriptHash: string;            // SHA-256 of negotiation transcript
    humanApprovalRequired: boolean;    // Whether HITL was triggered
    humanApproved: boolean | null;     // HITL decision (null if not required)
  };
  
  settlement: {
    method: "internal-ledger" | "usdc-base" | "x402";
    settledAt: string;                 // ISO 8601 settlement timestamp
    confirmationId: string;            // Ledger/chain confirmation ID
  };
  
  signatures: {
    agentSignature: string;            // Agent's Ed25519 signature of receipt hash
    platformSignature: string;         // Warranted platform's signature
  };
  
  createdAt: string;                   // Receipt creation time (ISO 8601)
}
```

**Immutability:** Receipts are append-only. No update or delete operations. The receipt hash is derived from all fields except `signatures`, then both parties sign the hash.

---

## Webhooks

The SDK sends webhooks to the vendor's `webhookUrl` for settlement events. All webhook payloads are signed with HMAC-SHA256 using the `webhookSecret`.

### Verification

```typescript
// Webhook signature is in the X-Warranted-Signature header
// Verify before processing:
const isValid = warranted.verifyWebhook(req.headers, req.body);
```

### Events

```typescript
// Settlement confirmed — vendor should fulfill the order
warranted.onSettlement(async (event: SettlementEvent) => {
  // event.sessionId, event.agentDid, event.items, event.totalAmount, event.receiptId
  await fulfillOrder(event);
});

// Dispute opened — vendor should pause fulfillment
warranted.onDispute(async (event: DisputeEvent) => {
  // event.sessionId, event.reason, event.openedBy
  await pauseFulfillment(event.sessionId);
});

// Refund processed — vendor should reverse fulfillment
warranted.onRefund(async (event: RefundEvent) => {
  // event.sessionId, event.amount, event.reason
  await reverseProvision(event.sessionId);
});
```

### Webhook Payload Schema

```typescript
interface WebhookPayload {
  event: "settlement.completed" | "dispute.opened" | "refund.processed";
  timestamp: string;                   // ISO 8601
  sessionId: string;
  data: SettlementEvent | DisputeEvent | RefundEvent;
}

interface SettlementEvent {
  sessionId: string;
  agentDid: string;
  vendorId: string;
  items: Array<{ sku: string; quantity: number; amount: number }>;
  totalAmount: number;
  receiptId: string;
  settlement: {
    method: string;
    confirmationId: string;
  };
}

interface DisputeEvent {
  sessionId: string;
  reason: string;
  openedBy: "buyer" | "vendor" | "platform";
  evidence?: string;
}

interface RefundEvent {
  sessionId: string;
  amount: number;
  reason: string;
  refundId: string;
}
```

---

## Error Responses

All errors return a consistent JSON structure:

```typescript
interface ErrorResponse {
  success: false;
  error: {
    code: string;                      // Machine-readable error code
    message: string;                   // Human-readable description
    details?: Record<string, unknown>; // Additional context
  };
}
```

### Error Codes

| HTTP | Code | Description |
|------|------|-------------|
| 401 | `NO_TOKEN` | Missing Authorization header |
| 401 | `INVALID_TOKEN` | Malformed or unparseable JWT |
| 401 | `TOKEN_EXPIRED` | JWT `exp` is in the past |
| 401 | `UNKNOWN_AGENT` | DID not found in registry |
| 401 | `INVALID_SIGNATURE` | Ed25519 signature verification failed |
| 403 | `AGENT_INACTIVE` | Agent lifecycle state is suspended or revoked |
| 403 | `TRUST_SCORE_LOW` | Agent trust score below storefront minimum |
| 403 | `OVER_LIMIT` | Transaction amount exceeds agent's spending limit |
| 403 | `VENDOR_NOT_APPROVED` | Storefront vendor not in agent's approved list |
| 403 | `CATEGORY_DENIED` | Product category not in agent's permitted categories |
| 404 | `SESSION_NOT_FOUND` | Transaction session does not exist |
| 409 | `SESSION_EXPIRED` | Transaction session TTL has elapsed |
| 409 | `SESSION_INVALID_STATE` | Action not valid for current session status |
| 422 | `INVALID_ITEMS` | Requested SKUs not found or unavailable |
| 500 | `REGISTRY_UNREACHABLE` | Cannot reach the platform registry |
| 500 | `SETTLEMENT_FAILED` | Settlement processing error |

---

## x402 Compatibility

The Storefront SDK is designed for forward compatibility with the x402 HTTP payment protocol (Coinbase + Cloudflare). When an agent hits a storefront without presenting a valid JWT:

1. The SDK responds with `HTTP 402 Payment Required`
2. The response includes `X-Payment-Required` headers specifying accepted payment methods and amounts
3. An x402-compatible agent can attach a USDC payment to the retry request
4. The SDK verifies the payment and proceeds with the transaction

This is a post-demo feature. For the demo, all transactions use the internal ledger via JWTs.

---

## Demo Scope vs Full Implementation

### Demo (build now)

- Manifest serving (`/.well-known/agent-storefront.json`)
- Verification middleware (steps 1-10)
- Static catalog serving
- Session creation
- Settlement webhook
- Receipt generation

### Post-Demo (build later)

- Dynamic catalog with `onCatalogRequest` handler
- Negotiated transaction flow
- x402 payment support
- USDC settlement via Coinbase Base
- Dispute and refund webhook handlers
- Multi-item cart with mixed categories
- Rate limiting per agent
- Webhook retry with exponential backoff