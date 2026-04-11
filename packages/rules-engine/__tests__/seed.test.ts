import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { seed } from "../src/seed";
import type { DrizzleDB } from "../src/envelope";
import {
  ORG_ID,
  ACME_GROUP_ID,
  FINANCE_DEPT_ID,
  ENGINEERING_DEPT_ID,
  OPERATIONS_DEPT_ID,
  AP_TEAM_ID,
  TREASURY_TEAM_ID,
  PLATFORM_TEAM_ID,
  MLAI_TEAM_ID,
  PROCUREMENT_TEAM_ID,
  AGENT_DID,
  ACTION_PURCHASE_INITIATE_ID,
  POLICY_AGENT_SPENDING_LIMIT_ID,
  POLICY_HARD_TRANSACTION_CAP_ID,
  POLICY_APPROVED_VENDORS_ID,
  POLICY_SANCTIONED_VENDORS_ID,
  POLICY_PERMITTED_CATEGORIES_ID,
  POLICY_HOURLY_RATE_LIMIT_ID,
  POLICY_DAILY_SPEND_CEILING_ID,
  POLICY_ESCALATION_THRESHOLD_ID,
  POLICY_COOLING_OFF_PERIOD_ID,
  POLICY_ENG_DEPT_SPENDING_ID,
  POLICY_PLATFORM_TEAM_SPENDING_ID,
} from "../src/seed";
import * as schema from "../src/schema";
import { eq, sql } from "drizzle-orm";

let db: DrizzleDB;

beforeAll(async () => {
  db = await setupTestDb();
  await seed(db);
}, 30_000);

afterAll(async () => {
  await teardownTestDb();
}, 10_000);

describe("seed data", () => {
  it("creates Acme Corp organization", async () => {
    const orgs = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, ORG_ID));
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.name).toBe("Acme Corp");
    expect(orgs[0]!.slug).toBe("acme-corp");
    expect(orgs[0]!.policyVersion).toBe(1);
  });

  it("creates correct group hierarchy", async () => {
    const groups = await db.select().from(schema.groups);
    // 1 org root + 3 departments + 5 teams = 9
    expect(groups).toHaveLength(9);

    // Org root has no parent
    const orgRoot = groups.find((g) => g.id === ACME_GROUP_ID);
    expect(orgRoot).toBeDefined();
    expect(orgRoot!.parentId).toBeNull();
    expect(orgRoot!.nodeType).toBe("org");

    // Departments have org as parent
    const finance = groups.find((g) => g.id === FINANCE_DEPT_ID);
    expect(finance!.parentId).toBe(ACME_GROUP_ID);
    expect(finance!.nodeType).toBe("department");

    const engineering = groups.find((g) => g.id === ENGINEERING_DEPT_ID);
    expect(engineering!.parentId).toBe(ACME_GROUP_ID);
    expect(engineering!.nodeType).toBe("department");

    const operations = groups.find((g) => g.id === OPERATIONS_DEPT_ID);
    expect(operations!.parentId).toBe(ACME_GROUP_ID);
    expect(operations!.nodeType).toBe("department");

    // Teams have departments as parents
    const ap = groups.find((g) => g.id === AP_TEAM_ID);
    expect(ap!.parentId).toBe(FINANCE_DEPT_ID);
    expect(ap!.nodeType).toBe("team");

    const treasury = groups.find((g) => g.id === TREASURY_TEAM_ID);
    expect(treasury!.parentId).toBe(FINANCE_DEPT_ID);

    const platform = groups.find((g) => g.id === PLATFORM_TEAM_ID);
    expect(platform!.parentId).toBe(ENGINEERING_DEPT_ID);

    const mlai = groups.find((g) => g.id === MLAI_TEAM_ID);
    expect(mlai!.parentId).toBe(ENGINEERING_DEPT_ID);

    const procurement = groups.find((g) => g.id === PROCUREMENT_TEAM_ID);
    expect(procurement!.parentId).toBe(OPERATIONS_DEPT_ID);
  });

  it("all 14 action types seeded with correct domains", async () => {
    const actions = await db.select().from(schema.actionTypes);
    expect(actions).toHaveLength(14);

    // Finance domain actions
    const financeActions = actions.filter((a) => a.domain === "finance");
    expect(financeActions).toHaveLength(6);
    const financeNames = financeActions.map((a) => a.name).sort();
    expect(financeNames).toEqual([
      "budget.allocate",
      "budget.transfer",
      "expense.approve",
      "expense.submit",
      "purchase.approve",
      "purchase.initiate",
    ]);

    // Communication domain actions
    const commActions = actions.filter((a) => a.domain === "communication");
    expect(commActions).toHaveLength(4);

    // Agent delegation domain actions
    const agentActions = actions.filter((a) => a.domain === "agent_delegation");
    expect(agentActions).toHaveLength(4);
  });

  it("dimension definitions match spec", async () => {
    const dims = await db.select().from(schema.dimensionDefinitions);
    // Should have 16+ dimension definitions
    expect(dims.length).toBeGreaterThanOrEqual(16);

    // Check purchase.initiate dimensions specifically
    const purchaseDims = dims.filter((d) => d.actionTypeId === ACTION_PURCHASE_INITIATE_ID);
    expect(purchaseDims).toHaveLength(5);

    const names = purchaseDims.map((d) => d.dimensionName).sort();
    expect(names).toEqual(["amount", "budget_expiry", "category", "requires_human_approval", "vendor"]);

    // Check kinds
    const amount = purchaseDims.find((d) => d.dimensionName === "amount");
    expect(amount!.kind).toBe("numeric");

    const vendor = purchaseDims.find((d) => d.dimensionName === "vendor");
    expect(vendor!.kind).toBe("set");
    expect(vendor!.setMembers).toContain("aws");

    const humanApproval = purchaseDims.find((d) => d.dimensionName === "requires_human_approval");
    expect(humanApproval!.kind).toBe("boolean");
    expect(humanApproval!.boolRestrictive).toBe(true);

    const budgetExpiry = purchaseDims.find((d) => d.dimensionName === "budget_expiry");
    expect(budgetExpiry!.kind).toBe("temporal");
  });

  it("all 9 spending-policy.yaml rules have corresponding policies", async () => {
    const policyNames = [
      "agent-spending-limit",
      "hard-transaction-cap",
      "approved-vendors",
      "sanctioned-vendors",
      "permitted-categories",
      "hourly-rate-limit",
      "daily-spend-ceiling",
      "escalation-threshold",
      "cooling-off-period",
    ];

    const allPolicies = await db.select().from(schema.policies);
    for (const name of policyNames) {
      const found = allPolicies.find((p) => p.name === name);
      expect(found, `Policy "${name}" should exist`).toBeDefined();
    }
  });

  it("policies have active versions with Cedar source", async () => {
    const allPolicies = await db.select().from(schema.policies);
    const policyVersions = await db.select().from(schema.policyVersions);

    // All seeded policies should have active versions
    for (const policy of allPolicies) {
      expect(policy.activeVersionId, `Policy "${policy.name}" should have activeVersionId`).toBeTruthy();

      const version = policyVersions.find((v) => v.id === policy.activeVersionId);
      expect(version, `Policy "${policy.name}" version should exist`).toBeDefined();
      expect(version!.cedarSource.length).toBeGreaterThan(0);
      expect(version!.cedarHash.length).toBe(64); // SHA-256 hex
    }
  });

  it("cascading policies at different hierarchy levels", async () => {
    const assignments = await db.select().from(schema.policyAssignments);

    // Org-level: agent-spending-limit at Acme Corp root
    const orgAssignment = assignments.find(
      (a) => a.policyId === POLICY_AGENT_SPENDING_LIMIT_ID,
    );
    expect(orgAssignment).toBeDefined();
    expect(orgAssignment!.groupId).toBe(ACME_GROUP_ID);

    // Dept-level: engineering-dept-spending at Engineering
    const deptAssignment = assignments.find(
      (a) => a.policyId === POLICY_ENG_DEPT_SPENDING_ID,
    );
    expect(deptAssignment).toBeDefined();
    expect(deptAssignment!.groupId).toBe(ENGINEERING_DEPT_ID);

    // Team-level: platform-team-spending at Platform
    const teamAssignment = assignments.find(
      (a) => a.policyId === POLICY_PLATFORM_TEAM_SPENDING_ID,
    );
    expect(teamAssignment).toBeDefined();
    expect(teamAssignment!.groupId).toBe(PLATFORM_TEAM_ID);
  });

  it("OpenClaw agent DID assigned to Engineering > Platform", async () => {
    const memberships = await db
      .select()
      .from(schema.agentGroupMemberships)
      .where(eq(schema.agentGroupMemberships.agentDid, AGENT_DID));

    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.groupId).toBe(PLATFORM_TEAM_ID);
  });

  it("policy assignments reference correct groups", async () => {
    const assignments = await db.select().from(schema.policyAssignments);

    // All org-level policies should be assigned to ACME_GROUP_ID
    const orgPolicyIds = [
      POLICY_AGENT_SPENDING_LIMIT_ID,
      POLICY_HARD_TRANSACTION_CAP_ID,
      POLICY_APPROVED_VENDORS_ID,
      POLICY_SANCTIONED_VENDORS_ID,
      POLICY_PERMITTED_CATEGORIES_ID,
      POLICY_HOURLY_RATE_LIMIT_ID,
      POLICY_DAILY_SPEND_CEILING_ID,
      POLICY_ESCALATION_THRESHOLD_ID,
      POLICY_COOLING_OFF_PERIOD_ID,
    ];

    for (const policyId of orgPolicyIds) {
      const assignment = assignments.find((a) => a.policyId === policyId);
      expect(assignment, `Policy ${policyId} should have assignment`).toBeDefined();
      expect(assignment!.groupId).toBe(ACME_GROUP_ID);
      expect(assignment!.agentDid).toBeNull();
    }
  });
});
