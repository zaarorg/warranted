import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { policyAssignments, policies, ORG_ID } from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";
import { z } from "zod";

const CreateAssignmentSchema = z
  .object({
    policyId: z.string().uuid(),
    groupId: z.string().uuid().optional(),
    agentDid: z.string().optional(),
  })
  .refine(
    (data) =>
      (data.groupId !== undefined && data.agentDid === undefined) ||
      (data.groupId === undefined && data.agentDid !== undefined),
    { message: "Exactly one of groupId or agentDid must be provided" },
  );

export function assignmentsRoutes(db: DrizzleDB): Hono {
  const app = new Hono();

  // GET / — List assignments (filter by groupId or agentDid, org-scoped)
  app.get("/", async (c) => {
    const orgId = c.get("orgId") ?? ORG_ID;
    const groupId = c.req.query("groupId");
    const agentDid = c.req.query("agentDid");

    // Get policy IDs belonging to this org
    const orgPolicies = await db
      .select({ id: policies.id })
      .from(policies)
      .where(eq(policies.orgId, orgId));
    const orgPolicyIds = orgPolicies.map((p) => p.id);

    if (orgPolicyIds.length === 0) {
      return c.json({ success: true, data: [] });
    }

    const conditions = [inArray(policyAssignments.policyId, orgPolicyIds)];
    if (groupId) {
      conditions.push(eq(policyAssignments.groupId, groupId));
    } else if (agentDid) {
      conditions.push(eq(policyAssignments.agentDid, agentDid));
    }

    const rows = await db
      .select()
      .from(policyAssignments)
      .where(and(...conditions));

    return c.json({ success: true, data: rows });
  });

  // POST / — Assign policy to group or agent (org-scoped)
  app.post("/", async (c) => {
    const orgId = c.get("orgId") ?? ORG_ID;
    const body = await c.req.json();
    const parsed = CreateAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.format() }, 400);
    }

    // Verify policy belongs to this org
    const policyRows = await db
      .select()
      .from(policies)
      .where(and(eq(policies.id, parsed.data.policyId), eq(policies.orgId, orgId)));
    if (policyRows.length === 0) {
      return c.json({ success: false, error: "Policy not found" }, 404);
    }

    const [row] = await db
      .insert(policyAssignments)
      .values({
        policyId: parsed.data.policyId,
        groupId: parsed.data.groupId ?? null,
        agentDid: parsed.data.agentDid ?? null,
      })
      .returning();

    return c.json({ success: true, data: row }, 201);
  });

  // DELETE /:id — Remove assignment (org-scoped)
  app.delete("/:id", async (c) => {
    const orgId = c.get("orgId") ?? ORG_ID;
    const id = c.req.param("id");

    // Verify assignment's policy belongs to this org
    const assignmentRows = await db
      .select()
      .from(policyAssignments)
      .where(eq(policyAssignments.id, id));
    if (assignmentRows.length === 0) {
      return c.json({ success: false, error: "Assignment not found" }, 404);
    }

    const policyRows = await db
      .select()
      .from(policies)
      .where(and(eq(policies.id, assignmentRows[0]!.policyId), eq(policies.orgId, orgId)));
    if (policyRows.length === 0) {
      return c.json({ success: false, error: "Assignment not found" }, 404);
    }

    await db
      .delete(policyAssignments)
      .where(eq(policyAssignments.id, id));

    return c.json({ success: true, data: { deleted: true } });
  });

  return app;
}
