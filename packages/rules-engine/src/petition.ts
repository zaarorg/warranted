import { z } from "zod";

// ---------------------------------------------------------------------------
// Petition Create Schema (what an agent submits)
// ---------------------------------------------------------------------------

export const PetitionCreateSchema = z.object({
  actionTypeId: z.string().uuid(),
  requestedContext: z.record(z.unknown()),
  violatedDimension: z.string(),
  requestedValue: z.unknown(),
  justification: z.string().min(1),
});
export type PetitionCreate = z.infer<typeof PetitionCreateSchema>;

// ---------------------------------------------------------------------------
// Petition Decide Schema (what an admin submits)
// ---------------------------------------------------------------------------

export const PetitionDecideSchema = z.object({
  decision: z.enum(["approved", "denied"]),
  reason: z.string().min(1),
  grantExpiresAt: z.string().optional(),
});
export type PetitionDecide = z.infer<typeof PetitionDecideSchema>;

// ---------------------------------------------------------------------------
// Petition Response Shape (returned by stub endpoints)
// ---------------------------------------------------------------------------

export const PetitionResponseShape = {
  id: "string (UUID)",
  orgId: "string (UUID)",
  requestorDid: "string",
  actionTypeId: "string (UUID)",
  requestedContext: "object",
  violatedPolicyId: "string (UUID)",
  violatedDimension: "string",
  requestedValue: "unknown",
  justification: "string",
  approverDid: "string | null",
  approverGroupId: "string (UUID) | null",
  status: "pending | approved | denied | expired | cancelled",
  decisionReason: "string | null",
  expiresAt: "string (ISO 8601)",
  grantExpiresAt: "string (ISO 8601) | null",
  createdAt: "string (ISO 8601)",
  decidedAt: "string (ISO 8601) | null",
} as const;
