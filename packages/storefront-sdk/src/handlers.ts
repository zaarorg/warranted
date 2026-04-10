import type { WarrantedSDKConfig, SettlementEvent } from "./types";
import { CreateSessionRequestSchema } from "./types";
import type { RegistryClient } from "./registry-client";
import { generateManifest } from "./manifest";
import { createCatalogResponse } from "./catalog";
import { SidecarRegistryClient } from "./registry-client";
import { createVerificationMiddleware, getVerifiedAgent } from "./middleware";
import { verifyAuthorization } from "./verify";
import type { SessionManager } from "./session";
import type { ReceiptGenerator } from "./receipt";
import type { WebhookEmitter } from "./webhook";
import { WarrantedError } from "./errors";

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
  registryClient?: RegistryClient,
  sessionManager?: SessionManager,
  receiptGenerator?: ReceiptGenerator,
  webhookEmitter?: WebhookEmitter
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
        // Catalog
        if (path === "/agent-checkout/catalog" && request.method === "GET") {
          return new Response(JSON.stringify(catalog), {
            status: 200,
            headers: JSON_HEADERS,
          });
        }

        // Session create
        if (path === "/agent-checkout/session" && request.method === "POST") {
          return handleCreateSession(request, config, sessionManager);
        }

        // Session get / settle — match /agent-checkout/session/:id and /agent-checkout/session/:id/settle
        const sessionMatch = path.match(
          /^\/agent-checkout\/session\/([^/]+)(\/settle)?$/
        );
        if (sessionMatch && sessionMatch[1]) {
          const sessionId = sessionMatch[1];
          const isSettle = sessionMatch[2] === "/settle";

          if (isSettle && request.method === "POST") {
            return handleSettleSession(
              request,
              sessionId,
              config,
              sessionManager,
              receiptGenerator,
              webhookEmitter
            );
          }

          if (!isSettle && request.method === "GET") {
            return handleGetSession(sessionId, sessionManager);
          }
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

// ---------------------------------------------------------------------------
// Session Handlers
// ---------------------------------------------------------------------------

async function handleCreateSession(
  request: Request,
  config: WarrantedSDKConfig,
  sessionManager?: SessionManager
): Promise<Response> {
  if (!sessionManager) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "NOT_FOUND", message: "Sessions not configured" },
      }),
      { status: 404, headers: JSON_HEADERS }
    );
  }

  const agentContext = getVerifiedAgent(request);
  if (!agentContext) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "NO_TOKEN", message: "Agent context not available" },
      }),
      { status: 401, headers: JSON_HEADERS }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "INVALID_ITEMS", message: "Invalid request body" },
      }),
      { status: 422, headers: JSON_HEADERS }
    );
  }

  const parsed = CreateSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: "INVALID_ITEMS",
          message: "Invalid request body",
          details: { issues: parsed.error.issues },
        },
      }),
      { status: 422, headers: JSON_HEADERS }
    );
  }

  // Run authorization checks (steps 7-10) for the transaction
  const firstItem = config.catalog?.find(
    (c) => c.sku === parsed.data.items[0]?.sku
  );
  if (firstItem) {
    const totalAmount = parsed.data.items.reduce((sum, item) => {
      const catalogItem = config.catalog?.find((c) => c.sku === item.sku);
      return sum + (catalogItem?.price ?? 0) * item.quantity;
    }, 0);

    const authResult = verifyAuthorization(
      agentContext,
      {
        amount: totalAmount,
        vendorId: config.vendorId,
        category: firstItem.category,
      },
      { minTrustScore: config.minTrustScore, vendorId: config.vendorId }
    );

    if (!authResult.authorized) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: authResult.code,
            message: authResult.message,
            details: authResult.details,
          },
        }),
        {
          status: authResult.code === "TRUST_SCORE_LOW" ||
            authResult.code === "OVER_LIMIT" ||
            authResult.code === "VENDOR_NOT_APPROVED" ||
            authResult.code === "CATEGORY_DENIED"
            ? 403
            : 400,
          headers: JSON_HEADERS,
        }
      );
    }
  }

  try {
    const session = await sessionManager.createSession(
      agentContext,
      parsed.data.items,
      parsed.data.transactionType,
      config.vendorId
    );

    return new Response(JSON.stringify(session), {
      status: 201,
      headers: JSON_HEADERS,
    });
  } catch (err) {
    if (err instanceof WarrantedError) {
      return err.toHTTPResponse();
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "SETTLEMENT_FAILED", message: "Session creation failed" },
      }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
}

async function handleGetSession(
  sessionId: string,
  sessionManager?: SessionManager
): Promise<Response> {
  if (!sessionManager) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "NOT_FOUND", message: "Sessions not configured" },
      }),
      { status: 404, headers: JSON_HEADERS }
    );
  }

  const session = await sessionManager.getSession(sessionId);
  if (!session) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "SESSION_NOT_FOUND", message: "Transaction session does not exist" },
      }),
      { status: 404, headers: JSON_HEADERS }
    );
  }

  return new Response(JSON.stringify(session), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

async function handleSettleSession(
  request: Request,
  sessionId: string,
  config: WarrantedSDKConfig,
  sessionManager?: SessionManager,
  receiptGenerator?: ReceiptGenerator,
  webhookEmitter?: WebhookEmitter
): Promise<Response> {
  if (!sessionManager || !receiptGenerator) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "NOT_FOUND", message: "Settlement not configured" },
      }),
      { status: 404, headers: JSON_HEADERS }
    );
  }

  const agentContext = getVerifiedAgent(request);
  if (!agentContext) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "NO_TOKEN", message: "Agent context not available" },
      }),
      { status: 401, headers: JSON_HEADERS }
    );
  }

  let settledSession;
  try {
    settledSession = await sessionManager.settleSession(
      sessionId,
      agentContext.did
    );
  } catch (err) {
    if (err instanceof WarrantedError) {
      return err.toHTTPResponse();
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "SETTLEMENT_FAILED", message: "Settlement failed" },
      }),
      { status: 500, headers: JSON_HEADERS }
    );
  }

  // Generate receipt
  const vendorConfig = {
    id: config.vendorId,
    name: `Storefront ${config.vendorId}`,
    jurisdiction: config.jurisdiction,
  };

  const receipt = await receiptGenerator.generateReceipt(
    settledSession,
    vendorConfig
  );

  // Update session with receipt ID
  await sessionManager
    .getSession(sessionId)
    .then(() =>
      sessionManager["store"]
        ? Promise.resolve()
        : Promise.resolve()
    );

  // Build settlement event
  const event: SettlementEvent = {
    sessionId: settledSession.sessionId,
    agentDid: settledSession.agentDid,
    vendorId: settledSession.vendorId,
    items: settledSession.items.map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
      amount: item.price,
    })),
    totalAmount: settledSession.totalAmount,
    receiptId: receipt.receiptId,
    settlement: {
      method: receipt.settlement.method,
      confirmationId: receipt.settlement.confirmationId,
    },
  };

  // Fire webhook callbacks
  if (webhookEmitter) {
    await webhookEmitter.emitSettlement(event);
  }

  return new Response(
    JSON.stringify({
      sessionId: settledSession.sessionId,
      status: "complete",
      receiptId: receipt.receiptId,
      settledAt: settledSession.settledAt,
      confirmationId: receipt.settlement.confirmationId,
      receipt,
    }),
    { status: 200, headers: JSON_HEADERS }
  );
}
