import { describe, it, expect } from "vitest";
import {
  PetitionCreateSchema,
  PetitionDecideSchema,
  PetitionResponseShape,
} from "../src/petition";

describe("petition data model", () => {
  describe("PetitionCreateSchema", () => {
    it("validates correct PetitionCreate input", () => {
      const result = PetitionCreateSchema.safeParse({
        actionTypeId: "00000000-0000-0000-0000-000000000100",
        requestedContext: { amount: 6000, vendor: "aws" },
        violatedDimension: "amount",
        requestedValue: 6000,
        justification: "Emergency server capacity for incident response",
      });
      expect(result.success).toBe(true);
    });

    it("rejects PetitionCreate with missing justification", () => {
      const result = PetitionCreateSchema.safeParse({
        actionTypeId: "00000000-0000-0000-0000-000000000100",
        requestedContext: { amount: 6000 },
        violatedDimension: "amount",
        requestedValue: 6000,
      });
      expect(result.success).toBe(false);
    });

    it("rejects PetitionCreate with empty justification", () => {
      const result = PetitionCreateSchema.safeParse({
        actionTypeId: "00000000-0000-0000-0000-000000000100",
        requestedContext: {},
        violatedDimension: "amount",
        requestedValue: 6000,
        justification: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects PetitionCreate with invalid UUID", () => {
      const result = PetitionCreateSchema.safeParse({
        actionTypeId: "not-a-uuid",
        requestedContext: {},
        violatedDimension: "amount",
        requestedValue: 6000,
        justification: "Reason",
      });
      expect(result.success).toBe(false);
    });

    it("accepts complex requestedContext", () => {
      const result = PetitionCreateSchema.safeParse({
        actionTypeId: "00000000-0000-0000-0000-000000000100",
        requestedContext: { amount: 6000, vendor: "aws", nested: { key: [1, 2, 3] } },
        violatedDimension: "amount",
        requestedValue: 6000,
        justification: "Complex context test",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("PetitionDecideSchema", () => {
    it("validates correct PetitionDecide input with approved", () => {
      const result = PetitionDecideSchema.safeParse({
        decision: "approved",
        reason: "Emergency approved by VP Engineering",
        grantExpiresAt: "2026-12-31T23:59:59Z",
      });
      expect(result.success).toBe(true);
    });

    it("validates correct PetitionDecide input with denied", () => {
      const result = PetitionDecideSchema.safeParse({
        decision: "denied",
        reason: "Not justified",
      });
      expect(result.success).toBe(true);
    });

    it("rejects PetitionDecide with invalid decision", () => {
      const result = PetitionDecideSchema.safeParse({
        decision: "maybe",
        reason: "Not sure",
      });
      expect(result.success).toBe(false);
    });

    it("rejects PetitionDecide with empty reason", () => {
      const result = PetitionDecideSchema.safeParse({
        decision: "approved",
        reason: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects PetitionDecide with missing reason", () => {
      const result = PetitionDecideSchema.safeParse({
        decision: "approved",
      });
      expect(result.success).toBe(false);
    });

    it("allows optional grantExpiresAt", () => {
      const result = PetitionDecideSchema.safeParse({
        decision: "approved",
        reason: "Valid reason",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.grantExpiresAt).toBeUndefined();
      }
    });
  });

  describe("PetitionResponseShape", () => {
    it("has all expected fields", () => {
      expect(PetitionResponseShape).toHaveProperty("id");
      expect(PetitionResponseShape).toHaveProperty("orgId");
      expect(PetitionResponseShape).toHaveProperty("requestorDid");
      expect(PetitionResponseShape).toHaveProperty("actionTypeId");
      expect(PetitionResponseShape).toHaveProperty("requestedContext");
      expect(PetitionResponseShape).toHaveProperty("violatedPolicyId");
      expect(PetitionResponseShape).toHaveProperty("violatedDimension");
      expect(PetitionResponseShape).toHaveProperty("requestedValue");
      expect(PetitionResponseShape).toHaveProperty("justification");
      expect(PetitionResponseShape).toHaveProperty("approverDid");
      expect(PetitionResponseShape).toHaveProperty("approverGroupId");
      expect(PetitionResponseShape).toHaveProperty("status");
      expect(PetitionResponseShape).toHaveProperty("decisionReason");
      expect(PetitionResponseShape).toHaveProperty("expiresAt");
      expect(PetitionResponseShape).toHaveProperty("grantExpiresAt");
      expect(PetitionResponseShape).toHaveProperty("createdAt");
      expect(PetitionResponseShape).toHaveProperty("decidedAt");
    });

    it("describes correct status values", () => {
      expect(PetitionResponseShape.status).toBe(
        "pending | approved | denied | expired | cancelled",
      );
    });
  });
});
