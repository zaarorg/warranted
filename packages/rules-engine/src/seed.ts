import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import type { DrizzleDB } from "./envelope";
import * as schema from "./schema";
import { generateCedar } from "./cedar-gen";
import type { PolicyConstraint } from "./types";

// ---------------------------------------------------------------------------
// Deterministic UUIDs (used in tests and as defaults)
// ---------------------------------------------------------------------------

export const ORG_ID = "00000000-0000-0000-0000-000000000001";

// Groups
export const ACME_GROUP_ID = "00000000-0000-0000-0000-000000000002";
export const FINANCE_DEPT_ID = "00000000-0000-0000-0000-000000000010";
export const ENGINEERING_DEPT_ID = "00000000-0000-0000-0000-000000000020";
export const OPERATIONS_DEPT_ID = "00000000-0000-0000-0000-000000000030";
export const AP_TEAM_ID = "00000000-0000-0000-0000-000000000011";
export const TREASURY_TEAM_ID = "00000000-0000-0000-0000-000000000012";
export const PLATFORM_TEAM_ID = "00000000-0000-0000-0000-000000000021";
export const MLAI_TEAM_ID = "00000000-0000-0000-0000-000000000022";
export const PROCUREMENT_TEAM_ID = "00000000-0000-0000-0000-000000000031";

// Agent
// Deterministic DID derived from ED25519_SEED="demo-seed-123"
export const AGENT_DID = "did:mesh:bf30e3839373bfbc2571603751ba147830d5a300";

// Action types
export const ACTION_PURCHASE_INITIATE_ID = "00000000-0000-0000-0000-000000000100";
export const ACTION_PURCHASE_APPROVE_ID = "00000000-0000-0000-0000-000000000101";
export const ACTION_BUDGET_ALLOCATE_ID = "00000000-0000-0000-0000-000000000102";
export const ACTION_BUDGET_TRANSFER_ID = "00000000-0000-0000-0000-000000000103";
export const ACTION_EXPENSE_SUBMIT_ID = "00000000-0000-0000-0000-000000000104";
export const ACTION_EXPENSE_APPROVE_ID = "00000000-0000-0000-0000-000000000105";
export const ACTION_EMAIL_SEND_ID = "00000000-0000-0000-0000-000000000200";
export const ACTION_EMAIL_SEND_EXTERNAL_ID = "00000000-0000-0000-0000-000000000201";
export const ACTION_MEETING_SCHEDULE_ID = "00000000-0000-0000-0000-000000000202";
export const ACTION_DOCUMENT_SHARE_ID = "00000000-0000-0000-0000-000000000203";
export const ACTION_AGENT_DELEGATE_ID = "00000000-0000-0000-0000-000000000300";
export const ACTION_AGENT_CREATE_ID = "00000000-0000-0000-0000-000000000301";
export const ACTION_AGENT_REVOKE_ID = "00000000-0000-0000-0000-000000000302";
export const ACTION_API_CALL_ID = "00000000-0000-0000-0000-000000000303";

// Dimension definitions
export const DIM_PURCHASE_AMOUNT_ID = "00000000-0000-0000-0000-000000000600";
export const DIM_PURCHASE_VENDOR_ID = "00000000-0000-0000-0000-000000000601";
export const DIM_PURCHASE_CATEGORY_ID = "00000000-0000-0000-0000-000000000602";
export const DIM_PURCHASE_HUMAN_APPROVAL_ID = "00000000-0000-0000-0000-000000000603";
export const DIM_PURCHASE_BUDGET_EXPIRY_ID = "00000000-0000-0000-0000-000000000604";

// ---------------------------------------------------------------------------
// Seed Function
// ---------------------------------------------------------------------------

export async function seed(db: DrizzleDB): Promise<void> {
  // 1. Action types (14 across 3 domains)
  await db.insert(schema.actionTypes).values([
    // Finance
    { id: ACTION_PURCHASE_INITIATE_ID, domain: "finance", name: "purchase.initiate", description: "Initiate a purchase transaction" },
    { id: ACTION_PURCHASE_APPROVE_ID, domain: "finance", name: "purchase.approve", description: "Approve a purchase transaction" },
    { id: ACTION_BUDGET_ALLOCATE_ID, domain: "finance", name: "budget.allocate", description: "Allocate budget to department" },
    { id: ACTION_BUDGET_TRANSFER_ID, domain: "finance", name: "budget.transfer", description: "Transfer budget between departments" },
    { id: ACTION_EXPENSE_SUBMIT_ID, domain: "finance", name: "expense.submit", description: "Submit an expense report" },
    { id: ACTION_EXPENSE_APPROVE_ID, domain: "finance", name: "expense.approve", description: "Approve an expense report" },
    // Communication
    { id: ACTION_EMAIL_SEND_ID, domain: "communication", name: "email.send", description: "Send an internal email" },
    { id: ACTION_EMAIL_SEND_EXTERNAL_ID, domain: "communication", name: "email.send_external", description: "Send an external email" },
    { id: ACTION_MEETING_SCHEDULE_ID, domain: "communication", name: "meeting.schedule", description: "Schedule a meeting" },
    { id: ACTION_DOCUMENT_SHARE_ID, domain: "communication", name: "document.share", description: "Share a document" },
    // Agent delegation
    { id: ACTION_AGENT_DELEGATE_ID, domain: "agent_delegation", name: "agent.delegate", description: "Delegate authority to another agent" },
    { id: ACTION_AGENT_CREATE_ID, domain: "agent_delegation", name: "agent.create", description: "Create a new agent" },
    { id: ACTION_AGENT_REVOKE_ID, domain: "agent_delegation", name: "agent.revoke", description: "Revoke an agent" },
    { id: ACTION_API_CALL_ID, domain: "agent_delegation", name: "api.call", description: "Call an external API" },
  ]).onConflictDoNothing();

  // 5. Dimension definitions for purchase.initiate
  await db.insert(schema.dimensionDefinitions).values([
    {
      id: DIM_PURCHASE_AMOUNT_ID,
      actionTypeId: ACTION_PURCHASE_INITIATE_ID,
      dimensionName: "amount",
      kind: "numeric",
      numericMax: "25000",
    },
    {
      id: DIM_PURCHASE_VENDOR_ID,
      actionTypeId: ACTION_PURCHASE_INITIATE_ID,
      dimensionName: "vendor",
      kind: "set",
      setMembers: ["aws", "azure", "gcp", "github", "vercel", "railway", "vendor-acme-001"],
    },
    {
      id: DIM_PURCHASE_CATEGORY_ID,
      actionTypeId: ACTION_PURCHASE_INITIATE_ID,
      dimensionName: "category",
      kind: "set",
      setMembers: ["compute", "software-licenses", "cloud-services", "api-credits", "developer-tools"],
    },
    {
      id: DIM_PURCHASE_HUMAN_APPROVAL_ID,
      actionTypeId: ACTION_PURCHASE_INITIATE_ID,
      dimensionName: "requires_human_approval",
      kind: "boolean",
      boolDefault: false,
      boolRestrictive: true,
    },
    {
      id: DIM_PURCHASE_BUDGET_EXPIRY_ID,
      actionTypeId: ACTION_PURCHASE_INITIATE_ID,
      dimensionName: "budget_expiry",
      kind: "temporal",
      temporalExpiry: "2026-12-31",
    },
    // purchase.approve
    {
      id: "00000000-0000-0000-0000-000000000610",
      actionTypeId: ACTION_PURCHASE_APPROVE_ID,
      dimensionName: "amount",
      kind: "numeric",
      numericMax: "25000",
    },
    {
      id: "00000000-0000-0000-0000-000000000611",
      actionTypeId: ACTION_PURCHASE_APPROVE_ID,
      dimensionName: "approval_level",
      kind: "set",
      setMembers: ["manager", "director", "vp", "cfo"],
    },
    // budget.allocate
    {
      id: "00000000-0000-0000-0000-000000000620",
      actionTypeId: ACTION_BUDGET_ALLOCATE_ID,
      dimensionName: "amount",
      kind: "numeric",
      numericMax: "100000",
    },
    {
      id: "00000000-0000-0000-0000-000000000621",
      actionTypeId: ACTION_BUDGET_ALLOCATE_ID,
      dimensionName: "department",
      kind: "set",
      setMembers: ["finance", "engineering", "operations"],
    },
    // budget.transfer
    {
      id: "00000000-0000-0000-0000-000000000630",
      actionTypeId: ACTION_BUDGET_TRANSFER_ID,
      dimensionName: "amount",
      kind: "numeric",
      numericMax: "50000",
    },
    {
      id: "00000000-0000-0000-0000-000000000631",
      actionTypeId: ACTION_BUDGET_TRANSFER_ID,
      dimensionName: "source_department",
      kind: "set",
      setMembers: ["finance", "engineering", "operations"],
    },
    {
      id: "00000000-0000-0000-0000-000000000632",
      actionTypeId: ACTION_BUDGET_TRANSFER_ID,
      dimensionName: "target_department",
      kind: "set",
      setMembers: ["finance", "engineering", "operations"],
    },
    // expense.submit
    {
      id: "00000000-0000-0000-0000-000000000640",
      actionTypeId: ACTION_EXPENSE_SUBMIT_ID,
      dimensionName: "amount",
      kind: "numeric",
      numericMax: "10000",
    },
    {
      id: "00000000-0000-0000-0000-000000000641",
      actionTypeId: ACTION_EXPENSE_SUBMIT_ID,
      dimensionName: "category",
      kind: "set",
      setMembers: ["compute", "software-licenses", "cloud-services", "api-credits", "developer-tools", "travel", "office"],
    },
    {
      id: "00000000-0000-0000-0000-000000000642",
      actionTypeId: ACTION_EXPENSE_SUBMIT_ID,
      dimensionName: "vendor",
      kind: "set",
      setMembers: ["aws", "azure", "gcp", "github", "vercel", "railway", "vendor-acme-001"],
    },
    // expense.approve
    {
      id: "00000000-0000-0000-0000-000000000650",
      actionTypeId: ACTION_EXPENSE_APPROVE_ID,
      dimensionName: "amount",
      kind: "numeric",
      numericMax: "10000",
    },
    // email.send
    {
      id: "00000000-0000-0000-0000-000000000660",
      actionTypeId: ACTION_EMAIL_SEND_ID,
      dimensionName: "recipients",
      kind: "rate",
      rateLimit: 100,
      rateWindow: "1 hour",
    },
    {
      id: "00000000-0000-0000-0000-000000000661",
      actionTypeId: ACTION_EMAIL_SEND_ID,
      dimensionName: "domain",
      kind: "set",
      setMembers: ["acme.com", "internal"],
    },
    // email.send_external
    {
      id: "00000000-0000-0000-0000-000000000670",
      actionTypeId: ACTION_EMAIL_SEND_EXTERNAL_ID,
      dimensionName: "recipients",
      kind: "rate",
      rateLimit: 50,
      rateWindow: "1 day",
    },
    {
      id: "00000000-0000-0000-0000-000000000671",
      actionTypeId: ACTION_EMAIL_SEND_EXTERNAL_ID,
      dimensionName: "domain",
      kind: "set",
      setMembers: ["*"],
    },
    {
      id: "00000000-0000-0000-0000-000000000672",
      actionTypeId: ACTION_EMAIL_SEND_EXTERNAL_ID,
      dimensionName: "requires_approval",
      kind: "boolean",
      boolDefault: true,
      boolRestrictive: true,
    },
    // meeting.schedule
    {
      id: "00000000-0000-0000-0000-000000000680",
      actionTypeId: ACTION_MEETING_SCHEDULE_ID,
      dimensionName: "attendee_count",
      kind: "numeric",
      numericMax: "50",
    },
    {
      id: "00000000-0000-0000-0000-000000000681",
      actionTypeId: ACTION_MEETING_SCHEDULE_ID,
      dimensionName: "external_attendees",
      kind: "boolean",
      boolDefault: false,
      boolRestrictive: true,
    },
    // document.share
    {
      id: "00000000-0000-0000-0000-000000000690",
      actionTypeId: ACTION_DOCUMENT_SHARE_ID,
      dimensionName: "classification",
      kind: "set",
      setMembers: ["public", "internal", "confidential"],
    },
    {
      id: "00000000-0000-0000-0000-000000000691",
      actionTypeId: ACTION_DOCUMENT_SHARE_ID,
      dimensionName: "external",
      kind: "boolean",
      boolDefault: false,
      boolRestrictive: true,
    },
    // agent.delegate
    {
      id: "00000000-0000-0000-0000-0000000006a0",
      actionTypeId: ACTION_AGENT_DELEGATE_ID,
      dimensionName: "scope",
      kind: "set",
      setMembers: ["finance", "communication", "agent_delegation"],
    },
    {
      id: "00000000-0000-0000-0000-0000000006a1",
      actionTypeId: ACTION_AGENT_DELEGATE_ID,
      dimensionName: "max_depth",
      kind: "numeric",
      numericMax: "3",
    },
    // agent.create
    {
      id: "00000000-0000-0000-0000-0000000006b0",
      actionTypeId: ACTION_AGENT_CREATE_ID,
      dimensionName: "domain",
      kind: "set",
      setMembers: ["finance", "communication", "agent_delegation"],
    },
    {
      id: "00000000-0000-0000-0000-0000000006b1",
      actionTypeId: ACTION_AGENT_CREATE_ID,
      dimensionName: "spending_limit",
      kind: "numeric",
      numericMax: "5000",
    },
    // api.call
    {
      id: "00000000-0000-0000-0000-0000000006c0",
      actionTypeId: ACTION_API_CALL_ID,
      dimensionName: "endpoint",
      kind: "set",
      setMembers: ["*"],
    },
    {
      id: "00000000-0000-0000-0000-0000000006c1",
      actionTypeId: ACTION_API_CALL_ID,
      dimensionName: "rate",
      kind: "rate",
      rateLimit: 60,
      rateWindow: "1 minute",
    },
  ]).onConflictDoNothing();
}

/**
 * Seeds a test organization with group hierarchy and agent membership.
 * Not called in production — use the dashboard UI to create organizations.
 */
export async function seedTestOrg(db: DrizzleDB): Promise<void> {
  await db.insert(schema.organizations).values({
    id: ORG_ID,
    name: "Acme Corp",
    slug: "acme-corp",
    policyVersion: 1,
  }).onConflictDoNothing();

  await db.insert(schema.groups).values([
    { id: ACME_GROUP_ID, orgId: ORG_ID, name: "Acme Corp", nodeType: "org", parentId: null },
  ]).onConflictDoNothing();
  await db.insert(schema.groups).values([
    { id: FINANCE_DEPT_ID, orgId: ORG_ID, name: "Finance", nodeType: "department", parentId: ACME_GROUP_ID },
    { id: ENGINEERING_DEPT_ID, orgId: ORG_ID, name: "Engineering", nodeType: "department", parentId: ACME_GROUP_ID },
    { id: OPERATIONS_DEPT_ID, orgId: ORG_ID, name: "Operations", nodeType: "department", parentId: ACME_GROUP_ID },
  ]).onConflictDoNothing();
  await db.insert(schema.groups).values([
    { id: AP_TEAM_ID, orgId: ORG_ID, name: "Accounts Payable", nodeType: "team", parentId: FINANCE_DEPT_ID },
    { id: TREASURY_TEAM_ID, orgId: ORG_ID, name: "Treasury", nodeType: "team", parentId: FINANCE_DEPT_ID },
    { id: PLATFORM_TEAM_ID, orgId: ORG_ID, name: "Platform", nodeType: "team", parentId: ENGINEERING_DEPT_ID },
    { id: MLAI_TEAM_ID, orgId: ORG_ID, name: "ML/AI", nodeType: "team", parentId: ENGINEERING_DEPT_ID },
    { id: PROCUREMENT_TEAM_ID, orgId: ORG_ID, name: "Procurement", nodeType: "team", parentId: OPERATIONS_DEPT_ID },
  ]).onConflictDoNothing();

  await db.insert(schema.agentGroupMemberships).values({
    agentDid: AGENT_DID,
    groupId: PLATFORM_TEAM_ID,
  }).onConflictDoNothing();

  // ---------------------------------------------------------------------------
  // Policies: org-level allow, dept-level allow, team-level allow, deny policies
  // ---------------------------------------------------------------------------

  const ORG_SPENDING_POLICY_ID = "00000000-0000-0000-0000-000000000800";
  const ORG_SPENDING_PV_ID = "00000000-0000-0000-0000-000000000801";
  const DEPT_SPENDING_POLICY_ID = "00000000-0000-0000-0000-000000000810";
  const DEPT_SPENDING_PV_ID = "00000000-0000-0000-0000-000000000811";
  const TEAM_SPENDING_POLICY_ID = "00000000-0000-0000-0000-000000000820";
  const TEAM_SPENDING_PV_ID = "00000000-0000-0000-0000-000000000821";
  const SANCTIONED_VENDORS_POLICY_ID = "00000000-0000-0000-0000-000000000830";
  const SANCTIONED_VENDORS_PV_ID = "00000000-0000-0000-0000-000000000831";
  const HARD_CAP_POLICY_ID = "00000000-0000-0000-0000-000000000840";
  const HARD_CAP_PV_ID = "00000000-0000-0000-0000-000000000841";

  const orgTarget = `Group::"${ACME_GROUP_ID}"`;
  const deptTarget = `Group::"${ENGINEERING_DEPT_ID}"`;
  const teamTarget = `Group::"${PLATFORM_TEAM_ID}"`;

  // 1. Org-level allow policy
  const orgConstraints: PolicyConstraint[] = [
    {
      actionTypeId: ACTION_PURCHASE_INITIATE_ID,
      actionName: "purchase.initiate",
      dimensions: [
        { name: "amount", kind: "numeric", max: 5000 },
        { name: "vendor", kind: "set", members: ["aws", "azure", "gcp", "github", "vercel", "railway", "vendor-acme-001"] },
        { name: "category", kind: "set", members: ["compute", "software-licenses", "cloud-services", "api-credits", "developer-tools"] },
        { name: "requires_human_approval", kind: "boolean", value: true, restrictive: true },
        { name: "budget_expiry", kind: "temporal", expiry: "2026-12-31" },
        { name: "transactions", kind: "rate", limit: 10, window: "1 hour" },
      ],
    },
  ];
  const orgCedar = generateCedar("org-spending", 1, "allow", orgConstraints, orgTarget);
  const orgCedarHash = createHash("sha256").update(orgCedar).digest("hex");

  // 2. Dept-level allow policy (Engineering)
  const deptConstraints: PolicyConstraint[] = [
    {
      actionTypeId: ACTION_PURCHASE_INITIATE_ID,
      actionName: "purchase.initiate",
      dimensions: [
        { name: "amount", kind: "numeric", max: 2000 },
      ],
    },
  ];
  const deptCedar = generateCedar("engineering-spending", 1, "allow", deptConstraints, deptTarget);
  const deptCedarHash = createHash("sha256").update(deptCedar).digest("hex");

  // 3. Team-level allow policy (Platform)
  const teamConstraints: PolicyConstraint[] = [
    {
      actionTypeId: ACTION_PURCHASE_INITIATE_ID,
      actionName: "purchase.initiate",
      dimensions: [
        { name: "amount", kind: "numeric", max: 1000 },
      ],
    },
  ];
  const teamCedar = generateCedar("platform-team-spending", 1, "allow", teamConstraints, teamTarget);
  const teamCedarHash = createHash("sha256").update(teamCedar).digest("hex");

  // 4. Sanctioned vendors deny policy
  const sanctionedConstraints: PolicyConstraint[] = [
    {
      actionTypeId: ACTION_PURCHASE_INITIATE_ID,
      actionName: "purchase.initiate",
      dimensions: [
        { name: "vendor", kind: "set", members: ["sanctioned-vendor-001"] },
      ],
    },
  ];
  const sanctionedCedar = generateCedar("sanctioned-vendors", 1, "deny", sanctionedConstraints, orgTarget);
  const sanctionedCedarHash = createHash("sha256").update(sanctionedCedar).digest("hex");

  // 5. Hard transaction cap deny policy
  const hardCapConstraints: PolicyConstraint[] = [
    {
      actionTypeId: ACTION_PURCHASE_INITIATE_ID,
      actionName: "purchase.initiate",
      dimensions: [
        { name: "amount", kind: "numeric", max: 25000 },
      ],
    },
  ];
  const hardCapCedar = generateCedar("hard-transaction-cap", 1, "deny", hardCapConstraints, orgTarget);
  const hardCapCedarHash = createHash("sha256").update(hardCapCedar).digest("hex");

  // Insert policies
  await db.insert(schema.policies).values([
    { id: ORG_SPENDING_POLICY_ID, orgId: ORG_ID, name: "org-spending", domain: "finance", effect: "allow", activeVersionId: null },
    { id: DEPT_SPENDING_POLICY_ID, orgId: ORG_ID, name: "engineering-spending", domain: "finance", effect: "allow", activeVersionId: null },
    { id: TEAM_SPENDING_POLICY_ID, orgId: ORG_ID, name: "platform-team-spending", domain: "finance", effect: "allow", activeVersionId: null },
    { id: SANCTIONED_VENDORS_POLICY_ID, orgId: ORG_ID, name: "sanctioned-vendors", domain: "finance", effect: "deny", activeVersionId: null },
    { id: HARD_CAP_POLICY_ID, orgId: ORG_ID, name: "hard-transaction-cap", domain: "finance", effect: "deny", activeVersionId: null },
  ]).onConflictDoNothing();

  // Insert policy versions
  await db.insert(schema.policyVersions).values([
    { id: ORG_SPENDING_PV_ID, policyId: ORG_SPENDING_POLICY_ID, versionNumber: 1, constraints: orgConstraints, cedarSource: orgCedar, cedarHash: orgCedarHash, createdBy: "seed" },
    { id: DEPT_SPENDING_PV_ID, policyId: DEPT_SPENDING_POLICY_ID, versionNumber: 1, constraints: deptConstraints, cedarSource: deptCedar, cedarHash: deptCedarHash, createdBy: "seed" },
    { id: TEAM_SPENDING_PV_ID, policyId: TEAM_SPENDING_POLICY_ID, versionNumber: 1, constraints: teamConstraints, cedarSource: teamCedar, cedarHash: teamCedarHash, createdBy: "seed" },
    { id: SANCTIONED_VENDORS_PV_ID, policyId: SANCTIONED_VENDORS_POLICY_ID, versionNumber: 1, constraints: sanctionedConstraints, cedarSource: sanctionedCedar, cedarHash: sanctionedCedarHash, createdBy: "seed" },
    { id: HARD_CAP_PV_ID, policyId: HARD_CAP_POLICY_ID, versionNumber: 1, constraints: hardCapConstraints, cedarSource: hardCapCedar, cedarHash: hardCapCedarHash, createdBy: "seed" },
  ]).onConflictDoNothing();

  // Activate versions
  await db.update(schema.policies).set({ activeVersionId: ORG_SPENDING_PV_ID }).where(sql`${schema.policies.id} = ${ORG_SPENDING_POLICY_ID}`);
  await db.update(schema.policies).set({ activeVersionId: DEPT_SPENDING_PV_ID }).where(sql`${schema.policies.id} = ${DEPT_SPENDING_POLICY_ID}`);
  await db.update(schema.policies).set({ activeVersionId: TEAM_SPENDING_PV_ID }).where(sql`${schema.policies.id} = ${TEAM_SPENDING_POLICY_ID}`);
  await db.update(schema.policies).set({ activeVersionId: SANCTIONED_VENDORS_PV_ID }).where(sql`${schema.policies.id} = ${SANCTIONED_VENDORS_POLICY_ID}`);
  await db.update(schema.policies).set({ activeVersionId: HARD_CAP_PV_ID }).where(sql`${schema.policies.id} = ${HARD_CAP_POLICY_ID}`);

  // Assign policies to groups
  await db.insert(schema.policyAssignments).values([
    { policyId: ORG_SPENDING_POLICY_ID, groupId: ACME_GROUP_ID, agentDid: null },
    { policyId: DEPT_SPENDING_POLICY_ID, groupId: ENGINEERING_DEPT_ID, agentDid: null },
    { policyId: TEAM_SPENDING_POLICY_ID, groupId: PLATFORM_TEAM_ID, agentDid: null },
    { policyId: SANCTIONED_VENDORS_POLICY_ID, groupId: ACME_GROUP_ID, agentDid: null },
    { policyId: HARD_CAP_POLICY_ID, groupId: ACME_GROUP_ID, agentDid: null },
  ]).onConflictDoNothing();
}
