import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { seed, seedTestOrg, ORG_ID, AGENT_DID } from "../src/seed";
import { initCedar } from "../src/cedar-wasm";
import { CedarEvaluator } from "../src/evaluator";
import type { DrizzleDB } from "../src/envelope";

let db: DrizzleDB;
let evaluator: CedarEvaluator;

beforeAll(async () => {
  db = await setupTestDb();
  await seed(db);
  await seedTestOrg(db);

  const engine = await initCedar();
  evaluator = new CedarEvaluator(engine);
  await evaluator.loadPolicySet(db, ORG_ID);
}, 30_000);

afterAll(async () => {
  await teardownTestDb();
});

describe("cedar evaluation", () => {
  it("permits when all conditions met", () => {
    const result = evaluator.check({
      principal: `Agent::"${AGENT_DID}"`,
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"vendor-acme-001"',
      context: { amount: 500, vendor: "vendor-acme-001", category: "compute" },
    });
    expect(result.decision).toBe("Allow");
  });

  it("denies when no condition matches any permit policy", () => {
    // All dimensions invalid: amount too high for all policies,
    // vendor not in any set, category not in any set
    const result = evaluator.check({
      principal: `Agent::"${AGENT_DID}"`,
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"sketchy-vendor"',
      context: { amount: 99999, vendor: "sketchy-vendor", category: "weapons" },
    });
    expect(result.decision).toBe("Deny");
  });

  it("forbid overrides permit (sanctioned vendor deny policy)", () => {
    // Sanctioned vendor triggers forbid policy even though other permits match
    const result = evaluator.check({
      principal: `Agent::"${AGENT_DID}"`,
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"sanctioned-vendor-001"',
      context: { amount: 100, vendor: "sanctioned-vendor-001", category: "compute" },
    });
    expect(result.decision).toBe("Deny");
  });

  it("forbid overrides permit (hard cap exceeded)", () => {
    // Amount exceeds hard-transaction-cap (25000) — forbid policy triggers
    const result = evaluator.check({
      principal: `Agent::"${AGENT_DID}"`,
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"aws"',
      context: { amount: 30000, vendor: "aws", category: "compute" },
    });
    expect(result.decision).toBe("Deny");
  });

  it("principal in Group works with loaded entities", () => {
    // The agent is in Platform team → Engineering dept → Acme Corp org
    // Policies assigned to the org group should apply to this agent
    const result = evaluator.check({
      principal: `Agent::"${AGENT_DID}"`,
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"aws"',
      context: { amount: 500, vendor: "aws", category: "compute" },
    });
    expect(result.decision).toBe("Allow");
  });

  it("default deny when no matching permit policy (unknown agent)", () => {
    const result = evaluator.check({
      principal: 'Agent::"did:mesh:unknown-agent"',
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"aws"',
      context: { amount: 100, vendor: "aws", category: "compute" },
    });
    expect(result.decision).toBe("Deny");
  });

  it("returns diagnostics array", () => {
    const result = evaluator.check({
      principal: `Agent::"${AGENT_DID}"`,
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"aws"',
      context: { amount: 500, vendor: "aws", category: "compute" },
    });
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it("bundle hash is deterministic", () => {
    const hash1 = evaluator.getBundleHash();
    const hash2 = evaluator.getBundleHash();
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 hex
  });

  it("context fields are passed through to Cedar evaluation", () => {
    // Valid context → Allow
    const allow = evaluator.check({
      principal: `Agent::"${AGENT_DID}"`,
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"aws"',
      context: { amount: 500, vendor: "aws", category: "compute" },
    });
    // All invalid context → Deny (no permit matches)
    const deny = evaluator.check({
      principal: `Agent::"${AGENT_DID}"`,
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"sketchy-vendor"',
      context: { amount: 99999, vendor: "sketchy-vendor", category: "weapons" },
    });
    expect(allow.decision).toBe("Allow");
    expect(deny.decision).toBe("Deny");
  });

  it("reload detects no version bump and skips", async () => {
    const reloaded = await evaluator.reload(db, ORG_ID);
    expect(reloaded).toBe(false);
  });

  it("deny response includes engine and SDK error codes", () => {
    const result = evaluator.check({
      principal: `Agent::"${AGENT_DID}"`,
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"sanctioned-vendor-001"',
      context: { amount: 100, vendor: "sanctioned-vendor-001", category: "compute" },
    });
    expect(result.decision).toBe("Deny");
    expect(result.engineCode).toBe("POLICY_DENIED");
    expect(result.sdkCode).toBe("CATEGORY_DENIED");
  });

  it("permits action not covered by any forbid policy", () => {
    // A valid request with amount within limits should be allowed
    const result = evaluator.check({
      principal: `Agent::"${AGENT_DID}"`,
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"gcp"',
      context: { amount: 999, vendor: "gcp", category: "cloud-services" },
    });
    expect(result.decision).toBe("Allow");
  });
});
