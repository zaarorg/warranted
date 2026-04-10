import {
  WarrantedSDKConfigSchema,
  type WarrantedSDKConfig,
  type SettlementEvent,
  type DisputeEvent,
  type RefundEvent,
} from "./types";

type SettlementHandler = (event: SettlementEvent) => Promise<void> | void;
type DisputeHandler = (event: DisputeEvent) => Promise<void> | void;
type RefundHandler = (event: RefundEvent) => Promise<void> | void;

/**
 * Core SDK class for mounting governed agent transaction endpoints.
 *
 * Validates configuration at construction time. In Phase 1 this is a
 * skeleton — `.fetch()` returns 404 for every path and `.routes()` is
 * a placeholder.
 */
export class WarrantedSDK {
  public readonly config: WarrantedSDKConfig;

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
  }

  /**
   * Web Standard fetch handler. Routes incoming requests to SDK
   * endpoints. Returns a 404 JSON response for unmatched paths.
   */
  async fetch(_request: Request): Promise<Response> {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "NOT_FOUND", message: "Not found" },
      }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  /**
   * Returns an adapter suitable for mounting with Hono's `app.route()`.
   * Placeholder until Phase 2.
   */
  routes(): { fetch: (request: Request) => Promise<Response> } {
    return { fetch: (req: Request) => this.fetch(req) };
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
