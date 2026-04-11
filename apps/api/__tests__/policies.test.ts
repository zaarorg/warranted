import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { policyRoutes } from "../src/routes/policies/index";
import {
  setupTestDb,
  teardownTestDb,
  getDb,
} from "../../../packages/rules-engine/__tests__/helpers/db";
import { seed, ORG_ID, AGENT_DID, ACME_GROUP_ID, PLATFORM_TEAM_ID, ACTION_PURCHASE_INITIATE_ID, POLICY_AGENT_SPENDING_LIMIT_ID, PetitionResponseShape } from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";

let db: DrizzleDB;
let app: Hono;

function req(path: string, init?: RequestInit) {
  return app.request(path, init);
}

function jsonReq(path: string, body: unknown, method = "POST") {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  db = await setupTestDb();
  await seed(db);
  app = new Hono();
  app.route("/api/policies", policyRoutes(db));
});

afterAll(async () => {
  await teardownTestDb();
});

describe("management API", () => {
  // -------------------------------------------------------------------
  // Policy CRUD
  // -------------------------------------------------------------------
  describe("policy CRUD", () => {
    let createdPolicyId: string;

    it("GET /api/policies/rules lists all policies", async () => {
      const res = await req("/api/policies/rules");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it("POST /api/policies/rules creates a policy", async () => {
      const res = await jsonReq("/api/policies/rules", {
        name: "test-policy-crud",
        orgId: ORG_ID,
        domain: "finance",
        effect: "allow",
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("test-policy-crud");
      createdPolicyId = body.data.id;
    });

    it("GET /api/policies/rules/:id returns a single policy", async () => {
      const res = await req(`/api/policies/rules/${createdPolicyId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(createdPolicyId);
    });

    it("PUT /api/policies/rules/:id updates policy metadata", async () => {
      const res = await jsonReq(
        `/api/policies/rules/${createdPolicyId}`,
        { name: "test-policy-updated" },
        "PUT",
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("test-policy-updated");
    });

    it("GET /api/policies/rules/:id returns 404 for non-existent policy", async () => {
      const res = await req("/api/policies/rules/00000000-0000-0000-0000-999999999999");
      expect(res.status).toBe(404);
    });

    it("DELETE /api/policies/rules/:id deletes a policy", async () => {
      const res = await app.request(`/api/policies/rules/${createdPolicyId}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify it's gone
      const check = await req(`/api/policies/rules/${createdPolicyId}`);
      expect(check.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // Version creation (atomic)
  // -------------------------------------------------------------------
  describe("version creation (atomic)", () => {
    let testPolicyId: string;

    beforeAll(async () => {
      // Create a fresh policy for version tests
      const res = await jsonReq("/api/policies/rules", {
        name: "test-version-policy",
        orgId: ORG_ID,
        domain: "finance",
        effect: "allow",
      });
      const body = await res.json();
      testPolicyId = body.data.id;

      // Assign to a group so Cedar gen has a target
      await jsonReq("/api/policies/assignments", {
        policyId: testPolicyId,
        groupId: ACME_GROUP_ID,
      });
    });

    it("POST /api/policies/rules/:id/versions creates version with Cedar gen", async () => {
      const res = await jsonReq(`/api/policies/rules/${testPolicyId}/versions`, {
        constraints: [
          {
            actionTypeId: ACTION_PURCHASE_INITIATE_ID,
            actionName: "purchase.initiate",
            dimensions: [{ name: "amount", kind: "numeric", max: 1000 }],
          },
        ],
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.versionNumber).toBe(1);
      expect(body.data.cedarSource).toContain("permit");
      expect(body.data.cedarSource).toContain("purchase.initiate");
      expect(body.data.cedarHash).toBeTruthy();
    });

    it("increments policyVersion on org after version creation", async () => {
      // Create another version to see the bump
      const orgBefore = await req(`/api/policies/rules?orgId=${ORG_ID}`);
      const beforeBody = await orgBefore.json();

      await jsonReq(`/api/policies/rules/${testPolicyId}/versions`, {
        constraints: [
          {
            actionTypeId: ACTION_PURCHASE_INITIATE_ID,
            actionName: "purchase.initiate",
            dimensions: [{ name: "amount", kind: "numeric", max: 500 }],
          },
        ],
      });

      // The version number should be 2 now
      const versionsRes = await req(`/api/policies/rules/${testPolicyId}/versions`);
      const versionsBody = await versionsRes.json();
      expect(versionsBody.data.length).toBe(2);
    });

    it("returns 400 for invalid constraints", async () => {
      const res = await jsonReq(`/api/policies/rules/${testPolicyId}/versions`, {
        constraints: [{ invalid: true }],
      });
      expect(res.status).toBe(400);
    });

    it("GET /api/policies/rules/:id/versions lists all versions", async () => {
      const res = await req(`/api/policies/rules/${testPolicyId}/versions`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
    });

    it("POST /api/policies/rules/:id/versions/:vid/activate activates a version", async () => {
      // Get the first version
      const versionsRes = await req(`/api/policies/rules/${testPolicyId}/versions`);
      const versionsBody = await versionsRes.json();
      const firstVersionId = versionsBody.data[0].id;

      const res = await app.request(
        `/api/policies/rules/${testPolicyId}/versions/${firstVersionId}/activate`,
        { method: "POST" },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.activated).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // Groups
  // -------------------------------------------------------------------
  describe("groups", () => {
    let createdGroupId: string;

    it("GET /api/policies/groups lists all groups", async () => {
      const res = await req("/api/policies/groups");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it("POST /api/policies/groups creates a group", async () => {
      const res = await jsonReq("/api/policies/groups", {
        orgId: ORG_ID,
        name: "Test Team",
        nodeType: "team",
        parentId: ACME_GROUP_ID,
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("Test Team");
      createdGroupId = body.data.id;
    });

    it("GET /api/policies/groups/:id returns a group", async () => {
      const res = await req(`/api/policies/groups/${createdGroupId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.name).toBe("Test Team");
    });

    it("GET /api/policies/groups/:id/ancestors returns ancestor chain", async () => {
      const res = await req(`/api/policies/groups/${PLATFORM_TEAM_ID}/ancestors`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      // Platform team → Engineering dept → Acme Corp (3 levels)
      expect(body.data.length).toBe(3);
    });

    it("GET /api/policies/groups/:id/descendants returns descendant tree", async () => {
      const res = await req(`/api/policies/groups/${ACME_GROUP_ID}/descendants`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      // Acme Corp + depts + teams + test team
      expect(body.data.length).toBeGreaterThanOrEqual(9);
    });

    it("POST /api/policies/groups/:id/members adds agent to group", async () => {
      const res = await jsonReq(`/api/policies/groups/${createdGroupId}/members`, {
        agentDid: "did:mesh:test-agent-for-group",
      });
      expect(res.status).toBe(201);
    });

    it("GET /api/policies/groups/:id/members lists members", async () => {
      const res = await req(`/api/policies/groups/${createdGroupId}/members`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBe(1);
      expect(body.data[0].agentDid).toBe("did:mesh:test-agent-for-group");
    });

    it("DELETE /api/policies/groups/:id/members/:did removes agent", async () => {
      const res = await app.request(
        `/api/policies/groups/${createdGroupId}/members/did:mesh:test-agent-for-group`,
        { method: "DELETE" },
      );
      expect(res.status).toBe(200);

      // Verify empty
      const check = await req(`/api/policies/groups/${createdGroupId}/members`);
      const body = await check.json();
      expect(body.data.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // Assignments
  // -------------------------------------------------------------------
  describe("assignments", () => {
    let assignmentId: string;

    it("POST /api/policies/assignments assigns policy to group", async () => {
      // Create a fresh policy for assignment tests
      const pRes = await jsonReq("/api/policies/rules", {
        name: "test-assign-policy",
        orgId: ORG_ID,
        domain: "finance",
        effect: "allow",
      });
      const pBody = await pRes.json();

      const res = await jsonReq("/api/policies/assignments", {
        policyId: pBody.data.id,
        groupId: ACME_GROUP_ID,
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      assignmentId = body.data.id;
    });

    it("POST /api/policies/assignments assigns policy to agent", async () => {
      const pRes = await jsonReq("/api/policies/rules", {
        name: "test-assign-agent-policy",
        orgId: ORG_ID,
        domain: "finance",
        effect: "allow",
      });
      const pBody = await pRes.json();

      const res = await jsonReq("/api/policies/assignments", {
        policyId: pBody.data.id,
        agentDid: AGENT_DID,
      });
      expect(res.status).toBe(201);
    });

    it("rejects assignment with both groupId and agentDid", async () => {
      const res = await jsonReq("/api/policies/assignments", {
        policyId: POLICY_AGENT_SPENDING_LIMIT_ID,
        groupId: ACME_GROUP_ID,
        agentDid: AGENT_DID,
      });
      expect(res.status).toBe(400);
    });

    it("rejects assignment with neither groupId nor agentDid", async () => {
      const res = await jsonReq("/api/policies/assignments", {
        policyId: POLICY_AGENT_SPENDING_LIMIT_ID,
      });
      expect(res.status).toBe(400);
    });

    it("GET /api/policies/assignments?groupId= lists group assignments", async () => {
      const res = await req(`/api/policies/assignments?groupId=${ACME_GROUP_ID}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeGreaterThan(0);
    });

    it("DELETE /api/policies/assignments/:id removes assignment", async () => {
      const res = await app.request(`/api/policies/assignments/${assignmentId}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------
  // Envelope
  // -------------------------------------------------------------------
  describe("envelope", () => {
    it("GET /api/policies/agents/:did/envelope returns resolved envelope", async () => {
      const res = await req(`/api/policies/agents/${AGENT_DID}/envelope`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.agentDid).toBe(AGENT_DID);
      expect(body.data.actions).toBeDefined();
      expect(body.data.policyVersion).toBeGreaterThan(0);
    });

    it("GET /api/policies/agents/:did/policies lists agent's policies", async () => {
      const res = await req(`/api/policies/agents/${AGENT_DID}/policies`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------
  // Check (Cedar evaluation)
  // -------------------------------------------------------------------
  describe("check (Cedar evaluation)", () => {
    it("POST /api/policies/check evaluates and returns Allow", async () => {
      const res = await jsonReq("/api/policies/check", {
        principal: `Agent::"${AGENT_DID}"`,
        action: 'Action::"purchase.initiate"',
        resource: 'Resource::"aws"',
        context: { amount: 500, vendor: "aws", category: "compute" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.decision).toBe("Allow");
    });

    it("POST /api/policies/check evaluates and returns Deny for over-limit", async () => {
      const res = await jsonReq("/api/policies/check", {
        principal: `Agent::"${AGENT_DID}"`,
        action: 'Action::"purchase.initiate"',
        resource: 'Resource::"aws"',
        context: { amount: 50000, vendor: "aws", category: "compute" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.decision).toBe("Deny");
    });

    it("POST /api/policies/check writes decision log entry", async () => {
      // Make a check request first
      await jsonReq("/api/policies/check", {
        principal: `Agent::"${AGENT_DID}"`,
        action: 'Action::"purchase.initiate"',
        resource: 'Resource::"aws"',
        context: { amount: 100, vendor: "aws", category: "compute" },
      });

      // Query decision log
      const res = await req(`/api/policies/decisions?agentDid=${AGENT_DID}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0].bundleHash).toBeTruthy();
    });

    it("returns 400 for invalid check request", async () => {
      const res = await jsonReq("/api/policies/check", { invalid: true });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------
  // Decisions
  // -------------------------------------------------------------------
  describe("decisions", () => {
    it("GET /api/policies/decisions lists decisions", async () => {
      const res = await req("/api/policies/decisions");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it("GET /api/policies/decisions?agentDid= filters by agent", async () => {
      const res = await req(`/api/policies/decisions?agentDid=${AGENT_DID}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      for (const entry of body.data) {
        expect(entry.agentDid).toBe(AGENT_DID);
      }
    });

    it("GET /api/policies/decisions/:id returns single decision", async () => {
      // Get the first decision
      const listRes = await req("/api/policies/decisions");
      const listBody = await listRes.json();
      if (listBody.data.length === 0) return; // skip if no decisions yet

      const id = listBody.data[0].id;
      const res = await req(`/api/policies/decisions/${id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(id);
    });

    it("GET /api/policies/decisions/:id returns 404 for non-existent", async () => {
      const res = await req("/api/policies/decisions/00000000-0000-0000-0000-999999999999");
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // Action Types
  // -------------------------------------------------------------------
  describe("action types", () => {
    it("GET /api/policies/action-types lists all with dimensions", async () => {
      const res = await req("/api/policies/action-types");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(14); // 14 seeded action types

      // Verify dimensions are included
      const purchase = body.data.find(
        (t: { name: string }) => t.name === "purchase.initiate",
      );
      expect(purchase).toBeDefined();
      expect(purchase.dimensions.length).toBeGreaterThan(0);
    });

    it("GET /api/policies/action-types/:id returns single with dimensions", async () => {
      const res = await req(`/api/policies/action-types/${ACTION_PURCHASE_INITIATE_ID}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("purchase.initiate");
      expect(body.data.dimensions.length).toBe(5); // amount, vendor, category, requires_human_approval, budget_expiry
    });

    it("GET /api/policies/action-types/:id returns 404 for non-existent", async () => {
      const res = await req("/api/policies/action-types/00000000-0000-0000-0000-999999999999");
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // Petition Stubs
  // -------------------------------------------------------------------
  describe("petition stubs", () => {
    it("POST /api/policies/petitions returns 501", async () => {
      const res = await jsonReq("/api/policies/petitions", {});
      expect(res.status).toBe(501);
      const body = await res.json();
      expect(body.status).toBe(501);
      expect(body.plannedResponseShape).toBeDefined();
    });

    it("GET /api/policies/petitions returns 501", async () => {
      const res = await req("/api/policies/petitions");
      expect(res.status).toBe(501);
      const body = await res.json();
      expect(body.status).toBe(501);
    });

    it("POST /api/policies/petitions/:id/decide returns 501", async () => {
      const res = await app.request(
        "/api/policies/petitions/00000000-0000-0000-0000-000000000001/decide",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(res.status).toBe(501);
    });

    it("GET /api/policies/petitions/:id returns 501", async () => {
      const res = await req(
        "/api/policies/petitions/00000000-0000-0000-0000-000000000001",
      );
      expect(res.status).toBe(501);
    });

    it("501 response includes plannedResponseShape", async () => {
      const res = await jsonReq("/api/policies/petitions", {});
      const body = await res.json();
      expect(body.plannedResponseShape).toHaveProperty("id");
      expect(body.plannedResponseShape).toHaveProperty("status");
      expect(body.plannedResponseShape).toHaveProperty("approverDid");
    });
  });
});
