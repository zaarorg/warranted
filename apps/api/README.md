# Warranted Rules Engine API

> **v0.1 — API may change.** Core exports are stable but details may shift before v1.0.

HTTP API for policy management, Cedar evaluation, and agent envelope resolution. Powers the governance sidecar and admin dashboard.

## Quick Start

```bash
docker run \
  -e DATABASE_URL=postgresql://user:pass@host:5432/warranted \
  -p 3000:3000 \
  warranted/rules-engine-api
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `PORT` | No | `3000` | Port the API listens on |
| `SKIP_MIGRATE` | No | `""` | Set to `1` to skip automatic migrations on startup |
| `SKIP_SEED` | No | `""` | Set to `1` to skip seeding demo data on startup |

Resource minimum: 512 MB RAM (Cedar WASM evaluation).

## API Endpoints

All endpoints are prefixed with `/api/policies`. All responses follow `{ success: boolean, data?: T, error?: string }`.

### Policies (Rules)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/policies/rules` | List all policies. Filter: `?orgId=` |
| `POST` | `/api/policies/rules` | Create a policy |
| `GET` | `/api/policies/rules/:id` | Get policy by ID |
| `PUT` | `/api/policies/rules/:id` | Update policy metadata (name, domain) |
| `DELETE` | `/api/policies/rules/:id` | Delete a policy |

### Versions

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/policies/rules/:id/versions` | List all versions for a policy |
| `POST` | `/api/policies/rules/:id/versions` | Create version (atomic: constraints → Cedar gen → validate → store → activate) |
| `POST` | `/api/policies/rules/:id/versions/:vid/activate` | Activate a specific version |

Creating a version is atomic: it generates Cedar source from constraints, computes a SHA-256 hash, stores the version, sets it as active, and bumps the org's policy version counter — all in a single transaction.

### Groups

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/policies/groups` | List all groups. Filter: `?orgId=` |
| `POST` | `/api/policies/groups` | Create a group |
| `GET` | `/api/policies/groups/:id` | Get group by ID |
| `DELETE` | `/api/policies/groups/:id` | Delete group (cascades memberships) |
| `GET` | `/api/policies/groups/:id/members` | List agents in group |
| `POST` | `/api/policies/groups/:id/members` | Add agent to group |
| `DELETE` | `/api/policies/groups/:id/members/:did` | Remove agent from group |
| `GET` | `/api/policies/groups/:id/ancestors` | Get ancestor chain (recursive CTE) |
| `GET` | `/api/policies/groups/:id/descendants` | Get descendant tree (recursive CTE) |

### Assignments

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/policies/assignments` | List assignments. Filter: `?groupId=` or `?agentDid=` |
| `POST` | `/api/policies/assignments` | Assign policy to group or agent |
| `DELETE` | `/api/policies/assignments/:id` | Remove assignment |

### Envelope

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/policies/agents/:did/envelope` | Resolve effective envelope for an agent. Optional: `?orgId=` |
| `GET` | `/api/policies/agents/:did/policies` | List all policies applying to an agent (with active versions and Cedar source) |

### Check (Cedar Evaluation)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/policies/check` | Evaluate an authorization request against Cedar policies |

Request body:

```json
{
  "principal": "Agent::\"did:mesh:abc123\"",
  "action": "Action::\"purchase.initiate\"",
  "resource": "Resource::\"aws\"",
  "context": { "amount": 2500, "vendor": "aws", "category": "compute" }
}
```

Response:

```json
{
  "success": true,
  "data": {
    "decision": "Allow",
    "diagnostics": [],
    "engineCode": null,
    "sdkCode": null
  }
}
```

This endpoint also writes to the decision log with the envelope snapshot at evaluation time.

### Decisions (Audit Log)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/policies/decisions` | List decisions. Filters: `?agentDid=`, `?outcome=`, `?after=`, `?before=`, `?limit=` (max 200), `?offset=` |
| `GET` | `/api/policies/decisions/:id` | Get single decision with envelope snapshot |

### Action Types

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/policies/action-types` | List all action types with dimension definitions |
| `GET` | `/api/policies/action-types/:id` | Get action type with dimension definitions |

### Petitions (stub — 501)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/policies/petitions` | File petition — returns 501 |
| `GET` | `/api/policies/petitions` | List petitions — returns 501 |
| `POST` | `/api/policies/petitions/:id/decide` | Approve/deny petition — returns 501 |
| `GET` | `/api/policies/petitions/:id` | Get petition details — returns 501 |

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |

## Deployment

Works with any cloud that runs Docker + PostgreSQL:
- Railway, Fly.io, Render, AWS ECS, Google Cloud Run

## Backup

```bash
docker compose exec postgres pg_dump -U warranted warranted > backup.sql
```

## License

Apache-2.0
