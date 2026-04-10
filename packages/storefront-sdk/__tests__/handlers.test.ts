import { describe, it, expect } from "vitest";
import { createHandler } from "../src/handlers";
import type { WarrantedSDKConfig } from "../src/types";

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

describe("createHandler", () => {
  const handler = createHandler(CONFIG);

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
    it("returns catalog at /agent-checkout/catalog", async () => {
      const req = new Request("http://localhost/agent-checkout/catalog");
      const res = await handler(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/json");

      const body = await res.json();
      expect(body.vendor).toBe("vendor-acme-001");
      expect(body.pricing).toBe("fixed");
      expect(body.items).toHaveLength(1);
      expect(body.items[0].sku).toBe("gpu-hours-100");
    });

    it("returns 404 for POST to catalog path", async () => {
      const req = new Request("http://localhost/agent-checkout/catalog", {
        method: "POST",
      });
      const res = await handler(req);
      expect(res.status).toBe(404);
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

    it("returns 404 for /agent-checkout root", async () => {
      const req = new Request("http://localhost/agent-checkout");
      const res = await handler(req);
      expect(res.status).toBe(404);
    });
  });
});
