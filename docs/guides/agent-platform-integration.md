# Agent Platform Integration Guide

Integrate Warranted's governance layer with any AI agent platform. Your agents get cryptographic identity (Ed25519 DIDs), authorization checks before every transaction, and signed audit trails.

## Quick Start

Five commands to a governed agent:

```bash
# 1. Run the sidecar
docker run -e ED25519_SEED=my-agent-seed -p 8100:8100 warranted/governance-sidecar

# 2. Get your agent's identity
curl http://localhost:8100/check_identity

# 3. Get a JWT for vendor authentication
curl -X POST http://localhost:8100/issue_token

# 4. Check authorization before a purchase
curl -X POST "http://localhost:8100/check_authorization?vendor=aws&amount=500&category=compute"

# 5. Sign a transaction
curl -X POST "http://localhost:8100/sign_transaction?vendor=aws&amount=500&item=gpu-hours-100&category=compute"
```

---

## Overview

Warranted provides three capabilities to any agent runtime:

1. **Identity** — Ed25519 DID-based cryptographic identity per agent. Not human-readable labels.
2. **Authorization** — Policy-checked spending limits, approved vendors, and permitted categories before every purchase.
3. **Audit** — Ed25519-signed transaction payloads with nonces, timestamps, and authority chains.

The governance sidecar runs as a separate process. Your agent cannot tamper with its own identity or policies — same isolation pattern as Envoy, Istio, or Dapr.

---

## Deploy the Sidecar

```bash
docker run \
  -e ED25519_SEED=my-agent-seed \
  -p 8100:8100 \
  warranted/governance-sidecar
```

The `ED25519_SEED` determines your agent's cryptographic identity. Same seed = same DID across restarts.

For full configuration options (environment variables, Docker Compose setup, health checks), see the [sidecar README](../../sidecar/README.md).

---

## Agent Identity Flow

On agent startup, call `GET /check_identity` to retrieve the agent's cryptographic identity:

```bash
curl http://localhost:8100/check_identity
```

**Response:**

```json
{
  "agent_id": "openclaw-agent-001",
  "did": "did:mesh:7b2f4a91e3...",
  "public_key": "base64-encoded-ed25519-public-key",
  "trust_score": 850,
  "trust_level": "trusted",
  "lifecycle_state": "active",
  "spending_limit": 5000,
  "approved_vendors": ["aws", "azure", "gcp", "github", "vercel", "railway"],
  "authority_chain": ["did:mesh:cfo-hash", "did:mesh:vp-eng-hash", "did:mesh:7b2f4a91e3..."],
  "status": "verified"
}
```

Store the `did` — you'll include it in all subsequent calls. The `authority_chain` traces delegation from your organization's CFO down to this agent.

---

## Get a JWT

Call `POST /issue_token` to get an EdDSA-signed JWT for authenticating with vendor storefronts:

```bash
curl -X POST http://localhost:8100/issue_token
```

**Response:**

```json
{
  "token": "eyJhbGciOiJFZERTQSIs...",
  "did": "did:mesh:7b2f4a91e3...",
  "expires_at": "2026-04-12T15:00:00Z"
}
```

The JWT has a 24-hour TTL and includes claims: `sub` (DID), `spendingLimit`, `dailySpendLimit`, `categories`, `approvedVendors`, and `authorityChain`.

Include this token in `Authorization: Bearer <token>` headers when calling vendor storefronts.

---

## Authorization Check

Before any purchase, call `POST /check_authorization` with the vendor, amount, and category:

```bash
curl -X POST "http://localhost:8100/check_authorization?vendor=aws&amount=2500&category=compute"
```

### Authorized (within policy):

```json
{
  "authorized": true,
  "reasons": ["within spending limit", "vendor on approved list", "category permitted"],
  "requires_approval": false,
  "agent_id": "openclaw-agent-001",
  "did": "did:mesh:7b2f4a91e3...",
  "trust_score": 850,
  "trust_level": "trusted",
  "vendor": "aws",
  "amount": 2500,
  "category": "compute"
}
```

### Authorized but requires human approval:

```json
{
  "authorized": true,
  "reasons": ["within spending limit but above escalation threshold"],
  "requires_approval": true,
  "agent_id": "openclaw-agent-001",
  "did": "did:mesh:7b2f4a91e3...",
  "trust_score": 850,
  "trust_level": "trusted",
  "vendor": "aws",
  "amount": 3000,
  "category": "compute"
}
```

### Denied:

```json
{
  "authorized": false,
  "reasons": ["Amount $6000 exceeds limit of $5000"],
  "requires_approval": false,
  "agent_id": "openclaw-agent-001",
  "did": "did:mesh:7b2f4a91e3...",
  "trust_score": 850,
  "trust_level": "trusted",
  "vendor": "aws",
  "amount": 6000,
  "category": "compute"
}
```

**Agent behavior:**
- `authorized: false` — abort the transaction, surface `reasons` to the human operator
- `requires_approval: true` — pause execution and escalate to a human approver before proceeding

---

## Sign Transactions

After authorization passes, call `POST /sign_transaction` to produce a signed, non-repudiable record:

```bash
curl -X POST "http://localhost:8100/sign_transaction?vendor=aws&amount=2500&item=gpu-hours-100&category=compute"
```

The sidecar re-checks authorization AND signs if approved.

**Response (signed):**

```json
{
  "signed": true,
  "payload": {
    "agent_id": "openclaw-agent-001",
    "did": "did:mesh:7b2f4a91e3...",
    "vendor": "aws",
    "amount": 2500,
    "item": "gpu-hours-100",
    "timestamp": 1712678400.123,
    "nonce": "a7f3b2c1d4e5f6ab"
  },
  "signature": "base64-encoded-ed25519-signature",
  "public_key": "base64-encoded-ed25519-public-key",
  "algorithm": "Ed25519"
}
```

**Response (denied):**

```json
{
  "signed": false,
  "reasons": ["Amount $6000 exceeds limit of $5000"]
}
```

The signed payload includes a unique `nonce` and `timestamp` — vendors reject replayed signatures.

---

## One Sidecar Per Agent Runtime

Deploy one sidecar instance per agent. Each instance derives its Ed25519 identity from the `ED25519_SEED` environment variable.

**Why one-per-agent:**
- Cryptographic isolation — no agent can sign as another agent
- Independent policy enforcement — compromise of one agent doesn't affect others
- Clear audit trail — every signature traces to exactly one identity

This is the same pattern as Envoy (one proxy per service), Istio (one sidecar per pod), and Dapr (one runtime per app). It's not a limitation — it's a security design choice.

---

## Connect to the Rules Engine (Optional)

By default, the sidecar uses hardcoded spending limits ($5000 per transaction, fixed approved vendors list). For dynamic, policy-based authorization:

```bash
docker run \
  -e ED25519_SEED=my-agent-seed \
  -e RULES_ENGINE_URL=http://api:3000/api/policies/check \
  -p 8100:8100 \
  warranted/governance-sidecar
```

With `RULES_ENGINE_URL` set, authorization checks are evaluated against Cedar policies managed through the [Policy Administration Guide](./policy-admin.md). This enables:

- Group-based policy hierarchy (org → department → team → agent)
- Dynamic policy updates without sidecar restart
- Cedar-based authorization with full audit trail

Without it, the sidecar works standalone with its built-in rules — useful for development and single-agent deployments.

---

## Integration Examples

### Python Agent

```python
import requests

SIDECAR = "http://localhost:8100"

# 1. Get identity on startup
identity = requests.get(f"{SIDECAR}/check_identity").json()
agent_did = identity["did"]
print(f"Agent DID: {agent_did}")

# 2. Check authorization before purchase
auth = requests.post(
    f"{SIDECAR}/check_authorization",
    params={"vendor": "aws", "amount": 2500, "category": "compute"}
).json()

if not auth["authorized"]:
    print(f"Denied: {auth['reasons']}")
    exit(1)

if auth["requires_approval"]:
    print("Requires human approval — escalating...")
    # ... escalation logic ...

# 3. Sign the transaction
signed = requests.post(
    f"{SIDECAR}/sign_transaction",
    params={"vendor": "aws", "amount": 2500, "item": "gpu-hours-100", "category": "compute"}
).json()

if signed["signed"]:
    print(f"Signed payload: {signed['payload']}")
    print(f"Signature: {signed['signature']}")
else:
    print(f"Signing denied: {signed['reasons']}")
```

### TypeScript Agent

```typescript
const SIDECAR = "http://localhost:8100";

// 1. Get identity on startup
const identity = await fetch(`${SIDECAR}/check_identity`).then(r => r.json());
const agentDid = identity.did;
console.log(`Agent DID: ${agentDid}`);

// 2. Check authorization before purchase
const auth = await fetch(
  `${SIDECAR}/check_authorization?vendor=aws&amount=2500&category=compute`,
  { method: "POST" }
).then(r => r.json());

if (!auth.authorized) {
  console.error(`Denied: ${auth.reasons.join(", ")}`);
  process.exit(1);
}

if (auth.requires_approval) {
  console.log("Requires human approval — escalating...");
  // ... escalation logic ...
}

// 3. Sign the transaction
const signed = await fetch(
  `${SIDECAR}/sign_transaction?vendor=aws&amount=2500&item=gpu-hours-100&category=compute`,
  { method: "POST" }
).then(r => r.json());

if (signed.signed) {
  console.log("Signature:", signed.signature);
  console.log("Payload:", signed.payload);
} else {
  console.error(`Signing denied: ${signed.reasons.join(", ")}`);
}
```

---

## Next Steps

- [Vendor Integration Guide](./vendor-integration.md) — if you're building the storefront side
- [Policy Administration Guide](./policy-admin.md) — if you need to manage policies centrally
- [Sidecar README](../../sidecar/README.md) — full configuration reference
