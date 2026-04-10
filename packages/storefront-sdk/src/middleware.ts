import type { WarrantedSDKConfig, VerifiedAgentContext } from "./types";
import type { RegistryClient } from "./registry-client";
import { verifyIdentity } from "./verify";
import { WarrantedError, NoTokenError, InvalidTokenError } from "./errors";

/** WeakMap storing verified agent context per request. */
const verifiedAgents = new WeakMap<Request, VerifiedAgentContext>();

/**
 * Retrieves the verified agent context attached by the verification middleware.
 *
 * Returns undefined if the request has not been verified.
 */
export function getVerifiedAgent(
  request: Request
): VerifiedAgentContext | undefined {
  return verifiedAgents.get(request);
}

/**
 * Attaches a verified agent context to a request (for internal use).
 */
export function setVerifiedAgent(
  request: Request,
  agent: VerifiedAgentContext
): void {
  verifiedAgents.set(request, agent);
}

/**
 * Creates a verification middleware that implements the 10-step verification chain.
 *
 * Steps 1-6 (identity verification) run on every protected request.
 * Steps 7-10 (authorization) run when transaction details are available
 * (handled by the endpoint handlers with verifyAuthorization).
 *
 * @param registryClient - Registry client for DID lookup
 * @param _storefrontConfig - SDK configuration (reserved for future use in middleware)
 */
export function createVerificationMiddleware(
  registryClient: RegistryClient,
  _storefrontConfig: WarrantedSDKConfig
): (
  request: Request,
  next: () => Promise<Response>
) => Promise<Response> {
  return async (
    request: Request,
    next: () => Promise<Response>
  ): Promise<Response> => {
    // Step 1: Extract Authorization header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return new NoTokenError().toHTTPResponse();
    }

    // Step 1b: Strip "Bearer " prefix
    if (!authHeader.startsWith("Bearer ")) {
      return new InvalidTokenError({
        reason: "Authorization header must use Bearer scheme",
      }).toHTTPResponse();
    }

    const token = authHeader.slice(7);
    if (!token) {
      return new NoTokenError().toHTTPResponse();
    }

    // Steps 2-6: Verify identity
    try {
      const agent = await verifyIdentity(token, registryClient);
      setVerifiedAgent(request, agent);
    } catch (err) {
      if (err instanceof WarrantedError) {
        return err.toHTTPResponse();
      }
      // Unexpected error — wrap as 500
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "REGISTRY_UNREACHABLE",
            message: "Internal verification error",
          },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return next();
  };
}
