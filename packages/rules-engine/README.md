# @warranted/rules-engine

> **v0.1 — API may change.** Core exports are stable but details may shift before v1.0.

Cedar-based policy evaluation for AI agent governance. Provides group hierarchy, envelope resolution (constraints only narrow, never widen), and Cedar WASM evaluation.

## Installation

```bash
npm install @warranted/rules-engine
```

## Prerequisites

- PostgreSQL 16+
- Node.js 20+ or Bun 1.3+

## Quick Start

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import {
  resolveEnvelope,
  CedarEvaluator,
  initCedar,
  buildEntityStore,
  seed,
  ORG_ID,
  AGENT_DID,
} from "@warranted/rules-engine";

// 1. Connect and seed
const db = drizzle(process.env.DATABASE_URL!);
await seed(db);

// 2. Resolve the agent's effective permissions
const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
console.log(envelope.actions); // actions with resolved dimensions

// 3. Evaluate a Cedar authorization request
const engine = await initCedar();
const evaluator = new CedarEvaluator(engine);
await evaluator.loadPolicySet(db, ORG_ID);

const result = evaluator.check({
  principal: `Agent::"${AGENT_DID}"`,
  action: 'Action::"purchase.initiate"',
  resource: 'Resource::"aws"',
  context: { amount: 2500, vendor: "aws", category: "compute" },
});
console.log(result.decision); // "Allow" or "Deny"
```

## Key Exports

### Envelope Resolution

```typescript
resolveEnvelope(db: DrizzleDB, agentDid: string, orgId: string): Promise<ResolvedEnvelope>
```

Walks the group hierarchy from the agent up to the org root, collects all policy assignments, and intersects constraints. Returns:

```typescript
type ResolvedEnvelope = {
  agentDid: string;
  actions: ResolvedAction[];   // one per action type
  policyVersion: number;       // org-level version counter
  resolvedAt: string;          // ISO 8601 timestamp
};

type ResolvedAction = {
  actionId: string;
  actionName: string;
  denied: boolean;             // true if any deny policy applies
  denySource: string | null;   // policy name that denied
  dimensions: ResolvedDimension[];
};

type ResolvedDimension = {
  name: string;
  kind: "numeric" | "rate" | "set" | "boolean" | "temporal";
  resolved: unknown;           // intersected value
  sources: DimensionSource[];  // which policies contributed
};
```

### Cedar Evaluation

```typescript
class CedarEvaluator {
  constructor(engine: CedarEngine);
  loadPolicySet(db: DrizzleDB, orgId: string): Promise<void>;
  check(request: CheckRequest): CheckResponse;
  reload(db: DrizzleDB, orgId: string): Promise<boolean>;
  getBundleHash(): string;
}
```

- `initCedar()` — initialize the Cedar WASM runtime
- `generateCedar(policyName, versionNumber, effect, constraints, assignmentTarget)` — generate Cedar source from constraints

### Entity Store

```typescript
buildEntityStore(db: DrizzleDB, orgId: string): Promise<CedarEntity[]>
```

Builds Cedar entity store from group hierarchy. Creates `Group::`, `Agent::`, and `Action::` entities with parent relationships.

```typescript
rebuildOnVersionBump(db: DrizzleDB, orgId: string): Promise<void>
```

### Schema

All Drizzle table exports for direct database access: `organizations`, `groups`, `agentGroupMemberships`, `actionTypes`, `dimensionDefinitions`, `policies`, `policyVersions`, `policyAssignments`, `decisionLog`, `petitions`.

## Envelope Resolution

The envelope resolver walks the agent's group hierarchy and intersects constraints from every ancestor. Constraints can only narrow — a child group can never grant more than its parent.

| Dimension Kind | Resolution | Example |
|---|---|---|
| `numeric` | `min(all ancestors)` | Org: $5,000, Team: $1,000 → **$1,000** |
| `set` | `intersection(all ancestors)` | Org: {aws, gcp, azure}, Team: {aws, gcp} → **{aws, gcp}** |
| `boolean` | `OR(all ancestors)` | Any ancestor requires approval → **required** |
| `temporal` | tightest window | Org: 2027-12-31, Team: 2026-12-31 → **2026-12-31** |
| `rate` | `min(all ancestors)` | Org: 100/day, Team: 50/day → **50/day** |

Deny policies override allow policies — if any policy in the chain denies an action, the action is denied regardless of allow policies.

## Cedar Policy Format

`generateCedar` produces Cedar source from constraints. Example output for an allow policy with spending limit and vendor restrictions:

```cedar
// Policy: "Agent Spending Limit" (v1)
// Assigned to: Group::"acme-org"
permit (
  principal in Group::"acme-org",
  action == Action::"purchase.initiate",
  resource
);

// Policy: "Agent Spending Limit" (v1) — constraint: max_amount
forbid (
  principal in Group::"acme-org",
  action == Action::"purchase.initiate",
  resource
)
when {
  context.amount > 5000
};

// Policy: "Agent Spending Limit" (v1) — constraint: approved_vendors
forbid (
  principal in Group::"acme-org",
  action == Action::"purchase.initiate",
  resource
)
when {
  !context.vendor.containsAny([Set].fromArray(["aws", "gcp", "azure"]))
};
```

## License

Apache-2.0
