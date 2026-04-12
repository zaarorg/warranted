import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  setupTestDb,
  teardownTestDb,
} from "../../../../packages/rules-engine/__tests__/helpers/db";
import {
  organizations,
  groups,
  workosProcessedEvents,
} from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";
import { workosWebhookRoutes } from "../../src/webhooks/workos";
import type { WebhookEvent } from "../../src/webhooks/workos";

let db: DrizzleDB;
let app: Hono;
let testOrgId: string;

// Mock signature verification — just parse the JSON payload as the event
const mockVerify = async (payload: string): Promise<WebhookEvent> =>
  JSON.parse(payload) as WebhookEvent;

beforeAll(async () => {
  process.env.WORKOS_WEBHOOK_SECRET = "test-webhook-secret";
  db = await setupTestDb();

  // Create a test org with a workosDirectoryId
  const [org] = await db
    .insert(organizations)
    .values({
      name: "Test Org",
      slug: "test-org",
      workosOrgId: "org_test_123",
      workosDirectoryId: "dir_test_456",
    })
    .returning();
  testOrgId = org!.id;

  // Create app with mock signature verification (no vi.mock needed)
  app = new Hono();
  app.route("/api/webhooks/workos", workosWebhookRoutes(db, { verifySignature: mockVerify }));
});

afterAll(async () => {
  delete process.env.WORKOS_WEBHOOK_SECRET;
  await teardownTestDb();
});

function webhookReq(event: {
  id: string;
  event: string;
  data: Record<string, unknown>;
}) {
  return app.request("/api/webhooks/workos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "workos-signature": "test-sig",
    },
    body: JSON.stringify(event),
  });
}

describe("SCIM webhook handler", () => {
  it("dsync.group.created → creates group with nodeType unassigned", async () => {
    const res = await webhookReq({
      id: "evt_group_created_1",
      event: "dsync.group.created",
      data: {
        id: "wos_grp_001",
        name: "Engineering",
        directory_id: "dir_test_456",
      },
    });

    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(groups)
      .where(eq(groups.name, "Engineering"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nodeType).toBe("unassigned");
    expect(rows[0]!.orgId).toBe(testOrgId);
  });

  it("dsync.group.updated → updates name but preserves admin-assigned nodeType", async () => {
    // First create a group
    await webhookReq({
      id: "evt_group_created_2",
      event: "dsync.group.created",
      data: {
        id: "wos_grp_002",
        name: "Sales",
        directory_id: "dir_test_456",
      },
    });

    // Admin assigns nodeType to 'department'
    const salesGroups = await db
      .select()
      .from(groups)
      .where(eq(groups.name, "Sales"));
    await db
      .update(groups)
      .set({ nodeType: "department" })
      .where(eq(groups.id, salesGroups[0]!.id));

    // SCIM update event (rename)
    const res = await webhookReq({
      id: "evt_group_updated_1",
      event: "dsync.group.updated",
      data: {
        id: "wos_grp_002",
        name: "Sales Team",
        directory_id: "dir_test_456",
        previous_attributes: { name: "Sales" },
      },
    });

    expect(res.status).toBe(200);

    const updated = await db
      .select()
      .from(groups)
      .where(eq(groups.name, "Sales Team"));
    expect(updated).toHaveLength(1);
    expect(updated[0]!.nodeType).toBe("department"); // NOT overwritten to 'unassigned'
  });

  it("duplicate event ID → skipped, returns 200", async () => {
    // evt_group_created_1 was already processed in the first test
    const res = await webhookReq({
      id: "evt_group_created_1",
      event: "dsync.group.created",
      data: {
        id: "wos_grp_duplicate",
        name: "Duplicate Group",
        directory_id: "dir_test_456",
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Event already processed");

    // Verify no duplicate group was created
    const groupRows = await db
      .select()
      .from(groups)
      .where(eq(groups.name, "Duplicate Group"));
    expect(groupRows).toHaveLength(0);

    // Verify event is in processed events table
    const eventRows = await db
      .select()
      .from(workosProcessedEvents)
      .where(eq(workosProcessedEvents.eventId, "evt_group_created_1"));
    expect(eventRows).toHaveLength(1);
  });

  it("unknown directory_id → returns 200 (logged, not failed)", async () => {
    const res = await webhookReq({
      id: "evt_unknown_dir_1",
      event: "dsync.group.created",
      data: {
        id: "wos_grp_unknown",
        name: "Unknown Dir Group",
        directory_id: "dir_nonexistent",
      },
    });

    expect(res.status).toBe(200);

    // Verify no group created (no org matches this directory)
    const rows = await db
      .select()
      .from(groups)
      .where(eq(groups.name, "Unknown Dir Group"));
    expect(rows).toHaveLength(0);
  });

  it("dsync.group.deleted → group removed", async () => {
    // Create a group to delete
    await webhookReq({
      id: "evt_group_created_for_delete",
      event: "dsync.group.created",
      data: {
        id: "wos_grp_delete",
        name: "To Be Deleted",
        directory_id: "dir_test_456",
      },
    });

    // Verify created
    const before = await db
      .select()
      .from(groups)
      .where(eq(groups.name, "To Be Deleted"));
    expect(before).toHaveLength(1);

    // Delete event
    const res = await webhookReq({
      id: "evt_group_deleted_1",
      event: "dsync.group.deleted",
      data: {
        id: "wos_grp_delete",
        name: "To Be Deleted",
        directory_id: "dir_test_456",
      },
    });

    expect(res.status).toBe(200);

    const after = await db
      .select()
      .from(groups)
      .where(eq(groups.name, "To Be Deleted"));
    expect(after).toHaveLength(0);
  });

  it("dsync.user.suspended → event recorded", async () => {
    const res = await webhookReq({
      id: "evt_user_suspend_1",
      event: "dsync.user.suspended",
      data: {
        id: "usr_suspended",
        directory_id: "dir_test_456",
        state: "suspended",
      },
    });
    expect(res.status).toBe(200);

    // Verify event recorded in processed events
    const eventRows = await db
      .select()
      .from(workosProcessedEvents)
      .where(eq(workosProcessedEvents.eventId, "evt_user_suspend_1"));
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]!.eventType).toBe("dsync.user.suspended");
  });

  it("webhook signature verification rejection", async () => {
    // Create a separate app with a failing verifier
    const failingVerify = async () => {
      throw new Error("Invalid signature");
    };
    const rejectApp = new Hono();
    rejectApp.route(
      "/api/webhooks/workos",
      workosWebhookRoutes(db, { verifySignature: failingVerify }),
    );

    const res = await rejectApp.request("/api/webhooks/workos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "workos-signature": "bad-sig",
      },
      body: JSON.stringify({ id: "evt_bad", event: "dsync.group.created", data: {} }),
    });
    expect(res.status).toBe(401);
  });
});
