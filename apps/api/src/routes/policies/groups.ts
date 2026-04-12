import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { groups, agentGroupMemberships } from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";
import { z } from "zod";

const CreateGroupSchema = z.object({
  orgId: z.string().uuid(),
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

  // GET / — List all groups
  app.get("/", async (c) => {
    const orgId = c.req.query("orgId");
    const query = orgId
      ? db.select().from(groups).where(eq(groups.orgId, orgId))
      : db.select().from(groups);
    const rows = await query;
    return c.json({ success: true, data: rows });
  });

  // POST / — Create group
  app.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreateGroupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.format() }, 400);
    }

    const [row] = await db
      .insert(groups)
      .values({
        orgId: parsed.data.orgId,
        name: parsed.data.name,
        nodeType: parsed.data.nodeType,
        parentId: parsed.data.parentId ?? null,
      })
      .returning();

    return c.json({ success: true, data: row }, 201);
  });

  // GET /:id — Get group
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const rows = await db.select().from(groups).where(eq(groups.id, id));
    if (rows.length === 0) {
      return c.json({ success: false, error: "Group not found" }, 404);
    }
    return c.json({ success: true, data: rows[0] });
  });

  // DELETE /:id — Delete group (cascade memberships)
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const rows = await db.delete(groups).where(eq(groups.id, id)).returning();
    if (rows.length === 0) {
      return c.json({ success: false, error: "Group not found" }, 404);
    }
    return c.json({ success: true, data: { deleted: true } });
  });

  // PATCH /:id — Update group (nodeType assignment, parentId)
  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
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
      .where(eq(groups.id, id))
      .returning();

    if (rows.length === 0) {
      return c.json({ success: false, error: "Group not found" }, 404);
    }
    return c.json({ success: true, data: rows[0] });
  });

  // GET /:id/members — List agents in group
  app.get("/:id/members", async (c) => {
    const groupId = c.req.param("id");
    const rows = await db
      .select()
      .from(agentGroupMemberships)
      .where(eq(agentGroupMemberships.groupId, groupId));
    return c.json({ success: true, data: rows });
  });

  // POST /:id/members — Add agent to group
  app.post("/:id/members", async (c) => {
    const groupId = c.req.param("id");
    const body = await c.req.json();
    const parsed = AddMemberSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.format() }, 400);
    }

    await db.insert(agentGroupMemberships).values({
      agentDid: parsed.data.agentDid,
      groupId,
    });

    return c.json({ success: true, data: { agentDid: parsed.data.agentDid, groupId } }, 201);
  });

  // DELETE /:id/members/:did — Remove agent from group
  app.delete("/:id/members/:did", async (c) => {
    const groupId = c.req.param("id");
    const agentDid = c.req.param("did");

    const rows = await db
      .delete(agentGroupMemberships)
      .where(
        sql`${agentGroupMemberships.agentDid} = ${agentDid} AND ${agentGroupMemberships.groupId} = ${groupId}`,
      )
      .returning();

    if (rows.length === 0) {
      return c.json({ success: false, error: "Membership not found" }, 404);
    }
    return c.json({ success: true, data: { deleted: true } });
  });

  // GET /:id/ancestors — Get ancestor chain (recursive CTE)
  app.get("/:id/ancestors", async (c) => {
    const id = c.req.param("id");
    const rows = await db.execute(sql`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, name, node_type, 0 AS depth
        FROM groups WHERE id = ${id}
        UNION ALL
        SELECT g.id, g.parent_id, g.name, g.node_type, a.depth + 1
        FROM groups g JOIN ancestors a ON g.id = a.parent_id
      )
      SELECT * FROM ancestors ORDER BY depth
    `);
    return c.json({ success: true, data: rows });
  });

  // GET /:id/descendants — Get descendant tree (recursive CTE)
  app.get("/:id/descendants", async (c) => {
    const id = c.req.param("id");
    const rows = await db.execute(sql`
      WITH RECURSIVE descendants AS (
        SELECT id, parent_id, name, node_type, 0 AS depth
        FROM groups WHERE id = ${id}
        UNION ALL
        SELECT g.id, g.parent_id, g.name, g.node_type, d.depth + 1
        FROM groups g JOIN descendants d ON g.parent_id = d.id
      )
      SELECT * FROM descendants ORDER BY depth
    `);
    return c.json({ success: true, data: rows });
  });

  return app;
}
