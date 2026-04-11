import { eq } from "drizzle-orm";
import type { DrizzleDB } from "./envelope";
import type { CedarEntity } from "./types";
import * as schema from "./schema";

// ---------------------------------------------------------------------------
// Entity Store Builder
// ---------------------------------------------------------------------------

/**
 * Build the flat array of Cedar entities needed for `CedarEngine.loadEntities()`.
 * Queries the database for groups, agent memberships, and action types,
 * then assembles parent relationships so `principal in Group::"uuid"` works.
 */
export async function buildEntityStore(db: DrizzleDB, orgId: string): Promise<CedarEntity[]> {
  const entities: CedarEntity[] = [];

  // 1. Build Group entities with parent relationships
  const groups = await db.select().from(schema.groups).where(eq(schema.groups.orgId, orgId));
  for (const group of groups) {
    entities.push({
      uid: `Group::"${group.id}"`,
      parents: group.parentId ? [`Group::"${group.parentId}"`] : [],
      attrs: {},
    });
  }

  // 2. Build Agent entities — join memberships with groups to scope by org
  const memberships = await db
    .select({
      agentDid: schema.agentGroupMemberships.agentDid,
      groupId: schema.agentGroupMemberships.groupId,
    })
    .from(schema.agentGroupMemberships)
    .innerJoin(schema.groups, eq(schema.agentGroupMemberships.groupId, schema.groups.id))
    .where(eq(schema.groups.orgId, orgId));

  // Collect all group parents per agent (an agent can be in multiple groups)
  const agentGroups = new Map<string, string[]>();
  for (const m of memberships) {
    const parents = agentGroups.get(m.agentDid) ?? [];
    parents.push(`Group::"${m.groupId}"`);
    agentGroups.set(m.agentDid, parents);
  }
  for (const [did, parents] of agentGroups) {
    entities.push({
      uid: `Agent::"${did}"`,
      parents,
      attrs: {},
    });
  }

  // 3. Build Action entities (no parents)
  const actions = await db.select().from(schema.actionTypes);
  for (const action of actions) {
    entities.push({
      uid: `Action::"${action.name}"`,
      parents: [],
      attrs: {},
    });
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Version-Aware Rebuild
// ---------------------------------------------------------------------------

/**
 * Rebuild the entity store only if the org's policyVersion has bumped
 * past the caller's `currentVersion`.
 */
export async function rebuildOnVersionBump(
  db: DrizzleDB,
  orgId: string,
  currentVersion: number,
): Promise<{ entities: CedarEntity[]; version: number; rebuilt: boolean }> {
  const org = await db
    .select({ policyVersion: schema.organizations.policyVersion })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId));

  const dbVersion = org[0]?.policyVersion ?? 0;

  if (dbVersion <= currentVersion) {
    return { entities: [], version: currentVersion, rebuilt: false };
  }

  const entities = await buildEntityStore(db, orgId);
  return { entities, version: dbVersion, rebuilt: true };
}
