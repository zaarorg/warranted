import type { DrizzleDB } from "./envelope";
import * as schema from "./schema";

// ---------------------------------------------------------------------------
// Deterministic UUIDs
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
  // 1. Organization
  await db.insert(schema.organizations).values({
    id: ORG_ID,
    name: "Acme Corp",
    slug: "acme-corp",
    policyVersion: 1,
  }).onConflictDoNothing();

  // 2. Group hierarchy
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

  // 3. Agent membership — assigned to Platform team
  await db.insert(schema.agentGroupMemberships).values({
    agentDid: AGENT_DID,
    groupId: PLATFORM_TEAM_ID,
  }).onConflictDoNothing();

  // 4. Action types (14 across 3 domains)
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
