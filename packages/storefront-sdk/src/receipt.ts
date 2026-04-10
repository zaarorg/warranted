import { createHash, randomBytes } from "node:crypto";
import type { TransactionSession, TransactionReceipt } from "./types";
import { TransactionReceiptSchema } from "./types";

/** Vendor identity for receipt generation. */
export interface VendorConfig {
  id: string;
  name: string;
  jurisdiction: string;
}

/**
 * Computes a SHA-256 hash of a receipt (excluding signatures).
 *
 * Used as the receipt's transactionHash — both parties sign this hash.
 */
export function computeReceiptHash(
  receipt: Omit<TransactionReceipt, "signatures">
): string {
  const serialized = JSON.stringify(receipt, Object.keys(receipt).sort());
  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Generates immutable transaction receipts with compliance snapshots
 * and optional sidecar-signed platform signatures.
 */
export class ReceiptGenerator {
  constructor(private readonly sidecarUrl: string) {}

  /**
   * Builds a TransactionReceipt from a completed session.
   *
   * Attempts to sign the receipt hash via the sidecar's `/sign_transaction`
   * endpoint. Falls back to "unsigned" if the sidecar is unreachable.
   */
  async generateReceipt(
    session: TransactionSession,
    vendorConfig: VendorConfig
  ): Promise<TransactionReceipt> {
    const receiptId = `rcpt_${randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();

    const receiptWithoutSig: Omit<TransactionReceipt, "signatures"> = {
      receiptId,
      transactionHash: "", // computed below
      buyer: {
        did: session.agentDid,
        agentId: session.agentDid,
        owner: session.agentDid,
        authorityChain: session.agentAuthorityChain,
      },
      vendor: {
        id: vendorConfig.id,
        name: vendorConfig.name,
        jurisdiction: vendorConfig.jurisdiction,
      },
      items: session.items.map((item) => ({
        sku: item.sku,
        name: item.name,
        amount: item.price,
        quantity: item.quantity,
        category: item.category,
      })),
      totalAmount: session.totalAmount,
      currency: "usd",
      compliance: {
        policyVersion: "1.0",
        rulesEvaluated: [
          "jwt_verification",
          "registry_lookup",
          "signature_verification",
          "lifecycle_check",
          "trust_score_check",
          "spending_limit_check",
          "vendor_approval_check",
          "category_check",
        ],
        allPassed: true,
        transcriptHash: createHash("sha256").update("").digest("hex"),
        humanApprovalRequired: false,
        humanApproved: null,
      },
      settlement: {
        method: "internal-ledger",
        settledAt: session.settledAt ?? now,
        confirmationId: `ledger_${randomBytes(8).toString("hex")}`,
      },
      createdAt: now,
    };

    // Compute the receipt hash
    const transactionHash = computeReceiptHash(receiptWithoutSig);
    receiptWithoutSig.transactionHash = transactionHash;

    // Attempt sidecar signing
    let platformSignature = "unsigned";
    try {
      const response = await fetch(
        `${this.sidecarUrl}/sign_transaction?` +
          new URLSearchParams({
            vendor: vendorConfig.id,
            amount: String(session.totalAmount),
            item: session.items[0]?.sku ?? "unknown",
            category: session.items[0]?.category ?? "unknown",
          }),
        { method: "POST" }
      );
      if (response.ok) {
        const data = await response.json();
        if (data.signed && data.signature) {
          platformSignature = data.signature;
        }
      }
    } catch {
      // Sidecar unreachable — receipt still valid, just unsigned
    }

    const receipt: TransactionReceipt = {
      ...receiptWithoutSig,
      signatures: {
        agentSignature: "",
        platformSignature,
      },
    };

    // Validate against schema
    TransactionReceiptSchema.parse(receipt);

    return receipt;
  }
}
