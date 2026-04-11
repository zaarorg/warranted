import { describe, it, expect, beforeAll, vi } from "vitest";
import { WarrantedSDK } from "../src/sdk";
import { MockRegistryClient } from "../src/registry-client";
import type { RegistryAgentRecord } from "../src/registry-client";
import { createTestToken, getTestPublicKey } from "../src/jwt";
import type { WarrantedSDKConfig } from "../src/types";

const TEST_SEED = "test-seed-123";

const CONFIG: WarrantedSDKConfig = {
  vendorId: "vendor-acme-001",
  registryUrl: "https://api.warranted.dev/registry",
  webhookSecret: "whsec_test123",
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
    categories: ["compute", "software-licenses"],
  });
  return new MockRegistryClient(agents);
}

let validToken: string;

beforeAll(async () => {
  validToken = await createTestToken(
    { approvedVendors: ["aws", "gcp", "azure", "vendor-acme-001"] },
    TEST_SEED
  );
});

describe("settlement flow", () => {
  it("full settle flow: create session → settle → returns receipt", async () => {
    const registry = createMockRegistry();
    const sdk = new WarrantedSDK(CONFIG, registry);

    // Create session
    const createRes = await sdk.fetch(
      new Request("http://localhost/agent-checkout/session", {
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

    expect(createRes.status).toBe(201);
    const session = await createRes.json();
    expect(session.sessionId).toMatch(/^txn_/);
    expect(session.status).toBe("context_set");

    // Settle
    const settleRes = await sdk.fetch(
      new Request(
        `http://localhost/agent-checkout/session/${session.sessionId}/settle`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${validToken}` },
        }
      )
    );

    expect(settleRes.status).toBe(200);
    const result = await settleRes.json();
    expect(result.status).toBe("complete");
    expect(result.receiptId).toMatch(/^rcpt_/);
    expect(result.settledAt).toBeDefined();
    expect(result.confirmationId).toMatch(/^ledger_/);
    expect(result.receipt).toBeDefined();
    expect(result.receipt.buyer.did).toBe(
      "did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6"
    );
    expect(result.receipt.vendor.id).toBe("vendor-acme-001");
    expect(result.receipt.items[0].sku).toBe("gpu-hours-100");
  });

  it("settlement triggers onSettlement callback", async () => {
    const registry = createMockRegistry();
    const sdk = new WarrantedSDK(CONFIG, registry);
    const handler = vi.fn();
    sdk.onSettlement(handler);

    // Create session
    const createRes = await sdk.fetch(
      new Request("http://localhost/agent-checkout/session", {
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
    const session = await createRes.json();

    // Settle
    await sdk.fetch(
      new Request(
        `http://localhost/agent-checkout/session/${session.sessionId}/settle`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${validToken}` },
        }
      )
    );

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]![0];
    expect(event.sessionId).toBe(session.sessionId);
    expect(event.agentDid).toBe(
      "did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6"
    );
    expect(event.receiptId).toMatch(/^rcpt_/);
    expect(event.totalAmount).toBe(2500);
  });

  it("returns 422 for invalid SKU", async () => {
    const registry = createMockRegistry();
    const sdk = new WarrantedSDK(CONFIG, registry);

    const res = await sdk.fetch(
      new Request("http://localhost/agent-checkout/session", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [{ sku: "nonexistent", quantity: 1 }],
          transactionType: "fixed-price",
        }),
      })
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INVALID_ITEMS");
  });

  it("returns 404 for nonexistent session GET", async () => {
    const registry = createMockRegistry();
    const sdk = new WarrantedSDK(CONFIG, registry);

    const res = await sdk.fetch(
      new Request("http://localhost/agent-checkout/session/txn_nonexistent", {
        headers: { Authorization: `Bearer ${validToken}` },
      })
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("returns 200 for valid session GET", async () => {
    const registry = createMockRegistry();
    const sdk = new WarrantedSDK(CONFIG, registry);

    // Create first
    const createRes = await sdk.fetch(
      new Request("http://localhost/agent-checkout/session", {
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
    const session = await createRes.json();

    // Get
    const getRes = await sdk.fetch(
      new Request(
        `http://localhost/agent-checkout/session/${session.sessionId}`,
        { headers: { Authorization: `Bearer ${validToken}` } }
      )
    );

    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.sessionId).toBe(session.sessionId);
  });

  it("returns 409 when settling already-completed session", async () => {
    const registry = createMockRegistry();
    const sdk = new WarrantedSDK(CONFIG, registry);

    // Create + settle
    const createRes = await sdk.fetch(
      new Request("http://localhost/agent-checkout/session", {
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
    const session = await createRes.json();

    await sdk.fetch(
      new Request(
        `http://localhost/agent-checkout/session/${session.sessionId}/settle`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${validToken}` },
        }
      )
    );

    // Try settling again
    const res = await sdk.fetch(
      new Request(
        `http://localhost/agent-checkout/session/${session.sessionId}/settle`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${validToken}` },
        }
      )
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("SESSION_INVALID_STATE");
  });

  it("returns 403 when amount exceeds spending limit via handler", async () => {
    const registry = createMockRegistry();
    // Agent has spending limit of 5000, but we'll make the token have a low limit
    const limitedToken = await createTestToken(
      {
        approvedVendors: ["aws", "gcp", "azure", "vendor-acme-001"],
        spendingLimit: 100,
      },
      TEST_SEED
    );

    // Need registry to also reflect limited spending
    const limitedAgents = new Map<string, RegistryAgentRecord>();
    limitedAgents.set("did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6", {
      did: "did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6",
      publicKey: pubKeyB64,
      trustScore: 850,
      lifecycleState: "active",
      owner: "openclaw-agent-001",
      spendingLimit: 100,
      approvedVendors: ["aws", "gcp", "azure", "vendor-acme-001"],
      categories: ["compute", "software-licenses"],
    });
    const limitedRegistry = new MockRegistryClient(limitedAgents);

    const sdk = new WarrantedSDK(CONFIG, limitedRegistry);

    const res = await sdk.fetch(
      new Request("http://localhost/agent-checkout/session", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${limitedToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [{ sku: "gpu-hours-100", quantity: 1 }],
          transactionType: "fixed-price",
        }),
      })
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("OVER_LIMIT");
  });
});
