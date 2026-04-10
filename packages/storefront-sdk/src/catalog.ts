import type { WarrantedSDKConfig, CatalogResponse } from "./types";

/**
 * Builds a CatalogResponse from the SDK configuration's catalog array.
 *
 * Filters to only available items. Returns an empty items array if no
 * catalog is configured.
 */
export function createCatalogResponse(config: WarrantedSDKConfig): CatalogResponse {
  const items = (config.catalog ?? []).filter((item) => item.available);

  const pricing: CatalogResponse["pricing"] =
    config.supportedTransactionTypes.length === 1 &&
    config.supportedTransactionTypes[0] === "fixed-price"
      ? "fixed"
      : "negotiable";

  return {
    vendor: config.vendorId,
    pricing,
    items,
  };
}
