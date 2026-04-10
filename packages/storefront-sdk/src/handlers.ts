import type { WarrantedSDKConfig } from "./types";
import type { RegistryClient } from "./registry-client";
import { generateManifest } from "./manifest";
import { createCatalogResponse } from "./catalog";
import { SidecarRegistryClient } from "./registry-client";
import { createVerificationMiddleware } from "./middleware";

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Creates a Web Standard Request → Response handler that routes
 * incoming requests to SDK endpoints.
 *
 * No framework imports — uses only the Web Standard Request/Response API.
 *
 * The manifest endpoint is public. All `/agent-checkout/*` routes
 * pass through the verification middleware.
 */
export function createHandler(
  config: WarrantedSDKConfig,
  registryClient?: RegistryClient
): (request: Request) => Promise<Response> {
  const manifest = generateManifest(config);
  const catalog = createCatalogResponse(config);
  const registry = registryClient ?? new SidecarRegistryClient(config.registryUrl);
  const verifyMiddleware = createVerificationMiddleware(registry, config);

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;

    // Public endpoint — no auth required
    if (path === "/.well-known/agent-storefront.json" && request.method === "GET") {
      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    // Protected endpoints — require verification middleware
    if (path.startsWith("/agent-checkout/")) {
      return verifyMiddleware(request, async () => {
        if (path === "/agent-checkout/catalog" && request.method === "GET") {
          return new Response(JSON.stringify(catalog), {
            status: 200,
            headers: JSON_HEADERS,
          });
        }

        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "NOT_FOUND", message: "Not found" },
          }),
          { status: 404, headers: JSON_HEADERS }
        );
      });
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "NOT_FOUND", message: "Not found" },
      }),
      { status: 404, headers: JSON_HEADERS }
    );
  };
}
