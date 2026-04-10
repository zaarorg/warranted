import type { SettlementEvent, DisputeEvent, RefundEvent } from "./types";

export type SettlementHandler = (
  event: SettlementEvent
) => Promise<void> | void;
export type DisputeHandler = (event: DisputeEvent) => Promise<void> | void;
export type RefundHandler = (event: RefundEvent) => Promise<void> | void;

/**
 * In-process webhook callback system for settlement, dispute, and refund events.
 *
 * Handlers are called sequentially. A handler throwing does not prevent
 * subsequent handlers from running.
 */
export class WebhookEmitter {
  private readonly settlementHandlers: SettlementHandler[] = [];
  private readonly disputeHandlers: DisputeHandler[] = [];
  private readonly refundHandlers: RefundHandler[] = [];

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

  /** Emit a settlement event to all registered handlers. */
  async emitSettlement(event: SettlementEvent): Promise<void> {
    for (const handler of this.settlementHandlers) {
      try {
        await handler(event);
      } catch (err) {
        console.error("Settlement handler error:", err);
      }
    }
  }

  /** Emit a dispute event to all registered handlers. */
  async emitDispute(event: DisputeEvent): Promise<void> {
    for (const handler of this.disputeHandlers) {
      try {
        await handler(event);
      } catch (err) {
        console.error("Dispute handler error:", err);
      }
    }
  }

  /** Emit a refund event to all registered handlers. */
  async emitRefund(event: RefundEvent): Promise<void> {
    for (const handler of this.refundHandlers) {
      try {
        await handler(event);
      } catch (err) {
        console.error("Refund handler error:", err);
      }
    }
  }
}
