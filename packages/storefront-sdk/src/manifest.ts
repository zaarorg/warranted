import type { WarrantedSDKConfig, StorefrontManifest } from "./types";
import { StorefrontManifestSchema } from "./types";

/**
 * Generates a StorefrontManifest from the SDK configuration.
 *
 * Maps SDK config fields to the discovery manifest shape that agents
 * read from `/.well-known/agent-storefront.json`.
 */
export function generateManifest(config: WarrantedSDKConfig): StorefrontManifest {
  const raw = {
    name: `Storefront ${config.vendorId}`,
    version: "1.0" as const,
    warranted_registry: config.registryUrl,
    requires_auth: true,
    min_trust_score: config.minTrustScore,
    accepted_payment: config.acceptedPayment,
    catalog_endpoint: "/agent-checkout/catalog",
    session_endpoint: "/agent-checkout/session",
    supported_transaction_types: config.supportedTransactionTypes,
    terms_url: config.termsUrl ?? "/agent-checkout/terms.json",
    jurisdiction: config.jurisdiction,
  };

  return StorefrontManifestSchema.parse(raw);
}
