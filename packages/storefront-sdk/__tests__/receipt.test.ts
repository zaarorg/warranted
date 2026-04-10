import { describe, it, expect } from "vitest";
import { ReceiptGenerator, computeReceiptHash } from "../src/receipt";
import type { TransactionSession, TransactionReceipt } from "../src/types";
import { TransactionReceiptSchema } from "../src/types";

const COMPLETED_SESSION: TransactionSession = {
  sessionId: "txn_abc123",
  status: "complete",
  agentDid: "did:mesh:abc123",
  vendorId: "vendor-acme-001",
  items: [
    {
      sku: "gpu-hours-100",
      name: "100 GPU Hours (A100)",
      price: 2500,
      category: "compute",
      quantity: 1,
    },
  ],
  totalAmount: 2500,
  agentAuthorityChain: ["did:mesh:cfo", "did:mesh:vp-eng", "did:mesh:abc123"],
  agentSpendingLimit: 5000,
  agentTrustScore: 850,
  jurisdiction: "US",
  transcriptHash: null,
  receiptId: null,
  createdAt: "2026-04-09T15:30:00.000Z",
  expiresAt: "2026-04-09T16:30:00.000Z",
  settledAt: "2026-04-09T15:35:00.000Z",
};

const VENDOR_CONFIG = {
  id: "vendor-acme-001",
  name: "Acme Cloud Compute",
  jurisdiction: "US",
};

describe("ReceiptGenerator", () => {
  it("generates a receipt with rcpt_ prefix ID", async () => {
    // Use an unreachable URL so sidecar signing falls back to "unsigned"
    const generator = new ReceiptGenerator("http://localhost:19999");
    const receipt = await generator.generateReceipt(
      COMPLETED_SESSION,
      VENDOR_CONFIG
    );

    expect(receipt.receiptId).toMatch(/^rcpt_[a-f0-9]{16}$/);
  });

  it("contains all required fields from spec", async () => {
    const generator = new ReceiptGenerator("http://localhost:19999");
    const receipt = await generator.generateReceipt(
      COMPLETED_SESSION,
      VENDOR_CONFIG
    );

    // Buyer
    expect(receipt.buyer.did).toBe("did:mesh:abc123");
    expect(receipt.buyer.authorityChain).toEqual([
      "did:mesh:cfo",
      "did:mesh:vp-eng",
      "did:mesh:abc123",
    ]);

    // Vendor
    expect(receipt.vendor.id).toBe("vendor-acme-001");
    expect(receipt.vendor.name).toBe("Acme Cloud Compute");
    expect(receipt.vendor.jurisdiction).toBe("US");

    // Items
    expect(receipt.items).toHaveLength(1);
    expect(receipt.items[0]!.sku).toBe("gpu-hours-100");
    expect(receipt.items[0]!.amount).toBe(2500);
    expect(receipt.items[0]!.quantity).toBe(1);
    expect(receipt.items[0]!.category).toBe("compute");

    // Total
    expect(receipt.totalAmount).toBe(2500);
    expect(receipt.currency).toBe("usd");

    // Compliance
    expect(receipt.compliance.policyVersion).toBe("1.0");
    expect(receipt.compliance.rulesEvaluated.length).toBeGreaterThan(0);
    expect(receipt.compliance.allPassed).toBe(true);
    expect(receipt.compliance.transcriptHash).toBeDefined();
    expect(receipt.compliance.humanApprovalRequired).toBe(false);
    expect(receipt.compliance.humanApproved).toBeNull();

    // Settlement
    expect(receipt.settlement.method).toBe("internal-ledger");
    expect(receipt.settlement.settledAt).toBeDefined();
    expect(receipt.settlement.confirmationId).toMatch(/^ledger_/);

    // Signatures
    expect(receipt.signatures).toBeDefined();
    expect(receipt.signatures.agentSignature).toBe("");

    // Timestamps
    expect(receipt.createdAt).toBeDefined();
  });

  it("validates against TransactionReceiptSchema", async () => {
    const generator = new ReceiptGenerator("http://localhost:19999");
    const receipt = await generator.generateReceipt(
      COMPLETED_SESSION,
      VENDOR_CONFIG
    );

    const result = TransactionReceiptSchema.safeParse(receipt);
    expect(result.success).toBe(true);
  });

  it("sets platformSignature to 'unsigned' when sidecar is unreachable", async () => {
    const generator = new ReceiptGenerator("http://localhost:19999");
    const receipt = await generator.generateReceipt(
      COMPLETED_SESSION,
      VENDOR_CONFIG
    );

    expect(receipt.signatures.platformSignature).toBe("unsigned");
  });

  it("has a non-empty transactionHash", async () => {
    const generator = new ReceiptGenerator("http://localhost:19999");
    const receipt = await generator.generateReceipt(
      COMPLETED_SESSION,
      VENDOR_CONFIG
    );

    expect(receipt.transactionHash).toBeDefined();
    expect(receipt.transactionHash.length).toBeGreaterThan(0);
  });
});

describe("computeReceiptHash", () => {
  it("produces deterministic hash for same inputs", () => {
    const receipt: Omit<TransactionReceipt, "signatures"> = {
      receiptId: "rcpt_test123",
      transactionHash: "",
      buyer: {
        did: "did:mesh:abc123",
        agentId: "agent-001",
        owner: "owner-001",
        authorityChain: ["did:mesh:cfo"],
      },
      vendor: { id: "vendor-001", name: "Test Vendor", jurisdiction: "US" },
      items: [
        { sku: "sku-1", name: "Item 1", amount: 100, quantity: 1, category: "compute" },
      ],
      totalAmount: 100,
      currency: "usd",
      compliance: {
        policyVersion: "1.0",
        rulesEvaluated: ["check_1"],
        allPassed: true,
        transcriptHash: "abc",
        humanApprovalRequired: false,
        humanApproved: null,
      },
      settlement: {
        method: "internal-ledger",
        settledAt: "2026-04-09T15:35:00.000Z",
        confirmationId: "ledger_test",
      },
      createdAt: "2026-04-09T15:35:00.000Z",
    };

    const hash1 = computeReceiptHash(receipt);
    const hash2 = computeReceiptHash(receipt);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
  });

  it("produces different hash when any field changes", () => {
    const base: Omit<TransactionReceipt, "signatures"> = {
      receiptId: "rcpt_test123",
      transactionHash: "",
      buyer: {
        did: "did:mesh:abc123",
        agentId: "agent-001",
        owner: "owner-001",
        authorityChain: ["did:mesh:cfo"],
      },
      vendor: { id: "vendor-001", name: "Test Vendor", jurisdiction: "US" },
      items: [
        { sku: "sku-1", name: "Item 1", amount: 100, quantity: 1, category: "compute" },
      ],
      totalAmount: 100,
      currency: "usd",
      compliance: {
        policyVersion: "1.0",
        rulesEvaluated: ["check_1"],
        allPassed: true,
        transcriptHash: "abc",
        humanApprovalRequired: false,
        humanApproved: null,
      },
      settlement: {
        method: "internal-ledger",
        settledAt: "2026-04-09T15:35:00.000Z",
        confirmationId: "ledger_test",
      },
      createdAt: "2026-04-09T15:35:00.000Z",
    };

    const modified = { ...base, totalAmount: 200 };

    expect(computeReceiptHash(base)).not.toBe(computeReceiptHash(modified));
  });
});
