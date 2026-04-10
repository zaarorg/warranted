import { Hono } from "hono";
import type { WarrantedSDK } from "./sdk";

/**
 * Creates a Hono app that delegates all requests to the SDK's
 * Web Standard fetch handler.
 *
 * This is a thin wrapper — all routing and business logic lives
 * in the core handlers. The Hono app exists so vendors can mount
 * the SDK with `app.route('/', sdk.routes())`.
 */
export function createHonoApp(sdk: WarrantedSDK): Hono {
  const app = new Hono();

  app.all("*", async (c) => {
    const response = await sdk.fetch(c.req.raw);
    return response;
  });

  return app;
}
