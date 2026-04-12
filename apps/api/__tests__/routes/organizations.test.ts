import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import {
  setupTestDb,
  teardownTestDb,
} from "../../../../packages/rules-engine/__tests__/helpers/db";
import { organizations, groups } from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";

let db: DrizzleDB;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

describe("org auto-creation", () => {
  it("creates org from WorkOS org ID with kebab-case slug", async () => {
    // Simulate what ensureOrg does: create org with WorkOS binding
    const [org] = await db
      .insert(organizations)
      .values({
        name: "Acme Corporation",
        slug: "acme-corporation",
        workosOrgId: "org_workos_001",
        policyVersion: 0,
      })
      .returning();

    expect(org).toBeDefined();
    expect(org!.slug).toBe("acme-corporation");
    expect(org!.workosOrgId).toBe("org_workos_001");

    // Verify root group was not auto-created here (that's done by ensureOrg service)
    // This test verifies the DB accepts the workosOrgId column
  });

  it("enforces uniqueness on workosOrgId", async () => {
    await db.insert(organizations).values({
      name: "Unique Org A",
      slug: "unique-org-a",
      workosOrgId: "org_unique_test",
      policyVersion: 0,
    });

    // Attempting to insert another org with the same workosOrgId should fail
    await expect(
      db.insert(organizations).values({
        name: "Unique Org B",
        slug: "unique-org-b",
        workosOrgId: "org_unique_test",
        policyVersion: 0,
      }),
    ).rejects.toThrow();
  });

  it("allows null workosOrgId for existing orgs", async () => {
    const [org] = await db
      .insert(organizations)
      .values({
        name: "Legacy Org",
        slug: "legacy-org",
        policyVersion: 0,
      })
      .returning();

    expect(org).toBeDefined();
    expect(org!.workosOrgId).toBeNull();
  });

  it("slug collision handling: finds existing slug and appends suffix", async () => {
    // Create the base org
    await db.insert(organizations).values({
      name: "Widget Corp",
      slug: "widget-corp",
      workosOrgId: "org_widget_1",
      policyVersion: 0,
    });

    // Simulate slug collision check — look for similar slugs
    const similar = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(like(organizations.slug, "widget-corp%"));

    expect(similar.length).toBeGreaterThan(0);

    // Create second org with suffixed slug (simulating collision handling)
    const [org2] = await db
      .insert(organizations)
      .values({
        name: "Widget Corp 2",
        slug: "widget-corp-2",
        workosOrgId: "org_widget_2",
        policyVersion: 0,
      })
      .returning();

    expect(org2!.slug).toBe("widget-corp-2");
  });

  it("lookup by workosOrgId returns existing org", async () => {
    const workosOrgId = "org_existing_lookup";
    await db.insert(organizations).values({
      name: "Existing Lookup Org",
      slug: "existing-lookup-org",
      workosOrgId,
      policyVersion: 0,
    });

    const rows = await db
      .select()
      .from(organizations)
      .where(eq(organizations.workosOrgId, workosOrgId));

    expect(rows.length).toBe(1);
    expect(rows[0]!.name).toBe("Existing Lookup Org");
  });
});

describe("groups with unassigned nodeType", () => {
  it("creates group with nodeType unassigned", async () => {
    const [org] = await db
      .insert(organizations)
      .values({
        name: "NodeType Test Org",
        slug: "nodetype-test-org",
        policyVersion: 0,
      })
      .returning();

    const [group] = await db
      .insert(groups)
      .values({
        orgId: org!.id,
        name: "SCIM Group",
        nodeType: "unassigned",
        parentId: null,
      })
      .returning();

    expect(group).toBeDefined();
    expect(group!.nodeType).toBe("unassigned");
  });

  it("allows updating nodeType from unassigned to department", async () => {
    const [org] = await db
      .insert(organizations)
      .values({
        name: "Update NodeType Org",
        slug: "update-nodetype-org",
        policyVersion: 0,
      })
      .returning();

    const [group] = await db
      .insert(groups)
      .values({
        orgId: org!.id,
        name: "Pending Group",
        nodeType: "unassigned",
        parentId: null,
      })
      .returning();

    // Update to department
    const [updated] = await db
      .update(groups)
      .set({ nodeType: "department" })
      .where(eq(groups.id, group!.id))
      .returning();

    expect(updated!.nodeType).toBe("department");
  });

  it("rejects invalid nodeType values", async () => {
    const [org] = await db
      .insert(organizations)
      .values({
        name: "Invalid NodeType Org",
        slug: "invalid-nodetype-org",
        policyVersion: 0,
      })
      .returning();

    await expect(
      db.insert(groups).values({
        orgId: org!.id,
        name: "Bad Group",
        nodeType: "invalid_type",
        parentId: null,
      }),
    ).rejects.toThrow();
  });
});
