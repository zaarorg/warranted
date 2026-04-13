import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { groups, agentGroupMemberships, ORG_ID } from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";
import { z } from "zod";

const CreateGroupSchema = z.object({
  name: z.string().min(1),
  nodeType: z.enum(["org", "department", "team", "unassigned"]),
  parentId: z.string().uuid().nullable().optional(),
});

const UpdateGroupSchema = z.object({
  nodeType: z.enum(["org", "department", "team"]).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

const AddMemberSchema = z.object({
  agentDid: z.string().min(1),
});

export function groupsRoutes(db: DrizzleDB): Hono {
  const app = new Hono();

  // GET / — List all groups (org-scoped)
  app.get("/", async (c) => {
    const orgId = c.get("orgId") ?? ORG_ID;
    const rows = await db.select().from(groups).where(eq(groups.orgId, orgId));
    return c.json({ success: true, data: rows });
  });

  // POST / — Create group (org-scoped)
  app.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreateGroupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.format() }, 400);
    }

    const orgId = c.get("orgId") ?? ORG_ID;

    const [row] = await db
      .insert(groups)
      .values({
        orgId,
        name: parsed.data.name,
        nodeType: parsed.data.nodeType,
        parentId: parsed.data.parentId ?? null,
      })
      .returning();

    return c.json({ success: true, data: row }, 201);
  });

  // GET /:id — Get group (org-scoped)
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const orgId = c.get("orgId") ?? ORG_ID;
    const rows = await db.select().from(groups).where(and(eq(groups.id, id), eq(groups.orgId, orgId)));
    if (rows.length === 0) {
      return c.json({ success: false, error: "Group not found" }, 404);
    }
    return c.json({ success: true, data: rows[0] });
  });

  // DELETE /:id — Delete group (org-scoped, cascade memberships)
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const orgId = c.get("orgId") ?? ORG_ID;
    const rows = await db.delete(groups).where(and(eq(groups.id, id), eq(groups.orgId, orgId))).returning();
    if (rows.length === 0) {
      return c.json({ success: false, error: "Group not found" }, 404);
    }
    return c.json({ success: true, data: { deleted: true } });
  });

  // PATCH /:id — Update group (org-scoped, nodeType assignment, parentId)
  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const orgId = c.get("orgId") ?? ORG_ID;
    const body = await c.req.json();
    const parsed = UpdateGroupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.format() }, 400);
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.nodeType !== undefined) updates.nodeType = parsed.data.nodeType;
    if (parsed.data.parentId !== undefined) updates.parentId = parsed.data.parentId;

    if (Object.keys(updates).length === 0) {
      return c.json({ success: false, error: "No fields to update" }, 400);
    }

    const rows = await db
      .update(groups)
      .set(updates)
      .where(and(eq(groups.id, id), eq(groups.orgId, orgId)))
      .returning();

    if (rows.length === 0) {
      return c.json({ success: false, error: "Group not found" }, 404);
    }
    return c.json({ success: true, data: rows[0] });
  });

  // GET /:id/members — List agents in group (org-scoped)
  app.get("/:id/members", async (c) => {
    const groupId = c.req.param("id");
    const orgId = c.get("orgId") ?? ORG_ID;
    const rows = await db
      .select()
      .from(agentGroupMemberships)
      .where(and(eq(agentGroupMemberships.groupId, groupId), eq(agentGroupMemberships.orgId, orgId)));
    return c.json({ success: true, data: rows });
  });

  // POST /:id/members — Add agent to group (org-scoped)
  app.post("/:id/members", async (c) => {
    const groupId = c.req.param("id");
    const orgId = c.get("orgId") ?? ORG_ID;
    const body = await c.req.json();
    const parsed = AddMemberSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.format() }, 400);
    }

    await db.insert(agentGroupMemberships).values({
      agentDid: parsed.data.agentDid,
      groupId,
      orgId,
    });

    return c.json({ success: true, data: { agentDid: parsed.data.agentDid, groupId } }, 201);
  });

  // DELETE /:id/members/:did — Remove agent from group (org-scoped)
  app.delete("/:id/members/:did", async (c) => {
    const groupId = c.req.param("id");
    const agentDid = c.req.param("did");
    const orgId = c.get("orgId") ?? ORG_ID;

    // Verify group belongs to this org before deleting membership
    const groupRows = await db.select().from(groups).where(and(eq(groups.id, groupId), eq(groups.orgId, orgId)));
    if (groupRows.length === 0) {
      return c.json({ success: false, error: "Group not found" }, 404);
    }

    const rows = await db
      .delete(agentGroupMemberships)
      .where(
        and(
          eq(agentGroupMemberships.agentDid, agentDid),
          eq(agentGroupMemberships.groupId, groupId),
          eq(agentGroupMemberships.orgId, orgId),
        ),
      )
      .returning();

    if (rows.length === 0) {
      return c.json({ success: false, error: "Membership not found" }, 404);
    }
    return c.json({ success: true, data: { deleted: true } });
  });

  // GET /:id/ancestors — Get ancestor chain (recursive CTE, org-scoped)
  app.get("/:id/ancestors", async (c) => {
    const id = c.req.param("id");
    const orgId = c.get("orgId") ?? ORG_ID;
    const rows = await db.execute(sql`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, name, node_type, 0 AS depth
        FROM groups WHERE id = ${id} AND org_id = ${orgId}
        UNION ALL
        SELECT g.id, g.parent_id, g.name, g.node_type, a.depth + 1
        FROM groups g JOIN ancestors a ON g.id = a.parent_id
        WHERE g.org_id = ${orgId}
      )
      SELECT * FROM ancestors ORDER BY depth
    `);
    return c.json({ success: true, data: rows });
  });

  // GET /:id/descendants — Get descendant tree (recursive CTE, org-scoped)
  app.get("/:id/descendants", async (c) => {
    const id = c.req.param("id");
    const orgId = c.get("orgId") ?? ORG_ID;
    const rows = await db.execute(sql`
      WITH RECURSIVE descendants AS (
        SELECT id, parent_id, name, node_type, 0 AS depth
        FROM groups WHERE id = ${id} AND org_id = ${orgId}
        UNION ALL
        SELECT g.id, g.parent_id, g.name, g.node_type, d.depth + 1
        FROM groups g JOIN descendants d ON g.parent_id = d.id
        WHERE g.org_id = ${orgId}
      )
      SELECT * FROM descendants ORDER BY depth
    `);
    return c.json({ success: true, data: rows });
  });

  return app;
}
