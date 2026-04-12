import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  CheckRequestSchema,
  CedarEvaluator,
  initCedar,
  resolveEnvelope,
  decisionLog,
  actionTypes,
  agentIdentities,
  ORG_ID,
} from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";
import type { RedisClient } from "../../redis";

let evaluator: CedarEvaluator | null = null;

async function getEvaluator(db: DrizzleDB, orgId: string): Promise<CedarEvaluator> {
  if (!evaluator) {
    const engine = await initCedar();
    evaluator = new CedarEvaluator(engine);
    await evaluator.loadPolicySet(db, orgId);
  } else {
    await evaluator.reload(db, orgId);
  }
  return evaluator;
}

export function checkRoutes(db: DrizzleDB, redis?: RedisClient | null): Hono {
  const app = new Hono();

  // POST /check — Evaluate authorization (Cedar check)
  app.post("/check", async (c) => {
    const body = await c.req.json();
    const parsed = CheckRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.format() }, 400);
    }

    const orgId = (c.req.query("orgId") ?? ORG_ID);

    // Extract agent DID from principal early — needed for Redis check
    const principalMatch = parsed.data.principal.match(/^Agent::"(.+)"$/);
    const agentDid = principalMatch?.[1] ?? parsed.data.principal;

    // Check agent suspension status via Redis before Cedar evaluation
    if (redis) {
      try {
        // Look up the agent's agentId from their DID
        const [agent] = await db
          .select({ agentId: agentIdentities.agentId, orgId: agentIdentities.orgId })
          .from(agentIdentities)
          .where(eq(agentIdentities.did, agentDid));

        if (agent) {
          const statusKey = `${agent.orgId}:status:${agent.agentId}`;
          const status = await redis.get(statusKey);
          if (status === "suspended" || status === "revoked") {
            return c.json({
              success: true,
              data: {
                decision: "Deny" as const,
                diagnostics: [`Agent is ${status}`],
                engineCode: null,
                sdkCode: null,
                details: {},
              },
            });
          }
        }
      } catch {
        // Redis/DB lookup failure is non-fatal — fall through to Cedar
      }
    }

    const eval_ = await getEvaluator(db, orgId);
    const result = eval_.check(parsed.data);
    const bundleHash = eval_.getBundleHash();

    // Extract action name: Action::"purchase.initiate"
    const actionMatch = parsed.data.action.match(/^Action::"(.+)"$/);
    const actionName = actionMatch?.[1] ?? parsed.data.action;

    // Look up action type ID
    const actionTypeRows = await db
      .select({ id: actionTypes.id })
      .from(actionTypes)
      .where(eq(actionTypes.name, actionName));
    const actionTypeId = actionTypeRows[0]?.id;

    // Resolve envelope for snapshot
    let envelopeSnapshot = null;
    try {
      const envelope = await resolveEnvelope(db, agentDid, orgId);
      envelopeSnapshot = envelope;
    } catch {
      // Envelope resolution failure is non-fatal for logging
    }

    // Write decision log entry
    if (actionTypeId) {
      await db.insert(decisionLog).values({
        agentDid,
        actionTypeId,
        requestContext: parsed.data.context,
        bundleHash,
        outcome: result.decision === "Allow" ? "allow" : "deny",
        reason: result.diagnostics.join("; ") || null,
        engineErrorCode: result.engineCode,
        sdkErrorCode: result.sdkCode,
        envelopeSnapshot,
      });
    }

    return c.json({ success: true, data: result });
  });

  return app;
}
