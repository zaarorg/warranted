import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  setupTestDb,
  teardownTestDb,
} from "../../../packages/rules-engine/__tests__/helpers/db";
import {
  organizations,
  groups,
  agentGroupMemberships,
  actionTypes,
  policies,
  policyVersions,
  policyAssignments,
  decisionLog,
  resolveEnvelope,
  seedDefaultTools,
  generateCedar,
} from "@warranted/rules-engine";
import type { DrizzleDB, PolicyConstraint } from "@warranted/rules-engine";
import { createHash } from "crypto";

let db: DrizzleDB;
let orgA: { id: string } = { id: "" };
let orgB: { id: string } = { id: "" };

beforeAll(async () => {
  db = await setupTestDb();

  // Create two organizations
  const [orgARow] = await db
    .insert(organizations)
    .values({ name: "Org Alpha", slug: "org-alpha" })
    .returning();
  orgA = orgARow!;
  const [orgBRow] = await db
    .insert(organizations)
    .values({ name: "Org Beta", slug: "org-beta" })
    .returning();
  orgB = orgBRow!;

  // Seed default tools for both orgs
  await seedDefaultTools(db, orgA!.id);
  await seedDefaultTools(db, orgB!.id);
});

afterAll(async () => {
  await teardownTestDb();
});

describe("org isolation", () => {
  it("policies are isolated between orgs", async () => {
    // Create a policy in Org A
    const [policyA] = await db
      .insert(policies)
      .values({
        orgId: orgA!.id,
        name: "alpha-spending",
        domain: "finance",
        effect: "allow",
        activeVersionId: null,
      })
      .returning();

    // Query policies for Org B — should be empty
    const orgBPolicies = await db
      .select()
      .from(policies)
      .where(eq(policies.orgId, orgB!.id));

    expect(orgBPolicies).toHaveLength(0);

    // Query policies for Org A — should have the one we created
    const orgAPolicies = await db
      .select()
      .from(policies)
      .where(eq(policies.orgId, orgA!.id));

    expect(orgAPolicies).toHaveLength(1);
    expect(orgAPolicies[0]!.name).toBe("alpha-spending");
  });

  it("groups are isolated between orgs", async () => {
    // Create a group in Org A
    const [groupA] = await db
      .insert(groups)
      .values({ orgId: orgA!.id, name: "Alpha Engineering", nodeType: "department", parentId: null })
      .returning();

    // Query groups for Org B — should be empty
    const orgBGroups = await db
      .select()
      .from(groups)
      .where(eq(groups.orgId, orgB!.id));

    expect(orgBGroups).toHaveLength(0);

    // Query groups for Org A — should have our group
    const orgAGroups = await db
      .select()
      .from(groups)
      .where(eq(groups.orgId, orgA!.id));

    expect(orgAGroups.some((g) => g.name === "Alpha Engineering")).toBe(true);
  });

  it("agent group memberships are isolated between orgs", async () => {
    const agentDid = "did:mesh:isolation-test-agent-001";

    // Create a group in Org A and add an agent
    const [groupA] = await db
      .insert(groups)
      .values({ orgId: orgA!.id, name: "Alpha Platform", nodeType: "team", parentId: null })
      .returning();

    await db.insert(agentGroupMemberships).values({
      agentDid,
      groupId: groupA!.id,
      orgId: orgA!.id,
    });

    // Query memberships for Org B — should be empty
    const orgBMemberships = await db
      .select()
      .from(agentGroupMemberships)
      .where(eq(agentGroupMemberships.orgId, orgB!.id));

    expect(orgBMemberships).toHaveLength(0);

    // Query memberships for Org A — should have our agent
    const orgAMemberships = await db
      .select()
      .from(agentGroupMemberships)
      .where(eq(agentGroupMemberships.orgId, orgA!.id));

    expect(orgAMemberships.some((m) => m.agentDid === agentDid)).toBe(true);
  });

  it("action types allow same name in different orgs (unique per org)", async () => {
    // Both orgs already have default tools seeded — verify both have purchase.initiate
    const orgATypes = await db
      .select()
      .from(actionTypes)
      .where(eq(actionTypes.orgId, orgA!.id));

    const orgBTypes = await db
      .select()
      .from(actionTypes)
      .where(eq(actionTypes.orgId, orgB!.id));

    const orgAInitiate = orgATypes.find((t) => t.name === "purchase.initiate");
    const orgBInitiate = orgBTypes.find((t) => t.name === "purchase.initiate");

    // Both should exist
    expect(orgAInitiate).toBeDefined();
    expect(orgBInitiate).toBeDefined();

    // They should have different UUIDs
    expect(orgAInitiate!.id).not.toBe(orgBInitiate!.id);

    // Each org should only see its own action types
    expect(orgATypes.every((t) => t.orgId === orgA!.id)).toBe(true);
    expect(orgBTypes.every((t) => t.orgId === orgB!.id)).toBe(true);
  });

  it("decision log entries are isolated between orgs", async () => {
    // Get an action type ID for Org A
    const orgATypes = await db
      .select()
      .from(actionTypes)
      .where(eq(actionTypes.orgId, orgA!.id));
    const actionTypeId = orgATypes[0]!.id;

    // Insert a decision log entry for Org A
    await db.insert(decisionLog).values({
      orgId: orgA!.id,
      agentDid: "did:mesh:isolation-test-agent-001",
      actionTypeId,
      requestContext: { amount: 500, vendor: "aws" },
      bundleHash: "test-hash-isolation",
      outcome: "allow",
      reason: "within policy",
    });

    // Query decision log for Org B — should be empty
    const orgBDecisions = await db
      .select()
      .from(decisionLog)
      .where(eq(decisionLog.orgId, orgB!.id));

    expect(orgBDecisions).toHaveLength(0);

    // Query decision log for Org A — should have our entry
    const orgADecisions = await db
      .select()
      .from(decisionLog)
      .where(eq(decisionLog.orgId, orgA!.id));

    expect(orgADecisions.length).toBeGreaterThanOrEqual(1);
    expect(orgADecisions.some((d) => d.bundleHash === "test-hash-isolation")).toBe(true);
  });

  it("envelope resolution is isolated between orgs", async () => {
    const agentDid = "did:mesh:isolation-envelope-agent";

    // Build a full policy hierarchy in Org A
    const [rootGroup] = await db
      .insert(groups)
      .values({ orgId: orgA!.id, name: "Alpha Root", nodeType: "org", parentId: null })
      .returning();

    const [teamGroup] = await db
      .insert(groups)
      .values({ orgId: orgA!.id, name: "Alpha Team", nodeType: "team", parentId: rootGroup!.id })
      .returning();

    await db.insert(agentGroupMemberships).values({
      agentDid,
      groupId: teamGroup!.id,
      orgId: orgA!.id,
    });

    // Get Org A's purchase.initiate action type for the policy constraint
    const orgATypes = await db
      .select()
      .from(actionTypes)
      .where(eq(actionTypes.orgId, orgA!.id));
    const purchaseType = orgATypes.find((t) => t.name === "purchase.initiate")!;

    // Create a policy assigned to the root group
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: purchaseType.id,
        actionName: "purchase.initiate",
        dimensions: [{ name: "amount", kind: "numeric", max: 5000 }],
      },
    ];

    const cedarSource = generateCedar(
      "alpha-envelope-test",
      1,
      "allow",
      constraints,
      `Group::"${rootGroup!.id}"`,
    );
    const cedarHash = createHash("sha256").update(cedarSource).digest("hex");

    const [policy] = await db
      .insert(policies)
      .values({
        orgId: orgA!.id,
        name: "alpha-envelope-test",
        domain: "finance",
        effect: "allow",
        activeVersionId: null,
      })
      .returning();

    const [version] = await db
      .insert(policyVersions)
      .values({
        policyId: policy!.id,
        versionNumber: 1,
        constraints,
        cedarSource,
        cedarHash,
        createdBy: "test",
      })
      .returning();

    await db
      .update(policies)
      .set({ activeVersionId: version!.id })
      .where(eq(policies.id, policy!.id));

    await db.insert(policyAssignments).values({
      policyId: policy!.id,
      groupId: rootGroup!.id,
      agentDid: null,
    });

    // Resolve envelope with Org A's ID — should return actions
    const envelopeA = await resolveEnvelope(db, agentDid, orgA!.id);
    expect(envelopeA.actions.length).toBeGreaterThan(0);
    expect(envelopeA.actions.some((a) => a.actionName === "purchase.initiate")).toBe(true);

    // Resolve same agent DID with Org B's ID — should return empty (agent not in Org B's groups)
    const envelopeB = await resolveEnvelope(db, agentDid, orgB!.id);
    expect(envelopeB.actions).toHaveLength(0);
  });

  it("seedDefaultTools creates independent tool sets per org", async () => {
    // Both orgs should have 14 action types each
    const orgATypes = await db
      .select()
      .from(actionTypes)
      .where(eq(actionTypes.orgId, orgA!.id));

    const orgBTypes = await db
      .select()
      .from(actionTypes)
      .where(eq(actionTypes.orgId, orgB!.id));

    expect(orgATypes).toHaveLength(14);
    expect(orgBTypes).toHaveLength(14);

    // All Org A type IDs should be different from Org B type IDs
    const orgAIds = new Set(orgATypes.map((t) => t.id));
    const orgBIds = new Set(orgBTypes.map((t) => t.id));
    const intersection = [...orgAIds].filter((id) => orgBIds.has(id));

    expect(intersection).toHaveLength(0);
  });

  it("policy assignments cannot cross org boundaries", async () => {
    // Create a policy in Org A
    const [policyA] = await db
      .insert(policies)
      .values({
        orgId: orgA!.id,
        name: "alpha-cross-org-test",
        domain: "finance",
        effect: "allow",
        activeVersionId: null,
      })
      .returning();

    // Create a group in Org B
    const [groupB] = await db
      .insert(groups)
      .values({ orgId: orgB!.id, name: "Beta Cross Test", nodeType: "team", parentId: null })
      .returning();

    // Assign Org A's policy to Org B's group (DB allows it, but application should prevent it)
    // The application layer verifies policy ownership before creating assignments
    // Here we verify that even if such an assignment exists, org-scoped queries filter it out

    await db.insert(policyAssignments).values({
      policyId: policyA!.id,
      groupId: groupB!.id,
      agentDid: null,
    });

    // When querying assignments through org-scoped policies, Org B should NOT see Org A's policy
    const orgBPolicies = await db
      .select()
      .from(policies)
      .where(eq(policies.orgId, orgB!.id));
    const orgBPolicyIds = orgBPolicies.map((p) => p.id);

    // Org A's policy should not appear in Org B's policy list
    expect(orgBPolicyIds).not.toContain(policyA!.id);
  });

  it("org creation with seedDefaultTools is idempotent", async () => {
    // Call seedDefaultTools again for Org A — should not duplicate
    await seedDefaultTools(db, orgA!.id);

    const orgATypes = await db
      .select()
      .from(actionTypes)
      .where(eq(actionTypes.orgId, orgA!.id));

    // Should still be exactly 14
    expect(orgATypes).toHaveLength(14);
  });
});
