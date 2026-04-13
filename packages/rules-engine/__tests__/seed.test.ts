import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { seed, seedTestOrg } from "../src/seed";
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
} from "../src/seed";
import * as schema from "../src/schema";
import { eq } from "drizzle-orm";

let db: DrizzleDB;

beforeAll(async () => {
  db = await setupTestDb();
  await seed(db);
}, 30_000);

afterAll(async () => {
  await teardownTestDb();
}, 10_000);

describe("seed data", () => {
  it("seeds the default organization but no groups", async () => {
    const orgs = await db.select().from(schema.organizations);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.name).toBe("Acme Corp");

    const allGroups = await db.select().from(schema.groups);
    expect(allGroups).toHaveLength(0);
  });

  it("all 14 action types seeded with correct domains", async () => {
    const actions = await db.select().from(schema.actionTypes);
    expect(actions).toHaveLength(14);

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

    const commActions = actions.filter((a) => a.domain === "communication");
    expect(commActions).toHaveLength(4);

    const agentActions = actions.filter((a) => a.domain === "agent_delegation");
    expect(agentActions).toHaveLength(4);
  });

  it("dimension definitions match spec", async () => {
    const dims = await db.select().from(schema.dimensionDefinitions);
    expect(dims.length).toBeGreaterThanOrEqual(16);

    const purchaseDims = dims.filter((d) => d.actionTypeId === ACTION_PURCHASE_INITIATE_ID);
    expect(purchaseDims).toHaveLength(5);

    const names = purchaseDims.map((d) => d.dimensionName).sort();
    expect(names).toEqual(["amount", "budget_expiry", "category", "requires_human_approval", "vendor"]);
  });

  it("no policies are seeded", async () => {
    const allPolicies = await db.select().from(schema.policies);
    expect(allPolicies).toHaveLength(0);
  });

  it("no policy assignments are seeded", async () => {
    const assignments = await db.select().from(schema.policyAssignments);
    expect(assignments).toHaveLength(0);
  });
});

describe("seedTestOrg", () => {
  beforeAll(async () => {
    await seedTestOrg(db);
  });

  it("creates Acme Corp organization", async () => {
    const orgs = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, ORG_ID));
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.name).toBe("Acme Corp");
    expect(orgs[0]!.slug).toBe("acme-corp");
  });

  it("creates correct group hierarchy", async () => {
    const groups = await db.select().from(schema.groups);
    expect(groups).toHaveLength(9);

    const orgRoot = groups.find((g) => g.id === ACME_GROUP_ID);
    expect(orgRoot).toBeDefined();
    expect(orgRoot!.parentId).toBeNull();
    expect(orgRoot!.nodeType).toBe("org");

    const finance = groups.find((g) => g.id === FINANCE_DEPT_ID);
    expect(finance!.parentId).toBe(ACME_GROUP_ID);

    const engineering = groups.find((g) => g.id === ENGINEERING_DEPT_ID);
    expect(engineering!.parentId).toBe(ACME_GROUP_ID);

    const operations = groups.find((g) => g.id === OPERATIONS_DEPT_ID);
    expect(operations!.parentId).toBe(ACME_GROUP_ID);

    const ap = groups.find((g) => g.id === AP_TEAM_ID);
    expect(ap!.parentId).toBe(FINANCE_DEPT_ID);

    const treasury = groups.find((g) => g.id === TREASURY_TEAM_ID);
    expect(treasury!.parentId).toBe(FINANCE_DEPT_ID);

    const platform = groups.find((g) => g.id === PLATFORM_TEAM_ID);
    expect(platform!.parentId).toBe(ENGINEERING_DEPT_ID);

    const mlai = groups.find((g) => g.id === MLAI_TEAM_ID);
    expect(mlai!.parentId).toBe(ENGINEERING_DEPT_ID);

    const procurement = groups.find((g) => g.id === PROCUREMENT_TEAM_ID);
    expect(procurement!.parentId).toBe(OPERATIONS_DEPT_ID);
  });

  it("assigns agent to Platform team", async () => {
    const memberships = await db
      .select()
      .from(schema.agentGroupMemberships)
      .where(eq(schema.agentGroupMemberships.agentDid, AGENT_DID));

    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.groupId).toBe(PLATFORM_TEAM_ID);
  });
});
