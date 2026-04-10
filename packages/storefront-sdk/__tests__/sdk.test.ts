import { describe, it, expect } from "vitest";
import { WarrantedSDK } from "../src/sdk";

const VALID_CONFIG = {
  vendorId: "vendor-acme-001",
  registryUrl: "https://api.warranted.dev/registry",
  webhookSecret: "whsec_test123",
};

describe("WarrantedSDK", () => {
  describe("construction", () => {
    it("instantiates with valid config", () => {
      const sdk = new WarrantedSDK(VALID_CONFIG);
      expect(sdk.config.vendorId).toBe("vendor-acme-001");
    });

    it("applies default values for optional fields", () => {
      const sdk = new WarrantedSDK(VALID_CONFIG);
      expect(sdk.config.minTrustScore).toBe(0);
      expect(sdk.config.acceptedPayment).toEqual(["warranted-credits"]);
      expect(sdk.config.supportedTransactionTypes).toEqual(["fixed-price"]);
      expect(sdk.config.jurisdiction).toBe("US");
      expect(sdk.config.sessionTtlSeconds).toBe(3600);
    });

    it("throws on missing vendorId", () => {
      expect(
        () =>
          new WarrantedSDK({
            registryUrl: "https://example.com",
            webhookSecret: "secret",
          })
      ).toThrow("vendorId");
    });

    it("throws on missing registryUrl", () => {
      expect(
        () =>
          new WarrantedSDK({
            vendorId: "v1",
            webhookSecret: "secret",
          })
      ).toThrow("registryUrl");
    });

    it("throws on missing webhookSecret", () => {
      expect(
        () =>
          new WarrantedSDK({
            vendorId: "v1",
            registryUrl: "https://example.com",
          })
      ).toThrow("webhookSecret");
    });

    it("throws on invalid registryUrl", () => {
      expect(
        () =>
          new WarrantedSDK({
            ...VALID_CONFIG,
            registryUrl: "not-a-url",
          })
      ).toThrow("registryUrl");
    });

    it("throws on empty vendorId", () => {
      expect(
        () =>
          new WarrantedSDK({
            ...VALID_CONFIG,
            vendorId: "",
          })
      ).toThrow("vendorId");
    });

    it("accepts full config with all optional fields", () => {
      const sdk = new WarrantedSDK({
        ...VALID_CONFIG,
        webhookUrl: "https://acme.com/hook",
        minTrustScore: 500,
        acceptedPayment: ["usdc"],
        supportedTransactionTypes: ["fixed-price", "negotiated"],
        jurisdiction: "EU",
        termsUrl: "/terms",
        sessionTtlSeconds: 7200,
        catalog: [
          {
            sku: "test",
            name: "Test",
            price: 100,
            currency: "usd",
            category: "compute",
            available: true,
          },
        ],
      });
      expect(sdk.config.minTrustScore).toBe(500);
      expect(sdk.config.jurisdiction).toBe("EU");
    });
  });

  describe(".fetch()", () => {
    it("returns 404 for unknown paths", async () => {
      const sdk = new WarrantedSDK(VALID_CONFIG);
      const response = await sdk.fetch(new Request("http://test/unknown"));
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("callback registration", () => {
    it("registers settlement handler without error", () => {
      const sdk = new WarrantedSDK(VALID_CONFIG);
      expect(() => sdk.onSettlement(async () => {})).not.toThrow();
    });

    it("registers dispute handler without error", () => {
      const sdk = new WarrantedSDK(VALID_CONFIG);
      expect(() => sdk.onDispute(async () => {})).not.toThrow();
    });

    it("registers refund handler without error", () => {
      const sdk = new WarrantedSDK(VALID_CONFIG);
      expect(() => sdk.onRefund(async () => {})).not.toThrow();
    });
  });

  describe(".routes()", () => {
    it("returns an object with a fetch method", () => {
      const sdk = new WarrantedSDK(VALID_CONFIG);
      const adapter = sdk.routes();
      expect(typeof adapter.fetch).toBe("function");
    });
  });
});
