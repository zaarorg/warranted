import { describe, it, expect, beforeAll } from "vitest";
import { createHandler } from "../src/handlers";
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
    {
      sku: "gpu-hours-1000",
      name: "1000 GPU Hours",
      price: 20000,
      currency: "usd",
      category: "compute",
      available: false,
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

describe("createHandler", () => {
  const registry = createMockRegistry();
  const handler = createHandler(CONFIG, registry);

  describe("manifest endpoint", () => {
    it("returns manifest at /.well-known/agent-storefront.json", async () => {
      const req = new Request("http://localhost/.well-known/agent-storefront.json");
      const res = await handler(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/json");

      const body = await res.json();
      expect(body.version).toBe("1.0");
      expect(body.warranted_registry).toBe("https://api.warranted.dev/registry");
      expect(body.requires_auth).toBe(true);
    });

    it("returns 404 for POST to manifest path", async () => {
      const req = new Request("http://localhost/.well-known/agent-storefront.json", {
        method: "POST",
      });
      const res = await handler(req);
      expect(res.status).toBe(404);
    });
  });

  describe("catalog endpoint", () => {
    it("returns catalog at /agent-checkout/catalog with valid auth", async () => {
      const req = new Request("http://localhost/agent-checkout/catalog", {
        headers: { Authorization: `Bearer ${validToken}` },
      });
      const res = await handler(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/json");

      const body = await res.json();
      expect(body.vendor).toBe("vendor-acme-001");
      expect(body.pricing).toBe("fixed");
      expect(body.items).toHaveLength(1);
      expect(body.items[0].sku).toBe("gpu-hours-100");
    });

    it("returns 401 for catalog without auth", async () => {
      const req = new Request("http://localhost/agent-checkout/catalog");
      const res = await handler(req);
      expect(res.status).toBe(401);
    });

    it("returns 401 for POST to catalog path without auth", async () => {
      const req = new Request("http://localhost/agent-checkout/catalog", {
        method: "POST",
      });
      const res = await handler(req);
      expect(res.status).toBe(401);
    });
  });

  describe("unknown paths", () => {
    it("returns 404 with ErrorResponse shape", async () => {
      const req = new Request("http://localhost/unknown");
      const res = await handler(req);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("NOT_FOUND");
      expect(body.error.message).toBe("Not found");
    });

    it("returns 401 for /agent-checkout/ without auth", async () => {
      const req = new Request("http://localhost/agent-checkout/");
      const res = await handler(req);
      expect(res.status).toBe(401);
    });
  });
});
