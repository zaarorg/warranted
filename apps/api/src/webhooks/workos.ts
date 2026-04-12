import { Hono } from "hono";
import { WorkOS } from "@workos-inc/node";
import { eq, and } from "drizzle-orm";
import {
  organizations,
  groups,
  workosProcessedEvents,
} from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";

export interface WebhookEvent {
  id: string;
  event: string;
  data: Record<string, unknown>;
}

export interface WebhookDeps {
  verifySignature?: (payload: string, sigHeader: string, secret: string) => Promise<WebhookEvent>;
}

async function defaultVerifySignature(
  payload: string,
  sigHeader: string,
  secret: string,
): Promise<WebhookEvent> {
  const workos = new WorkOS(process.env.WORKOS_API_KEY);
  const verified = await workos.webhooks.constructEvent({
    payload: JSON.parse(payload),
    sigHeader,
    secret,
  });
  return verified as unknown as WebhookEvent;
}

/**
 * WorkOS webhook route handler.
 * Handles SCIM Directory Sync events with signature verification
 * and dual idempotency (event dedup table + upserts).
 */
export function workosWebhookRoutes(db: DrizzleDB, deps: WebhookDeps = {}): Hono {
  const verifySignature = deps.verifySignature ?? defaultVerifySignature;
  const app = new Hono();

  app.post("/", async (c) => {
    // 1. Verify webhook signature
    let event: WebhookEvent;
    try {
      const payload = await c.req.text();
      const sigHeader = c.req.header("workos-signature") ?? c.req.header("WorkOS-Signature") ?? "";
      const webhookSecret = process.env.WORKOS_WEBHOOK_SECRET ?? "";

      if (!webhookSecret) {
        console.error("WORKOS_WEBHOOK_SECRET not configured");
        return c.json({ error: "Webhook secret not configured" }, 500);
      }

      event = await verifySignature(payload, sigHeader, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return c.json({ error: "Invalid signature" }, 401);
    }

    // 2. Check idempotency — skip if already processed
    const existing = await db
      .select({ eventId: workosProcessedEvents.eventId })
      .from(workosProcessedEvents)
      .where(eq(workosProcessedEvents.eventId, event.id));

    if (existing.length > 0) {
      return c.json({ success: true, message: "Event already processed" }, 200);
    }

    // 3. Process the event
    try {
      await handleEvent(db, event);
    } catch (err) {
      console.error(`Error processing webhook event ${event.id}:`, err);
      // Still record the event to prevent reprocessing of broken events
    }

    // 4. Record event as processed
    await db.insert(workosProcessedEvents).values({
      eventId: event.id,
      eventType: event.event,
    });

    return c.json({ success: true }, 200);
  });

  return app;
}

async function handleEvent(db: DrizzleDB, event: WebhookEvent): Promise<void> {
  const { event: eventType, data } = event;

  switch (eventType) {
    case "dsync.group.created":
      await handleGroupCreated(db, data);
      break;

    case "dsync.group.updated":
      await handleGroupUpdated(db, data);
      break;

    case "dsync.group.deleted":
      await handleGroupDeleted(db, data);
      break;

    case "dsync.directory.created":
      await handleDirectoryCreated(db, data);
      break;

    case "dsync.user.created":
    case "dsync.user.deleted":
    case "dsync.user.suspended":
    case "organization_membership.created":
    case "organization_membership.deleted":
      // Phase 1: log + store event ID (handled by caller).
      // Agent lifecycle logic comes in Phase 2.
      console.log(`Received ${eventType} event — recorded for Phase 2`);
      break;

    default:
      console.log(`Unhandled webhook event type: ${eventType}`);
  }
}

async function handleGroupCreated(
  db: DrizzleDB,
  data: Record<string, unknown>,
): Promise<void> {
  const directoryId = data.directory_id as string | undefined;
  const groupName = data.name as string;
  const workosGroupId = data.id as string;

  if (!directoryId || !groupName) {
    console.warn("dsync.group.created missing directory_id or name");
    return;
  }

  // Look up the org by workosDirectoryId
  const org = await findOrgByDirectoryId(db, directoryId);
  if (!org) {
    console.warn(`No org found for directory_id ${directoryId} — skipping group creation`);
    return;
  }

  // Upsert: use org+name+null parentId as the unique key
  // INSERT with ON CONFLICT on the unique constraint
  const existingGroups = await db
    .select()
    .from(groups)
    .where(
      and(
        eq(groups.orgId, org.id),
        eq(groups.name, groupName),
      ),
    );

  if (existingGroups.length === 0) {
    await db.insert(groups).values({
      orgId: org.id,
      name: groupName,
      nodeType: "unassigned",
      parentId: null,
    });
  }
}

async function handleGroupUpdated(
  db: DrizzleDB,
  data: Record<string, unknown>,
): Promise<void> {
  const directoryId = data.directory_id as string | undefined;
  const groupName = data.name as string;
  const previousName = data.previous_attributes
    ? (data.previous_attributes as Record<string, unknown>).name as string | undefined
    : undefined;

  if (!directoryId || !groupName) {
    console.warn("dsync.group.updated missing directory_id or name");
    return;
  }

  const org = await findOrgByDirectoryId(db, directoryId);
  if (!org) {
    console.warn(`No org found for directory_id ${directoryId} — skipping group update`);
    return;
  }

  // Find the group by previous name or current name within the org
  const searchName = previousName ?? groupName;
  const existingGroups = await db
    .select()
    .from(groups)
    .where(
      and(
        eq(groups.orgId, org.id),
        eq(groups.name, searchName),
      ),
    );

  if (existingGroups.length > 0) {
    const group = existingGroups[0]!;
    // Update name only — do NOT overwrite admin-assigned nodeType or parentId
    await db
      .update(groups)
      .set({ name: groupName })
      .where(eq(groups.id, group.id));
  } else {
    // Group not found — create it as unassigned
    await db.insert(groups).values({
      orgId: org.id,
      name: groupName,
      nodeType: "unassigned",
      parentId: null,
    });
  }
}

async function handleGroupDeleted(
  db: DrizzleDB,
  data: Record<string, unknown>,
): Promise<void> {
  const directoryId = data.directory_id as string | undefined;
  const groupName = data.name as string;

  if (!directoryId || !groupName) {
    console.warn("dsync.group.deleted missing directory_id or name");
    return;
  }

  const org = await findOrgByDirectoryId(db, directoryId);
  if (!org) {
    return;
  }

  // Delete the group (cascade will remove memberships)
  await db
    .delete(groups)
    .where(
      and(
        eq(groups.orgId, org.id),
        eq(groups.name, groupName),
      ),
    );
}

async function handleDirectoryCreated(
  db: DrizzleDB,
  data: Record<string, unknown>,
): Promise<void> {
  const directoryId = data.id as string;
  const orgId = data.organization_id as string | undefined;

  if (!directoryId || !orgId) {
    console.warn("dsync.directory.created missing id or organization_id");
    return;
  }

  // Update the org's workosDirectoryId
  await db
    .update(organizations)
    .set({ workosDirectoryId: directoryId })
    .where(eq(organizations.workosOrgId, orgId));
}

async function findOrgByDirectoryId(
  db: DrizzleDB,
  directoryId: string,
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.workosDirectoryId, directoryId));

  return rows[0] ?? null;
}
