import type { ErrorCode, VerifiedAgentContext } from "./types";
import type { RegistryClient } from "./registry-client";
import { decodeAndVerifyJWT, decodeJWTUnsafe } from "./jwt";
import {
  InvalidTokenError,
  TokenExpiredError,
  UnknownAgentError,
  InvalidSignatureError,
  AgentInactiveError,
  RegistryUnreachableError,
} from "./errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of an authorization check (local or engine). */
export type AuthorizationResult =
  | { authorized: true }
  | {
      authorized: false;
      code: ErrorCode;
      message: string;
      details: Record<string, unknown>;
      engine?: {
        code: string;
        dimension: string;
        resolved: unknown;
        requested: unknown;
        sources: unknown[];
        petitionable: boolean;
      };
      retryHint?: {
        reason: "policy_updated";
        message: string;
      };
    };

/**
 * Optional dependencies for Phase 2 (engine) authorization.
 * When not provided, only the fast local check (Phase 1) runs.
 */
export interface EngineAuthorizationDeps {
  resolveEnvelope: (
    db: unknown,
    agentDid: string,
    orgId: string,
  ) => Promise<{
    agentDid: string;
    actions: Array<{
      actionId: string;
      actionName: string;
      denied: boolean;
      denySource: string | null;
      dimensions: Array<{
        name: string;
        kind: string;
        resolved: unknown;
        sources: unknown[];
      }>;
    }>;
    policyVersion: number;
    resolvedAt: string;
  }>;
  mapEngineToSdkCode: (
    engineCode: string,
    dimensionName?: string,
  ) => { sdkCode: string; httpStatus: number };
  db: unknown;
  orgId: string;
}

// ---------------------------------------------------------------------------
// Identity Verification (Steps 1-6)
// ---------------------------------------------------------------------------

/**
 * Verifies an agent's identity through the 10-step verification chain.
 *
 * Steps 1-6 are handled here (JWT extraction is done by the caller/middleware).
 * Step 7+ (trust score, spending, vendor, category) are in verifyAuthorization.
 *
 * @param token - Raw JWT string (already extracted from Authorization header)
 * @param registryClient - Registry client for DID lookup
 * @returns Verified agent context with all identity fields populated
 */
export async function verifyIdentity(
  token: string,
  registryClient: RegistryClient
): Promise<VerifiedAgentContext> {
  // Step 2: Decode JWT claims without verification to get the DID
  let claims;
  try {
    claims = decodeJWTUnsafe(token);
  } catch {
    throw new InvalidTokenError();
  }

  if (!claims.sub) {
    throw new InvalidTokenError({ reason: "missing sub claim" });
  }

  // Step 3: Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp !== undefined && claims.exp < now) {
    throw new TokenExpiredError();
  }
  if (claims.iat !== undefined && claims.iat > now + 86400) {
    throw new InvalidTokenError({ reason: "iat too far in the future" });
  }

  // Step 4: Registry lookup
  let agentRecord;
  try {
    agentRecord = await registryClient.lookupAgent(claims.sub);
  } catch (err) {
    if (err instanceof RegistryUnreachableError) {
      throw err;
    }
    throw new RegistryUnreachableError();
  }

  if (!agentRecord) {
    throw new UnknownAgentError({ did: claims.sub });
  }

  // Step 5: Verify JWT signature against registry's public key
  const publicKeyBytes = Buffer.from(agentRecord.publicKey, "base64");
  try {
    await decodeAndVerifyJWT(token, new Uint8Array(publicKeyBytes));
  } catch {
    throw new InvalidSignatureError();
  }

  // Step 6: Check lifecycle state
  if (agentRecord.lifecycleState !== "active") {
    throw new AgentInactiveError(agentRecord.lifecycleState);
  }

  return {
    did: claims.sub,
    agentId: claims.agentId ?? agentRecord.owner,
    owner: agentRecord.owner,
    authorityChain: claims.authorityChain ?? [],
    spendingLimit: claims.spendingLimit ?? agentRecord.spendingLimit,
    dailySpendLimit: claims.dailySpendLimit ?? agentRecord.spendingLimit * 2,
    categories: claims.categories ?? agentRecord.categories,
    approvedVendors: claims.approvedVendors ?? agentRecord.approvedVendors,
    trustScore: agentRecord.trustScore,
    lifecycleState: "active",
    publicKey: agentRecord.publicKey,
    tokenExp: claims.exp ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Phase 1: Local Authorization Check (fast, no DB)
// ---------------------------------------------------------------------------

/**
 * Fast local authorization check using JWT claims only.
 *
 * Implements steps 7-10 of the verification chain:
 * - Step 7: Trust score check
 * - Step 8: Spending limit check
 * - Step 9: Vendor approval check
 * - Step 10: Category permission check
 */
export function localAuthorizationCheck(
  agent: VerifiedAgentContext,
  transaction: { amount: number; vendorId: string; category: string },
  storefrontConfig: { minTrustScore: number; vendorId: string }
): AuthorizationResult {
  // Step 7: Trust score
  if (agent.trustScore < storefrontConfig.minTrustScore) {
    return {
      authorized: false,
      code: "TRUST_SCORE_LOW",
      message: `Agent trust score ${agent.trustScore} is below minimum ${storefrontConfig.minTrustScore}`,
      details: {
        score: agent.trustScore,
        min: storefrontConfig.minTrustScore,
      },
    };
  }

  // Step 8: Spending limit
  if (transaction.amount > agent.spendingLimit) {
    return {
      authorized: false,
      code: "OVER_LIMIT",
      message: `Transaction amount ${transaction.amount} exceeds spending limit ${agent.spendingLimit}`,
      details: {
        limit: agent.spendingLimit,
        requested: transaction.amount,
      },
    };
  }

  // Step 9: Vendor approval
  if (!agent.approvedVendors.includes(storefrontConfig.vendorId)) {
    return {
      authorized: false,
      code: "VENDOR_NOT_APPROVED",
      message: `Vendor ${storefrontConfig.vendorId} is not in approved list`,
      details: { vendor: storefrontConfig.vendorId },
    };
  }

  // Step 10: Category permission
  if (!agent.categories.includes(transaction.category)) {
    return {
      authorized: false,
      code: "CATEGORY_DENIED",
      message: `Category ${transaction.category} is not permitted`,
      details: { category: transaction.category },
    };
  }

  return { authorized: true };
}

// ---------------------------------------------------------------------------
// Phase 2: Engine Authorization Check (DB + envelope resolution)
// ---------------------------------------------------------------------------

/**
 * Authoritative engine authorization check using resolved envelope.
 *
 * Resolves the agent's effective permissions from the policy hierarchy,
 * then compares the request context against each resolved dimension.
 * Returns dimension-level error codes when a violation is found.
 */
export async function engineAuthorizationCheck(
  agent: VerifiedAgentContext,
  transaction: { amount: number; vendorId: string; category: string },
  storefrontConfig: { vendorId: string },
  deps: EngineAuthorizationDeps,
): Promise<AuthorizationResult> {
  const envelope = await deps.resolveEnvelope(deps.db, agent.did, deps.orgId);

  // Find the purchase.initiate action in the resolved envelope
  const purchaseAction = envelope.actions.find(
    (a) => a.actionName === "purchase.initiate",
  );

  // No purchase action in envelope → agent has no purchase permissions
  if (!purchaseAction) {
    const mapping = deps.mapEngineToSdkCode("ENVELOPE_EMPTY");
    return {
      authorized: false,
      code: mapping.sdkCode as ErrorCode,
      message: "Agent has no purchase permissions in resolved envelope",
      details: { agentDid: agent.did },
      retryHint: {
        reason: "policy_updated",
        message: "Policy changed since token was issued. Refresh your token and retry.",
      },
    };
  }

  // Deny override — a forbid policy blocks this action entirely
  if (purchaseAction.denied) {
    const mapping = deps.mapEngineToSdkCode("DENY_OVERRIDE");
    return {
      authorized: false,
      code: mapping.sdkCode as ErrorCode,
      message: `Action denied by policy: ${purchaseAction.denySource}`,
      details: { denySource: purchaseAction.denySource },
      engine: {
        code: "DENY_OVERRIDE",
        dimension: "action",
        resolved: "denied",
        requested: "purchase.initiate",
        sources: [],
        petitionable: false,
      },
    };
  }

  // Check each resolved dimension against the request context
  for (const dim of purchaseAction.dimensions) {
    switch (dim.kind) {
      case "numeric": {
        const resolved = dim.resolved as number;
        if (dim.name === "amount" && transaction.amount > resolved) {
          const mapping = deps.mapEngineToSdkCode("DIMENSION_EXCEEDED", "amount");
          return {
            authorized: false,
            code: mapping.sdkCode as ErrorCode,
            message: `Transaction amount ${transaction.amount} exceeds engine limit of ${resolved}`,
            details: {
              limit: resolved,
              requested: transaction.amount,
            },
            engine: {
              code: "DIMENSION_EXCEEDED",
              dimension: "amount",
              resolved,
              requested: transaction.amount,
              sources: dim.sources,
              petitionable: true,
            },
            retryHint: {
              reason: "policy_updated",
              message: "Policy changed since token was issued. Refresh your token and retry.",
            },
          };
        }
        break;
      }
      case "set": {
        const resolved = dim.resolved as string[];
        if (dim.name === "vendor" && !resolved.includes(storefrontConfig.vendorId)) {
          const mapping = deps.mapEngineToSdkCode("DIMENSION_NOT_IN_SET", "vendor");
          return {
            authorized: false,
            code: mapping.sdkCode as ErrorCode,
            message: `Vendor ${storefrontConfig.vendorId} is not in engine's approved list`,
            details: { vendor: storefrontConfig.vendorId },
            engine: {
              code: "DIMENSION_NOT_IN_SET",
              dimension: "vendor",
              resolved,
              requested: storefrontConfig.vendorId,
              sources: dim.sources,
              petitionable: true,
            },
            retryHint: {
              reason: "policy_updated",
              message: "Policy changed since token was issued. Refresh your token and retry.",
            },
          };
        }
        if (dim.name === "category" && !resolved.includes(transaction.category)) {
          const mapping = deps.mapEngineToSdkCode("DIMENSION_NOT_IN_SET", "category");
          return {
            authorized: false,
            code: mapping.sdkCode as ErrorCode,
            message: `Category ${transaction.category} is not in engine's permitted list`,
            details: { category: transaction.category },
            engine: {
              code: "DIMENSION_NOT_IN_SET",
              dimension: "category",
              resolved,
              requested: transaction.category,
              sources: dim.sources,
              petitionable: true,
            },
            retryHint: {
              reason: "policy_updated",
              message: "Policy changed since token was issued. Refresh your token and retry.",
            },
          };
        }
        break;
      }
      case "boolean": {
        if (dim.name === "trust_gate" && dim.resolved === true) {
          const mapping = deps.mapEngineToSdkCode("DIMENSION_BOOLEAN_BLOCKED", "trust_gate");
          return {
            authorized: false,
            code: mapping.sdkCode as ErrorCode,
            message: "Agent blocked by trust gate",
            details: {},
            engine: {
              code: "DIMENSION_BOOLEAN_BLOCKED",
              dimension: "trust_gate",
              resolved: dim.resolved,
              requested: false,
              sources: dim.sources,
              petitionable: false,
            },
          };
        }
        break;
      }
      case "temporal": {
        const resolved = dim.resolved as string;
        if (new Date(resolved) < new Date()) {
          const mapping = deps.mapEngineToSdkCode("POLICY_EXPIRED");
          return {
            authorized: false,
            code: mapping.sdkCode as ErrorCode,
            message: `Policy expired at ${resolved}`,
            details: { expiry: resolved },
            engine: {
              code: "POLICY_EXPIRED",
              dimension: dim.name,
              resolved,
              requested: new Date().toISOString(),
              sources: dim.sources,
              petitionable: false,
            },
          };
        }
        break;
      }
      // rate dimensions are checked when caller provides runtime context
    }
  }

  return { authorized: true };
}

// ---------------------------------------------------------------------------
// Two-Phase Authorization (orchestrator)
// ---------------------------------------------------------------------------

/**
 * Two-phase authorization check:
 *
 * - **Phase 1 (local):** Fast JWT claims check — no DB, no WASM.
 *   If this fails, the request is denied immediately.
 *
 * - **Phase 2 (engine):** Authoritative envelope resolution with
 *   dimension-level error codes. Only runs if Phase 1 passes AND
 *   engine dependencies are provided.
 *
 * When Phase 1 passes but Phase 2 denies, the response includes a
 * `retryHint` indicating the policy was updated after the JWT was issued.
 *
 * If `engineDeps` is not provided, only Phase 1 runs (backward compatible).
 */
export async function verifyAuthorization(
  agent: VerifiedAgentContext,
  transaction: { amount: number; vendorId: string; category: string },
  storefrontConfig: { minTrustScore: number; vendorId: string },
  engineDeps?: EngineAuthorizationDeps,
): Promise<AuthorizationResult> {
  // Phase 1: Fast local JWT claims check
  const localResult = localAuthorizationCheck(agent, transaction, storefrontConfig);
  if (!localResult.authorized) {
    return localResult;
  }

  // Phase 2: Engine check (if deps provided)
  if (engineDeps) {
    return engineAuthorizationCheck(agent, transaction, storefrontConfig, engineDeps);
  }

  return { authorized: true };
}
