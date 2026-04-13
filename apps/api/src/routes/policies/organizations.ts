import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { organizations, groups, seedDefaultTools, ORG_ID } from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";
import { z } from "zod";

const CreateOrgSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
});

export function organizationsRoutes(db: DrizzleDB): Hono {
  const app = new Hono();

  // GET / — List organizations (scoped to authenticated org)
  app.get("/", async (c) => {
    const orgId = c.get("orgId") ?? ORG_ID;
    const rows = await db.select().from(organizations).where(eq(organizations.id, orgId));
    return c.json({ success: true, data: rows });
  });

  // POST / — Create organization + root group
  app.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreateOrgSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.format() }, 400);
    }

    // Check for duplicate slug
    const existing = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, parsed.data.slug));
    if (existing.length > 0) {
      return c.json({ success: false, error: "Organization slug already exists" }, 409);
    }

    // Create org, root group, and default tools in a transaction
    const result = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          name: parsed.data.name,
          slug: parsed.data.slug,
          policyVersion: 0,
        })
        .returning();

      const [rootGroup] = await tx
        .insert(groups)
        .values({
          orgId: org!.id,
          name: parsed.data.name,
          nodeType: "org",
          parentId: null,
        })
        .returning();

      // Seed default action types for the new org
      await seedDefaultTools(tx, org!.id);

      return { org: org!, rootGroup: rootGroup! };
    });

    return c.json({ success: true, data: result }, 201);
  });

  // GET /:id — Get organization by ID (scoped to authenticated org)
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const orgId = c.get("orgId") ?? ORG_ID;
    // Only allow access to the authenticated org
    if (id !== orgId) {
      return c.json({ success: false, error: "Organization not found" }, 404);
    }
    const rows = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id));
    if (rows.length === 0) {
      return c.json({ success: false, error: "Organization not found" }, 404);
    }
    return c.json({ success: true, data: rows[0] });
  });

  return app;
}
