import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import {
  agentIdentities,
  agentLineage,
  agentKeySeeds,
  agentGroupMemberships,
  policyAssignments,
  resolveEnvelope,
} from "@warranted/rules-engine";
import type { DrizzleDB, PolicyConstraint } from "@warranted/rules-engine";
import {
  createAgentIdentity,
  encryptSeed,
  validateNarrowing,
} from "@warranted/identity";
import { bytesToHex } from "@noble/hashes/utils";
import type { RedisClient } from "../../redis";
import type { AuthEnv } from "./types";

const MAX_LINEAGE_DEPTH = 5;

const CreateAgentSchema = z.object({
  name: z.string().min(1).max(255),
  groupId: z.string().uuid(),
  policyIds: z.array(z.string().uuid()).min(1),
  parentType: z.enum(["user", "agent"]).default("user"),
  /** For agent-spawned agents, the parent agent's DID */
  parentAgentDid: z.string().optional(),
  /** WorkOS organization membership ID (om_*) for the sponsor */
  sponsorMembershipId: z.string().min(1),
});

export interface CreateAgentDeps {
  db: DrizzleDB;
  redis: RedisClient | null;
  encryptionKey: string;
}

export function createAgentRoute(deps: CreateAgentDeps): Hono<AuthEnv> {
  const { db, redis, encryptionKey } = deps;
  const app = new Hono<AuthEnv>();

  app.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreateAgentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.format() }, 400);
    }

    const orgId = c.get("orgId") as string | undefined;
    const userId = c.get("userId") as string | undefined;

    if (!orgId || !userId) {
      return c.json({ success: false, error: "Organization context required" }, 401);
    }

    const {
      name,
      groupId,
      policyIds,
      parentType,
      parentAgentDid,
      sponsorMembershipId,
    } = parsed.data;

    // Determine the sponsor's synthetic DID (om_* for users, agent_* for agents)
    const sponsorDid = parentType === "user" ? sponsorMembershipId : parentAgentDid;
    if (!sponsorDid) {
      return c.json({ success: false, error: "Sponsor identity required" }, 400);
    }

    // Ensure sponsor has a membership row in agentGroupMemberships
    // so that resolveEnvelope can find them
    const existingMembership = await db
      .select()
      .from(agentGroupMemberships)
      .where(eq(agentGroupMemberships.agentDid, sponsorDid));

    if (existingMembership.length === 0) {
      // Auto-insert sponsor into the requested group for envelope resolution
      await db
        .insert(agentGroupMemberships)
        .values({ agentDid: sponsorDid, groupId })
        .onConflictDoNothing();
    }

    // 1. Resolve sponsor's envelope
    const sponsorEnvelope = await resolveEnvelope(db, sponsorDid, orgId);

    // If sponsor has no policies, we can't validate narrowing
    if (sponsorEnvelope.actions.length === 0) {
      return c.json(
        { success: false, error: "Sponsor has no effective policies — cannot create agent" },
        400,
      );
    }

    // 2. Load requested policy constraints for narrowing validation
    const { policies, policyVersions } = await import("@warranted/rules-engine");
    const policyData = [];
    for (const policyId of policyIds) {
      const [policy] = await db
        .select()
        .from(policies)
        .where(eq(policies.id, policyId));
      if (!policy || !policy.activeVersionId) continue;

      const [version] = await db
        .select()
        .from(policyVersions)
        .where(eq(policyVersions.id, policy.activeVersionId));
      if (!version) continue;

      policyData.push({
        policyId: policy.id,
        constraints: version.constraints as PolicyConstraint[],
      });
    }

    const agentConstraints = policyData.flatMap((p) => p.constraints);

    // 3. Validate narrowing invariant
    const narrowingResult = validateNarrowing(agentConstraints, sponsorEnvelope);
    if (!narrowingResult.valid) {
      return c.json(
        {
          success: false,
          error: "Agent policy exceeds sponsor's envelope",
          violations: narrowingResult.violations,
        },
        400,
      );
    }

    // 4. Validate lineage depth for agent-spawned agents
    if (parentType === "agent" && parentAgentDid) {
      const parentLineage = await db
        .select()
        .from(agentLineage)
        .where(eq(agentLineage.agentId, parentAgentDid));

      if (parentLineage.length > 0) {
        const parentChain = parentLineage[0]!.lineage as string[];
        if (parentChain.length + 1 > MAX_LINEAGE_DEPTH) {
          return c.json(
            { success: false, error: `Maximum lineage depth of ${MAX_LINEAGE_DEPTH} exceeded` },
            400,
          );
        }
      }
    }

    // 5. Generate agent identity
    const identity = await createAgentIdentity();

    // 6. Build lineage record
    const lineageArray = parentType === "user"
      ? [orgId, sponsorMembershipId, identity.agentId]
      : (() => {
          // For agent-spawned, prepend the parent's lineage
          return [orgId, sponsorMembershipId, parentAgentDid!, identity.agentId];
        })();

    // 7. Encrypt seed
    const encryptedSeed = encryptSeed(identity.seed, orgId, encryptionKey);

    // 8. Atomic transaction — all 6 inserts
    try {
      await db.transaction(async (tx) => {
        // Insert agent identity
        await tx.insert(agentIdentities).values({
          orgId,
          agentId: identity.agentId,
          did: identity.did,
          publicKey: Buffer.from(identity.publicKey),
          status: "active",
          name,
        });

        // Insert lineage record
        await tx.insert(agentLineage).values({
          orgId,
          agentId: identity.agentId,
          parentId: sponsorDid,
          parentType,
          sponsorUserId: userId,
          sponsorMembershipId,
          sponsorEnvelopeSnapshot: sponsorEnvelope,
          lineage: lineageArray,
          signature: "pending", // TODO: sign lineage record
        });

        // Insert group membership
        await tx
          .insert(agentGroupMemberships)
          .values({ agentDid: identity.did, groupId })
          .onConflictDoNothing();

        // Insert policy assignments
        for (const policyId of policyIds) {
          await tx.insert(policyAssignments).values({
            policyId,
            agentDid: identity.did,
          });
        }

        // Insert encrypted seed
        await tx.insert(agentKeySeeds).values({
          orgId,
          agentId: identity.agentId,
          encryptedSeed: Buffer.from(encryptedSeed),
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, error: `Agent creation failed: ${message}` }, 500);
    }

    // 9. Write status to Redis (outside transaction — non-critical)
    if (redis) {
      try {
        await redis.set(`${orgId}:status:${identity.agentId}`, "active");
      } catch {
        // Redis write failure is non-fatal
      }
    }

    // 10. Return response (seed returned ONCE)
    return c.json(
      {
        success: true,
        data: {
          agentId: identity.agentId,
          did: identity.did,
          seed: bytesToHex(identity.seed),
          publicKey: bytesToHex(identity.publicKey),
          lineage: lineageArray,
        },
      },
      201,
    );
  });

  return app;
}
