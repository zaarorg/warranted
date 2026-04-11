import { describe, it, expect, beforeAll } from "vitest";
import { WarrantedSDK } from "../src/sdk";
import { MockRegistryClient } from "../src/registry-client";
import type { RegistryAgentRecord } from "../src/registry-client";
import { createTestToken, getTestPublicKey } from "../src/jwt";
import type { WarrantedSDKConfig, SettlementEvent } from "../src/types";

const TEST_SEED = "test-seed-123";

const CONFIG: WarrantedSDKConfig = {
  vendorId: "vendor-acme-001",
  registryUrl: "http://localhost:8100",
  webhookSecret: "whsec_demo",
  minTrustScore: 0,
  acceptedPayment: ["warranted-credits"],
  supportedTransactionTypes: ["fixed-price"],
  jurisdiction: "US",
  sessionTtlSeconds: 3600,
  catalog: [
    {
      sku: "gpu-hours-100",
      name: "100 GPU Hours (A100)",
      price: 2500,
      currency: "usd",
      category: "compute",
      available: true,
    },
    {
      sku: "gpu-hours-500",
      name: "500 GPU Hours (A100)",
      price: 10000,
      currency: "usd",
      category: "compute",
      available: true,
    },
    {
      sku: "api-credits-10k",
      name: "10K API Credits",
      price: 500,
      currency: "usd",
      category: "api-credits",
      available: true,
    },
  ],
};

const pubKeyBytes = getTestPublicKey(TEST_SEED);
const pubKeyB64 = Buffer.from(pubKeyBytes).toString("base64");

function createMockRegistry(): MockRegistryClient {
  const agents = new Map<string, RegistryAgentRecord>();
  agents.set("did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6", {
    did: "did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6",
    publicKey: pubKeyB64,
    trustScore: 850,
    lifecycleState: "active",
    owner: "openclaw-agent-001",
    spendingLimit: 5000,
    approvedVendors: ["aws", "gcp", "azure", "vendor-acme-001"],
    categories: ["compute", "api-credits"],
  });
  return new MockRegistryClient(agents);
}

let validToken: string;

beforeAll(async () => {
  validToken = await createTestToken(
    {
      approvedVendors: ["aws", "gcp", "azure", "vendor-acme-001"],
      categories: ["compute", "api-credits"],
    },
    TEST_SEED
  );
});

describe("demo integration — full happy path", () => {
  it("completes manifest → catalog → session → settle flow", async () => {
    const registry = createMockRegistry();
    const sdk = new WarrantedSDK(CONFIG, registry);
    const settlementEvents: SettlementEvent[] = [];
    sdk.onSettlement((event) => {
      settlementEvents.push(event);
    });

    // Step 1: Fetch manifest
    const manifestRes = await sdk.fetch(
      new Request("http://localhost:3001/.well-known/agent-storefront.json")
    );
    expect(manifestRes.status).toBe(200);
    const manifest = await manifestRes.json();
    expect(manifest.name).toBeDefined();
    expect(manifest.version).toBe("1.0");
    expect(manifest.catalog_endpoint).toBe("/agent-checkout/catalog");

    // Step 2: Fetch catalog
    const catalogRes = await sdk.fetch(
      new Request("http://localhost:3001/agent-checkout/catalog", {
        headers: { Authorization: `Bearer ${validToken}` },
      })
    );
    expect(catalogRes.status).toBe(200);
    const catalog = await catalogRes.json();
    expect(catalog.items).toHaveLength(3);
    expect(catalog.items[0].sku).toBe("gpu-hours-100");

    // Step 3: Create session
    const sessionRes = await sdk.fetch(
      new Request("http://localhost:3001/agent-checkout/session", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [{ sku: "gpu-hours-100", quantity: 1 }],
          transactionType: "fixed-price",
        }),
      })
    );
    expect(sessionRes.status).toBe(201);
    const session = await sessionRes.json();
    expect(session.sessionId).toMatch(/^txn_/);
    expect(session.totalAmount).toBe(2500);
    expect(session.agentDid).toBe(
      "did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6"
    );

    // Step 4: Settle
    const settleRes = await sdk.fetch(
      new Request(
        `http://localhost:3001/agent-checkout/session/${session.sessionId}/settle`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${validToken}` },
        }
      )
    );
    expect(settleRes.status).toBe(200);
    const settlement = await settleRes.json();
    expect(settlement.receiptId).toMatch(/^rcpt_/);
    expect(settlement.status).toBe("complete");

    // Verify receipt structure
    const receipt = settlement.receipt;
    expect(receipt.buyer.did).toBe(
      "did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6"
    );
    expect(receipt.vendor.id).toBe("vendor-acme-001");
    expect(receipt.totalAmount).toBe(2500);
    expect(receipt.compliance.allPassed).toBe(true);
    expect(receipt.compliance.rulesEvaluated.length).toBeGreaterThan(0);
    expect(receipt.settlement.method).toBe("internal-ledger");

    // Verify settlement callback fired
    expect(settlementEvents).toHaveLength(1);
    expect(settlementEvents[0]!.sessionId).toBe(session.sessionId);
    expect(settlementEvents[0]!.receiptId).toBe(settlement.receiptId);
  });
});

describe("demo integration — failure paths", () => {
  it("rejects over-limit purchase with 403 OVER_LIMIT", async () => {
    const registry = createMockRegistry();
    const sdk = new WarrantedSDK(CONFIG, registry);

    const res = await sdk.fetch(
      new Request("http://localhost:3001/agent-checkout/session", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [{ sku: "gpu-hours-500", quantity: 1 }],
          transactionType: "fixed-price",
        }),
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("OVER_LIMIT");
  });

  it("rejects request without auth with 401 NO_TOKEN", async () => {
    const registry = createMockRegistry();
    const sdk = new WarrantedSDK(CONFIG, registry);

    const res = await sdk.fetch(
      new Request("http://localhost:3001/agent-checkout/catalog")
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("NO_TOKEN");
  });

  it("rejects forged token with 401", async () => {
    const registry = createMockRegistry();
    const sdk = new WarrantedSDK(CONFIG, registry);

    const res = await sdk.fetch(
      new Request("http://localhost:3001/agent-checkout/catalog", {
        headers: { Authorization: "Bearer eyJhbGciOiJFZERTQSJ9.fake.fake" },
      })
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(["INVALID_TOKEN", "INVALID_SIGNATURE"]).toContain(body.error.code);
  });
});
