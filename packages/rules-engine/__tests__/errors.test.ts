import { describe, expect, it } from "vitest";
import {
  ENGINE_ERROR_CODES,
  mapEngineToSdkCode,
  buildDualErrorResponse,
} from "../src/errors";
import type { EngineErrorCode } from "../src/errors";

describe("error code mapping", () => {
  it("maps DIMENSION_EXCEEDED on amount to OVER_LIMIT", () => {
    const result = mapEngineToSdkCode("DIMENSION_EXCEEDED", "amount");
    expect(result.sdkCode).toBe("OVER_LIMIT");
    expect(result.httpStatus).toBe(403);
  });

  it("maps DIMENSION_NOT_IN_SET on vendor to VENDOR_NOT_APPROVED", () => {
    const result = mapEngineToSdkCode("DIMENSION_NOT_IN_SET", "vendor");
    expect(result.sdkCode).toBe("VENDOR_NOT_APPROVED");
    expect(result.httpStatus).toBe(403);
  });

  it("maps DIMENSION_NOT_IN_SET on category to CATEGORY_DENIED", () => {
    const result = mapEngineToSdkCode("DIMENSION_NOT_IN_SET", "category");
    expect(result.sdkCode).toBe("CATEGORY_DENIED");
    expect(result.httpStatus).toBe(403);
  });

  it("maps DIMENSION_BOOLEAN_BLOCKED on trust_gate to TRUST_SCORE_LOW", () => {
    const result = mapEngineToSdkCode("DIMENSION_BOOLEAN_BLOCKED", "trust_gate");
    expect(result.sdkCode).toBe("TRUST_SCORE_LOW");
    expect(result.httpStatus).toBe(403);
  });

  it("maps ENGINE_ERROR to REGISTRY_UNREACHABLE", () => {
    const result = mapEngineToSdkCode("ENGINE_ERROR");
    expect(result.sdkCode).toBe("REGISTRY_UNREACHABLE");
    expect(result.httpStatus).toBe(500);
  });

  it("maps ENVELOPE_EMPTY to CATEGORY_DENIED", () => {
    const result = mapEngineToSdkCode("ENVELOPE_EMPTY");
    expect(result.sdkCode).toBe("CATEGORY_DENIED");
    expect(result.httpStatus).toBe(403);
  });

  it("maps DENY_OVERRIDE to VENDOR_NOT_APPROVED", () => {
    const result = mapEngineToSdkCode("DENY_OVERRIDE");
    expect(result.sdkCode).toBe("VENDOR_NOT_APPROVED");
    expect(result.httpStatus).toBe(403);
  });

  it("falls back to CATEGORY_DENIED for unmapped codes", () => {
    const result = mapEngineToSdkCode("POLICY_DENIED");
    expect(result.sdkCode).toBe("CATEGORY_DENIED");
    expect(result.httpStatus).toBe(403);
  });

  it("falls back to CATEGORY_DENIED for unmapped dimension-specific codes", () => {
    const result = mapEngineToSdkCode("DIMENSION_EXCEEDED", "unknown_dimension");
    expect(result.sdkCode).toBe("CATEGORY_DENIED");
    expect(result.httpStatus).toBe(403);
  });

  it("every engine error code has an SDK mapping (does not throw)", () => {
    for (const code of ENGINE_ERROR_CODES) {
      const result = mapEngineToSdkCode(code as EngineErrorCode);
      expect(result).toBeDefined();
      expect(result.sdkCode).toBeTruthy();
      expect(typeof result.httpStatus).toBe("number");
    }
  });
});

describe("buildDualErrorResponse", () => {
  it("includes engine detail when provided", () => {
    const response = buildDualErrorResponse({
      engineCode: "DIMENSION_EXCEEDED",
      message: "Transaction amount 6000 exceeds spending limit 5000",
      dimensionName: "amount",
      details: { limit: 5000, requested: 6000 },
      engine: {
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
    });

    expect(response.success).toBe(false);
    expect(response.error.code).toBe("OVER_LIMIT");
    expect(response.error.engine).toBeDefined();
    expect(response.error.engine!.code).toBe("DIMENSION_EXCEEDED");
    expect(response.error.engine!.dimension).toBe("amount");
    expect(response.error.engine!.petitionable).toBe(true);
  });

  it("omits engine detail when not provided", () => {
    const response = buildDualErrorResponse({
      engineCode: "ENVELOPE_EMPTY",
      message: "Agent has no policies granting this action",
    });

    expect(response.success).toBe(false);
    expect(response.error.code).toBe("CATEGORY_DENIED");
    expect(response.error.engine).toBeUndefined();
  });

  it("includes retryHint when specified", () => {
    const response = buildDualErrorResponse({
      engineCode: "DIMENSION_EXCEEDED",
      message: "Amount exceeded",
      dimensionName: "amount",
      retryHint: true,
    });

    expect(response.retryHint).toBeDefined();
    expect(response.retryHint!.reason).toBe("policy_updated");
    expect(response.retryHint!.message).toContain("Refresh your token");
  });

  it("omits retryHint when not specified", () => {
    const response = buildDualErrorResponse({
      engineCode: "DIMENSION_EXCEEDED",
      message: "Amount exceeded",
      dimensionName: "amount",
    });

    expect(response.retryHint).toBeUndefined();
  });

  it("uses correct SDK code from mapping", () => {
    const response = buildDualErrorResponse({
      engineCode: "ENGINE_ERROR",
      message: "Internal error",
    });

    expect(response.error.code).toBe("REGISTRY_UNREACHABLE");
  });
});
