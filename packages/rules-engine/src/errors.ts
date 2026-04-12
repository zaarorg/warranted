import type { DimensionSource, EngineErrorResponse } from "./types";

// ---------------------------------------------------------------------------
// Engine Error Codes
// ---------------------------------------------------------------------------

export const ENGINE_ERROR_CODES = [
  "POLICY_DENIED",
  "DIMENSION_EXCEEDED",
  "DIMENSION_NOT_IN_SET",
  "DIMENSION_OUTSIDE_WINDOW",
  "DIMENSION_RATE_EXCEEDED",
  "DIMENSION_BOOLEAN_BLOCKED",
  "ENVELOPE_EMPTY",
  "DENY_OVERRIDE",
  "POLICY_EXPIRED",
  "PETITION_REQUIRED",
  "ENGINE_ERROR",
] as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// SDK Error Code Mapping
// ---------------------------------------------------------------------------

interface SdkMapping {
  sdkCode: string;
  httpStatus: number;
}

/** Mapping keyed by `${engineCode}:${dimensionName}` or just `${engineCode}` for non-dimension-specific codes. */
const SDK_MAPPING: Record<string, SdkMapping> = {
  "DIMENSION_EXCEEDED:amount": { sdkCode: "OVER_LIMIT", httpStatus: 403 },
  "DIMENSION_NOT_IN_SET:vendor": { sdkCode: "VENDOR_NOT_APPROVED", httpStatus: 403 },
  "DIMENSION_NOT_IN_SET:category": { sdkCode: "CATEGORY_DENIED", httpStatus: 403 },
  "DIMENSION_BOOLEAN_BLOCKED:trust_gate": { sdkCode: "TRUST_SCORE_LOW", httpStatus: 403 },
  ENVELOPE_EMPTY: { sdkCode: "CATEGORY_DENIED", httpStatus: 403 },
  DENY_OVERRIDE: { sdkCode: "VENDOR_NOT_APPROVED", httpStatus: 403 },
  ENGINE_ERROR: { sdkCode: "REGISTRY_UNREACHABLE", httpStatus: 500 },
};

const DEFAULT_SDK_MAPPING: SdkMapping = { sdkCode: "CATEGORY_DENIED", httpStatus: 403 };

/**
 * Map an engine error code (and optional dimension name) to an SDK-compatible error code and HTTP status.
 */
export function mapEngineToSdkCode(
  engineCode: EngineErrorCode,
  dimensionName?: string,
): SdkMapping {
  if (dimensionName) {
    const specific = SDK_MAPPING[`${engineCode}:${dimensionName}`];
    if (specific) return specific;
  }

  const general = SDK_MAPPING[engineCode];
  if (general) return general;

  return DEFAULT_SDK_MAPPING;
}

// ---------------------------------------------------------------------------
// Dual Error Response Builder
// ---------------------------------------------------------------------------

export interface BuildDualErrorOptions {
  engineCode: EngineErrorCode;
  message: string;
  details?: Record<string, unknown>;
  dimensionName?: string;
  engine?: {
    dimension: string;
    resolved: unknown;
    requested: unknown;
    sources: DimensionSource[];
    petitionable: boolean;
  };
  retryHint?: boolean;
}

/**
 * Build an EngineErrorResponse with both SDK-compatible and engine-specific error information.
 */
export function buildDualErrorResponse(options: BuildDualErrorOptions): EngineErrorResponse {
  const { sdkCode } = mapEngineToSdkCode(options.engineCode, options.dimensionName);

  const response: EngineErrorResponse = {
    success: false,
    error: {
      code: sdkCode,
      message: options.message,
      details: options.details ?? {},
    },
  };

  if (options.engine) {
    response.error.engine = {
      code: options.engineCode,
      ...options.engine,
    };
  }

  if (options.retryHint) {
    response.retryHint = {
      reason: "policy_updated",
      message: "Policy changed since token was issued. Refresh your token and retry.",
    };
  }

  return response;
}
