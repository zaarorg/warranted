import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { policyAssignments } from "@warranted/rules-engine";
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

  // GET / — List assignments (filter by groupId or agentDid)
  app.get("/", async (c) => {
    const groupId = c.req.query("groupId");
    const agentDid = c.req.query("agentDid");

    let query;
    if (groupId) {
      query = db
        .select()
        .from(policyAssignments)
        .where(eq(policyAssignments.groupId, groupId));
    } else if (agentDid) {
      query = db
        .select()
        .from(policyAssignments)
        .where(eq(policyAssignments.agentDid, agentDid));
    } else {
      query = db.select().from(policyAssignments);
    }

    const rows = await query;
    return c.json({ success: true, data: rows });
  });

  // POST / — Assign policy to group or agent
  app.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreateAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.format() }, 400);
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

  // DELETE /:id — Remove assignment
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const rows = await db
      .delete(policyAssignments)
      .where(eq(policyAssignments.id, id))
      .returning();
    if (rows.length === 0) {
      return c.json({ success: false, error: "Assignment not found" }, 404);
    }
    return c.json({ success: true, data: { deleted: true } });
  });

  return app;
}
