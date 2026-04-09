# API Contracts & Schemas

## General Principles

- The Hono backend serves a REST API for the Next.js dashboard and the Agent/Storefront SDKs.
- All database operations use Drizzle ORM with typed schemas.
- All timestamps are ISO 8601 / RFC 3339 format.
- All API responses follow `{ success: boolean, data?: T, error?: string }`.
- Agent authentication via JWT in `Authorization: Bearer <token>` header.
- The governance sidecar is called via HTTP — never import Python from TypeScript.

## Internal Data Types

### Agent Token Claims (JWT Payload)

```typescript
interface AgentTokenClaims {
  sub: string;                    // agent DID (did:mesh:abc123...)
  iss: string;                    // platform issuer URL
  exp: number;                    // expiration timestamp
  iat: number;                    // issued at timestamp
  agentId: string;                // human-readable agent name
  ownerId: string;                // entity/business owner ID
  parentDid: string;              // parent token's DID (for hierarchy)
  authorityChain: string[];       // full chain: [cfo-did, vp-did, agent-did]
  spendingLimit: number;          // max per-transaction amount in USD
  dailySpendLimit: number;        // rolling 24-hour ceiling
  categories: string[];           // permitted purchase categories
  approvedVendors: string[];      // allowed vendor IDs
  transactionTypes: string[];     // "fixed-price" | "negotiated" | "barter"
}
```

### Transaction Session

```typescript
interface TransactionSession {
  sessionId: string;
  status: "identity" | "context" | "negotiation" | "settlement" | "complete" | "disputed" | "cancelled";
  
  buyer: {
    did: string;
    agentId: string;
    owner: string;
    authorityChain: string[];
    spendingLimit: number;
    trustScore: number;
  };
  
  vendor: {
    id: string;
    name: string;
    jurisdiction: string;
  };
  
  items: Array<{
    sku: string;
    name: string;
    amount: number;
    category: string;
  }>;
  
  compliance: {
    policyVersion: string;
    rulesEvaluated: string[];
    allPassed: boolean;
    transcriptHash: string;
    humanApprovalRequired: boolean;
    humanApproved: boolean | null;
    coolingOffExpires: string | null;
  };
  
  negotiation: {
    messages: NegotiationMessage[];
    agreedTerms: Record<string, unknown> | null;
  };
  
  settlement: {
    method: "internal-ledger" | "usdc-base" | "x402";
    settledAt: string | null;
    receiptId: string | null;
  };
  
  timestamps: {
    createdAt: string;
    identityVerifiedAt: string | null;
    contextSetAt: string | null;
    agreementReachedAt: string | null;
    settledAt: string | null;
  };
}
```

### Negotiation Message Protocol

```typescript
type NegotiationMessage =
  | { type: "offer"; from: string; amount: number; terms: Record<string, unknown>; timestamp: string }
  | { type: "counteroffer"; from: string; amount: number; terms: Record<string, unknown>; reason: string; timestamp: string }
  | { type: "accept"; from: string; finalAmount: number; finalTerms: Record<string, unknown>; timestamp: string }
  | { type: "reject"; from: string; reason: string; timestamp: string }
  | { type: "info_request"; from: string; question: string; timestamp: string }
  | { type: "info_response"; from: string; answer: string; data?: Record<string, unknown>; timestamp: string };
```

### Transaction Receipt

```typescript
interface TransactionReceipt {
  receiptId: string;
  transactionHash: string;        // on-chain anchor hash (post-demo)
  
  buyer: {
    did: string;
    agentId: string;
    owner: string;
    authorityChain: string[];
  };
  
  vendor: {
    id: string;
    name: string;
    jurisdiction: string;
  };
  
  items: Array<{
    sku: string;
    name: string;
    amount: number;
    category: string;
  }>;
  
  totalAmount: number;
  currency: "usd";
  
  compliance: {
    policyVersion: string;
    rulesEvaluated: string[];
    allPassed: boolean;
    transcriptHash: string;
    humanApprovalRequired: boolean;
    humanApproved: boolean | null;
  };
  
  settlement: {
    method: "internal-ledger" | "usdc-base" | "x402";
    settledAt: string;
    confirmationId: string;
  };
  
  signatures: {
    agentSignature: string;       // Ed25519 sig from sidecar
    platformSignature: string;    // Platform's sig
  };
  
  createdAt: string;
}
```

### Storefront Manifest

```typescript
interface StorefrontManifest {
  name: string;
  version: "1.0";
  warrantedRegistry: string;      // registry API URL
  requiresAuth: boolean;
  minTrustScore: number;          // 0-1000
  acceptedPayment: string[];      // ["usdc", "warranted-credits"]
  catalogEndpoint: string;
  sessionEndpoint: string;
  supportedTransactionTypes: string[];
  termsUrl: string;
  jurisdiction: string;
}
```

## Sidecar API (Python FastAPI)

### GET /check_identity

```json
// Response 200
{
  "agent_id": "openclaw-agent-001",
  "did": "did:mesh:7b2f4a91e3...",
  "public_key": "ed25519:base64...",
  "trust_score": 850,
  "lifecycle_state": "active",
  "spending_limit": 5000,
  "daily_spend_limit": 10000,
  "approved_vendors": ["aws", "azure", "gcp", "github", "vercel", "railway"],
  "permitted_categories": ["compute", "software-licenses", "cloud-services", "api-credits"],
  "authority_chain": ["did:mesh:cfo-hash", "did:mesh:vp-eng-hash", "did:mesh:7b2f4a91e3..."],
  "status": "verified"
}
```

### POST /check_authorization

```
Query params: vendor, amount, category
```

```json
// Response 200 (authorized)
{
  "authorized": true,
  "reasons": ["within policy"],
  "requires_approval": true,
  "agent_id": "openclaw-agent-001",
  "did": "did:mesh:7b2f4a91e3...",
  "trust_score": 850,
  "vendor": "aws",
  "amount": 2500,
  "category": "compute"
}

// Response 200 (denied — note: still 200, the denial IS the data)
{
  "authorized": false,
  "reasons": [
    "Amount $6000 exceeds limit of $5000",
    "Vendor 'sketchy-vendor' not on approved list"
  ],
  "requires_approval": false,
  "agent_id": "openclaw-agent-001",
  "did": "did:mesh:7b2f4a91e3...",
  "trust_score": 850,
  "vendor": "sketchy-vendor",
  "amount": 6000,
  "category": "compute"
}
```

### POST /sign_transaction

```
Query params: vendor, amount, item, category
```

```json
// Response 200 (signed)
{
  "signed": true,
  "payload": {
    "agent_id": "openclaw-agent-001",
    "did": "did:mesh:7b2f4a91e3...",
    "vendor": "aws",
    "amount": 2500,
    "item": "gpu-hours-100",
    "timestamp": 1712678400.123,
    "nonce": "a7f3b2c1d4e5f6"
  },
  "signature": "ed25519:base64-signature..."
}

// Response 200 (denied)
{
  "signed": false,
  "reasons": ["Amount $6000 exceeds limit of $5000"]
}
```

### GET /verify_signature

```
Query params: payload (JSON string), signature
```

```json
// Response 200
{
  "valid": true,
  "signer_did": "did:mesh:7b2f4a91e3...",
  "payload_timestamp": "2026-04-09T15:00:00Z"
}
```

## REST API Endpoints (Hono Backend)

### Registry

```
POST /api/registry/entities
Body: { name, jurisdiction, kycVerified }
→ 201: { success: true, data: { entityId, ... } }

POST /api/registry/agents
Body: { entityId, agentId, parentDid, spendingLimit, categories, approvedVendors }
→ 201: { success: true, data: { did, token, ... } }

GET /api/registry/agents/:did
→ 200: { success: true, data: { did, publicKey, trustScore, lifecycleState, ... } }

POST /api/registry/agents/:did/revoke
→ 200: { success: true, data: { revoked: true, cascadeCount: 3 } }
```

### Transactions

```
POST /api/transactions
Body: { buyerDid, vendorId, transactionType, items }
→ 201: { success: true, data: { sessionId, status: "identity" } }

GET /api/transactions/:sessionId
→ 200: { success: true, data: TransactionSession }

POST /api/transactions/:sessionId/negotiate
Body: NegotiationMessage
→ 200: { success: true, data: { status, message } }

POST /api/transactions/:sessionId/settle
→ 200: { success: true, data: { receiptId, receipt: TransactionReceipt } }

GET /api/transactions/:sessionId/transcript
→ 200: { success: true, data: { messages: NegotiationMessage[], hash: string } }
```

### Ledger

```
GET /api/ledger/:agentDid/balance
→ 200: { success: true, data: { available: 5000, held: 2500, total: 7500 } }

POST /api/ledger/deposit
Body: { agentDid, amount }
→ 200: { success: true, data: { newBalance: 7500, transactionId } }

POST /api/ledger/reserve
Body: { agentDid, amount, transactionSessionId }
→ 200: { success: true, data: { reservationId, expiresAt } }
```

### Storefront SDK Endpoints (served by vendor's site)

```
GET /.well-known/agent-storefront.json
→ 200: StorefrontManifest

GET /agent-checkout/catalog
Headers: Authorization: Bearer <agent-jwt>
→ 200: { items: [...], pricing: "fixed" | "negotiable" }

POST /agent-checkout/session
Headers: Authorization: Bearer <agent-jwt>
Body: { items, transactionType }
→ 201: { sessionId, redirectUrl }
```

## Spending Policy YAML Schema

```yaml
version: "1.0"
name: string                      # policy name

rules:
  - name: string                  # rule identifier
    description: string           # human-readable explanation
    condition: string             # when this rule applies ("action == 'purchase'")
    action: "deny" | "escalate" | "hold"
    when: string                  # expression to evaluate
    message: string               # denial/escalation reason template
    hold_duration_minutes: number # only for action: hold

defaults:
  agent_spending_limit: number
  daily_spend_limit: number
  escalation_threshold: number
  cooling_off_threshold: number
  approved_vendors: string[]
  sanctioned_vendors: string[]
  agent_permitted_categories: string[]
```

## WebSocket Events (Transaction Feed)

```typescript
// Server → Dashboard
type TransactionEvent =
  | { type: "transaction.created"; sessionId: string; buyerDid: string; vendorId: string }
  | { type: "transaction.phase_changed"; sessionId: string; from: string; to: string }
  | { type: "transaction.policy_evaluated"; sessionId: string; rule: string; result: "pass" | "deny" | "escalate" }
  | { type: "transaction.settled"; sessionId: string; amount: number; receiptId: string }
  | { type: "transaction.disputed"; sessionId: string; reason: string }
  | { type: "agent.token_issued"; agentDid: string; parentDid: string }
  | { type: "agent.token_revoked"; agentDid: string; cascadeCount: number }
  | { type: "alert.spending_velocity"; agentDid: string; amountLast24h: number; limit: number }
  | { type: "alert.sidecar_unreachable"; agentDid: string; lastSeen: string };
```
