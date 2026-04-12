// Schema (Drizzle tables and enums)
export {
  domainEnum,
  policyEffectEnum,
  dimensionKindEnum,
  decisionOutcomeEnum,
  petitionStatusEnum,
  organizations,
  groups,
  agentGroupMemberships,
  actionTypes,
  dimensionDefinitions,
  policies,
  policyVersions,
  policyAssignments,
  decisionLog,
  petitions,
  workosProcessedEvents,
  wosSyncState,
  agentIdentities,
  agentLineage,
  agentKeySeeds,
} from "./schema";

// Types and Zod schemas
export {
  DimensionKindSchema,
  NumericConstraintSchema,
  RateConstraintSchema,
  SetConstraintSchema,
  BooleanConstraintSchema,
  TemporalConstraintSchema,
  DimensionConstraintSchema,
  PolicyConstraintSchema,
  CedarEntitySchema,
  CheckRequestSchema,
  CheckResponseSchema,
  DimensionSourceSchema,
  ResolvedDimensionSchema,
  ResolvedActionSchema,
  ResolvedEnvelopeSchema,
  CachedEnvelopeSchema,
  EngineErrorResponseSchema,
  PetitionRequestSchema,
  PetitionDecisionSchema,
} from "./types";
export type {
  DimensionKind,
  NumericConstraint,
  RateConstraint,
  SetConstraint,
  BooleanConstraint,
  TemporalConstraint,
  DimensionConstraint,
  PolicyConstraint,
  CedarEntity,
  CheckRequest,
  CheckResponse,
  DimensionSource,
  ResolvedDimension,
  ResolvedAction,
  ResolvedEnvelope,
  CachedEnvelope,
  EngineErrorResponse,
  PetitionRequest,
  PetitionDecision,
} from "./types";

// Error codes and mapping
export {
  ENGINE_ERROR_CODES,
  mapEngineToSdkCode,
  buildDualErrorResponse,
} from "./errors";
export type { EngineErrorCode, BuildDualErrorOptions } from "./errors";

// Cedar WASM engine
export { initCedar } from "./cedar-wasm";
export type { CedarEngine } from "./cedar-wasm";

// Envelope resolution
export { resolveEnvelope } from "./envelope";
export type { DrizzleDB } from "./envelope";

// Cedar evaluator
export { CedarEvaluator } from "./evaluator";

// Entity store
export { buildEntityStore, rebuildOnVersionBump } from "./entity-store";

// Cedar source generation
export { generateCedar } from "./cedar-gen";

// Envelope cache
export { NoOpEnvelopeCache } from "./cache";
export type { EnvelopeCache, CachedEnvelopeEntry } from "./cache";

// Petition data model
export { PetitionCreateSchema, PetitionDecideSchema, PetitionResponseShape } from "./petition";
export type { PetitionCreate, PetitionDecide } from "./petition";

// Seed data
export {
  seed,
  seedTestOrg,
  ORG_ID,
  ACME_GROUP_ID,
  FINANCE_DEPT_ID,
  ENGINEERING_DEPT_ID,
  OPERATIONS_DEPT_ID,
  AP_TEAM_ID,
  TREASURY_TEAM_ID,
  PLATFORM_TEAM_ID,
  MLAI_TEAM_ID,
  PROCUREMENT_TEAM_ID,
  AGENT_DID,
  ACTION_PURCHASE_INITIATE_ID,
  ACTION_PURCHASE_APPROVE_ID,
  ACTION_BUDGET_ALLOCATE_ID,
  ACTION_BUDGET_TRANSFER_ID,
  ACTION_EXPENSE_SUBMIT_ID,
  ACTION_EXPENSE_APPROVE_ID,
  ACTION_EMAIL_SEND_ID,
  ACTION_EMAIL_SEND_EXTERNAL_ID,
  ACTION_MEETING_SCHEDULE_ID,
  ACTION_DOCUMENT_SHARE_ID,
  ACTION_AGENT_DELEGATE_ID,
  ACTION_AGENT_CREATE_ID,
  ACTION_AGENT_REVOKE_ID,
  ACTION_API_CALL_ID,
} from "./seed";
