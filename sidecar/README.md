# Warranted Governance Sidecar

> **v0.1 — API may change.** Core exports are stable but details may shift before v1.0.

Defense-in-depth identity and authorization for AI agents. Each sidecar instance provides a unique Ed25519 identity, JWT issuance, authorization checks, and transaction signing.

## Quick Start

```bash
docker run -e ED25519_SEED=my-agent-seed -p 8100:8100 warranted/governance-sidecar

curl http://localhost:8100/check_identity
```

## One Sidecar Per Agent

Deploy one sidecar instance per agent runtime. Each sidecar has its own Ed25519 identity derived from `ED25519_SEED`. This is a security design choice — cryptographic isolation ensures no agent can sign as another agent. Same sidecar pattern as Envoy, Istio, and Dapr.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `ED25519_SEED` | Yes | — | Deterministic seed for Ed25519 keypair. SHA-256 hashed to derive the private key. Defines the agent's DID. |
| `RULES_ENGINE_URL` | No | `""` | When set, `/check_authorization` proxies to this URL for Cedar policy evaluation. |
| `PORT` | No | `8100` | Port the sidecar listens on. |

Resource minimum: 128 MB RAM.

Without `ED25519_SEED`, the sidecar generates a random key at startup and the DID will change on every restart.

## API Endpoints

### GET /

Health check. Returns service status and available endpoints.

```json
{
  "service": "warranted-governance-sidecar",
  "status": "running",
  "endpoints": ["/check_identity", "/check_authorization", "/sign_transaction", "/verify_signature", "/issue_token"]
}
```

### GET /check_identity

Returns the sidecar's cryptographic identity and policy configuration.

```json
{
  "agent_id": "my-agent-001",
  "did": "did:mesh:7b2f4a91e3...",
  "public_key": "base64-encoded-ed25519-public-key",
  "trust_score": 850,
  "trust_level": "high",
  "lifecycle_state": "active",
  "spending_limit": 5000,
  "approved_vendors": ["aws", "azure", "gcp", "github", "vercel", "railway", "vendor-acme-001"],
  "authority_chain": ["did:mesh:cfo", "did:mesh:vp-eng", "did:mesh:7b2f4a91e3..."],
  "status": "verified"
}
```

### POST /check_authorization

Query parameters: `vendor` (string), `amount` (float), `category` (string).

```bash
curl -X POST "http://localhost:8100/check_authorization?vendor=aws&amount=2500&category=compute"
```

```json
{
  "authorized": true,
  "reasons": ["within policy"],
  "requires_approval": true,
  "agent_id": "my-agent-001",
  "did": "did:mesh:7b2f4a91e3...",
  "trust_score": 850,
  "trust_level": "high",
  "vendor": "aws",
  "amount": 2500,
  "category": "compute"
}
```

When `RULES_ENGINE_URL` is set, the request is proxied to the rules engine API as a Cedar check request. If the proxy fails, it falls back to the built-in spending limits.

### POST /sign_transaction

Query parameters: `vendor` (string), `amount` (float), `item` (string), `category` (string, default `"compute"`).

Runs authorization check first. If authorized, signs the transaction payload with Ed25519.

```json
{
  "signed": true,
  "payload": {
    "agent_id": "my-agent-001",
    "did": "did:mesh:7b2f4a91e3...",
    "vendor": "aws",
    "amount": 2500,
    "item": "gpu-hours-100",
    "timestamp": 1712678400.123,
    "nonce": "a7f3b2c1d4e5f6"
  },
  "signature": "base64-ed25519-signature",
  "public_key": "base64-ed25519-public-key",
  "algorithm": "Ed25519"
}
```

If authorization is denied:

```json
{
  "signed": false,
  "reasons": ["Amount $6000 exceeds limit of $5000"]
}
```

### GET /verify_signature

Query parameters: `payload` (JSON string), `signature` (base64 string).

```json
{
  "valid": true,
  "did": "did:mesh:7b2f4a91e3...",
  "public_key": "base64-ed25519-public-key",
  "algorithm": "Ed25519"
}
```

### POST /issue_token

Issues a JWT signed with the sidecar's Ed25519 private key (EdDSA algorithm). Token expires in 24 hours.

```json
{
  "token": "eyJhbGciOiJFZERTQSIs...",
  "did": "did:mesh:7b2f4a91e3...",
  "expires_at": "2026-04-12T15:00:00+00:00"
}
```

JWT claims include: `sub` (DID), `iss` ("warranted-sidecar"), `iat`, `exp`, `agentId`, `spendingLimit`, `dailySpendLimit`, `categories`, `approvedVendors`, `authorityChain`.

## Running Without Docker

```bash
# Python 3.10+
cd sidecar
pip install -r requirements.txt
ED25519_SEED=my-agent-seed uvicorn server:app --host 0.0.0.0 --port 8100
```

## Connecting to the Rules Engine

When `RULES_ENGINE_URL` is set (e.g., `http://api:3000/api/policies/check`), the `/check_authorization` endpoint proxies requests to the rules engine API for Cedar policy evaluation. This enables centralized policy management via the dashboard.

When `RULES_ENGINE_URL` is empty (default), the sidecar uses built-in spending limits:
- Spending limit: $5,000 per transaction
- Approved vendors: aws, azure, gcp, github, vercel, railway, vendor-acme-001
- Permitted categories: compute, software-licenses, cloud-services, api-credits
- Transactions over $1,000 require approval

## License

Apache-2.0
