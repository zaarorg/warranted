# Security Rules

## Secrets Management

- **Never hardcode API keys, JWT secrets, or private keys.** All secrets come from environment variables only.
- Load secrets via `.env` file locally (gitignored). In Docker, use `-e` flag or `env_file`.
- Required env vars: `DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`.
- Optional env vars: `COINBASE_API_KEY`, `STRIPE_SECRET_KEY`.
- Never log secret values. Log only that the variable "is set" or "is missing".
- Fail fast on startup if required secrets are empty — don't let the user discover this mid-transaction.

## .gitignore

The following must always be gitignored:
```
.env
.env.*
*.pem
*.key
node_modules/
.venv/
__pycache__/
*.pyc
dist/
.next/
.vercel/
.turbo/
*.tsbuildinfo
drizzle/meta/
```

## Cryptographic Material

### Ed25519 Keys (AGT Identity)
- Ed25519 private keys are generated and held by the governance sidecar only.
- The TypeScript backend NEVER sees or stores private keys.
- Public keys are registered in the platform registry and are safe to distribute.
- Key rotation: when a sidecar restarts, it can re-derive keys from a seed or generate new ones and re-register.

### JWT Tokens
- Platform JWTs are signed with `EdDSA` algorithm via `jose` library.
- JWT_SECRET is the platform's signing key — never expose it to agents or frontends.
- Token expiration: agent tokens default to 24 hours, session tokens to 1 hour.
- Revocation: revoked token IDs stored in the registry. Validate on every request.

### Transaction Signatures
- Transaction payloads signed by the sidecar include: agent DID, vendor ID, amount, timestamp, nonce.
- Nonces are single-use. The platform rejects any previously seen nonce.
- Signed payloads expire after 60 seconds (configurable TTL).
- Counterparties verify signatures against the registry's public key for the agent's DID.

## What Never to Log

- JWT_SECRET or any signing key material
- Ed25519 private keys
- Full JWT token strings (log the `sub` claim and `exp` only)
- ANTHROPIC_API_KEY, COINBASE_API_KEY, STRIPE_SECRET_KEY
- Full spending policy YAML (may contain vendor-specific business intelligence)
- Full negotiation transcripts in application logs (stored separately in the transcript service)

## What Is Safe to Log

- Agent DIDs (public identifiers)
- Transaction IDs and phase transitions
- Policy evaluation outcomes (approved/denied/escalated) with reason codes
- Settlement amounts and vendor IDs
- Token issuance events (agent ID, scope summary, expiration)
- Sidecar health checks and latency metrics
- Error types and counts (without sensitive context)

## Input Validation

### API Endpoints
- All request bodies validated with Zod schemas. Reject invalid input with 400 and structured error.
- Maximum request body size: 1MB for standard endpoints, 10MB for file uploads.
- Rate limit API requests: 100/minute per agent, 1000/minute per entity.

### JWT Tokens
- Always verify signature, expiration, and issuer before processing any claim.
- Verify the authority chain: trace agent → user → entity → policy.
- Reject tokens with `exp` in the past. No grace period.
- Reject tokens with `iat` more than 24 hours in the future (clock skew attack).

### Transaction Inputs
- Validate all amounts are positive numbers. Reject zero or negative amounts.
- Validate vendor IDs against the registry. Reject unknown vendors.
- Validate category strings against the permitted categories enum.
- Sanitize all string fields — no script injection in vendor names, item descriptions, etc.

### Negotiation Messages
- Negotiation uses a typed message protocol with defined fields per message type.
- No free-form text fields in the protocol — this prevents prompt injection.
- If a negotiation message contains unexpected fields, reject it.
- Transcript captures all messages as data. Messages are never interpreted as instructions.

## Sidecar Security

### IPC Channel
- The sidecar listens on HTTP within the Docker network. Not exposed to the public internet.
- In production, the sidecar should listen on a Unix domain socket with restricted file permissions.
- The sidecar validates a shared secret on the first request (injected via environment at boot).

### Policy Immutability
- Policies are loaded from YAML at sidecar startup.
- The sidecar's policy engine is frozen after initialization — no runtime policy modification.
- Policy updates require a sidecar restart with new YAML files.
- The agent process CANNOT modify its own policies.

### Confused Deputy Mitigation
- Rate limiting: configurable max transactions per hour per agent.
- Daily spend ceiling: separate from per-transaction limit.
- Anomaly detection flag: sudden change in vendor, category, or amount pattern.
- Cooling-off period: high-value transactions are signed but held before settlement.

## Docker Security

- OpenClaw runs in its own container. The sidecar runs in a separate container.
- Containers share a Docker network but have no shared filesystem.
- The sidecar container has no shell access — the agent cannot exec into it.
- Never run containers as root. Use non-root users in Dockerfiles.
- Use specific image tags, not `latest`.
- Don't copy `.env` files into Docker images.
- OpenClaw's SSRF policy blocks access to private/internal hostnames by default. The sidecar is accessed via Docker service name within the compose network.

## Error Responses

- Never expose stack traces, file system paths, or internal error details to API consumers.
- API errors return JSON: `{ success: false, error: "message", code: "ERROR_CODE" }`.
- Authorization denials return 403 with a specific reason code (not the full policy rule).
- Sidecar errors return a generic "governance check failed" to the agent, with details logged server-side.
- Transaction failures return the phase where failure occurred and a human-readable reason.

## CORS

- API: Allow configurable origins. Default to same-origin for production.
- Dashboard dev server: Allow `localhost:3000` during development.
- Storefront SDK endpoints: Allow all origins (agents can come from anywhere). Auth is via JWT, not cookies.

## Dependencies

- Pin TypeScript dependencies via `bun.lockb` (committed to git).
- Pin Python dependencies via `requirements.txt` with versions.
- Key TypeScript dependencies:
  - `hono` — HTTP framework
  - `drizzle-orm`, `drizzle-kit` — Database ORM
  - `jose` — JWT operations
  - `xstate` — State machine for transaction engine
  - `zod` — Input validation
- Key Python dependencies:
  - `agent-os-kernel` — Microsoft AGT policy engine
  - `inter-agent-trust-protocol` — IATP sidecar trust
  - `agentmesh-runtime` — Execution rings and sagas
  - `fastapi`, `uvicorn` — HTTP server for sidecar
- Before adding a new dependency, check if the existing stack covers the need.

## Git Hygiene

- **Before committing, verify no secrets were accidentally added:**
  ```bash
  git diff --cached | grep -iE "(api_key|secret|password|token|sk-|private_key)" | grep -v "test\|mock\|example\|env\.\|\.md"
  ```
  Review any matches.
- Never commit `.env` files, private keys, or gateway tokens.
- The `sidecar/policies/` directory contains spending policies that ARE committed — they define the governance rules, not secrets.
- The `skills/warranted-identity/SKILL.md` IS committed — it's the distributable skill definition.
