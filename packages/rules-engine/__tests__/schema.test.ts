import { describe, expect, it } from "vitest";
import {
  DimensionConstraintSchema,
  CheckRequestSchema,
  CheckResponseSchema,
  ResolvedEnvelopeSchema,
  PolicyConstraintSchema,
  DimensionKindSchema,
  PetitionRequestSchema,
  PetitionDecisionSchema,
  EngineErrorResponseSchema,
} from "../src/types";
import {
  domainEnum,
  policyEffectEnum,
  dimensionKindEnum,
  decisionOutcomeEnum,
  petitionStatusEnum,
} from "../src/schema";

describe("DimensionConstraint Zod validation", () => {
  it("validates numeric DimensionConstraint", () => {
    const result = DimensionConstraintSchema.safeParse({
      name: "amount",
      kind: "numeric",
      max: 5000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("numeric");
      expect(result.data).toHaveProperty("max", 5000);
    }
  });

  it("validates set DimensionConstraint", () => {
    const result = DimensionConstraintSchema.safeParse({
      name: "vendor",
      kind: "set",
      members: ["aws", "gcp"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("set");
      expect(result.data).toHaveProperty("members", ["aws", "gcp"]);
    }
  });

  it("validates boolean DimensionConstraint with restrictive flag", () => {
    const result = DimensionConstraintSchema.safeParse({
      name: "requires_approval",
      kind: "boolean",
      value: true,
      restrictive: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("boolean");
      expect(result.data).toHaveProperty("value", true);
      expect(result.data).toHaveProperty("restrictive", true);
    }
  });

  it("validates temporal DimensionConstraint (expiry only)", () => {
    const result = DimensionConstraintSchema.safeParse({
      name: "budget_expiry",
      kind: "temporal",
      expiry: "2026-12-31",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("temporal");
      expect(result.data).toHaveProperty("expiry", "2026-12-31");
    }
  });

  it("validates rate DimensionConstraint", () => {
    const result = DimensionConstraintSchema.safeParse({
      name: "tx_rate",
      kind: "rate",
      limit: 10,
      window: "1 hour",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("rate");
      expect(result.data).toHaveProperty("limit", 10);
      expect(result.data).toHaveProperty("window", "1 hour");
    }
  });

  it("rejects numeric missing max", () => {
    const result = DimensionConstraintSchema.safeParse({
      name: "amount",
      kind: "numeric",
    });
    expect(result.success).toBe(false);
  });

  it("rejects set with empty members", () => {
    const result = DimensionConstraintSchema.safeParse({
      name: "vendor",
      kind: "set",
      members: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects boolean missing restrictive", () => {
    const result = DimensionConstraintSchema.safeParse({
      name: "requires_approval",
      kind: "boolean",
      value: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown kind", () => {
    const result = DimensionConstraintSchema.safeParse({
      name: "foo",
      kind: "unknown_kind",
      max: 100,
    });
    expect(result.success).toBe(false);
  });
});

describe("CheckRequest Zod validation", () => {
  it("validates a valid CheckRequest", () => {
    const result = CheckRequestSchema.safeParse({
      principal: 'Agent::"did:mesh:abc123"',
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"vendor-acme-001"',
      context: { amount: 2500, vendor: "aws" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects CheckRequest missing principal", () => {
    const result = CheckRequestSchema.safeParse({
      action: 'Action::"purchase.initiate"',
      resource: 'Resource::"vendor-acme-001"',
      context: {},
    });
    expect(result.success).toBe(false);
  });
});

describe("CheckResponse Zod validation", () => {
  it("validates an Allow response", () => {
    const result = CheckResponseSchema.safeParse({
      decision: "Allow",
      diagnostics: [],
      engineCode: null,
      sdkCode: null,
      details: {},
    });
    expect(result.success).toBe(true);
  });

  it("validates a Deny response with codes", () => {
    const result = CheckResponseSchema.safeParse({
      decision: "Deny",
      diagnostics: ["policy-123"],
      engineCode: "DIMENSION_EXCEEDED",
      sdkCode: "OVER_LIMIT",
      details: { dimension: "amount", max: 5000 },
    });
    expect(result.success).toBe(true);
  });
});

describe("ResolvedEnvelope Zod validation", () => {
  it("validates a full envelope with nested structures", () => {
    const result = ResolvedEnvelopeSchema.safeParse({
      agentDid: "did:mesh:abc123",
      actions: [
        {
          actionId: "action-uuid-1",
          actionName: "purchase.initiate",
          denied: false,
          denySource: null,
          dimensions: [
            {
              name: "amount",
              kind: "numeric",
              resolved: 2000,
              sources: [
                {
                  policyName: "org-spending-limits",
                  groupName: "Acme Corp",
                  level: "org",
                  value: 5000,
                },
                {
                  policyName: "team-spending-limits",
                  groupName: "Platform",
                  level: "team",
                  value: 2000,
                },
              ],
            },
          ],
        },
      ],
      policyVersion: 3,
      resolvedAt: "2026-04-10T12:00:00Z",
    });
    expect(result.success).toBe(true);
  });
});

describe("PolicyConstraint Zod validation", () => {
  it("validates a constraint with multiple dimensions", () => {
    const result = PolicyConstraintSchema.safeParse({
      actionTypeId: "550e8400-e29b-41d4-a716-446655440000",
      actionName: "purchase.initiate",
      dimensions: [
        { name: "amount", kind: "numeric", max: 5000 },
        { name: "vendor", kind: "set", members: ["aws", "gcp"] },
        {
          name: "requires_approval",
          kind: "boolean",
          value: false,
          restrictive: true,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("enum values match expected sets", () => {
  it("domain enum has 3 values", () => {
    expect(domainEnum.enumValues).toEqual([
      "finance",
      "communication",
      "agent_delegation",
    ]);
  });

  it("policyEffect enum has 2 values", () => {
    expect(policyEffectEnum.enumValues).toEqual(["allow", "deny"]);
  });

  it("dimensionKind enum has 5 values", () => {
    expect(dimensionKindEnum.enumValues).toEqual([
      "numeric",
      "rate",
      "set",
      "boolean",
      "temporal",
    ]);
  });

  it("decisionOutcome enum has 4 values", () => {
    expect(decisionOutcomeEnum.enumValues).toEqual([
      "allow",
      "deny",
      "not_applicable",
      "error",
    ]);
  });

  it("petitionStatus enum has 5 values", () => {
    expect(petitionStatusEnum.enumValues).toEqual([
      "pending",
      "approved",
      "denied",
      "expired",
      "cancelled",
    ]);
  });

  it("DimensionKindSchema matches dimensionKind enum values", () => {
    expect(DimensionKindSchema.options).toEqual(dimensionKindEnum.enumValues);
  });
});

describe("Petition types Zod validation", () => {
  it("validates PetitionRequest", () => {
    const result = PetitionRequestSchema.safeParse({
      actionTypeId: "550e8400-e29b-41d4-a716-446655440000",
      requestedContext: { amount: 6000, vendor: "aws" },
      violatedDimension: "amount",
      requestedValue: 6000,
      justification: "Emergency server capacity for incident response",
    });
    expect(result.success).toBe(true);
  });

  it("validates PetitionDecision", () => {
    const result = PetitionDecisionSchema.safeParse({
      decision: "approved",
      reason: "Emergency approved by CTO",
      grantExpiresAt: "2026-04-11T12:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("validates PetitionDecision without grantExpiresAt", () => {
    const result = PetitionDecisionSchema.safeParse({
      decision: "denied",
      reason: "Not justified",
    });
    expect(result.success).toBe(true);
  });
});

describe("EngineErrorResponse Zod validation", () => {
  it("validates error response with engine detail", () => {
    const result = EngineErrorResponseSchema.safeParse({
      success: false,
      error: {
        code: "OVER_LIMIT",
        message: "Transaction amount 6000 exceeds spending limit 5000",
        details: { limit: 5000, requested: 6000 },
        engine: {
          code: "DIMENSION_EXCEEDED",
          dimension: "amount",
          resolved: 5000,
          requested: 6000,
          sources: [
            {
              policyName: "org-spending-limits",
              groupName: "Acme Corp",
              level: "org",
              value: 5000,
            },
          ],
          petitionable: true,
        },
      },
      retryHint: {
        reason: "policy_updated",
        message: "Policy changed since token was issued. Refresh your token and retry.",
      },
    });
    expect(result.success).toBe(true);
  });

  it("validates error response without engine detail", () => {
    const result = EngineErrorResponseSchema.safeParse({
      success: false,
      error: {
        code: "OVER_LIMIT",
        message: "Transaction amount exceeds spending limit",
        details: {},
      },
    });
    expect(result.success).toBe(true);
  });
});
