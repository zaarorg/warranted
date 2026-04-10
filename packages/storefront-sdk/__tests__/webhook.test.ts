import { describe, it, expect, vi } from "vitest";
import { WebhookEmitter } from "../src/webhook";
import type { SettlementEvent } from "../src/types";

const SETTLEMENT_EVENT: SettlementEvent = {
  sessionId: "txn_abc123",
  agentDid: "did:mesh:abc123",
  vendorId: "vendor-acme-001",
  items: [{ sku: "gpu-hours-100", quantity: 1, amount: 2500 }],
  totalAmount: 2500,
  receiptId: "rcpt_xyz789",
  settlement: {
    method: "internal-ledger",
    confirmationId: "ledger_abc123",
  },
};

describe("WebhookEmitter", () => {
  describe("settlement", () => {
    it("fires onSettlement callback when emitSettlement is called", async () => {
      const emitter = new WebhookEmitter();
      const handler = vi.fn();
      emitter.onSettlement(handler);

      await emitter.emitSettlement(SETTLEMENT_EVENT);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(SETTLEMENT_EVENT);
    });

    it("fires multiple registered callbacks", async () => {
      const emitter = new WebhookEmitter();
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      emitter.onSettlement(handler1);
      emitter.onSettlement(handler2);

      await emitter.emitSettlement(SETTLEMENT_EVENT);

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });

    it("receives correct SettlementEvent shape", async () => {
      const emitter = new WebhookEmitter();
      let receivedEvent: SettlementEvent | undefined;
      emitter.onSettlement((event) => {
        receivedEvent = event;
      });

      await emitter.emitSettlement(SETTLEMENT_EVENT);

      expect(receivedEvent).toBeDefined();
      expect(receivedEvent!.sessionId).toBe("txn_abc123");
      expect(receivedEvent!.agentDid).toBe("did:mesh:abc123");
      expect(receivedEvent!.vendorId).toBe("vendor-acme-001");
      expect(receivedEvent!.items).toHaveLength(1);
      expect(receivedEvent!.totalAmount).toBe(2500);
      expect(receivedEvent!.receiptId).toBe("rcpt_xyz789");
    });

    it("handler error does not prevent other handlers from running", async () => {
      const emitter = new WebhookEmitter();
      const errorHandler = vi.fn().mockRejectedValue(new Error("handler failed"));
      const goodHandler = vi.fn();

      emitter.onSettlement(errorHandler);
      emitter.onSettlement(goodHandler);

      await emitter.emitSettlement(SETTLEMENT_EVENT);

      expect(errorHandler).toHaveBeenCalledOnce();
      expect(goodHandler).toHaveBeenCalledOnce();
    });

    it("succeeds silently with no callbacks registered", async () => {
      const emitter = new WebhookEmitter();
      await expect(
        emitter.emitSettlement(SETTLEMENT_EVENT)
      ).resolves.toBeUndefined();
    });
  });

  describe("dispute", () => {
    it("fires onDispute callback", async () => {
      const emitter = new WebhookEmitter();
      const handler = vi.fn();
      emitter.onDispute(handler);

      const event = {
        sessionId: "txn_abc123",
        reason: "item not delivered",
        openedBy: "buyer" as const,
      };

      await emitter.emitDispute(event);
      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe("refund", () => {
    it("fires onRefund callback", async () => {
      const emitter = new WebhookEmitter();
      const handler = vi.fn();
      emitter.onRefund(handler);

      const event = {
        sessionId: "txn_abc123",
        amount: 2500,
        reason: "duplicate charge",
        refundId: "ref_001",
      };

      await emitter.emitRefund(event);
      expect(handler).toHaveBeenCalledWith(event);
    });
  });
});
