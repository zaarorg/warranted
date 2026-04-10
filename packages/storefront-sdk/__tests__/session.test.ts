import { describe, it, expect } from "vitest";
import {
  InMemorySessionStore,
  SessionManager,
} from "../src/session";
import type { VerifiedAgentContext, CatalogItem } from "../src/types";

const CATALOG: CatalogItem[] = [
  {
    sku: "gpu-hours-100",
    name: "100 GPU Hours (A100)",
    price: 2500,
    currency: "usd",
    category: "compute",
    available: true,
  },
  {
    sku: "storage-1tb",
    name: "1TB Cloud Storage",
    price: 500,
    currency: "usd",
    category: "storage",
    available: true,
  },
  {
    sku: "gpu-hours-unavailable",
    name: "Unavailable GPU Hours",
    price: 1000,
    currency: "usd",
    category: "compute",
    available: false,
  },
];

const AGENT_CONTEXT: VerifiedAgentContext = {
  did: "did:mesh:abc123",
  agentId: "openclaw-agent-001",
  owner: "test-owner",
  authorityChain: ["did:mesh:cfo", "did:mesh:vp-eng", "did:mesh:abc123"],
  spendingLimit: 5000,
  dailySpendLimit: 10000,
  categories: ["compute", "storage"],
  approvedVendors: ["vendor-acme-001"],
  trustScore: 850,
  lifecycleState: "active",
  publicKey: "dGVzdC1rZXk=",
  tokenExp: Math.floor(Date.now() / 1000) + 86400,
};

describe("InMemorySessionStore", () => {
  it("returns null for unknown session IDs", async () => {
    const store = new InMemorySessionStore();
    expect(await store.get("txn_nonexistent")).toBeNull();
  });

  it("stores and retrieves a session", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store, CATALOG);
    const session = await manager.createSession(
      AGENT_CONTEXT,
      [{ sku: "gpu-hours-100", quantity: 1 }],
      "fixed-price",
      "vendor-acme-001"
    );
    const retrieved = await store.get(session.sessionId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.sessionId).toBe(session.sessionId);
  });

  it("marks expired sessions as cancelled on get()", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store, CATALOG, 0); // 0 second TTL

    const session = await manager.createSession(
      AGENT_CONTEXT,
      [{ sku: "gpu-hours-100", quantity: 1 }],
      "fixed-price",
      "vendor-acme-001"
    );

    // Wait briefly for TTL to expire
    await new Promise((r) => setTimeout(r, 50));

    const retrieved = await store.get(session.sessionId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.status).toBe("cancelled");
  });

  it("deletes a session", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store, CATALOG);
    const session = await manager.createSession(
      AGENT_CONTEXT,
      [{ sku: "gpu-hours-100", quantity: 1 }],
      "fixed-price",
      "vendor-acme-001"
    );
    await store.delete(session.sessionId);
    expect(await store.get(session.sessionId)).toBeNull();
  });
});

describe("SessionManager", () => {
  describe("createSession", () => {
    it("creates a session with valid items and txn_ prefix", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG);

      const session = await manager.createSession(
        AGENT_CONTEXT,
        [{ sku: "gpu-hours-100", quantity: 1 }],
        "fixed-price",
        "vendor-acme-001"
      );

      expect(session.sessionId).toMatch(/^txn_[a-f0-9]{16}$/);
      expect(session.agentDid).toBe("did:mesh:abc123");
      expect(session.vendorId).toBe("vendor-acme-001");
      expect(session.items).toHaveLength(1);
      expect(session.items[0]!.sku).toBe("gpu-hours-100");
      expect(session.totalAmount).toBe(2500);
      expect(session.createdAt).toBeDefined();
      expect(session.expiresAt).toBeDefined();
      expect(session.settledAt).toBeNull();
    });

    it("auto-transitions fixed-price sessions to context_set", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG);

      const session = await manager.createSession(
        AGENT_CONTEXT,
        [{ sku: "gpu-hours-100", quantity: 1 }],
        "fixed-price",
        "vendor-acme-001"
      );

      expect(session.status).toBe("context_set");
    });

    it("sets status to identity_verified for negotiated transactions", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG);

      const session = await manager.createSession(
        AGENT_CONTEXT,
        [{ sku: "gpu-hours-100", quantity: 1 }],
        "negotiated",
        "vendor-acme-001"
      );

      expect(session.status).toBe("identity_verified");
    });

    it("captures governance snapshot from agent context", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG);

      const session = await manager.createSession(
        AGENT_CONTEXT,
        [{ sku: "gpu-hours-100", quantity: 1 }],
        "fixed-price",
        "vendor-acme-001"
      );

      expect(session.agentAuthorityChain).toEqual(AGENT_CONTEXT.authorityChain);
      expect(session.agentSpendingLimit).toBe(AGENT_CONTEXT.spendingLimit);
      expect(session.agentTrustScore).toBe(AGENT_CONTEXT.trustScore);
    });

    it("calculates totalAmount from catalog prices * quantities", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG);

      const session = await manager.createSession(
        AGENT_CONTEXT,
        [
          { sku: "gpu-hours-100", quantity: 1 },
          { sku: "storage-1tb", quantity: 2 },
        ],
        "fixed-price",
        "vendor-acme-001"
      );

      expect(session.totalAmount).toBe(2500 + 500 * 2);
    });

    it("throws INVALID_ITEMS for unknown SKU", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG);

      await expect(
        manager.createSession(
          AGENT_CONTEXT,
          [{ sku: "nonexistent-sku", quantity: 1 }],
          "fixed-price",
          "vendor-acme-001"
        )
      ).rejects.toThrow("Requested SKUs not found or unavailable");
    });

    it("throws INVALID_ITEMS for unavailable item", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG);

      await expect(
        manager.createSession(
          AGENT_CONTEXT,
          [{ sku: "gpu-hours-unavailable", quantity: 1 }],
          "fixed-price",
          "vendor-acme-001"
        )
      ).rejects.toThrow("Requested SKUs not found or unavailable");
    });

    it("throws OVER_LIMIT when total exceeds spending limit", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG);

      const limitedAgent = { ...AGENT_CONTEXT, spendingLimit: 100 };

      await expect(
        manager.createSession(
          limitedAgent,
          [{ sku: "gpu-hours-100", quantity: 1 }],
          "fixed-price",
          "vendor-acme-001"
        )
      ).rejects.toThrow("exceeds spending limit");
    });
  });

  describe("getSession", () => {
    it("returns session by ID", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG);

      const session = await manager.createSession(
        AGENT_CONTEXT,
        [{ sku: "gpu-hours-100", quantity: 1 }],
        "fixed-price",
        "vendor-acme-001"
      );

      const retrieved = await manager.getSession(session.sessionId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe(session.sessionId);
    });

    it("returns null for nonexistent session", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG);

      expect(await manager.getSession("txn_nonexistent")).toBeNull();
    });
  });

  describe("settleSession", () => {
    it("settles a valid session and sets status to complete", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG);

      const session = await manager.createSession(
        AGENT_CONTEXT,
        [{ sku: "gpu-hours-100", quantity: 1 }],
        "fixed-price",
        "vendor-acme-001"
      );

      const settled = await manager.settleSession(
        session.sessionId,
        AGENT_CONTEXT.did
      );

      expect(settled.status).toBe("complete");
      expect(settled.settledAt).toBeDefined();
      expect(settled.settledAt).not.toBeNull();
    });

    it("throws SESSION_NOT_FOUND for unknown session", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG);

      await expect(
        manager.settleSession("txn_nonexistent", AGENT_CONTEXT.did)
      ).rejects.toThrow("Transaction session does not exist");
    });

    it("throws SESSION_EXPIRED for expired session", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG, 0);

      const session = await manager.createSession(
        AGENT_CONTEXT,
        [{ sku: "gpu-hours-100", quantity: 1 }],
        "fixed-price",
        "vendor-acme-001"
      );

      await new Promise((r) => setTimeout(r, 50));

      await expect(
        manager.settleSession(session.sessionId, AGENT_CONTEXT.did)
      ).rejects.toThrow("Transaction session TTL has elapsed");
    });

    it("throws SESSION_INVALID_STATE for already completed session", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG);

      const session = await manager.createSession(
        AGENT_CONTEXT,
        [{ sku: "gpu-hours-100", quantity: 1 }],
        "fixed-price",
        "vendor-acme-001"
      );

      await manager.settleSession(session.sessionId, AGENT_CONTEXT.did);

      await expect(
        manager.settleSession(session.sessionId, AGENT_CONTEXT.did)
      ).rejects.toThrow("Action not valid for current session status");
    });

    it("throws SESSION_INVALID_STATE when agent DID does not match", async () => {
      const store = new InMemorySessionStore();
      const manager = new SessionManager(store, CATALOG);

      const session = await manager.createSession(
        AGENT_CONTEXT,
        [{ sku: "gpu-hours-100", quantity: 1 }],
        "fixed-price",
        "vendor-acme-001"
      );

      await expect(
        manager.settleSession(session.sessionId, "did:mesh:wrong-agent")
      ).rejects.toThrow("Action not valid for current session status");
    });
  });
});
