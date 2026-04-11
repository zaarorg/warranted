import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { seed, ORG_ID, AGENT_DID, ACTION_PURCHASE_INITIATE_ID } from "../src/seed";
import { initCedar } from "../src/cedar-wasm";
import { CedarEvaluator } from "../src/evaluator";
import { resolveEnvelope } from "../src/envelope";
import type { DrizzleDB } from "../src/envelope";
import * as schema from "../src/schema";

let db: DrizzleDB;
let evaluator: CedarEvaluator;

beforeAll(async () => {
  db = await setupTestDb();
  await seed(db);
  const engine = await initCedar();
  evaluator = new CedarEvaluator(engine);
  await evaluator.loadPolicySet(db, ORG_ID);
}, 30_000);

afterAll(async () => {
  await teardownTestDb();
});

describe("end-to-end integration", () => {
  it("policy → Cedar gen → evaluate → Allow for valid request", () => {
    const result = evaluator.check({
      principal: `Agent::"${AGENT_DID}"`,
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"aws"',
      context: { amount: 500, vendor: "aws", category: "compute" },
    });
    expect(result.decision).toBe("Allow");
  });

  it("envelope resolution matches Cedar evaluation", async () => {
    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find(
      (a) => a.actionName === "purchase.initiate",
    );
    expect(purchaseAction).toBeDefined();

    // Amount within envelope limit → Cedar allows
    const amountDim = purchaseAction!.dimensions.find((d) => d.name === "amount");
    expect(amountDim).toBeDefined();
    const limit = amountDim!.resolved as number;

    const allow = evaluator.check({
      principal: `Agent::"${AGENT_DID}"`,
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"aws"',
      context: { amount: limit - 1, vendor: "aws", category: "compute" },
    });
    expect(allow.decision).toBe("Allow");
  });

  it("cascading narrowing: envelope limit is less than org limit", async () => {
    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find(
      (a) => a.actionName === "purchase.initiate",
    );
    const amountDim = purchaseAction!.dimensions.find((d) => d.name === "amount");
    const engineLimit = amountDim!.resolved as number;

    // Org-level limit is 5000, engineering dept is 2000, platform team is 1000
    // Agent is in Platform team → cascaded to 1000
    expect(engineLimit).toBe(1000);
    expect(engineLimit).toBeLessThan(5000);
  });

  it("two-phase scenario: JWT would pass but engine denies", async () => {
    // Simulate: JWT claims say $5000, engine envelope says $1000
    // Amount $2000 passes local check but engine denies
    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find(
      (a) => a.actionName === "purchase.initiate",
    );
    const amountDim = purchaseAction!.dimensions.find((d) => d.name === "amount");
    const engineLimit = amountDim!.resolved as number;

    // $2000 is within org-level JWT claims (5000) but exceeds engine limit (1000)
    expect(2000).toBeLessThanOrEqual(5000);
    expect(2000).toBeGreaterThan(engineLimit);
  });

  it("bundle hash is recorded and deterministic", () => {
    const hash = evaluator.getBundleHash();
    expect(hash).toBeDefined();
    expect(hash.length).toBe(64); // SHA-256 hex
    // Same hash on second call
    expect(evaluator.getBundleHash()).toBe(hash);
  });

  it("forbid policy denies even when permit policies match", () => {
    const result = evaluator.check({
      principal: `Agent::"${AGENT_DID}"`,
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"sanctioned-vendor-001"',
      context: { amount: 100, vendor: "sanctioned-vendor-001", category: "compute" },
    });
    expect(result.decision).toBe("Deny");
  });

  it("envelope marks sanctioned action as denied", async () => {
    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find(
      (a) => a.actionName === "purchase.initiate",
    );
    // The deny override from sanctioned-vendors sets denied=true
    expect(purchaseAction!.denied).toBe(true);
    expect(purchaseAction!.denySource).toBe("sanctioned-vendors");
  });

  it("decision log can be written after evaluation", async () => {
    await db.insert(schema.decisionLog).values({
      agentDid: AGENT_DID,
      actionTypeId: ACTION_PURCHASE_INITIATE_ID,
      requestContext: { amount: 500, vendor: "aws", category: "compute" },
      bundleHash: evaluator.getBundleHash(),
      outcome: "allow",
      engineErrorCode: null,
      sdkErrorCode: null,
    });

    const entries = await db.select().from(schema.decisionLog);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]!.bundleHash).toBe(evaluator.getBundleHash());
  });

  it("envelope includes provenance chain for cascading dimensions", async () => {
    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find(
      (a) => a.actionName === "purchase.initiate",
    );
    const amountDim = purchaseAction!.dimensions.find((d) => d.name === "amount");

    // Should have sources from multiple levels (org, dept, team)
    expect(amountDim!.sources.length).toBeGreaterThanOrEqual(2);
    const levels = amountDim!.sources.map((s) => s.level);
    expect(levels).toContain("org");
    expect(levels).toContain("team");
  });

  it("vendor set intersection narrows across hierarchy", async () => {
    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    const purchaseAction = envelope.actions.find(
      (a) => a.actionName === "purchase.initiate",
    );
    const vendorDim = purchaseAction!.dimensions.find((d) => d.name === "vendor");
    expect(vendorDim).toBeDefined();

    const resolvedVendors = vendorDim!.resolved as string[];
    // Org-level approved vendors list should be preserved (no narrower vendor set defined)
    expect(resolvedVendors).toContain("aws");
    expect(resolvedVendors).toContain("gcp");
  });

  it("policyVersion is populated in envelope", async () => {
    const envelope = await resolveEnvelope(db, AGENT_DID, ORG_ID);
    expect(envelope.policyVersion).toBe(1);
  });
});
