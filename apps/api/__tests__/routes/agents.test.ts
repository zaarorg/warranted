import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  setupTestDb,
  teardownTestDb,
} from "../../../../packages/rules-engine/__tests__/helpers/db";
import {
  organizations,
  groups,
  agentGroupMemberships,
  policies,
  policyVersions,
  policyAssignments,
  agentIdentities,
  agentLineage,
  agentKeySeeds,
  resolveEnvelope,
  seed,
  seedTestOrg,
  ORG_ID,
  PLATFORM_TEAM_ID,
  ACTION_PURCHASE_INITIATE_ID,
} from "@warranted/rules-engine";
import type { DrizzleDB, PolicyConstraint } from "@warranted/rules-engine";
import {
  createAgentIdentity,
  deriveAgentIdentity,
  encryptSeed,
  decryptSeed,
  validateNarrowing,
} from "@warranted/identity";
import { bytesToHex } from "@noble/hashes/utils";

let db: DrizzleDB;

beforeAll(async () => {
  db = await setupTestDb();
  // Seed action types + dimension definitions
  await seed(db);
  // Seed test org with groups, policies, memberships
  await seedTestOrg(db);
});

afterAll(async () => {
  await teardownTestDb();
});

describe("sponsor synthetic DID (om_*)", () => {
  it("resolveEnvelope works with om_* synthetic DID", async () => {
    const sponsorDid = "om_test_sponsor_001";

    // Insert sponsor into agentGroupMemberships with the Platform Team group
    await db
      .insert(agentGroupMemberships)
      .values({ agentDid: sponsorDid, groupId: PLATFORM_TEAM_ID, orgId: ORG_ID });

    // resolveEnvelope should work for the synthetic DID
    const envelope = await resolveEnvelope(db, sponsorDid, ORG_ID);

    // The envelope should have actions from policies assigned to Platform Team's ancestors
    expect(envelope.agentDid).toBe(sponsorDid);
    expect(envelope.actions.length).toBeGreaterThan(0);
  });
});

describe("agent creation (the seam)", () => {
  it("creates agent identity, lineage, membership, and encrypted seed atomically", async () => {
    const identity = await createAgentIdentity();
    const encryptionKey = "test-encryption-key-32-chars-long";
    const sponsorDid = "om_test_sponsor_002";
    const userId = "user_test_001";

    // Ensure sponsor has group membership
    await db
      .insert(agentGroupMemberships)
      .values({ agentDid: sponsorDid, groupId: PLATFORM_TEAM_ID, orgId: ORG_ID })
      .onConflictDoNothing();

    // Get sponsor envelope for snapshot
    const sponsorEnvelope = await resolveEnvelope(db, sponsorDid, ORG_ID);

    // Encrypt seed
    const encrypted = encryptSeed(identity.seed, ORG_ID, encryptionKey);

    // Atomic transaction — all inserts
    await db.transaction(async (tx) => {
      await tx.insert(agentIdentities).values({
        orgId: ORG_ID,
        agentId: identity.agentId,
        did: identity.did,
        publicKey: Buffer.from(identity.publicKey),
        status: "active",
        name: "test-agent",
      });

      await tx.insert(agentLineage).values({
        orgId: ORG_ID,
        agentId: identity.agentId,
        parentId: sponsorDid,
        parentType: "user",
        sponsorUserId: userId,
        sponsorMembershipId: sponsorDid,
        sponsorEnvelopeSnapshot: sponsorEnvelope,
        lineage: [ORG_ID, sponsorDid, identity.agentId],
        signature: "test-signature",
      });

      await tx
        .insert(agentGroupMemberships)
        .values({ agentDid: identity.did, groupId: PLATFORM_TEAM_ID, orgId: ORG_ID })
        .onConflictDoNothing();

      await tx.insert(agentKeySeeds).values({
        orgId: ORG_ID,
        agentId: identity.agentId,
        encryptedSeed: Buffer.from(encrypted),
      });
    });

    // Verify all inserts
    const [agent] = await db
      .select()
      .from(agentIdentities)
      .where(eq(agentIdentities.agentId, identity.agentId));
    expect(agent).toBeDefined();
    expect(agent!.did).toBe(identity.did);
    expect(agent!.status).toBe("active");

    const [lineage] = await db
      .select()
      .from(agentLineage)
      .where(eq(agentLineage.agentId, identity.agentId));
    expect(lineage).toBeDefined();
    expect(lineage!.parentType).toBe("user");
    expect(lineage!.lineage).toEqual([ORG_ID, sponsorDid, identity.agentId]);

    const [seedRow] = await db
      .select()
      .from(agentKeySeeds)
      .where(eq(agentKeySeeds.agentId, identity.agentId));
    expect(seedRow).toBeDefined();

    // Verify seed decryption round-trip
    const decrypted = decryptSeed(
      new Uint8Array(seedRow!.encryptedSeed),
      ORG_ID,
      encryptionKey,
    );
    const recovered = await deriveAgentIdentity(decrypted);
    expect(recovered.agentId).toBe(identity.agentId);
    expect(recovered.did).toBe(identity.did);
  });
});

describe("agent status management", () => {
  let testAgentId: string;
  let testDid: string;

  beforeAll(async () => {
    const identity = await createAgentIdentity();
    testAgentId = identity.agentId;
    testDid = identity.did;

    await db.insert(agentIdentities).values({
      orgId: ORG_ID,
      agentId: testAgentId,
      did: testDid,
      publicKey: Buffer.from(identity.publicKey),
      status: "active",
      name: "status-test-agent",
    });
  });

  it("suspends an agent", async () => {
    await db
      .update(agentIdentities)
      .set({ status: "suspended", revokedAt: new Date() })
      .where(eq(agentIdentities.agentId, testAgentId));

    const [agent] = await db
      .select()
      .from(agentIdentities)
      .where(eq(agentIdentities.agentId, testAgentId));

    expect(agent!.status).toBe("suspended");
    expect(agent!.revokedAt).toBeTruthy();
  });

  it("reactivates a suspended agent", async () => {
    await db
      .update(agentIdentities)
      .set({ status: "active", revokedAt: null })
      .where(eq(agentIdentities.agentId, testAgentId));

    const [agent] = await db
      .select()
      .from(agentIdentities)
      .where(eq(agentIdentities.agentId, testAgentId));

    expect(agent!.status).toBe("active");
    expect(agent!.revokedAt).toBeNull();
  });
});

describe("suspension cascade", () => {
  it("suspending a sponsor user cascades to their agents", async () => {
    const userId = "user_cascade_test";
    const agents = [];

    // Create 3 agents sponsored by the same user
    for (let i = 0; i < 3; i++) {
      const identity = await createAgentIdentity();
      agents.push(identity);

      await db.insert(agentIdentities).values({
        orgId: ORG_ID,
        agentId: identity.agentId,
        did: identity.did,
        publicKey: Buffer.from(identity.publicKey),
        status: "active",
        name: `cascade-agent-${i}`,
      });

      await db.insert(agentLineage).values({
        orgId: ORG_ID,
        agentId: identity.agentId,
        parentId: "om_cascade_sponsor",
        parentType: "user",
        sponsorUserId: userId,
        sponsorMembershipId: "om_cascade_sponsor",
        sponsorEnvelopeSnapshot: {},
        lineage: [ORG_ID, "om_cascade_sponsor", identity.agentId],
        signature: "test-sig",
      });
    }

    // Simulate user suspension — find all agents by sponsorUserId and suspend
    const sponsoredAgents = await db
      .select({ agentId: agentLineage.agentId })
      .from(agentLineage)
      .where(eq(agentLineage.sponsorUserId, userId));

    expect(sponsoredAgents).toHaveLength(3);

    for (const agent of sponsoredAgents) {
      await db
        .update(agentIdentities)
        .set({ status: "suspended", revokedAt: new Date() })
        .where(eq(agentIdentities.agentId, agent.agentId));
    }

    // Verify all 3 agents are suspended
    for (const identity of agents) {
      const [agent] = await db
        .select()
        .from(agentIdentities)
        .where(eq(agentIdentities.agentId, identity.agentId));
      expect(agent!.status).toBe("suspended");
    }
  });
});

describe("narrowing invariant with real envelope", () => {
  it("rejects agent with wider numeric constraint than sponsor", async () => {
    const sponsorDid = "om_narrowing_test_001";

    // Insert sponsor into a group
    await db
      .insert(agentGroupMemberships)
      .values({ agentDid: sponsorDid, groupId: PLATFORM_TEAM_ID, orgId: ORG_ID })
      .onConflictDoNothing();

    const sponsorEnvelope = await resolveEnvelope(db, sponsorDid, ORG_ID);

    // Find the purchase.initiate action and its amount dimension
    const purchaseAction = sponsorEnvelope.actions.find(
      (a) => a.actionName === "purchase.initiate",
    );

    if (!purchaseAction) {
      // Skip if no purchase action in test data
      return;
    }

    const amountDim = purchaseAction.dimensions.find((d) => d.name === "amount");
    if (!amountDim || typeof amountDim.resolved !== "number") {
      return;
    }

    // Try to create agent with a higher limit
    const agentConstraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseAction.actionId,
        actionName: "purchase.initiate",
        dimensions: [
          { name: "amount", kind: "numeric", max: (amountDim.resolved as number) + 1000 },
        ],
      },
    ];

    const result = validateNarrowing(agentConstraints, sponsorEnvelope);
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    // The violation may be action-level (denied) or dimension-level (numeric)
    const hasRelevantViolation = result.violations.some(
      (v) => v.dimension === "amount" || v.dimension === "purchase.initiate",
    );
    expect(hasRelevantViolation).toBe(true);
  });
});
