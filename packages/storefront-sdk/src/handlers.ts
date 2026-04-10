import type { WarrantedSDKConfig } from "./types";
import { generateManifest } from "./manifest";
import { createCatalogResponse } from "./catalog";

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Creates a Web Standard Request → Response handler that routes
 * incoming requests to SDK endpoints.
 *
 * No framework imports — uses only the Web Standard Request/Response API.
 */
export function createHandler(
  config: WarrantedSDKConfig
): (request: Request) => Promise<Response> {
  const manifest = generateManifest(config);
  const catalog = createCatalogResponse(config);

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/.well-known/agent-storefront.json" && request.method === "GET") {
      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

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
  };
}
