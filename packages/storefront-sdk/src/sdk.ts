import {
  WarrantedSDKConfigSchema,
  type WarrantedSDKConfig,
} from "./types";
import type { RegistryClient } from "./registry-client";
import { createHandler } from "./handlers";
import { createHonoApp } from "./hono-adapter";
import { SessionManager, InMemorySessionStore } from "./session";
import { ReceiptGenerator } from "./receipt";
import { WebhookEmitter } from "./webhook";
import type { SettlementHandler, DisputeHandler, RefundHandler } from "./webhook";

/**
 * Core SDK class for mounting governed agent transaction endpoints.
 *
 * Validates configuration at construction time. `.fetch()` dispatches
 * to manifest, catalog, and session handlers. `.routes()` returns a
 * Hono app for easy mounting.
 */
export class WarrantedSDK {
  public readonly config: WarrantedSDKConfig;
  public readonly sessionManager: SessionManager;
  public readonly receiptGenerator: ReceiptGenerator;
  public readonly webhookEmitter: WebhookEmitter;

  private handler: (request: Request) => Promise<Response>;

  constructor(raw: unknown, registryClient?: RegistryClient) {
    const result = WarrantedSDKConfigSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(`Invalid WarrantedSDK config: ${issues}`);
    }
    this.config = result.data;

    const sessionStore = new InMemorySessionStore();
    this.sessionManager = new SessionManager(
      sessionStore,
      this.config.catalog ?? [],
      this.config.sessionTtlSeconds
    );
    this.receiptGenerator = new ReceiptGenerator(this.config.registryUrl);
    this.webhookEmitter = new WebhookEmitter();

    this.handler = createHandler(
      this.config,
      registryClient,
      this.sessionManager,
      this.receiptGenerator,
      this.webhookEmitter
    );
  }

  /**
   * Web Standard fetch handler. Routes incoming requests to SDK
   * endpoints. Returns a 404 JSON response for unmatched paths.
   */
  async fetch(request: Request): Promise<Response> {
    return this.handler(request);
  }

  /**
   * Returns a Hono app wrapping the SDK's fetch handler, suitable
   * for mounting with `app.route('/', sdk.routes())`.
   */
  routes() {
    return createHonoApp(this);
  }

  /** Register a callback for settlement events. */
  onSettlement(handler: SettlementHandler): void {
    this.webhookEmitter.onSettlement(handler);
  }

  /** Register a callback for dispute events. */
  onDispute(handler: DisputeHandler): void {
    this.webhookEmitter.onDispute(handler);
  }

  /** Register a callback for refund events. */
  onRefund(handler: RefundHandler): void {
    this.webhookEmitter.onRefund(handler);
  }
}
