import { Hono } from "hono";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  resolveEnvelope,
  policies,
  policyVersions,
  policyAssignments,
  agentGroupMemberships,
  ORG_ID,
} from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";

export function envelopeRoutes(db: DrizzleDB): Hono {
  const app = new Hono();

  // GET /agents/:did/envelope — Resolve effective envelope (org-scoped)
  app.get("/agents/:did/envelope", async (c) => {
    const agentDid = c.req.param("did");
    const orgId = c.get("orgId") ?? ORG_ID;

    const envelope = await resolveEnvelope(db, agentDid, orgId);
    return c.json({ success: true, data: envelope });
  });

  // GET /agents/:did/policies — List all policies applying to agent (org-scoped)
  app.get("/agents/:did/policies", async (c) => {
    const agentDid = c.req.param("did");
    const orgId = c.get("orgId") ?? ORG_ID;

    // Get groups the agent belongs to (org-scoped)
    const memberships = await db
      .select({ groupId: agentGroupMemberships.groupId })
      .from(agentGroupMemberships)
      .where(and(eq(agentGroupMemberships.agentDid, agentDid), eq(agentGroupMemberships.orgId, orgId)));

    const groupIds = memberships.map((m) => m.groupId);

    // Get assignments for those groups + direct agent assignments
    const conditions = [];
    if (groupIds.length > 0) {
      conditions.push(inArray(policyAssignments.groupId, groupIds));
    }
    conditions.push(eq(policyAssignments.agentDid, agentDid));

    const assignments = await db
      .select()
      .from(policyAssignments)
      .where(or(...conditions));

    const policyIds = [...new Set(assignments.map((a) => a.policyId))];
    if (policyIds.length === 0) {
      return c.json({ success: true, data: [] });
    }

    // Load policies with active versions (org-scoped)
    const policyRows = await db
      .select()
      .from(policies)
      .where(and(inArray(policies.id, policyIds), eq(policies.orgId, orgId)));

    const activeVersionIds = policyRows
      .map((p) => p.activeVersionId)
      .filter((id): id is string => id !== null);

    let versions: { id: string; policyId: string; constraints: unknown; cedarSource: string }[] =
      [];
    if (activeVersionIds.length > 0) {
      versions = await db
        .select({
          id: policyVersions.id,
          policyId: policyVersions.policyId,
          constraints: policyVersions.constraints,
          cedarSource: policyVersions.cedarSource,
        })
        .from(policyVersions)
        .where(inArray(policyVersions.id, activeVersionIds));
    }

    const versionMap = new Map(versions.map((v) => [v.policyId, v]));

    const enriched = policyRows.map((p) => ({
      ...p,
      activeVersion: versionMap.get(p.id) ?? null,
    }));

    return c.json({ success: true, data: enriched });
  });

  return app;
}
