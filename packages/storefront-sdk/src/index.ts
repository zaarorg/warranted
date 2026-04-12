export { WarrantedSDK } from "./sdk";
export { generateManifest } from "./manifest";
export { createCatalogResponse } from "./catalog";
export { createHandler } from "./handlers";
export { createHonoApp } from "./hono-adapter";

// Phase 3: Verification
export {
  decodeAndVerifyJWT,
  decodeJWTUnsafe,
  createTestToken,
  createExpiredTestToken,
  getTestPublicKey,
  type AgentTokenClaims,
} from "./jwt";

export {
  type RegistryClient,
  type RegistryAgentRecord,
  SidecarRegistryClient,
  MockRegistryClient,
} from "./registry-client";

export {
  verifyIdentity,
  verifyAuthorization,
  localAuthorizationCheck,
  engineAuthorizationCheck,
  type AuthorizationResult,
  type EngineAuthorizationDeps,
} from "./verify";

export {
  createVerificationMiddleware,
  getVerifiedAgent,
} from "./middleware";

// Phase 4: Sessions, Receipts, Webhooks
export {
  type SessionStore,
  InMemorySessionStore,
  SessionManager,
} from "./session";

export {
  ReceiptGenerator,
  computeReceiptHash,
  type VendorConfig,
} from "./receipt";

export {
  WebhookEmitter,
  type SettlementHandler,
  type DisputeHandler,
  type RefundHandler,
} from "./webhook";

export {
  // Zod schemas
  CatalogItemSchema,
  CatalogResponseSchema,
  WarrantedSDKConfigSchema,
  StorefrontManifestSchema,
  SessionStatusSchema,
  CartItemSchema,
  TransactionSessionSchema,
  VerifiedAgentContextSchema,
  TransactionReceiptSchema,
  ErrorCodeSchema,
  ErrorResponseSchema,
  SettlementEventSchema,
  DisputeEventSchema,
  RefundEventSchema,
  WebhookPayloadSchema,
  NegotiationMessageSchema,
  CreateSessionRequestSchema,
  SettleSessionRequestSchema,
  // TypeScript types
  type CatalogItem,
  type CatalogResponse,
  type WarrantedSDKConfig,
  type StorefrontManifest,
  type SessionStatus,
  type CartItem,
  type TransactionSession,
  type VerifiedAgentContext,
  type TransactionReceipt,
  type ErrorCode,
  type ErrorResponse,
  type SettlementEvent,
  type DisputeEvent,
  type RefundEvent,
  type WebhookPayload,
  type NegotiationMessage,
  type CreateSessionRequest,
  type SettleSessionRequest,
} from "./types";

export {
  WarrantedError,
  NoTokenError,
  InvalidTokenError,
  TokenExpiredError,
  UnknownAgentError,
  InvalidSignatureError,
  AgentInactiveError,
  TrustScoreLowError,
  OverLimitError,
  VendorNotApprovedError,
  CategoryDeniedError,
  SessionNotFoundError,
  SessionExpiredError,
  SessionInvalidStateError,
  InvalidItemsError,
  RegistryUnreachableError,
  SettlementFailedError,
} from "./errors";
