import { z } from "zod";

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const CatalogItemSchema = z.object({
  sku: z.string(),
  name: z.string(),
  price: z.number().positive(),
  currency: z.string(),
  category: z.string(),
  available: z.boolean(),
  metadata: z.record(z.unknown()).optional(),
});
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const CatalogResponseSchema = z.object({
  vendor: z.string(),
  pricing: z.enum(["fixed", "negotiable"]),
  items: z.array(CatalogItemSchema),
});
export type CatalogResponse = z.infer<typeof CatalogResponseSchema>;

// ---------------------------------------------------------------------------
// SDK Config
// ---------------------------------------------------------------------------

export const WarrantedSDKConfigSchema = z.object({
  vendorId: z.string().min(1),
  registryUrl: z.string().url(),
  webhookSecret: z.string().min(1),
  webhookUrl: z.string().url().optional(),
  minTrustScore: z.number().int().min(0).max(1000).default(0),
  acceptedPayment: z.array(z.string()).default(["warranted-credits"]),
  supportedTransactionTypes: z
    .array(z.enum(["fixed-price", "negotiated"]))
    .default(["fixed-price"]),
  jurisdiction: z.string().default("US"),
  termsUrl: z.string().optional(),
  sessionTtlSeconds: z.number().int().positive().default(3600),
  catalog: z.array(CatalogItemSchema).optional(),
});
export type WarrantedSDKConfig = z.infer<typeof WarrantedSDKConfigSchema>;

// ---------------------------------------------------------------------------
// Storefront Manifest
// ---------------------------------------------------------------------------

export const StorefrontManifestSchema = z.object({
  name: z.string(),
  version: z.literal("1.0"),
  warranted_registry: z.string(),
  requires_auth: z.boolean(),
  min_trust_score: z.number().int().min(0).max(1000),
  accepted_payment: z.array(z.string()),
  catalog_endpoint: z.string(),
  session_endpoint: z.string(),
  supported_transaction_types: z.array(z.string()),
  terms_url: z.string(),
  jurisdiction: z.string(),
});
export type StorefrontManifest = z.infer<typeof StorefrontManifestSchema>;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const SessionStatusSchema = z.enum([
  "identity_verified",
  "context_set",
  "negotiating",
  "settling",
  "complete",
  "disputed",
  "cancelled",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const CartItemSchema = z.object({
  sku: z.string(),
  name: z.string(),
  price: z.number(),
  category: z.string(),
  quantity: z.number().int().positive().default(1),
});
export type CartItem = z.infer<typeof CartItemSchema>;

export const TransactionSessionSchema = z.object({
  sessionId: z.string(),
  status: SessionStatusSchema,
  agentDid: z.string(),
  vendorId: z.string(),
  items: z.array(CartItemSchema),
  totalAmount: z.number(),
  agentAuthorityChain: z.array(z.string()),
  agentSpendingLimit: z.number(),
  agentTrustScore: z.number(),
  jurisdiction: z.string(),
  transcriptHash: z.string().nullable(),
  receiptId: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  settledAt: z.string().nullable(),
});
export type TransactionSession = z.infer<typeof TransactionSessionSchema>;

// ---------------------------------------------------------------------------
// Verified Agent Context
// ---------------------------------------------------------------------------

export const VerifiedAgentContextSchema = z.object({
  did: z.string(),
  agentId: z.string(),
  owner: z.string(),
  authorityChain: z.array(z.string()),
  spendingLimit: z.number(),
  dailySpendLimit: z.number(),
  categories: z.array(z.string()),
  approvedVendors: z.array(z.string()),
  trustScore: z.number().int().min(0).max(1000),
  lifecycleState: z.literal("active"),
  publicKey: z.string(),
  tokenExp: z.number(),
});
export type VerifiedAgentContext = z.infer<typeof VerifiedAgentContextSchema>;

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export const TransactionReceiptSchema = z.object({
  receiptId: z.string(),
  transactionHash: z.string(),
  buyer: z.object({
    did: z.string(),
    agentId: z.string(),
    owner: z.string(),
    authorityChain: z.array(z.string()),
  }),
  vendor: z.object({
    id: z.string(),
    name: z.string(),
    jurisdiction: z.string(),
  }),
  items: z.array(
    z.object({
      sku: z.string(),
      name: z.string(),
      amount: z.number(),
      quantity: z.number().int().positive(),
      category: z.string(),
    })
  ),
  totalAmount: z.number(),
  currency: z.string(),
  compliance: z.object({
    policyVersion: z.string(),
    rulesEvaluated: z.array(z.string()),
    allPassed: z.boolean(),
    transcriptHash: z.string(),
    humanApprovalRequired: z.boolean(),
    humanApproved: z.boolean().nullable(),
  }),
  settlement: z.object({
    method: z.enum(["internal-ledger", "usdc-base", "x402"]),
    settledAt: z.string(),
    confirmationId: z.string(),
  }),
  signatures: z.object({
    agentSignature: z.string(),
    platformSignature: z.string(),
  }),
  createdAt: z.string(),
});
export type TransactionReceipt = z.infer<typeof TransactionReceiptSchema>;

// ---------------------------------------------------------------------------
// Error Response
// ---------------------------------------------------------------------------

export const ErrorCodeSchema = z.enum([
  "NO_TOKEN",
  "INVALID_TOKEN",
  "TOKEN_EXPIRED",
  "UNKNOWN_AGENT",
  "INVALID_SIGNATURE",
  "AGENT_INACTIVE",
  "TRUST_SCORE_LOW",
  "OVER_LIMIT",
  "VENDOR_NOT_APPROVED",
  "CATEGORY_DENIED",
  "SESSION_NOT_FOUND",
  "SESSION_EXPIRED",
  "SESSION_INVALID_STATE",
  "INVALID_ITEMS",
  "REGISTRY_UNREACHABLE",
  "SETTLEMENT_FAILED",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ---------------------------------------------------------------------------
// Webhook Events
// ---------------------------------------------------------------------------

export const SettlementEventSchema = z.object({
  sessionId: z.string(),
  agentDid: z.string(),
  vendorId: z.string(),
  items: z.array(
    z.object({
      sku: z.string(),
      quantity: z.number().int().positive(),
      amount: z.number(),
    })
  ),
  totalAmount: z.number(),
  receiptId: z.string(),
  settlement: z.object({
    method: z.string(),
    confirmationId: z.string(),
  }),
});
export type SettlementEvent = z.infer<typeof SettlementEventSchema>;

export const DisputeEventSchema = z.object({
  sessionId: z.string(),
  reason: z.string(),
  openedBy: z.enum(["buyer", "vendor", "platform"]),
  evidence: z.string().optional(),
});
export type DisputeEvent = z.infer<typeof DisputeEventSchema>;

export const RefundEventSchema = z.object({
  sessionId: z.string(),
  amount: z.number(),
  reason: z.string(),
  refundId: z.string(),
});
export type RefundEvent = z.infer<typeof RefundEventSchema>;

export const WebhookPayloadSchema = z.object({
  event: z.enum([
    "settlement.completed",
    "dispute.opened",
    "refund.processed",
  ]),
  timestamp: z.string(),
  sessionId: z.string(),
  data: z.union([SettlementEventSchema, DisputeEventSchema, RefundEventSchema]),
});
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

// ---------------------------------------------------------------------------
// Negotiation Messages
// ---------------------------------------------------------------------------

export const NegotiationMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("offer"),
    from: z.string(),
    amount: z.number(),
    terms: z.record(z.unknown()),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("counteroffer"),
    from: z.string(),
    amount: z.number(),
    terms: z.record(z.unknown()),
    reason: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("accept"),
    from: z.string(),
    finalAmount: z.number(),
    finalTerms: z.record(z.unknown()),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("reject"),
    from: z.string(),
    reason: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("info_request"),
    from: z.string(),
    question: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("info_response"),
    from: z.string(),
    answer: z.string(),
    data: z.record(z.unknown()).optional(),
    timestamp: z.string(),
  }),
]);
export type NegotiationMessage = z.infer<typeof NegotiationMessageSchema>;

// ---------------------------------------------------------------------------
// Session creation request
// ---------------------------------------------------------------------------

export const CreateSessionRequestSchema = z.object({
  items: z.array(
    z.object({
      sku: z.string(),
      quantity: z.number().int().positive().default(1),
    })
  ),
  transactionType: z.enum(["fixed-price", "negotiated"]).default("fixed-price"),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

// ---------------------------------------------------------------------------
// Settlement request
// ---------------------------------------------------------------------------

export const SettleSessionRequestSchema = z.object({
  paymentMethod: z.string().default("warranted-credits"),
  signedPayload: z.string().optional(),
});
export type SettleSessionRequest = z.infer<typeof SettleSessionRequestSchema>;
