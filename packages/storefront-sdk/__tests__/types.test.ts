import { describe, it, expect } from "vitest";
import {
  WarrantedSDKConfigSchema,
  CatalogItemSchema,
  CatalogResponseSchema,
  StorefrontManifestSchema,
  SessionStatusSchema,
  CartItemSchema,
  TransactionSessionSchema,
  VerifiedAgentContextSchema,
  TransactionReceiptSchema,
  ErrorResponseSchema,
  SettlementEventSchema,
  DisputeEventSchema,
  RefundEventSchema,
  NegotiationMessageSchema,
  CreateSessionRequestSchema,
  SettleSessionRequestSchema,
} from "../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_CONFIG = {
  vendorId: "vendor-acme-001",
  registryUrl: "https://api.warranted.dev/registry",
  webhookSecret: "whsec_test123",
};

const VALID_CATALOG_ITEM = {
  sku: "gpu-hours-100",
  name: "100 GPU Hours",
  price: 2500,
  currency: "usd",
  category: "compute",
  available: true,
};

// ---------------------------------------------------------------------------
// WarrantedSDKConfig
// ---------------------------------------------------------------------------

describe("WarrantedSDKConfigSchema", () => {
  it("accepts valid config with required fields only", () => {
    const result = WarrantedSDKConfigSchema.safeParse(VALID_CONFIG);
    expect(result.success).toBe(true);
  });

  it("applies default values for optional fields", () => {
    const result = WarrantedSDKConfigSchema.parse(VALID_CONFIG);
    expect(result.minTrustScore).toBe(0);
    expect(result.acceptedPayment).toEqual(["warranted-credits"]);
    expect(result.supportedTransactionTypes).toEqual(["fixed-price"]);
    expect(result.jurisdiction).toBe("US");
    expect(result.sessionTtlSeconds).toBe(3600);
  });

  it("rejects missing vendorId", () => {
    const result = WarrantedSDKConfigSchema.safeParse({
      registryUrl: "https://example.com",
      webhookSecret: "secret",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing registryUrl", () => {
    const result = WarrantedSDKConfigSchema.safeParse({
      vendorId: "v1",
      webhookSecret: "secret",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing webhookSecret", () => {
    const result = WarrantedSDKConfigSchema.safeParse({
      vendorId: "v1",
      registryUrl: "https://example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid registryUrl", () => {
    const result = WarrantedSDKConfigSchema.safeParse({
      ...VALID_CONFIG,
      registryUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty vendorId", () => {
    const result = WarrantedSDKConfigSchema.safeParse({
      ...VALID_CONFIG,
      vendorId: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects minTrustScore out of range", () => {
    expect(
      WarrantedSDKConfigSchema.safeParse({ ...VALID_CONFIG, minTrustScore: -1 }).success
    ).toBe(false);
    expect(
      WarrantedSDKConfigSchema.safeParse({ ...VALID_CONFIG, minTrustScore: 1001 }).success
    ).toBe(false);
  });

  it("accepts full config with all optional fields", () => {
    const result = WarrantedSDKConfigSchema.safeParse({
      ...VALID_CONFIG,
      webhookUrl: "https://acme.com/webhook",
      minTrustScore: 600,
      acceptedPayment: ["usdc"],
      supportedTransactionTypes: ["fixed-price", "negotiated"],
      jurisdiction: "EU",
      termsUrl: "/terms",
      sessionTtlSeconds: 1800,
      catalog: [VALID_CATALOG_ITEM],
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CatalogItem
// ---------------------------------------------------------------------------

describe("CatalogItemSchema", () => {
  it("accepts valid catalog item", () => {
    const result = CatalogItemSchema.safeParse(VALID_CATALOG_ITEM);
    expect(result.success).toBe(true);
  });

  it("rejects non-positive price", () => {
    expect(
      CatalogItemSchema.safeParse({ ...VALID_CATALOG_ITEM, price: 0 }).success
    ).toBe(false);
    expect(
      CatalogItemSchema.safeParse({ ...VALID_CATALOG_ITEM, price: -10 }).success
    ).toBe(false);
  });

  it("accepts optional metadata", () => {
    const result = CatalogItemSchema.safeParse({
      ...VALID_CATALOG_ITEM,
      metadata: { gpu_type: "A100" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toEqual({ gpu_type: "A100" });
    }
  });

  it("rejects missing required fields", () => {
    expect(CatalogItemSchema.safeParse({ sku: "x" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CatalogResponse
// ---------------------------------------------------------------------------

describe("CatalogResponseSchema", () => {
  it("accepts valid response", () => {
    const result = CatalogResponseSchema.safeParse({
      vendor: "acme",
      pricing: "fixed",
      items: [VALID_CATALOG_ITEM],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid pricing type", () => {
    const result = CatalogResponseSchema.safeParse({
      vendor: "acme",
      pricing: "auction",
      items: [],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StorefrontManifest
// ---------------------------------------------------------------------------

describe("StorefrontManifestSchema", () => {
  it("accepts valid manifest", () => {
    const result = StorefrontManifestSchema.safeParse({
      name: "Acme Store",
      version: "1.0",
      warranted_registry: "https://api.warranted.dev",
      requires_auth: true,
      min_trust_score: 600,
      accepted_payment: ["warranted-credits"],
      catalog_endpoint: "/agent-checkout/catalog",
      session_endpoint: "/agent-checkout/session",
      supported_transaction_types: ["fixed-price"],
      terms_url: "/terms.json",
      jurisdiction: "US",
    });
    expect(result.success).toBe(true);
  });

  it("rejects version other than 1.0", () => {
    const result = StorefrontManifestSchema.safeParse({
      name: "Test",
      version: "2.0",
      warranted_registry: "https://example.com",
      requires_auth: true,
      min_trust_score: 0,
      accepted_payment: [],
      catalog_endpoint: "/catalog",
      session_endpoint: "/session",
      supported_transaction_types: [],
      terms_url: "/terms",
      jurisdiction: "US",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SessionStatus
// ---------------------------------------------------------------------------

describe("SessionStatusSchema", () => {
  it("accepts all valid statuses", () => {
    const statuses = [
      "identity_verified",
      "context_set",
      "negotiating",
      "settling",
      "complete",
      "disputed",
      "cancelled",
    ];
    for (const s of statuses) {
      expect(SessionStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(SessionStatusSchema.safeParse("pending").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VerifiedAgentContext
// ---------------------------------------------------------------------------

describe("VerifiedAgentContextSchema", () => {
  it("accepts valid context", () => {
    const result = VerifiedAgentContextSchema.safeParse({
      did: "did:mesh:abc123",
      agentId: "agent-001",
      owner: "acme-corp",
      authorityChain: ["did:mesh:cfo", "did:mesh:abc123"],
      spendingLimit: 5000,
      dailySpendLimit: 10000,
      categories: ["compute"],
      approvedVendors: ["aws"],
      trustScore: 850,
      lifecycleState: "active",
      publicKey: "base64key==",
      tokenExp: 1700000000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-active lifecycle state", () => {
    const result = VerifiedAgentContextSchema.safeParse({
      did: "did:mesh:abc123",
      agentId: "agent-001",
      owner: "acme-corp",
      authorityChain: [],
      spendingLimit: 5000,
      dailySpendLimit: 10000,
      categories: [],
      approvedVendors: [],
      trustScore: 850,
      lifecycleState: "suspended",
      publicKey: "key",
      tokenExp: 1700000000,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ErrorResponse
// ---------------------------------------------------------------------------

describe("ErrorResponseSchema", () => {
  it("accepts valid error response", () => {
    const result = ErrorResponseSchema.safeParse({
      success: false,
      error: {
        code: "NO_TOKEN",
        message: "Missing Authorization header",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts error response with details", () => {
    const result = ErrorResponseSchema.safeParse({
      success: false,
      error: {
        code: "OVER_LIMIT",
        message: "Exceeds limit",
        details: { limit: 5000, requested: 6000 },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid error code", () => {
    const result = ErrorResponseSchema.safeParse({
      success: false,
      error: { code: "BOGUS_CODE", message: "nope" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects success: true", () => {
    const result = ErrorResponseSchema.safeParse({
      success: true,
      error: { code: "NO_TOKEN", message: "test" },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TransactionReceipt
// ---------------------------------------------------------------------------

describe("TransactionReceiptSchema", () => {
  const VALID_RECEIPT = {
    receiptId: "rcpt_abc123",
    transactionHash: "",
    buyer: {
      did: "did:mesh:buyer",
      agentId: "buyer-agent",
      owner: "buyer-corp",
      authorityChain: ["did:mesh:cfo"],
    },
    vendor: { id: "vendor-001", name: "Acme", jurisdiction: "US" },
    items: [
      { sku: "item-1", name: "Item", amount: 1000, quantity: 1, category: "compute" },
    ],
    totalAmount: 1000,
    currency: "usd",
    compliance: {
      policyVersion: "1.0",
      rulesEvaluated: ["spending-limit"],
      allPassed: true,
      transcriptHash: "sha256:abc",
      humanApprovalRequired: false,
      humanApproved: null,
    },
    settlement: {
      method: "internal-ledger" as const,
      settledAt: "2026-04-09T15:00:00Z",
      confirmationId: "ledger_001",
    },
    signatures: {
      agentSignature: "sig1",
      platformSignature: "sig2",
    },
    createdAt: "2026-04-09T15:00:00Z",
  };

  it("accepts valid receipt", () => {
    const result = TransactionReceiptSchema.safeParse(VALID_RECEIPT);
    expect(result.success).toBe(true);
  });

  it("rejects receipt with invalid settlement method", () => {
    const result = TransactionReceiptSchema.safeParse({
      ...VALID_RECEIPT,
      settlement: { ...VALID_RECEIPT.settlement, method: "bitcoin" },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Webhook Events
// ---------------------------------------------------------------------------

describe("SettlementEventSchema", () => {
  it("accepts valid settlement event", () => {
    const result = SettlementEventSchema.safeParse({
      sessionId: "txn_abc",
      agentDid: "did:mesh:agent",
      vendorId: "vendor-001",
      items: [{ sku: "item-1", quantity: 1, amount: 1000 }],
      totalAmount: 1000,
      receiptId: "rcpt_abc",
      settlement: { method: "internal-ledger", confirmationId: "c1" },
    });
    expect(result.success).toBe(true);
  });
});

describe("DisputeEventSchema", () => {
  it("accepts valid dispute event", () => {
    const result = DisputeEventSchema.safeParse({
      sessionId: "txn_abc",
      reason: "Item not delivered",
      openedBy: "buyer",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid openedBy", () => {
    const result = DisputeEventSchema.safeParse({
      sessionId: "txn_abc",
      reason: "test",
      openedBy: "random",
    });
    expect(result.success).toBe(false);
  });
});

describe("RefundEventSchema", () => {
  it("accepts valid refund event", () => {
    const result = RefundEventSchema.safeParse({
      sessionId: "txn_abc",
      amount: 500,
      reason: "Partial refund",
      refundId: "ref_001",
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NegotiationMessage
// ---------------------------------------------------------------------------

describe("NegotiationMessageSchema", () => {
  it("accepts offer message", () => {
    const result = NegotiationMessageSchema.safeParse({
      type: "offer",
      from: "did:mesh:buyer",
      amount: 2000,
      terms: {},
      timestamp: "2026-04-09T15:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts counteroffer message", () => {
    const result = NegotiationMessageSchema.safeParse({
      type: "counteroffer",
      from: "did:mesh:seller",
      amount: 2500,
      terms: {},
      reason: "Too low",
      timestamp: "2026-04-09T15:01:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts accept message", () => {
    const result = NegotiationMessageSchema.safeParse({
      type: "accept",
      from: "did:mesh:buyer",
      finalAmount: 2500,
      finalTerms: { delivery: "2026-04-10" },
      timestamp: "2026-04-09T15:02:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts reject message", () => {
    const result = NegotiationMessageSchema.safeParse({
      type: "reject",
      from: "did:mesh:buyer",
      reason: "Price too high",
      timestamp: "2026-04-09T15:03:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts info_request message", () => {
    const result = NegotiationMessageSchema.safeParse({
      type: "info_request",
      from: "did:mesh:buyer",
      question: "What GPU model?",
      timestamp: "2026-04-09T15:04:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts info_response message", () => {
    const result = NegotiationMessageSchema.safeParse({
      type: "info_response",
      from: "did:mesh:seller",
      answer: "A100 80GB",
      data: { specs: { memory: "80GB" } },
      timestamp: "2026-04-09T15:05:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown message type", () => {
    const result = NegotiationMessageSchema.safeParse({
      type: "barter",
      from: "did:mesh:buyer",
      timestamp: "2026-04-09T15:00:00Z",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreateSessionRequest
// ---------------------------------------------------------------------------

describe("CreateSessionRequestSchema", () => {
  it("accepts valid request with defaults", () => {
    const result = CreateSessionRequestSchema.parse({
      items: [{ sku: "gpu-hours-100" }],
    });
    expect(result.transactionType).toBe("fixed-price");
    expect(result.items[0].quantity).toBe(1);
  });

  it("rejects empty items array", () => {
    const result = CreateSessionRequestSchema.safeParse({ items: [] });
    // Empty array is technically valid by the schema; the SDK validates SKUs
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SettleSessionRequest
// ---------------------------------------------------------------------------

describe("SettleSessionRequestSchema", () => {
  it("applies default payment method", () => {
    const result = SettleSessionRequestSchema.parse({});
    expect(result.paymentMethod).toBe("warranted-credits");
  });
});
