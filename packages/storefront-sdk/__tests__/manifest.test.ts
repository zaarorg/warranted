import { describe, it, expect } from "vitest";
import { generateManifest } from "../src/manifest";
import { StorefrontManifestSchema, type WarrantedSDKConfig } from "../src/types";

const BASE_CONFIG: WarrantedSDKConfig = {
  vendorId: "vendor-acme-001",
  registryUrl: "https://api.warranted.dev/registry",
  webhookSecret: "whsec_test123",
  minTrustScore: 0,
  acceptedPayment: ["warranted-credits"],
  supportedTransactionTypes: ["fixed-price"],
  jurisdiction: "US",
  sessionTtlSeconds: 3600,
};

describe("generateManifest", () => {
  it("maps config fields to manifest shape", () => {
    const manifest = generateManifest(BASE_CONFIG);

    expect(manifest.warranted_registry).toBe("https://api.warranted.dev/registry");
    expect(manifest.min_trust_score).toBe(0);
    expect(manifest.accepted_payment).toEqual(["warranted-credits"]);
    expect(manifest.supported_transaction_types).toEqual(["fixed-price"]);
    expect(manifest.jurisdiction).toBe("US");
  });

  it("sets version to 1.0", () => {
    const manifest = generateManifest(BASE_CONFIG);
    expect(manifest.version).toBe("1.0");
  });

  it("sets requires_auth to true", () => {
    const manifest = generateManifest(BASE_CONFIG);
    expect(manifest.requires_auth).toBe(true);
  });

  it("sets fixed endpoint paths", () => {
    const manifest = generateManifest(BASE_CONFIG);
    expect(manifest.catalog_endpoint).toBe("/agent-checkout/catalog");
    expect(manifest.session_endpoint).toBe("/agent-checkout/session");
  });

  it("uses default terms_url when not configured", () => {
    const manifest = generateManifest(BASE_CONFIG);
    expect(manifest.terms_url).toBe("/agent-checkout/terms.json");
  });

  it("uses custom terms_url when configured", () => {
    const manifest = generateManifest({
      ...BASE_CONFIG,
      termsUrl: "/custom-terms.json",
    });
    expect(manifest.terms_url).toBe("/custom-terms.json");
  });

  it("derives name from vendorId", () => {
    const manifest = generateManifest(BASE_CONFIG);
    expect(manifest.name).toContain("vendor-acme-001");
  });

  it("reflects custom config values", () => {
    const manifest = generateManifest({
      ...BASE_CONFIG,
      minTrustScore: 500,
      acceptedPayment: ["usdc", "warranted-credits"],
      supportedTransactionTypes: ["fixed-price", "negotiated"],
      jurisdiction: "EU",
    });

    expect(manifest.min_trust_score).toBe(500);
    expect(manifest.accepted_payment).toEqual(["usdc", "warranted-credits"]);
    expect(manifest.supported_transaction_types).toEqual(["fixed-price", "negotiated"]);
    expect(manifest.jurisdiction).toBe("EU");
  });

  it("produces output that validates against StorefrontManifestSchema", () => {
    const manifest = generateManifest(BASE_CONFIG);
    const result = StorefrontManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });
});
