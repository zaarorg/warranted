import { describe, it, expect } from "vitest";
import { createCatalogResponse } from "../src/catalog";
import { CatalogResponseSchema, type WarrantedSDKConfig } from "../src/types";

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

const GPU_ITEM = {
  sku: "gpu-hours-100",
  name: "100 GPU Hours (A100)",
  price: 2500,
  currency: "usd",
  category: "compute",
  available: true,
};

const UNAVAILABLE_ITEM = {
  sku: "gpu-hours-1000",
  name: "1000 GPU Hours (A100)",
  price: 20000,
  currency: "usd",
  category: "compute",
  available: false,
};

describe("createCatalogResponse", () => {
  it("returns all available items", () => {
    const response = createCatalogResponse({
      ...BASE_CONFIG,
      catalog: [GPU_ITEM, UNAVAILABLE_ITEM],
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0].sku).toBe("gpu-hours-100");
  });

  it("filters out unavailable items", () => {
    const response = createCatalogResponse({
      ...BASE_CONFIG,
      catalog: [UNAVAILABLE_ITEM],
    });

    expect(response.items).toHaveLength(0);
  });

  it("returns empty items when no catalog is configured", () => {
    const response = createCatalogResponse(BASE_CONFIG);
    expect(response.items).toEqual([]);
  });

  it("sets vendor from config", () => {
    const response = createCatalogResponse(BASE_CONFIG);
    expect(response.vendor).toBe("vendor-acme-001");
  });

  it("sets pricing to fixed for fixed-price only", () => {
    const response = createCatalogResponse(BASE_CONFIG);
    expect(response.pricing).toBe("fixed");
  });

  it("sets pricing to negotiable when negotiated is supported", () => {
    const response = createCatalogResponse({
      ...BASE_CONFIG,
      supportedTransactionTypes: ["fixed-price", "negotiated"],
    });
    expect(response.pricing).toBe("negotiable");
  });

  it("sets pricing to negotiable for negotiated-only", () => {
    const response = createCatalogResponse({
      ...BASE_CONFIG,
      supportedTransactionTypes: ["negotiated"],
    });
    expect(response.pricing).toBe("negotiable");
  });

  it("validates against CatalogResponseSchema", () => {
    const response = createCatalogResponse({
      ...BASE_CONFIG,
      catalog: [GPU_ITEM],
    });
    const result = CatalogResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  it("preserves item metadata", () => {
    const itemWithMeta = {
      ...GPU_ITEM,
      metadata: { gpu_type: "A100", region: "us-east-1" },
    };
    const response = createCatalogResponse({
      ...BASE_CONFIG,
      catalog: [itemWithMeta],
    });
    expect(response.items[0].metadata).toEqual({
      gpu_type: "A100",
      region: "us-east-1",
    });
  });
});
