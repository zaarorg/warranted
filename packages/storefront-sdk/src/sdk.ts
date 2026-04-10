import {
  WarrantedSDKConfigSchema,
  type WarrantedSDKConfig,
  type SettlementEvent,
  type DisputeEvent,
  type RefundEvent,
} from "./types";
import { createHandler } from "./handlers";
import { createHonoApp } from "./hono-adapter";

type SettlementHandler = (event: SettlementEvent) => Promise<void> | void;
type DisputeHandler = (event: DisputeEvent) => Promise<void> | void;
type RefundHandler = (event: RefundEvent) => Promise<void> | void;

/**
 * Core SDK class for mounting governed agent transaction endpoints.
 *
 * Validates configuration at construction time. `.fetch()` dispatches
 * to manifest, catalog, and session handlers. `.routes()` returns a
 * Hono app for easy mounting.
 */
export class WarrantedSDK {
  public readonly config: WarrantedSDKConfig;

  private handler: (request: Request) => Promise<Response>;
  private settlementHandlers: SettlementHandler[] = [];
  private disputeHandlers: DisputeHandler[] = [];
  private refundHandlers: RefundHandler[] = [];

  constructor(raw: unknown) {
    const result = WarrantedSDKConfigSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(`Invalid WarrantedSDK config: ${issues}`);
    }
    this.config = result.data;
    this.handler = createHandler(this.config);
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
    this.settlementHandlers.push(handler);
  }

  /** Register a callback for dispute events. */
  onDispute(handler: DisputeHandler): void {
    this.disputeHandlers.push(handler);
  }

  /** Register a callback for refund events. */
  onRefund(handler: RefundHandler): void {
    this.refundHandlers.push(handler);
  }
}
