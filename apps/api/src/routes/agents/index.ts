import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import {
  agentIdentities,
  agentLineage,
  agentKeySeeds,
  resolveEnvelope,
  agentGroupMemberships,
} from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";
import { decryptSeed } from "@warranted/identity";
import { bytesToHex } from "@noble/hashes/utils";
import { createAgentRoute } from "./create";
import type { RedisClient } from "../../redis";
import type { AuthEnv } from "./types";

export interface AgentRouteDeps {
  db: DrizzleDB;
  redis: RedisClient | null;
  encryptionKey: string;
}

const StatusUpdateSchema = z.object({
  status: z.enum(["active", "suspended", "revoked"]),
});

export function agentRoutes(deps: AgentRouteDeps): Hono<AuthEnv> {
  const { db, redis, encryptionKey } = deps;
  const app = new Hono<AuthEnv>();

  // Mount the create route
  app.route("/create", createAgentRoute({ db, redis, encryptionKey }));

  // GET / — List agents for org
  app.get("/", async (c) => {
    const orgId = c.get("orgId") as string | undefined;
    if (!orgId) {
      return c.json({ success: false, error: "Organization context required" }, 401);
    }

    const agents = await db
      .select()
      .from(agentIdentities)
      .where(eq(agentIdentities.orgId, orgId));

    return c.json({ success: true, data: agents });
  });

  // GET /:did — Agent detail
  app.get("/:did", async (c) => {
    const did = c.req.param("did");
    const orgId = c.get("orgId") as string | undefined;
    if (!orgId) {
      return c.json({ success: false, error: "Organization context required" }, 401);
    }

    const [agent] = await db
      .select()
      .from(agentIdentities)
      .where(and(eq(agentIdentities.did, did), eq(agentIdentities.orgId, orgId)));

    if (!agent) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }

    // Get lineage
    const [lineage] = await db
      .select()
      .from(agentLineage)
      .where(eq(agentLineage.agentId, agent.agentId));

    // Get current envelope
    let envelope = null;
    try {
      envelope = await resolveEnvelope(db, did, orgId);
    } catch {
      // Envelope resolution failure is non-fatal
    }

    // Get group memberships
    const memberships = await db
      .select()
      .from(agentGroupMemberships)
      .where(eq(agentGroupMemberships.agentDid, did));

    return c.json({
      success: true,
      data: {
        identity: agent,
        lineage: lineage ?? null,
        envelope,
        memberships,
      },
    });
  });

  // GET /:did/seed — Re-download encrypted seed (org admin only)
  app.get("/:did/seed", async (c) => {
    const did = c.req.param("did");
    const orgId = c.get("orgId") as string | undefined;
    if (!orgId) {
      return c.json({ success: false, error: "Organization context required" }, 401);
    }

    const [agent] = await db
      .select()
      .from(agentIdentities)
      .where(and(eq(agentIdentities.did, did), eq(agentIdentities.orgId, orgId)));

    if (!agent) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }

    const [seedRow] = await db
      .select()
      .from(agentKeySeeds)
      .where(eq(agentKeySeeds.agentId, agent.agentId));

    if (!seedRow) {
      return c.json({ success: false, error: "Seed not found" }, 404);
    }

    const decrypted = decryptSeed(
      new Uint8Array(seedRow.encryptedSeed),
      orgId,
      encryptionKey,
    );

    return c.json({
      success: true,
      data: {
        agentId: agent.agentId,
        did: agent.did,
        seed: bytesToHex(decrypted),
      },
    });
  });

  // PATCH /:did/status — Suspend/revoke/reactivate agent
  app.patch("/:did/status", async (c) => {
    const did = c.req.param("did");
    const orgId = c.get("orgId") as string | undefined;
    if (!orgId) {
      return c.json({ success: false, error: "Organization context required" }, 401);
    }

    const body = await c.req.json();
    const parsed = StatusUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.format() }, 400);
    }

    const [agent] = await db
      .select()
      .from(agentIdentities)
      .where(and(eq(agentIdentities.did, did), eq(agentIdentities.orgId, orgId)));

    if (!agent) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }

    const newStatus = parsed.data.status;
    const now = new Date();

    // Update identity status
    await db
      .update(agentIdentities)
      .set({
        status: newStatus,
        revokedAt: newStatus === "active" ? null : now,
      })
      .where(eq(agentIdentities.did, did));

    // Update Redis status
    if (redis) {
      try {
        if (newStatus === "active") {
          await redis.del(`${orgId}:status:${agent.agentId}`);
        } else {
          await redis.set(`${orgId}:status:${agent.agentId}`, newStatus);
        }
      } catch {
        // Redis failure is non-fatal
      }
    }

    return c.json({
      success: true,
      data: { did, status: newStatus },
    });
  });

  return app;
}
