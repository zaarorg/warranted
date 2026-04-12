import { z } from "zod";

// ---------------------------------------------------------------------------
// Dimension Kinds
// ---------------------------------------------------------------------------

export const DimensionKindSchema = z.enum([
  "numeric",
  "rate",
  "set",
  "boolean",
  "temporal",
]);
export type DimensionKind = z.infer<typeof DimensionKindSchema>;

// ---------------------------------------------------------------------------
// Dimension Constraints (discriminated union on `kind`)
// ---------------------------------------------------------------------------

export const NumericConstraintSchema = z.object({
  name: z.string(),
  kind: z.literal("numeric"),
  max: z.number(),
});
export type NumericConstraint = z.infer<typeof NumericConstraintSchema>;

export const RateConstraintSchema = z.object({
  name: z.string(),
  kind: z.literal("rate"),
  limit: z.number().int().positive(),
  window: z.string().min(1),
});
export type RateConstraint = z.infer<typeof RateConstraintSchema>;

export const SetConstraintSchema = z.object({
  name: z.string(),
  kind: z.literal("set"),
  members: z.array(z.string()).min(1),
});
export type SetConstraint = z.infer<typeof SetConstraintSchema>;

export const BooleanConstraintSchema = z.object({
  name: z.string(),
  kind: z.literal("boolean"),
  value: z.boolean(),
  restrictive: z.boolean(),
});
export type BooleanConstraint = z.infer<typeof BooleanConstraintSchema>;

export const TemporalConstraintSchema = z.object({
  name: z.string(),
  kind: z.literal("temporal"),
  expiry: z.string(),
});
export type TemporalConstraint = z.infer<typeof TemporalConstraintSchema>;

export const DimensionConstraintSchema = z.discriminatedUnion("kind", [
  NumericConstraintSchema,
  RateConstraintSchema,
  SetConstraintSchema,
  BooleanConstraintSchema,
  TemporalConstraintSchema,
]);
export type DimensionConstraint = z.infer<typeof DimensionConstraintSchema>;

// ---------------------------------------------------------------------------
// Policy Constraint (per action type)
// ---------------------------------------------------------------------------

export const PolicyConstraintSchema = z.object({
  actionTypeId: z.string().uuid(),
  actionName: z.string(),
  dimensions: z.array(DimensionConstraintSchema),
});
export type PolicyConstraint = z.infer<typeof PolicyConstraintSchema>;

// ---------------------------------------------------------------------------
// Cedar Types
// ---------------------------------------------------------------------------

export const CedarEntitySchema = z.object({
  uid: z.string(),
  parents: z.array(z.string()),
  attrs: z.record(z.unknown()),
});
export type CedarEntity = z.infer<typeof CedarEntitySchema>;

// ---------------------------------------------------------------------------
// Check Request / Response (Cedar evaluation)
// ---------------------------------------------------------------------------

export const CheckRequestSchema = z.object({
  principal: z.string(),
  action: z.string(),
  resource: z.string(),
  context: z.record(z.unknown()),
});
export type CheckRequest = z.infer<typeof CheckRequestSchema>;

export const CheckResponseSchema = z.object({
  decision: z.enum(["Allow", "Deny"]),
  diagnostics: z.array(z.string()),
  engineCode: z.string().nullable(),
  sdkCode: z.string().nullable(),
  details: z.record(z.unknown()),
});
export type CheckResponse = z.infer<typeof CheckResponseSchema>;

// ---------------------------------------------------------------------------
// Dimension Source / Resolved Dimension / Resolved Action / Envelope
// ---------------------------------------------------------------------------

export const DimensionSourceSchema = z.object({
  policyName: z.string(),
  groupName: z.string().nullable(),
  level: z.enum(["org", "department", "team", "agent"]),
  value: z.unknown(),
});
export type DimensionSource = z.infer<typeof DimensionSourceSchema>;

export const ResolvedDimensionSchema = z.object({
  name: z.string(),
  kind: DimensionKindSchema,
  resolved: z.unknown(),
  sources: z.array(DimensionSourceSchema),
});
export type ResolvedDimension = z.infer<typeof ResolvedDimensionSchema>;

export const ResolvedActionSchema = z.object({
  actionId: z.string(),
  actionName: z.string(),
  denied: z.boolean(),
  denySource: z.string().nullable(),
  dimensions: z.array(ResolvedDimensionSchema),
});
export type ResolvedAction = z.infer<typeof ResolvedActionSchema>;

export const ResolvedEnvelopeSchema = z.object({
  agentDid: z.string(),
  actions: z.array(ResolvedActionSchema),
  policyVersion: z.number().int(),
  resolvedAt: z.string(),
});
export type ResolvedEnvelope = z.infer<typeof ResolvedEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export const CachedEnvelopeSchema = z.object({
  envelope: ResolvedEnvelopeSchema,
  policyVersion: z.number().int(),
  cachedAt: z.number(),
});
export type CachedEnvelope = z.infer<typeof CachedEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Engine Error Response
// ---------------------------------------------------------------------------

export const EngineErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()),
    engine: z
      .object({
        code: z.string(),
        dimension: z.string(),
        resolved: z.unknown(),
        requested: z.unknown(),
        sources: z.array(DimensionSourceSchema),
        petitionable: z.boolean(),
      })
      .optional(),
  }),
  retryHint: z
    .object({
      reason: z.literal("policy_updated"),
      message: z.string(),
    })
    .optional(),
});
export type EngineErrorResponse = z.infer<typeof EngineErrorResponseSchema>;

// ---------------------------------------------------------------------------
// Petition
// ---------------------------------------------------------------------------

export const PetitionRequestSchema = z.object({
  actionTypeId: z.string().uuid(),
  requestedContext: z.record(z.unknown()),
  violatedDimension: z.string(),
  requestedValue: z.unknown(),
  justification: z.string().min(1),
});
export type PetitionRequest = z.infer<typeof PetitionRequestSchema>;

export const PetitionDecisionSchema = z.object({
  decision: z.enum(["approved", "denied"]),
  reason: z.string().min(1),
  grantExpiresAt: z.string().optional(),
});
export type PetitionDecision = z.infer<typeof PetitionDecisionSchema>;
