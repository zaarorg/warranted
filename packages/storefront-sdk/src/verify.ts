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

/** Result of an authorization check. */
export type AuthorizationResult =
  | { authorized: true }
  | {
      authorized: false;
      code: ErrorCode;
      message: string;
      details: Record<string, unknown>;
    };

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

/**
 * Checks authorization for a specific transaction against the agent's permissions.
 *
 * Implements steps 7-10 of the verification chain:
 * - Step 7: Trust score check
 * - Step 8: Spending limit check
 * - Step 9: Vendor approval check
 * - Step 10: Category permission check
 */
export function verifyAuthorization(
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
