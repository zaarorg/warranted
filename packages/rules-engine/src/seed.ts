import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDB } from "./envelope";
import { generateCedar } from "./cedar-gen";
import * as schema from "./schema";
import type { PolicyConstraint } from "./types";

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

// Policies
export const POLICY_AGENT_SPENDING_LIMIT_ID = "00000000-0000-0000-0000-000000000400";
export const POLICY_HARD_TRANSACTION_CAP_ID = "00000000-0000-0000-0000-000000000401";
export const POLICY_APPROVED_VENDORS_ID = "00000000-0000-0000-0000-000000000402";
export const POLICY_SANCTIONED_VENDORS_ID = "00000000-0000-0000-0000-000000000403";
export const POLICY_PERMITTED_CATEGORIES_ID = "00000000-0000-0000-0000-000000000404";
export const POLICY_HOURLY_RATE_LIMIT_ID = "00000000-0000-0000-0000-000000000405";
export const POLICY_DAILY_SPEND_CEILING_ID = "00000000-0000-0000-0000-000000000406";
export const POLICY_ESCALATION_THRESHOLD_ID = "00000000-0000-0000-0000-000000000407";
export const POLICY_COOLING_OFF_PERIOD_ID = "00000000-0000-0000-0000-000000000408";

// Cascading policies
export const POLICY_ENG_DEPT_SPENDING_ID = "00000000-0000-0000-0000-000000000410";
export const POLICY_PLATFORM_TEAM_SPENDING_ID = "00000000-0000-0000-0000-000000000411";

// Policy versions
export const PV_AGENT_SPENDING_LIMIT_ID = "00000000-0000-0000-0000-000000000500";
export const PV_HARD_TRANSACTION_CAP_ID = "00000000-0000-0000-0000-000000000501";
export const PV_APPROVED_VENDORS_ID = "00000000-0000-0000-0000-000000000502";
export const PV_SANCTIONED_VENDORS_ID = "00000000-0000-0000-0000-000000000503";
export const PV_PERMITTED_CATEGORIES_ID = "00000000-0000-0000-0000-000000000504";
export const PV_HOURLY_RATE_LIMIT_ID = "00000000-0000-0000-0000-000000000505";
export const PV_DAILY_SPEND_CEILING_ID = "00000000-0000-0000-0000-000000000506";
export const PV_ESCALATION_THRESHOLD_ID = "00000000-0000-0000-0000-000000000507";
export const PV_COOLING_OFF_PERIOD_ID = "00000000-0000-0000-0000-000000000508";
export const PV_ENG_DEPT_SPENDING_ID = "00000000-0000-0000-0000-000000000510";
export const PV_PLATFORM_TEAM_SPENDING_ID = "00000000-0000-0000-0000-000000000511";

// Dimension definitions
export const DIM_PURCHASE_AMOUNT_ID = "00000000-0000-0000-0000-000000000600";
export const DIM_PURCHASE_VENDOR_ID = "00000000-0000-0000-0000-000000000601";
export const DIM_PURCHASE_CATEGORY_ID = "00000000-0000-0000-0000-000000000602";
export const DIM_PURCHASE_HUMAN_APPROVAL_ID = "00000000-0000-0000-0000-000000000603";
export const DIM_PURCHASE_BUDGET_EXPIRY_ID = "00000000-0000-0000-0000-000000000604";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function cedarHash(cedarSource: string): string {
  return createHash("sha256").update(cedarSource).digest("hex");
}

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

  // 6. Policies (9 from spending-policy.yaml + 2 cascading)
  const orgTarget = `Group::"${ACME_GROUP_ID}"`;
  const engDeptTarget = `Group::"${ENGINEERING_DEPT_ID}"`;
  const platformTeamTarget = `Group::"${PLATFORM_TEAM_ID}"`;

  // --- Policy definitions ---

  type PolicySeed = {
    id: string;
    pvId: string;
    name: string;
    effect: "allow" | "deny";
    constraints: PolicyConstraint[];
    assignTo: string; // group ID
    assignTarget: string; // Cedar entity UID
  };

  const policySeedData: PolicySeed[] = [
    {
      id: POLICY_AGENT_SPENDING_LIMIT_ID,
      pvId: PV_AGENT_SPENDING_LIMIT_ID,
      name: "agent-spending-limit",
      effect: "allow",
      constraints: [
        {
          actionTypeId: ACTION_PURCHASE_INITIATE_ID,
          actionName: "purchase.initiate",
          dimensions: [{ name: "amount", kind: "numeric", max: 5000 }],
        },
      ],
      assignTo: ACME_GROUP_ID,
      assignTarget: orgTarget,
    },
    {
      id: POLICY_HARD_TRANSACTION_CAP_ID,
      pvId: PV_HARD_TRANSACTION_CAP_ID,
      name: "hard-transaction-cap",
      effect: "deny",
      constraints: [
        {
          actionTypeId: ACTION_PURCHASE_INITIATE_ID,
          actionName: "purchase.initiate",
          dimensions: [{ name: "amount", kind: "numeric", max: 25000 }],
        },
      ],
      assignTo: ACME_GROUP_ID,
      assignTarget: orgTarget,
    },
    {
      id: POLICY_APPROVED_VENDORS_ID,
      pvId: PV_APPROVED_VENDORS_ID,
      name: "approved-vendors",
      effect: "allow",
      constraints: [
        {
          actionTypeId: ACTION_PURCHASE_INITIATE_ID,
          actionName: "purchase.initiate",
          dimensions: [
            {
              name: "vendor",
              kind: "set",
              members: ["aws", "azure", "gcp", "github", "vercel", "railway", "vendor-acme-001"],
            },
          ],
        },
      ],
      assignTo: ACME_GROUP_ID,
      assignTarget: orgTarget,
    },
    {
      id: POLICY_SANCTIONED_VENDORS_ID,
      pvId: PV_SANCTIONED_VENDORS_ID,
      name: "sanctioned-vendors",
      effect: "deny",
      constraints: [
        {
          actionTypeId: ACTION_PURCHASE_INITIATE_ID,
          actionName: "purchase.initiate",
          dimensions: [{ name: "vendor", kind: "set", members: ["sanctioned-vendor-001"] }],
        },
      ],
      assignTo: ACME_GROUP_ID,
      assignTarget: orgTarget,
    },
    {
      id: POLICY_PERMITTED_CATEGORIES_ID,
      pvId: PV_PERMITTED_CATEGORIES_ID,
      name: "permitted-categories",
      effect: "allow",
      constraints: [
        {
          actionTypeId: ACTION_PURCHASE_INITIATE_ID,
          actionName: "purchase.initiate",
          dimensions: [
            {
              name: "category",
              kind: "set",
              members: ["compute", "software-licenses", "cloud-services", "api-credits"],
            },
          ],
        },
      ],
      assignTo: ACME_GROUP_ID,
      assignTarget: orgTarget,
    },
    {
      id: POLICY_HOURLY_RATE_LIMIT_ID,
      pvId: PV_HOURLY_RATE_LIMIT_ID,
      name: "hourly-rate-limit",
      effect: "allow",
      constraints: [
        {
          actionTypeId: ACTION_PURCHASE_INITIATE_ID,
          actionName: "purchase.initiate",
          dimensions: [{ name: "transactions", kind: "rate", limit: 10, window: "1 hour" }],
        },
      ],
      assignTo: ACME_GROUP_ID,
      assignTarget: orgTarget,
    },
    {
      id: POLICY_DAILY_SPEND_CEILING_ID,
      pvId: PV_DAILY_SPEND_CEILING_ID,
      name: "daily-spend-ceiling",
      effect: "allow",
      constraints: [
        {
          actionTypeId: ACTION_PURCHASE_INITIATE_ID,
          actionName: "purchase.initiate",
          dimensions: [{ name: "daily_amount", kind: "numeric", max: 10000 }],
        },
      ],
      assignTo: ACME_GROUP_ID,
      assignTarget: orgTarget,
    },
    {
      id: POLICY_ESCALATION_THRESHOLD_ID,
      pvId: PV_ESCALATION_THRESHOLD_ID,
      name: "escalation-threshold",
      effect: "allow",
      constraints: [
        {
          actionTypeId: ACTION_PURCHASE_INITIATE_ID,
          actionName: "purchase.initiate",
          dimensions: [
            { name: "requires_human_approval", kind: "boolean", value: true, restrictive: true },
          ],
        },
      ],
      assignTo: ACME_GROUP_ID,
      assignTarget: orgTarget,
    },
    {
      id: POLICY_COOLING_OFF_PERIOD_ID,
      pvId: PV_COOLING_OFF_PERIOD_ID,
      name: "cooling-off-period",
      effect: "allow",
      constraints: [
        {
          actionTypeId: ACTION_PURCHASE_INITIATE_ID,
          actionName: "purchase.initiate",
          dimensions: [{ name: "cooling_off_expiry", kind: "temporal", expiry: "2026-12-31" }],
        },
      ],
      assignTo: ACME_GROUP_ID,
      assignTarget: orgTarget,
    },
    // Cascading: Engineering dept - lower spending limit
    {
      id: POLICY_ENG_DEPT_SPENDING_ID,
      pvId: PV_ENG_DEPT_SPENDING_ID,
      name: "engineering-dept-spending",
      effect: "allow",
      constraints: [
        {
          actionTypeId: ACTION_PURCHASE_INITIATE_ID,
          actionName: "purchase.initiate",
          dimensions: [{ name: "amount", kind: "numeric", max: 2000 }],
        },
      ],
      assignTo: ENGINEERING_DEPT_ID,
      assignTarget: engDeptTarget,
    },
    // Cascading: Platform team - even lower spending limit
    {
      id: POLICY_PLATFORM_TEAM_SPENDING_ID,
      pvId: PV_PLATFORM_TEAM_SPENDING_ID,
      name: "platform-team-spending",
      effect: "allow",
      constraints: [
        {
          actionTypeId: ACTION_PURCHASE_INITIATE_ID,
          actionName: "purchase.initiate",
          dimensions: [{ name: "amount", kind: "numeric", max: 1000 }],
        },
      ],
      assignTo: PLATFORM_TEAM_ID,
      assignTarget: platformTeamTarget,
    },
  ];

  // Insert policies (without activeVersionId first)
  for (const p of policySeedData) {
    await db.insert(schema.policies).values({
      id: p.id,
      orgId: ORG_ID,
      name: p.name,
      domain: "finance",
      effect: p.effect,
      activeVersionId: null,
    }).onConflictDoNothing();
  }

  // Insert policy versions with generated Cedar source
  for (const p of policySeedData) {
    const cedar = generateCedar(p.name, 1, p.effect, p.constraints, p.assignTarget);
    const hash = cedarHash(cedar);

    await db.insert(schema.policyVersions).values({
      id: p.pvId,
      policyId: p.id,
      versionNumber: 1,
      constraints: p.constraints,
      cedarSource: cedar,
      cedarHash: hash,
      createdBy: "seed",
    }).onConflictDoNothing();
  }

  // Set active version IDs
  for (const p of policySeedData) {
    await db
      .update(schema.policies)
      .set({ activeVersionId: p.pvId })
      .where(
        // Use raw SQL to avoid type issues with the eq helper
        sql`${schema.policies.id} = ${p.id}`,
      );
  }

  // Insert policy assignments
  for (const p of policySeedData) {
    await db.insert(schema.policyAssignments).values({
      policyId: p.id,
      groupId: p.assignTo,
      agentDid: null,
    }).onConflictDoNothing();
  }
}
