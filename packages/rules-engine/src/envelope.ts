import { eq, sql, inArray, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type {
  ResolvedEnvelope,
  ResolvedAction,
  ResolvedDimension,
  DimensionSource,
  DimensionConstraint,
  PolicyConstraint,
} from "./types";
import * as schema from "./schema";

// ---------------------------------------------------------------------------
// Public type alias for the Drizzle database instance
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleDB = PostgresJsDatabase<any>;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface AncestorRow {
  id: string;
  parent_id: string | null;
  name: string;
  node_type: string;
  depth: number;
}

interface PolicyData {
  policyId: string;
  policyName: string;
  effect: "allow" | "deny";
  constraints: PolicyConstraint[];
  groupId: string | null;
  groupName: string | null;
  nodeType: string | null;
  agentDid: string | null;
}

// ---------------------------------------------------------------------------
// Envelope Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective permissions envelope for an agent by walking the
 * group hierarchy via recursive CTE, collecting policy assignments, and
 * intersecting dimension constraints.
 */
export async function resolveEnvelope(
  db: DrizzleDB,
  agentDid: string,
  orgId: string,
): Promise<ResolvedEnvelope> {
  // Step 1+2: Find agent's groups and walk ancestors via recursive CTE (org-scoped)
  const ancestors = await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT g.id, g.parent_id, g.name, g.node_type, 0 AS depth
      FROM ${schema.groups} g
      JOIN ${schema.agentGroupMemberships} m ON m.group_id = g.id
      WHERE m.agent_did = ${agentDid} AND m.org_id = ${orgId}

      UNION ALL

      SELECT g.id, g.parent_id, g.name, g.node_type, a.depth + 1
      FROM ${schema.groups} g
      JOIN ancestors a ON g.id = a.parent_id
      WHERE g.org_id = ${orgId}
    )
    SELECT * FROM ancestors
  `);

  const ancestorRows = ancestors as unknown as AncestorRow[];

  // Get org's policyVersion
  const orgRows = await db
    .select({ policyVersion: schema.organizations.policyVersion })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId));

  const policyVersion = orgRows[0]?.policyVersion ?? 0;

  // If no ancestors, return empty envelope
  if (!Array.isArray(ancestorRows) || ancestorRows.length === 0) {
    return {
      agentDid,
      actions: [],
      policyVersion,
      resolvedAt: new Date().toISOString(),
    };
  }

  const groupIds = [...new Set(ancestorRows.map((r: AncestorRow) => r.id))];
  const groupMap = new Map<string, AncestorRow>();
  for (const row of ancestorRows as AncestorRow[]) {
    groupMap.set(row.id, row);
  }

  // Step 3: Collect policy assignments from ancestor groups + direct agent assignments
  const assignments = await db
    .select({
      policyId: schema.policyAssignments.policyId,
      groupId: schema.policyAssignments.groupId,
      agentDid: schema.policyAssignments.agentDid,
    })
    .from(schema.policyAssignments)
    .where(
      or(
        inArray(schema.policyAssignments.groupId, groupIds),
        eq(schema.policyAssignments.agentDid, agentDid),
      ),
    );

  if (assignments.length === 0) {
    return {
      agentDid,
      actions: [],
      policyVersion,
      resolvedAt: new Date().toISOString(),
    };
  }

  // Step 4: Load active policy versions with JSONB constraints
  const policyIds = [...new Set(assignments.map((a) => a.policyId))];

  const policyData = await db
    .select({
      policyId: schema.policies.id,
      policyName: schema.policies.name,
      effect: schema.policies.effect,
      activeVersionId: schema.policies.activeVersionId,
    })
    .from(schema.policies)
    .where(inArray(schema.policies.id, policyIds));

  // Load active versions
  const activeVersionIds = policyData
    .map((p) => p.activeVersionId)
    .filter((id): id is string => id !== null);

  const versions =
    activeVersionIds.length > 0
      ? await db
          .select({
            id: schema.policyVersions.id,
            policyId: schema.policyVersions.policyId,
            constraints: schema.policyVersions.constraints,
          })
          .from(schema.policyVersions)
          .where(inArray(schema.policyVersions.id, activeVersionIds))
      : [];

  const versionMap = new Map(versions.map((v) => [v.policyId, v]));
  const policyMap = new Map(policyData.map((p) => [p.policyId, p]));

  // Build enriched policy data with group info
  const enrichedPolicies: PolicyData[] = [];
  for (const assignment of assignments) {
    const policy = policyMap.get(assignment.policyId);
    if (!policy || !policy.activeVersionId) continue;

    const version = versionMap.get(policy.policyId);
    if (!version) continue;

    const group = assignment.groupId ? groupMap.get(assignment.groupId) : null;

    enrichedPolicies.push({
      policyId: policy.policyId,
      policyName: policy.policyName,
      effect: policy.effect,
      constraints: version.constraints as PolicyConstraint[],
      groupId: assignment.groupId,
      groupName: group?.name ?? null,
      nodeType: group?.node_type ?? null,
      agentDid: assignment.agentDid,
    });
  }

  // Sort enrichedPolicies by name for deterministic processing order
  enrichedPolicies.sort((a, b) => a.policyName.localeCompare(b.policyName));

  // Step 6+7: Resolve dimensions by action type
  const actionMap = new Map<
    string,
    {
      actionId: string;
      actionName: string;
      denied: boolean;
      denySource: string | null;
      dimensionSources: Map<string, { kind: string; sources: DimensionSource[]; values: DimensionConstraint[] }>;
    }
  >();

  for (const policy of enrichedPolicies) {
    for (const constraint of policy.constraints) {
      let actionEntry = actionMap.get(constraint.actionName);
      if (!actionEntry) {
        actionEntry = {
          actionId: constraint.actionTypeId,
          actionName: constraint.actionName,
          denied: false,
          denySource: null,
          dimensionSources: new Map(),
        };
        actionMap.set(constraint.actionName, actionEntry);
      }

      // Deny override — set denied flag but don't mix deny dimensions into allow intersection
      if (policy.effect === "deny") {
        actionEntry.denied = true;
        actionEntry.denySource = policy.policyName;
        continue;
      }

      // Collect dimension sources (allow policies only)
      const level = mapNodeTypeToLevel(policy.nodeType, policy.agentDid);
      for (const dim of constraint.dimensions) {
        let dimEntry = actionEntry.dimensionSources.get(dim.name);
        if (!dimEntry) {
          dimEntry = { kind: dim.kind, sources: [], values: [] };
          actionEntry.dimensionSources.set(dim.name, dimEntry);
        }

        dimEntry.sources.push({
          policyName: policy.policyName,
          groupName: policy.groupName,
          level,
          value: extractValue(dim),
        });
        dimEntry.values.push(dim);
      }
    }
  }

  // Build resolved actions
  const actions: ResolvedAction[] = [];
  for (const [, entry] of actionMap) {
    const dimensions: ResolvedDimension[] = [];

    for (const [dimName, dimData] of entry.dimensionSources) {
      const resolved = intersectDimension(dimData.kind, dimData.values);
      dimensions.push({
        name: dimName,
        kind: dimData.kind as ResolvedDimension["kind"],
        resolved,
        sources: dimData.sources,
      });
    }

    // Sort dimensions by name for determinism
    dimensions.sort((a, b) => a.name.localeCompare(b.name));

    actions.push({
      actionId: entry.actionId,
      actionName: entry.actionName,
      denied: entry.denied,
      denySource: entry.denySource,
      dimensions,
    });
  }

  // Sort actions by name for determinism
  actions.sort((a, b) => a.actionName.localeCompare(b.actionName));

  return {
    agentDid,
    actions,
    policyVersion,
    resolvedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapNodeTypeToLevel(
  nodeType: string | null,
  agentDid: string | null,
): "org" | "department" | "team" | "agent" {
  if (agentDid) return "agent";
  switch (nodeType) {
    case "org":
      return "org";
    case "department":
      return "department";
    case "team":
      return "team";
    default:
      return "org";
  }
}

function extractValue(dim: DimensionConstraint): unknown {
  switch (dim.kind) {
    case "numeric":
      return dim.max;
    case "set":
      return dim.members;
    case "boolean":
      return dim.value;
    case "temporal":
      return dim.expiry;
    case "rate":
      return dim.limit;
  }
}

function intersectDimension(kind: string, values: DimensionConstraint[]): unknown {
  if (values.length === 0) return null;

  switch (kind) {
    case "numeric": {
      const maxValues = values
        .filter((v) => v.kind === "numeric")
        .map((v) => v.max);
      return Math.min(...maxValues);
    }
    case "set": {
      const sets = values.filter((v) => v.kind === "set").map((v) => v.members);
      if (sets.length === 0) return [];
      let result = sets[0]!;
      for (let i = 1; i < sets.length; i++) {
        const current = new Set(sets[i]!);
        result = result.filter((m) => current.has(m));
      }
      return result;
    }
    case "boolean": {
      const boolValues = values.filter((v) => v.kind === "boolean");
      if (boolValues.length === 0) return null;
      // Use restrictive flag: if restrictive=true, any true wins. If restrictive=false, any false wins.
      const restrictive = boolValues[0]!.restrictive;
      if (restrictive) {
        // Gate boolean: true is more restrictive. Any true → true.
        return boolValues.some((v) => v.value === true);
      } else {
        // Permission boolean: false is more restrictive. Any false → false.
        return !boolValues.some((v) => v.value === false);
      }
    }
    case "temporal": {
      const expiries = values
        .filter((v) => v.kind === "temporal")
        .map((v) => v.expiry);
      expiries.sort();
      return expiries[0] ?? null;
    }
    case "rate": {
      const limits = values
        .filter((v) => v.kind === "rate")
        .map((v) => v.limit);
      return Math.min(...limits);
    }
    default:
      return null;
  }
}
