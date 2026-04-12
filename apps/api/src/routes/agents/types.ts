/**
 * Hono environment type for routes that require WorkOS auth context.
 */
export type AuthEnv = {
  Variables: {
    orgId: string;
    workosOrgId: string;
    userId: string;
  };
};
