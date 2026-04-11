import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import {
  seed,
  ORG_ID,
  AGENT_DID,
  PLATFORM_TEAM_ID,
  ENGINEERING_DEPT_ID,
  ACME_GROUP_ID,
  MLAI_TEAM_ID,
} from "../src/seed";
import { buildEntityStore, rebuildOnVersionBump } from "../src/entity-store";
import * as schema from "../src/schema";
import type { DrizzleDB } from "../src/envelope";

let db: DrizzleDB;

beforeAll(async () => {
  db = await setupTestDb();
  await seed(db);
}, 30_000);

afterAll(async () => {
  await teardownTestDb();
});

describe("entity store", () => {
  it("builds group entities with correct parent relationships", async () => {
    const entities = await buildEntityStore(db, ORG_ID);

    const platformGroup = entities.find((e) => e.uid === `Group::"${PLATFORM_TEAM_ID}"`);
    expect(platformGroup).toBeDefined();
    expect(platformGroup!.parents).toContain(`Group::"${ENGINEERING_DEPT_ID}"`);

    const engDept = entities.find((e) => e.uid === `Group::"${ENGINEERING_DEPT_ID}"`);
    expect(engDept).toBeDefined();
    expect(engDept!.parents).toContain(`Group::"${ACME_GROUP_ID}"`);

    // Root group has no parents
    const orgRoot = entities.find((e) => e.uid === `Group::"${ACME_GROUP_ID}"`);
    expect(orgRoot).toBeDefined();
    expect(orgRoot!.parents).toHaveLength(0);
  });

  it("builds agent entities with group memberships as parents", async () => {
    const entities = await buildEntityStore(db, ORG_ID);
    const agent = entities.find((e) => e.uid === `Agent::"${AGENT_DID}"`);
    expect(agent).toBeDefined();
    expect(agent!.parents).toContain(`Group::"${PLATFORM_TEAM_ID}"`);
  });

  it("builds action type entities with no parents", async () => {
    const entities = await buildEntityStore(db, ORG_ID);
    const purchaseAction = entities.find((e) => e.uid === 'Action::"purchase.initiate"');
    expect(purchaseAction).toBeDefined();
    expect(purchaseAction!.parents).toHaveLength(0);
  });

  it("handles agent in multiple groups (multiple parents)", async () => {
    // Add the agent to a second group
    await db.insert(schema.agentGroupMemberships).values({
      agentDid: AGENT_DID,
      groupId: MLAI_TEAM_ID,
    });

    const entities = await buildEntityStore(db, ORG_ID);
    const agent = entities.find((e) => e.uid === `Agent::"${AGENT_DID}"`);
    expect(agent).toBeDefined();
    expect(agent!.parents).toContain(`Group::"${PLATFORM_TEAM_ID}"`);
    expect(agent!.parents).toContain(`Group::"${MLAI_TEAM_ID}"`);

    // Clean up: remove the extra membership
    const { eq, and } = await import("drizzle-orm");
    await db
      .delete(schema.agentGroupMemberships)
      .where(
        and(
          eq(schema.agentGroupMemberships.agentDid, AGENT_DID),
          eq(schema.agentGroupMemberships.groupId, MLAI_TEAM_ID),
        ),
      );
  });

  it("includes all groups in the org hierarchy", async () => {
    const entities = await buildEntityStore(db, ORG_ID);
    const groupEntities = entities.filter((e) => e.uid.startsWith("Group::"));
    // 1 org + 3 departments + 5 teams = 9 groups
    expect(groupEntities.length).toBe(9);
  });

  it("includes all 14 action type entities", async () => {
    const entities = await buildEntityStore(db, ORG_ID);
    const actionEntities = entities.filter((e) => e.uid.startsWith("Action::"));
    expect(actionEntities.length).toBe(14);
  });

  it("rebuildOnVersionBump detects stale version and rebuilds", async () => {
    const result = await rebuildOnVersionBump(db, ORG_ID, -1);
    expect(result.rebuilt).toBe(true);
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.version).toBeGreaterThanOrEqual(0);
  });

  it("rebuildOnVersionBump skips rebuild when version is current", async () => {
    const first = await rebuildOnVersionBump(db, ORG_ID, -1);
    const second = await rebuildOnVersionBump(db, ORG_ID, first.version);
    expect(second.rebuilt).toBe(false);
    expect(second.entities).toHaveLength(0);
  });
});
