import type { ErrorCode, ErrorResponse } from "./types";

/** Base error class for all Warranted SDK errors. */
export class WarrantedError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "WarrantedError";
  }

  /** Serialize to the spec's ErrorResponse shape. */
  toResponse(): ErrorResponse {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }

  /** Build a standard Response object. */
  toHTTPResponse(): Response {
    return new Response(JSON.stringify(this.toResponse()), {
      status: this.httpStatus,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ---------------------------------------------------------------------------
// 401 — Authentication errors
// ---------------------------------------------------------------------------

export class NoTokenError extends WarrantedError {
  constructor(details?: Record<string, unknown>) {
    super(401, "NO_TOKEN", "Missing Authorization header", details);
    this.name = "NoTokenError";
  }
}

export class InvalidTokenError extends WarrantedError {
  constructor(details?: Record<string, unknown>) {
    super(401, "INVALID_TOKEN", "Malformed or unparseable JWT", details);
    this.name = "InvalidTokenError";
  }
}

export class TokenExpiredError extends WarrantedError {
  constructor(details?: Record<string, unknown>) {
    super(401, "TOKEN_EXPIRED", "JWT has expired", details);
    this.name = "TokenExpiredError";
  }
}

export class UnknownAgentError extends WarrantedError {
  constructor(details?: Record<string, unknown>) {
    super(401, "UNKNOWN_AGENT", "DID not found in registry", details);
    this.name = "UnknownAgentError";
  }
}

export class InvalidSignatureError extends WarrantedError {
  constructor(details?: Record<string, unknown>) {
    super(401, "INVALID_SIGNATURE", "Ed25519 signature verification failed", details);
    this.name = "InvalidSignatureError";
  }
}

// ---------------------------------------------------------------------------
// 403 — Authorization errors
// ---------------------------------------------------------------------------

export class AgentInactiveError extends WarrantedError {
  constructor(state: string, details?: Record<string, unknown>) {
    super(403, "AGENT_INACTIVE", `Agent lifecycle state is ${state}`, {
      state,
      ...details,
    });
    this.name = "AgentInactiveError";
  }
}

export class TrustScoreLowError extends WarrantedError {
  constructor(score: number, min: number, details?: Record<string, unknown>) {
    super(
      403,
      "TRUST_SCORE_LOW",
      `Agent trust score ${score} is below minimum ${min}`,
      { score, min, ...details }
    );
    this.name = "TrustScoreLowError";
  }
}

export class OverLimitError extends WarrantedError {
  constructor(limit: number, requested: number, details?: Record<string, unknown>) {
    super(
      403,
      "OVER_LIMIT",
      `Transaction amount ${requested} exceeds spending limit ${limit}`,
      { limit, requested, ...details }
    );
    this.name = "OverLimitError";
  }
}

export class VendorNotApprovedError extends WarrantedError {
  constructor(vendor: string, details?: Record<string, unknown>) {
    super(403, "VENDOR_NOT_APPROVED", `Vendor ${vendor} is not in approved list`, {
      vendor,
      ...details,
    });
    this.name = "VendorNotApprovedError";
  }
}

export class CategoryDeniedError extends WarrantedError {
  constructor(category: string, details?: Record<string, unknown>) {
    super(403, "CATEGORY_DENIED", `Category ${category} is not permitted`, {
      category,
      ...details,
    });
    this.name = "CategoryDeniedError";
  }
}

// ---------------------------------------------------------------------------
// 404 — Not found
// ---------------------------------------------------------------------------

export class SessionNotFoundError extends WarrantedError {
  constructor(sessionId?: string, details?: Record<string, unknown>) {
    super(404, "SESSION_NOT_FOUND", "Transaction session does not exist", {
      ...(sessionId ? { sessionId } : {}),
      ...details,
    });
    this.name = "SessionNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// 409 — Conflict
// ---------------------------------------------------------------------------

export class SessionExpiredError extends WarrantedError {
  constructor(details?: Record<string, unknown>) {
    super(409, "SESSION_EXPIRED", "Transaction session TTL has elapsed", details);
    this.name = "SessionExpiredError";
  }
}

export class SessionInvalidStateError extends WarrantedError {
  constructor(currentState: string, details?: Record<string, unknown>) {
    super(
      409,
      "SESSION_INVALID_STATE",
      `Action not valid for current session status: ${currentState}`,
      { currentState, ...details }
    );
    this.name = "SessionInvalidStateError";
  }
}

// ---------------------------------------------------------------------------
// 422 — Validation
// ---------------------------------------------------------------------------

export class InvalidItemsError extends WarrantedError {
  constructor(details?: Record<string, unknown>) {
    super(422, "INVALID_ITEMS", "Requested SKUs not found or unavailable", details);
    this.name = "InvalidItemsError";
  }
}

// ---------------------------------------------------------------------------
// 500 — Internal
// ---------------------------------------------------------------------------

export class RegistryUnreachableError extends WarrantedError {
  constructor(details?: Record<string, unknown>) {
    super(500, "REGISTRY_UNREACHABLE", "Cannot reach the platform registry", details);
    this.name = "RegistryUnreachableError";
  }
}

export class SettlementFailedError extends WarrantedError {
  constructor(details?: Record<string, unknown>) {
    super(500, "SETTLEMENT_FAILED", "Settlement processing error", details);
    this.name = "SettlementFailedError";
  }
}
