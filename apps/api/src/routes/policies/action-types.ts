import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { actionTypes, dimensionDefinitions, ORG_ID } from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";

export function actionTypesRoutes(db: DrizzleDB): Hono {
  const app = new Hono();

  // GET / — List all action types with dimensions (org-scoped)
  app.get("/", async (c) => {
    const orgId = c.get("orgId") ?? ORG_ID;
    const types = await db.select().from(actionTypes).where(eq(actionTypes.orgId, orgId));
    const typeIds = types.map((t) => t.id);

    const dims = typeIds.length > 0
      ? await db.select().from(dimensionDefinitions).where(inArray(dimensionDefinitions.actionTypeId, typeIds))
      : [];

    const dimsByAction = new Map<string, typeof dims>();
    for (const dim of dims) {
      const existing = dimsByAction.get(dim.actionTypeId) ?? [];
      existing.push(dim);
      dimsByAction.set(dim.actionTypeId, existing);
    }

    const enriched = types.map((t) => ({
      ...t,
      dimensions: dimsByAction.get(t.id) ?? [],
    }));

    return c.json({ success: true, data: enriched });
  });

  // GET /:id — Get action type with dimension definitions (org-scoped)
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const orgId = c.get("orgId") ?? ORG_ID;
    const typeRows = await db.select().from(actionTypes).where(and(eq(actionTypes.id, id), eq(actionTypes.orgId, orgId)));
    if (typeRows.length === 0) {
      return c.json({ success: false, error: "Action type not found" }, 404);
    }

    const dims = await db
      .select()
      .from(dimensionDefinitions)
      .where(eq(dimensionDefinitions.actionTypeId, id));

    return c.json({
      success: true,
      data: {
        ...typeRows[0],
        dimensions: dims,
      },
    });
  });

  return app;
}
