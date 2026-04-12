import { Hono } from "hono";
import { eq, sql, and, gte, lte } from "drizzle-orm";
import { decisionLog } from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";

export function decisionsRoutes(db: DrizzleDB): Hono {
  const app = new Hono();

  // GET / — List decisions (filters: agentDid, outcome, dateRange; pagination)
  app.get("/", async (c) => {
    const agentDid = c.req.query("agentDid");
    const outcome = c.req.query("outcome");
    const after = c.req.query("after");
    const before = c.req.query("before");
    const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);

    const conditions = [];
    if (agentDid) {
      conditions.push(eq(decisionLog.agentDid, agentDid));
    }
    if (outcome) {
      conditions.push(
        sql`${decisionLog.outcome} = ${outcome}::decision_outcome`,
      );
    }
    if (after) {
      conditions.push(gte(decisionLog.evaluatedAt, new Date(after)));
    }
    if (before) {
      conditions.push(lte(decisionLog.evaluatedAt, new Date(before)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select()
      .from(decisionLog)
      .where(whereClause)
      .orderBy(sql`${decisionLog.evaluatedAt} DESC`)
      .limit(limit)
      .offset(offset);

    return c.json({ success: true, data: rows });
  });

  // GET /:id — Get single decision with envelope snapshot
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const rows = await db.select().from(decisionLog).where(eq(decisionLog.id, id));
    if (rows.length === 0) {
      return c.json({ success: false, error: "Decision not found" }, 404);
    }
    return c.json({ success: true, data: rows[0] });
  });

  return app;
}
