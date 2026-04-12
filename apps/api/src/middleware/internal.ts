import { createMiddleware } from "hono/factory";

/**
 * Internal API auth middleware for the /check endpoint.
 * Validates the X-Internal-Token header against INTERNAL_API_SECRET.
 * Defense-in-depth on top of network segmentation.
 * Reads env var at request time to support test overrides.
 */
export const internalAuthMiddleware = createMiddleware(async (c, next) => {
  const secret = process.env.INTERNAL_API_SECRET ?? "";

  if (!secret) {
    return c.json({ success: false, error: "Internal auth not configured" }, 500);
  }

  const token = c.req.header("X-Internal-Token");
  if (!token || token !== secret) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  await next();
});
