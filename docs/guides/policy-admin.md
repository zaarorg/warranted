# Policy Administration Guide

Manage AI agent governance policies with Cedar-based authorization, Active Directory-style group hierarchy, and real-time policy testing.

## Quick Start

```bash
# 1. Start the stack
docker compose -f docker-compose.production.yml up -d

# 2. Open the dashboard
open http://localhost:3001

# 3. List policies (API)
curl http://localhost:3000/api/policies/rules

# 4. Resolve an agent's effective permissions
curl http://localhost:3000/api/policies/agents/did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6/envelope

# 5. Test authorization
curl -X POST http://localhost:3000/api/policies/check \
  -H "Content-Type: application/json" \
  -d '{"principal":"Agent::\"did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6\"","action":"Action::\"purchase.initiate\"","resource":"Resource::\"aws\"","context":{"amount":500,"vendor":"aws","category":"compute"}}'
```

---

## Overview

Warranted uses Cedar-based authorization with a group hierarchy. Policies are created with typed constraints, automatically compiled to Cedar, and evaluated in real time. Constraints only narrow as they flow down the hierarchy — a department can't grant permissions wider than the organization allows.

---

## Deploy the API + Dashboard

```bash
docker compose -f docker-compose.production.yml up -d
```

This starts the Hono API (port 3000) and the Next.js dashboard (port 3001). For full setup options, see:

- [API README](../../apps/api/README.md) — environment variables, database setup
- [Dashboard README](../../apps/dashboard/README.md) — configuration, development mode

For production, use the included reverse proxy configs to serve both behind a single domain:

- [Caddyfile](../proxy/Caddyfile) — automatic HTTPS
- [nginx.conf](../proxy/nginx.conf) — standard nginx

---

## Create Your Organization and Group Hierarchy

Build your organizational structure as a tree: Organization → Departments → Teams.

### Create the organization

```bash
curl -X POST http://localhost:3000/api/policies/groups \
  -H "Content-Type: application/json" \
  -d '{"orgId":"550e8400-e29b-41d4-a716-446655440000","name":"Acme Corp","nodeType":"org"}'
```

### Create departments

```bash
# Engineering department
curl -X POST http://localhost:3000/api/policies/groups \
  -H "Content-Type: application/json" \
  -d '{"orgId":"550e8400-e29b-41d4-a716-446655440000","name":"Engineering","nodeType":"department","parentId":"<org-group-id>"}'

# Finance department
curl -X POST http://localhost:3000/api/policies/groups \
  -H "Content-Type: application/json" \
  -d '{"orgId":"550e8400-e29b-41d4-a716-446655440000","name":"Finance","nodeType":"department","parentId":"<org-group-id>"}'
```

### Create teams

```bash
# Platform Team under Engineering
curl -X POST http://localhost:3000/api/policies/groups \
  -H "Content-Type: application/json" \
  -d '{"orgId":"550e8400-e29b-41d4-a716-446655440000","name":"Platform Team","nodeType":"team","parentId":"<engineering-group-id>"}'
```

### Add agents to teams

```bash
curl -X POST http://localhost:3000/api/policies/groups/<team-group-id>/members \
  -H "Content-Type: application/json" \
  -d '{"agentDid":"did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6"}'
```

### View hierarchy

```bash
# Ancestors (team → department → org)
curl http://localhost:3000/api/policies/groups/<team-group-id>/ancestors

# Descendants (org → all departments → all teams)
curl http://localhost:3000/api/policies/groups/<org-group-id>/descendants
```

---

## Create Policies

Policies can be managed at three levels of abstraction, depending on your role.

### Dashboard Tier (Procurement Manager)

Navigate to **Policies → Create Policy** in the dashboard:

1. Enter a policy name (e.g., "Engineering Spending Limits")
2. Select domain: `finance`, `communication`, or `agent_delegation`
3. Select effect: `allow` or `deny`
4. Add constraints via the form:
   - Amount limit: enter max value
   - Approved vendors: select from list
   - Permitted categories: check boxes
5. Click **Create** — the policy is live immediately

This is all you need for day-to-day governance management.

### API Tier (Compliance Engineer)

For programmatic policy management and CI/CD integration:

#### Create a policy

```bash
curl -X POST http://localhost:3000/api/policies/rules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Engineering Compute Budget",
    "orgId": "550e8400-e29b-41d4-a716-446655440000",
    "domain": "finance",
    "effect": "allow"
  }'
```

**Response (201):**

```json
{
  "success": true,
  "data": {
    "id": "7a8b9c0d-1234-5678-9abc-def012345678",
    "name": "Engineering Compute Budget",
    "orgId": "550e8400-e29b-41d4-a716-446655440000",
    "domain": "finance",
    "effect": "allow",
    "activeVersionId": null
  }
}
```

#### Create a version with constraints

```bash
curl -X POST http://localhost:3000/api/policies/rules/7a8b9c0d-1234-5678-9abc-def012345678/versions \
  -H "Content-Type: application/json" \
  -d '{
    "constraints": [{
      "actionTypeId": "action-type-uuid-here",
      "actionName": "purchase.initiate",
      "dimensions": [
        { "name": "amount", "kind": "numeric", "max": 5000 },
        { "name": "vendor", "kind": "set", "members": ["aws", "gcp", "azure"] },
        { "name": "category", "kind": "set", "members": ["compute", "cloud-services"] }
      ]
    }],
    "createdBy": "compliance-team@acme.com"
  }'
```

**Response (201):**

```json
{
  "success": true,
  "data": {
    "id": "version-uuid",
    "versionNumber": 1,
    "cedarSource": "permit(\n  principal,\n  action == Action::\"purchase.initiate\",\n  resource\n) when {\n  context.amount <= 5000 &&\n  [\"aws\", \"gcp\", \"azure\"].contains(context.vendor) &&\n  [\"compute\", \"cloud-services\"].contains(context.category)\n};",
    "cedarHash": "sha256:abc123..."
  }
}
```

This is an **atomic operation**: constraints are validated, Cedar is generated, hash is computed, version is stored, and the policy is activated — all in a single transaction.

#### Activate a specific version

```bash
curl -X POST http://localhost:3000/api/policies/rules/7a8b9c0d-1234-5678-9abc-def012345678/versions/<version-id>/activate
```

### Cedar Tier (Auditor)

The generated Cedar source from the above constraints:

```cedar
permit(
  principal,
  action == Action::"purchase.initiate",
  resource
) when {
  context.amount <= 5000 &&
  ["aws", "gcp", "azure"].contains(context.vendor) &&
  ["compute", "cloud-services"].contains(context.category)
};
```

**How to read Cedar:**
- `permit` — this policy allows the action (vs `forbid` which blocks it)
- `principal` — the entity making the request (the agent)
- `action == Action::"purchase.initiate"` — only applies to purchase actions
- `when { ... }` — conditions that must be true for the permit to apply
- `context.amount <= 5000` — numeric constraint
- `["aws", "gcp"].contains(context.vendor)` — set membership constraint

**What Cedar proves:** The `cedarHash` in every authorization decision points to the exact Cedar source that governed that decision. Auditors can verify that the correct policy version was in effect at any point in time.

---

## Assign Policies to Groups

Link policies to groups (or directly to agents):

```bash
# Assign to a group (applies to all members and descendants)
curl -X POST http://localhost:3000/api/policies/assignments \
  -H "Content-Type: application/json" \
  -d '{"policyId":"7a8b9c0d-1234-5678-9abc-def012345678","groupId":"<engineering-group-id>"}'

# Assign directly to an agent
curl -X POST http://localhost:3000/api/policies/assignments \
  -H "Content-Type: application/json" \
  -d '{"policyId":"<policy-id>","agentDid":"did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6"}'
```

### Intersection Semantics

Constraints only narrow, never widen. When multiple policies apply (from org, department, team, and agent levels), the effective permission is the **intersection**:

| Level | Spending Limit | Approved Vendors |
|-------|---------------|-----------------|
| Org policy | $10,000 | aws, gcp, azure, github, vercel |
| Department policy | $5,000 | aws, gcp, azure |
| Team policy | $2,000 | aws, gcp |
| **Effective** | **$2,000** | **aws, gcp** |

Each level can only tighten constraints set by its ancestors. A team cannot grant a $20,000 limit if the org caps at $10,000.

---

## Test with the REPL

### Dashboard

Open the dashboard → **Agents** → enter an agent DID → **Test** tab:

1. Select action type (e.g., `purchase.initiate`)
2. Fill dimensions:
   - Amount: `500`
   - Vendor: `aws`
   - Category: `compute`
3. Click **Test** → **Allow** (green badge)
4. Change amount to `6000` → **Deny** (red badge) with diagnostic details

### API

```bash
curl -X POST http://localhost:3000/api/policies/check \
  -H "Content-Type: application/json" \
  -d '{
    "principal": "Agent::\"did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6\"",
    "action": "Action::\"purchase.initiate\"",
    "resource": "Resource::\"aws\"",
    "context": {
      "amount": 500,
      "vendor": "aws",
      "category": "compute"
    }
  }'
```

**Response (allowed):**

```json
{
  "success": true,
  "data": {
    "decision": "Allow",
    "diagnostics": []
  }
}
```

**Response (denied):**

```json
{
  "success": true,
  "data": {
    "decision": "Deny",
    "diagnostics": ["amount 6000 exceeds maximum 5000"],
    "engineCode": "CONSTRAINT_VIOLATED"
  }
}
```

Every check is logged to the decision audit trail — see the next section.

---

## Audit

### Decision Log

Every authorization check is recorded:

```bash
# All decisions
curl "http://localhost:3000/api/policies/decisions?limit=20"

# Filter by agent
curl "http://localhost:3000/api/policies/decisions?agentDid=did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6"

# Filter by outcome
curl "http://localhost:3000/api/policies/decisions?outcome=deny"

# Date range
curl "http://localhost:3000/api/policies/decisions?after=2026-04-10T00:00:00Z&before=2026-04-11T23:59:59Z"
```

**Response:**

```json
{
  "success": true,
  "data": [{
    "id": "decision-uuid",
    "agentDid": "did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6",
    "actionTypeId": "action-type-uuid",
    "requestContext": { "amount": 6000, "vendor": "aws", "category": "compute" },
    "bundleHash": "sha256:abc123...",
    "outcome": "deny",
    "reason": "amount 6000 exceeds maximum 5000",
    "envelopeSnapshot": { "...": "..." },
    "evaluatedAt": "2026-04-11T15:30:00Z"
  }]
}
```

The `bundleHash` identifies exactly which policy set version governed the decision — for full reproducibility.

### Agent Envelope

See exactly what an agent can do and why:

```bash
curl http://localhost:3000/api/policies/agents/did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6/envelope
```

The envelope shows all applicable policies, their sources (org → department → team → direct), and the effective constraints. The dashboard's envelope viewer renders this as a visual provenance tree.

### Agent's Policies

List all policies that apply to an agent (with full Cedar source):

```bash
curl http://localhost:3000/api/policies/agents/did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6/policies
```

---

## Advanced Policies

### Deny Policies

Block specific actions regardless of allow policies:

```bash
curl -X POST http://localhost:3000/api/policies/rules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Block Sanctioned Vendors",
    "orgId": "550e8400-e29b-41d4-a716-446655440000",
    "domain": "finance",
    "effect": "deny"
  }'
```

Then add a version with vendor constraints. Deny policies always win over allow policies at the same level.

### Rate Limits

Constrain transaction frequency:

```json
{
  "constraints": [{
    "actionTypeId": "...",
    "actionName": "purchase.initiate",
    "dimensions": [
      { "name": "transactions", "kind": "rate", "limit": 10, "window": "hour" }
    ]
  }]
}
```

### Temporal Constraints

Policies with expiry dates:

```json
{
  "constraints": [{
    "actionTypeId": "...",
    "actionName": "purchase.initiate",
    "dimensions": [
      { "name": "budget_period", "kind": "temporal", "expiresAt": "2026-06-30T23:59:59Z" }
    ]
  }]
}
```

### Boolean Flags

Restrictive flags that can't be unset by descendants:

```json
{
  "constraints": [{
    "actionTypeId": "...",
    "actionName": "purchase.initiate",
    "dimensions": [
      { "name": "requires_human_approval", "kind": "boolean", "restrictive": true }
    ]
  }]
}
```

When `restrictive: true`, once set at any level in the hierarchy, no descendant group can override it.

---

## Next Steps

- [Agent Platform Integration Guide](./agent-platform-integration.md) — connect the rules engine to your sidecars
- [Vendor Integration Guide](./vendor-integration.md) — accept governed agent purchases
- [API README](../../apps/api/README.md) — full endpoint reference
