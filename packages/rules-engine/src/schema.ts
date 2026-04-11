import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const domainEnum = pgEnum("domain", [
  "finance",
  "communication",
  "agent_delegation",
]);

export const policyEffectEnum = pgEnum("policy_effect", ["allow", "deny"]);

export const dimensionKindEnum = pgEnum("dimension_kind", [
  "numeric",
  "rate",
  "set",
  "boolean",
  "temporal",
]);

export const decisionOutcomeEnum = pgEnum("decision_outcome", [
  "allow",
  "deny",
  "not_applicable",
  "error",
]);

export const petitionStatusEnum = pgEnum("petition_status", [
  "pending",
  "approved",
  "denied",
  "expired",
  "cancelled",
]);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** Multi-tenant root. Each organization has its own policy version counter. */
export const organizations = pgTable("organizations", {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull().unique(),
  slug: text().notNull().unique(),
  policyVersion: integer("policy_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Hierarchical group tree via adjacency list (no ltree). */
export const groups = pgTable(
  "groups",
  {
    id: uuid().defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    nodeType: text("node_type").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => groups.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("groups_org_name_parent_uniq").on(table.orgId, table.name, table.parentId),
    check("groups_node_type_check", sql`${table.nodeType} IN ('org', 'department', 'team')`),
  ],
);

/** Many-to-many: registry agent DID <-> group. Agent DIDs are cross-package references. */
export const agentGroupMemberships = pgTable(
  "agent_group_memberships",
  {
    agentDid: text("agent_did").notNull(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.agentDid, table.groupId] })],
);

/** Typed agent actions (14 seeded across 3 domains). */
export const actionTypes = pgTable("action_types", {
  id: uuid().defaultRandom().primaryKey(),
  domain: domainEnum().notNull(),
  name: text().notNull().unique(),
  description: text(),
});

/** Constraint schema per action type — defines what dimensions are available. */
export const dimensionDefinitions = pgTable(
  "dimension_definitions",
  {
    id: uuid().defaultRandom().primaryKey(),
    actionTypeId: uuid("action_type_id")
      .notNull()
      .references(() => actionTypes.id, { onDelete: "cascade" }),
    dimensionName: text("dimension_name").notNull(),
    kind: dimensionKindEnum().notNull(),
    numericMax: numeric("numeric_max"),
    rateLimit: integer("rate_limit"),
    rateWindow: text("rate_window"),
    setMembers: text("set_members")
      .array()
      .$type<string[]>(),
    boolDefault: boolean("bool_default"),
    boolRestrictive: boolean("bool_restrictive"),
    temporalExpiry: date("temporal_expiry"),
  },
  (table) => [
    unique("dim_def_action_name_uniq").on(table.actionTypeId, table.dimensionName),
  ],
);

/** Policy definitions. Each policy belongs to an org and has an effect (allow/deny). */
export const policies = pgTable(
  "policies",
  {
    id: uuid().defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    domain: domainEnum().notNull(),
    effect: policyEffectEnum().notNull(),
    activeVersionId: uuid("active_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("policies_org_name_uniq").on(table.orgId, table.name)],
);

/** Immutable policy version records with structured constraints and generated Cedar source. */
export const policyVersions = pgTable("policy_versions", {
  id: uuid().defaultRandom().primaryKey(),
  policyId: uuid("policy_id")
    .notNull()
    .references(() => policies.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  constraints: jsonb().notNull(),
  cedarSource: text("cedar_source").notNull(),
  cedarHash: text("cedar_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
});

/**
 * Policy <-> target binding.
 * Assignments always use policies.activeVersionId — no version pinning on assignments.
 * CHECK: exactly one of groupId or agentDid must be non-null.
 */
export const policyAssignments = pgTable(
  "policy_assignments",
  {
    id: uuid().defaultRandom().primaryKey(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => groups.id),
    agentDid: text("agent_did"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "assignment_target_check",
      sql`(${table.groupId} IS NOT NULL AND ${table.agentDid} IS NULL) OR (${table.groupId} IS NULL AND ${table.agentDid} IS NOT NULL)`,
    ),
  ],
);

/** Immutable audit trail for every authorization decision. */
export const decisionLog = pgTable(
  "decision_log",
  {
    id: uuid().defaultRandom().primaryKey(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
    agentDid: text("agent_did").notNull(),
    actionTypeId: uuid("action_type_id")
      .notNull()
      .references(() => actionTypes.id),
    requestContext: jsonb("request_context").notNull(),
    bundleHash: text("bundle_hash").notNull(),
    outcome: decisionOutcomeEnum().notNull(),
    reason: text(),
    matchedVersionId: uuid("matched_version_id").references(() => policyVersions.id),
    engineErrorCode: text("engine_error_code"),
    sdkErrorCode: text("sdk_error_code"),
    envelopeSnapshot: jsonb("envelope_snapshot"),
  },
  (table) => [
    index("decision_log_agent_time_idx").on(table.agentDid, table.evaluatedAt),
    index("decision_log_outcome_time_idx").on(table.outcome, table.evaluatedAt),
    index("decision_log_bundle_hash_idx").on(table.bundleHash),
  ],
);

/** One-time exception requests (petitions). */
export const petitions = pgTable(
  "petitions",
  {
    id: uuid().defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    requestorDid: text("requestor_did").notNull(),
    actionTypeId: uuid("action_type_id")
      .notNull()
      .references(() => actionTypes.id),
    requestedContext: jsonb("requested_context").notNull(),
    violatedPolicyId: uuid("violated_policy_id")
      .notNull()
      .references(() => policies.id),
    violatedDimension: text("violated_dimension").notNull(),
    requestedValue: jsonb("requested_value").notNull(),
    justification: text().notNull(),
    approverDid: text("approver_did"),
    approverGroupId: uuid("approver_group_id").references(() => groups.id),
    status: petitionStatusEnum().notNull().default("pending"),
    decisionReason: text("decision_reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    grantExpiresAt: timestamp("grant_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    index("petitions_requestor_status_idx").on(table.requestorDid, table.status),
    index("petitions_approver_status_idx").on(table.approverDid, table.status),
  ],
);
