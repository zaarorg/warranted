import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { seed, seedTestOrg } from "../src/seed";
import { resolveEnvelope } from "../src/envelope";
import type { DrizzleDB } from "../src/envelope";
import {
  ORG_ID,
  AGENT_DID,
  ACME_GROUP_ID,
  ENGINEERING_DEPT_ID,
  PLATFORM_TEAM_ID,
  FINANCE_DEPT_ID,
  AP_TEAM_ID,
  ACTION_PURCHASE_INITIATE_ID,
} from "../src/seed";
import * as schema from "../src/schema";
import { generateCedar } from "../src/cedar-gen";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";

let db: DrizzleDB;

beforeAll(async () => {
  db = await setupTestDb();
  await seed(db);
  await seedTestOrg(db);
}, 30_000);

afterAll(async () => {
  await teardownTestDb();
}, 10_000);

describe("envelope resolution", () => {
  it("resolves numeric dimensions to minimum across hierarchy", async () => {
    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find((a) => a.actionName === "purchase.initiate");
    expect(purchaseAction).toBeDefined();

    const amountDim = purchaseAction!.dimensions.find((d) => d.name === "amount");
    expect(amountDim).toBeDefined();
    // Org: 5000, Dept (Engineering): 2000, Team (Platform): 1000 → min = 1000
    expect(amountDim!.resolved).toBe(1000);
  });

  it("resolves set dimensions to intersection across hierarchy", async () => {
    // Add a team-level vendor policy that narrows the set
    const teamVendorPolicyId = "00000000-0000-0000-0000-0000000009a0";
    const teamVendorPvId = "00000000-0000-0000-0000-0000000009a1";
    const teamTarget = `Group::"${PLATFORM_TEAM_ID}"`;

    const constraints = [
      {
        actionTypeId: ACTION_PURCHASE_INITIATE_ID,
        actionName: "purchase.initiate",
        dimensions: [{ name: "vendor", kind: "set" as const, members: ["aws", "gcp"] }],
      },
    ];

    const cedar = generateCedar("platform-team-vendors", 1, "allow", constraints, teamTarget);
    const hash = createHash("sha256").update(cedar).digest("hex");

    await db.insert(schema.policies).values({
      id: teamVendorPolicyId,
      orgId: ORG_ID,
      name: "platform-team-vendors",
      domain: "finance",
      effect: "allow",
      activeVersionId: null,
    });
    await db.insert(schema.policyVersions).values({
      id: teamVendorPvId,
      policyId: teamVendorPolicyId,
      versionNumber: 1,
      constraints,
      cedarSource: cedar,
      cedarHash: hash,
      createdBy: "test",
    });
    await db
      .update(schema.policies)
      .set({ activeVersionId: teamVendorPvId })
      .where(sql`${schema.policies.id} = ${teamVendorPolicyId}`);
    await db.insert(schema.policyAssignments).values({
      policyId: teamVendorPolicyId,
      groupId: PLATFORM_TEAM_ID,
      agentDid: null,
    });

    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find((a) => a.actionName === "purchase.initiate");
    const vendorDim = purchaseAction!.dimensions.find((d) => d.name === "vendor");
    expect(vendorDim).toBeDefined();

    // Org: [aws, azure, gcp, github, vercel, railway, vendor-acme-001], Team: [aws, gcp]
    // Intersection = [aws, gcp]
    const resolved = vendorDim!.resolved as string[];
    expect(resolved).toContain("aws");
    expect(resolved).toContain("gcp");
    expect(resolved).not.toContain("azure");
    expect(resolved).not.toContain("github");
  });

  it("resolves gate boolean dimensions (restrictive=true) to true if any source is true", async () => {
    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find((a) => a.actionName === "purchase.initiate");
    const humanApproval = purchaseAction!.dimensions.find(
      (d) => d.name === "requires_human_approval",
    );
    expect(humanApproval).toBeDefined();
    // escalation-threshold sets requires_human_approval: true, restrictive: true
    // Gate boolean: any true wins → true
    expect(humanApproval!.resolved).toBe(true);
  });

  it("resolves permission boolean dimensions (restrictive=false) to false if any source is false", async () => {
    // Create two policies at different levels: org true, team false
    const orgPermPolicyId = "00000000-0000-0000-0000-0000000009b0";
    const orgPermPvId = "00000000-0000-0000-0000-0000000009b1";
    const teamPermPolicyId = "00000000-0000-0000-0000-0000000009b2";
    const teamPermPvId = "00000000-0000-0000-0000-0000000009b3";

    const orgConstraints = [
      {
        actionTypeId: ACTION_PURCHASE_INITIATE_ID,
        actionName: "purchase.initiate",
        dimensions: [
          {
            name: "allow_external_vendors",
            kind: "boolean" as const,
            value: true,
            restrictive: false,
          },
        ],
      },
    ];
    const teamConstraints = [
      {
        actionTypeId: ACTION_PURCHASE_INITIATE_ID,
        actionName: "purchase.initiate",
        dimensions: [
          {
            name: "allow_external_vendors",
            kind: "boolean" as const,
            value: false,
            restrictive: false,
          },
        ],
      },
    ];

    const orgTarget = `Group::"${ACME_GROUP_ID}"`;
    const teamTarget = `Group::"${PLATFORM_TEAM_ID}"`;

    // Insert org-level
    const orgCedar = generateCedar("org-allow-external", 1, "allow", orgConstraints, orgTarget);
    await db.insert(schema.policies).values({
      id: orgPermPolicyId,
      orgId: ORG_ID,
      name: "org-allow-external",
      domain: "finance",
      effect: "allow",
      activeVersionId: null,
    });
    await db.insert(schema.policyVersions).values({
      id: orgPermPvId,
      policyId: orgPermPolicyId,
      versionNumber: 1,
      constraints: orgConstraints,
      cedarSource: orgCedar,
      cedarHash: createHash("sha256").update(orgCedar).digest("hex"),
      createdBy: "test",
    });
    await db
      .update(schema.policies)
      .set({ activeVersionId: orgPermPvId })
      .where(sql`${schema.policies.id} = ${orgPermPolicyId}`);
    await db.insert(schema.policyAssignments).values({
      policyId: orgPermPolicyId,
      groupId: ACME_GROUP_ID,
      agentDid: null,
    });

    // Insert team-level
    const teamCedar = generateCedar(
      "team-block-external",
      1,
      "allow",
      teamConstraints,
      teamTarget,
    );
    await db.insert(schema.policies).values({
      id: teamPermPolicyId,
      orgId: ORG_ID,
      name: "team-block-external",
      domain: "finance",
      effect: "allow",
      activeVersionId: null,
    });
    await db.insert(schema.policyVersions).values({
      id: teamPermPvId,
      policyId: teamPermPolicyId,
      versionNumber: 1,
      constraints: teamConstraints,
      cedarSource: teamCedar,
      cedarHash: createHash("sha256").update(teamCedar).digest("hex"),
      createdBy: "test",
    });
    await db
      .update(schema.policies)
      .set({ activeVersionId: teamPermPvId })
      .where(sql`${schema.policies.id} = ${teamPermPolicyId}`);
    await db.insert(schema.policyAssignments).values({
      policyId: teamPermPolicyId,
      groupId: PLATFORM_TEAM_ID,
      agentDid: null,
    });

    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find((a) => a.actionName === "purchase.initiate");
    const extVendorDim = purchaseAction!.dimensions.find(
      (d) => d.name === "allow_external_vendors",
    );
    expect(extVendorDim).toBeDefined();
    // Permission boolean (restrictive=false): any false → false
    expect(extVendorDim!.resolved).toBe(false);
  });

  it("resolves temporal dimensions to earliest expiry", async () => {
    // Add a team-level temporal policy with earlier expiry
    const teamTempPolicyId = "00000000-0000-0000-0000-0000000009c0";
    const teamTempPvId = "00000000-0000-0000-0000-0000000009c1";
    const teamTarget = `Group::"${PLATFORM_TEAM_ID}"`;

    const constraints = [
      {
        actionTypeId: ACTION_PURCHASE_INITIATE_ID,
        actionName: "purchase.initiate",
        dimensions: [{ name: "cooling_off_expiry", kind: "temporal" as const, expiry: "2026-06-30" }],
      },
    ];

    const cedar = generateCedar("team-expiry", 1, "allow", constraints, teamTarget);
    await db.insert(schema.policies).values({
      id: teamTempPolicyId,
      orgId: ORG_ID,
      name: "team-expiry",
      domain: "finance",
      effect: "allow",
      activeVersionId: null,
    });
    await db.insert(schema.policyVersions).values({
      id: teamTempPvId,
      policyId: teamTempPolicyId,
      versionNumber: 1,
      constraints,
      cedarSource: cedar,
      cedarHash: createHash("sha256").update(cedar).digest("hex"),
      createdBy: "test",
    });
    await db
      .update(schema.policies)
      .set({ activeVersionId: teamTempPvId })
      .where(sql`${schema.policies.id} = ${teamTempPolicyId}`);
    await db.insert(schema.policyAssignments).values({
      policyId: teamTempPolicyId,
      groupId: PLATFORM_TEAM_ID,
      agentDid: null,
    });

    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find((a) => a.actionName === "purchase.initiate");
    const expiryDim = purchaseAction!.dimensions.find((d) => d.name === "cooling_off_expiry");
    expect(expiryDim).toBeDefined();
    // Org: 2026-12-31, Team: 2026-06-30 → earliest = 2026-06-30
    expect(expiryDim!.resolved).toBe("2026-06-30");
  });

  it("resolves rate dimensions to minimum limit", async () => {
    // Add a team-level rate policy with lower limit
    const teamRatePolicyId = "00000000-0000-0000-0000-0000000009d0";
    const teamRatePvId = "00000000-0000-0000-0000-0000000009d1";
    const teamTarget = `Group::"${PLATFORM_TEAM_ID}"`;

    const constraints = [
      {
        actionTypeId: ACTION_PURCHASE_INITIATE_ID,
        actionName: "purchase.initiate",
        dimensions: [{ name: "transactions", kind: "rate" as const, limit: 5, window: "1 hour" }],
      },
    ];

    const cedar = generateCedar("team-rate", 1, "allow", constraints, teamTarget);
    await db.insert(schema.policies).values({
      id: teamRatePolicyId,
      orgId: ORG_ID,
      name: "team-rate-limit",
      domain: "finance",
      effect: "allow",
      activeVersionId: null,
    });
    await db.insert(schema.policyVersions).values({
      id: teamRatePvId,
      policyId: teamRatePolicyId,
      versionNumber: 1,
      constraints,
      cedarSource: cedar,
      cedarHash: createHash("sha256").update(cedar).digest("hex"),
      createdBy: "test",
    });
    await db
      .update(schema.policies)
      .set({ activeVersionId: teamRatePvId })
      .where(sql`${schema.policies.id} = ${teamRatePolicyId}`);
    await db.insert(schema.policyAssignments).values({
      policyId: teamRatePolicyId,
      groupId: PLATFORM_TEAM_ID,
      agentDid: null,
    });

    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find((a) => a.actionName === "purchase.initiate");
    const rateDim = purchaseAction!.dimensions.find((d) => d.name === "transactions");
    expect(rateDim).toBeDefined();
    // Org: 10/hour, Team: 5/hour → min = 5
    expect(rateDim!.resolved).toBe(5);
  });

  it("deny policy overrides all permits", async () => {
    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find((a) => a.actionName === "purchase.initiate");
    expect(purchaseAction).toBeDefined();
    // hard-transaction-cap and sanctioned-vendors are deny policies
    expect(purchaseAction!.denied).toBe(true);
    expect(purchaseAction!.denySource).toBeTruthy();
  });

  it("includes full provenance chain in sources", async () => {
    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find((a) => a.actionName === "purchase.initiate");
    const amountDim = purchaseAction!.dimensions.find((d) => d.name === "amount");
    expect(amountDim).toBeDefined();
    expect(amountDim!.sources.length).toBeGreaterThanOrEqual(3);

    // Check provenance from org, dept, team levels
    const levels = amountDim!.sources.map((s) => s.level);
    expect(levels).toContain("org");
    expect(levels).toContain("department");
    expect(levels).toContain("team");

    // Check values at each level
    const orgSource = amountDim!.sources.find((s) => s.level === "org");
    const deptSource = amountDim!.sources.find((s) => s.level === "department");
    const teamSource = amountDim!.sources.find((s) => s.level === "team");
    expect(orgSource!.value).toBe(5000);
    expect(deptSource!.value).toBe(2000);
    expect(teamSource!.value).toBe(1000);
  });

  it("handles agent in multiple groups (most restrictive wins)", async () => {
    // Add agent to Finance > AP team as well
    await db.insert(schema.agentGroupMemberships).values({
      agentDid: AGENT_DID,
      groupId: AP_TEAM_ID,
      orgId: ORG_ID,
    });

    // Add AP team spending policy with amount max 500
    const apPolicyId = "00000000-0000-0000-0000-0000000009e0";
    const apPvId = "00000000-0000-0000-0000-0000000009e1";
    const apTarget = `Group::"${AP_TEAM_ID}"`;

    const constraints = [
      {
        actionTypeId: ACTION_PURCHASE_INITIATE_ID,
        actionName: "purchase.initiate",
        dimensions: [{ name: "amount", kind: "numeric" as const, max: 500 }],
      },
    ];
    const cedar = generateCedar("ap-team-spending", 1, "allow", constraints, apTarget);

    await db.insert(schema.policies).values({
      id: apPolicyId,
      orgId: ORG_ID,
      name: "ap-team-spending",
      domain: "finance",
      effect: "allow",
      activeVersionId: null,
    });
    await db.insert(schema.policyVersions).values({
      id: apPvId,
      policyId: apPolicyId,
      versionNumber: 1,
      constraints,
      cedarSource: cedar,
      cedarHash: createHash("sha256").update(cedar).digest("hex"),
      createdBy: "test",
    });
    await db
      .update(schema.policies)
      .set({ activeVersionId: apPvId })
      .where(sql`${schema.policies.id} = ${apPolicyId}`);
    await db.insert(schema.policyAssignments).values({
      policyId: apPolicyId,
      groupId: AP_TEAM_ID,
      agentDid: null,
    });

    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find((a) => a.actionName === "purchase.initiate");
    const amountDim = purchaseAction!.dimensions.find((d) => d.name === "amount");
    expect(amountDim).toBeDefined();
    // Platform team: 1000, AP team: 500 → min across all paths = 500
    expect(amountDim!.resolved).toBe(500);

    // Cleanup: remove AP membership for other tests
    await db.execute(
      sql`DELETE FROM agent_group_memberships WHERE agent_did = ${AGENT_DID} AND group_id = ${AP_TEAM_ID}`,
    );
  });

  it("direct agent assignment narrows further", async () => {
    // Add a direct agent-level policy with even lower spending
    const agentPolicyId = "00000000-0000-0000-0000-0000000009f0";
    const agentPvId = "00000000-0000-0000-0000-0000000009f1";

    const constraints = [
      {
        actionTypeId: ACTION_PURCHASE_INITIATE_ID,
        actionName: "purchase.initiate",
        dimensions: [{ name: "amount", kind: "numeric" as const, max: 200 }],
      },
    ];
    const cedar = generateCedar("agent-direct-limit", 1, "allow", constraints, `Agent::"${AGENT_DID}"`);

    await db.insert(schema.policies).values({
      id: agentPolicyId,
      orgId: ORG_ID,
      name: "agent-direct-limit",
      domain: "finance",
      effect: "allow",
      activeVersionId: null,
    });
    await db.insert(schema.policyVersions).values({
      id: agentPvId,
      policyId: agentPolicyId,
      versionNumber: 1,
      constraints,
      cedarSource: cedar,
      cedarHash: createHash("sha256").update(cedar).digest("hex"),
      createdBy: "test",
    });
    await db
      .update(schema.policies)
      .set({ activeVersionId: agentPvId })
      .where(sql`${schema.policies.id} = ${agentPolicyId}`);
    await db.insert(schema.policyAssignments).values({
      policyId: agentPolicyId,
      groupId: null,
      agentDid: AGENT_DID,
    });

    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find((a) => a.actionName === "purchase.initiate");
    const amountDim = purchaseAction!.dimensions.find((d) => d.name === "amount");
    expect(amountDim).toBeDefined();
    // Group hierarchy: 1000 (min of org/dept/team), Agent-level: 200 → 200
    expect(amountDim!.resolved).toBe(200);

    // Check agent-level provenance
    const agentSource = amountDim!.sources.find((s) => s.level === "agent");
    expect(agentSource).toBeDefined();
    expect(agentSource!.value).toBe(200);

    // Cleanup
    await db.execute(
      sql`DELETE FROM policy_assignments WHERE agent_did = ${AGENT_DID} AND policy_id = ${agentPolicyId}`,
    );
    await db.execute(sql`DELETE FROM policy_versions WHERE id = ${agentPvId}`);
    await db.execute(sql`DELETE FROM policies WHERE id = ${agentPolicyId}`);
  });

  it("returns empty actions when agent has no group memberships", async () => {
    const unknownDid = "did:mesh:0000000000000000000000000000000000000000";
    const envelope = await resolveEnvelope(db, unknownDid, ORG_ID);
    expect(envelope.agentDid).toBe(unknownDid);
    expect(envelope.actions).toEqual([]);
  });

  it("policyVersion matches org's current version", async () => {
    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    expect(envelope.policyVersion).toBe(1);
  });

  it("resolvedAt is a valid ISO 8601 string", async () => {
    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const parsed = new Date(envelope.resolvedAt);
    expect(parsed.toISOString()).toBe(envelope.resolvedAt);
  });
});
