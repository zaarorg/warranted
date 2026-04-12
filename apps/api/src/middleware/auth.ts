import { createMiddleware } from "hono/factory";
import { WorkOS } from "@workos-inc/node";
import { eq } from "drizzle-orm";
import { organizations } from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";

/**
 * WorkOS session auth middleware for management API routes.
 * Validates the Bearer token (access token JWT) via WorkOS JWKS
 * and sets orgId + userId on context.
 *
 * In non-WorkOS environments (tests, local dev without WorkOS),
 * this middleware will return 401 for unauthenticated requests.
 */
export function createAuthMiddleware(db: DrizzleDB) {
  let jwksCache: ReturnType<WorkOS["userManagement"]["getJWKS"]> | null = null;

  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ success: false, error: "Authentication required" }, 401);
    }

    const accessToken = authHeader.slice(7);

    try {
      const workos = new WorkOS(process.env.WORKOS_API_KEY);
      const clientId = process.env.WORKOS_CLIENT_ID ?? "";

      // Get JWKS for JWT verification (cached)
      if (!jwksCache) {
        jwksCache = workos.userManagement.getJWKS();
      }

      // Decode and verify the JWT
      const { createRemoteJWKSet, jwtVerify } = await import("jose");
      const JWKS = createRemoteJWKSet(new URL(workos.userManagement.getJwksUrl(clientId)));
      const { payload } = await jwtVerify(accessToken, JWKS);

      const userId = payload.sub;
      const workosOrgId = payload.org_id as string | undefined;

      if (!userId) {
        return c.json({ success: false, error: "Invalid session" }, 401);
      }

      // Resolve the internal org from workosOrgId
      if (workosOrgId) {
        const rows = await db
          .select()
          .from(organizations)
          .where(eq(organizations.workosOrgId, workosOrgId));

        if (rows.length > 0) {
          c.set("orgId", rows[0]!.id);
        }
        c.set("workosOrgId", workosOrgId);
      }

      c.set("userId", userId);
      await next();
    } catch {
      return c.json({ success: false, error: "Invalid or expired session" }, 401);
    }
  });
}
