import { randomBytes } from "node:crypto";
import type {
  TransactionSession,
  VerifiedAgentContext,
  CatalogItem,
  CartItem,
} from "./types";
import {
  InvalidItemsError,
  OverLimitError,
  SessionNotFoundError,
  SessionExpiredError,
  SessionInvalidStateError,
} from "./errors";

// ---------------------------------------------------------------------------
// Session Store Interface
// ---------------------------------------------------------------------------

/** Interface for persisting transaction sessions. */
export interface SessionStore {
  create(session: TransactionSession): Promise<void>;
  get(sessionId: string): Promise<TransactionSession | null>;
  update(
    sessionId: string,
    updates: Partial<TransactionSession>
  ): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-Memory Implementation
// ---------------------------------------------------------------------------

/**
 * In-memory session store backed by a Map.
 *
 * Checks TTL on get() — if the session has expired, marks it as "cancelled"
 * before returning. Sessions are lost on process restart.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, TransactionSession>();

  async create(session: TransactionSession): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  async get(sessionId: string): Promise<TransactionSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Check TTL expiry
    if (
      session.status !== "complete" &&
      session.status !== "cancelled" &&
      new Date(session.expiresAt) < new Date()
    ) {
      const cancelled: TransactionSession = {
        ...session,
        status: "cancelled",
      };
      this.sessions.set(sessionId, cancelled);
      return cancelled;
    }

    return session;
  }

  async update(
    sessionId: string,
    updates: Partial<TransactionSession>
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, { ...session, ...updates });
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

/**
 * Manages transaction session lifecycle: creation, retrieval, and settlement.
 *
 * Validates items against the catalog, captures governance snapshots from the
 * verified agent context, and enforces status transitions.
 */
export class SessionManager {
  constructor(
    private readonly store: SessionStore,
    private readonly catalog: CatalogItem[],
    private readonly sessionTtlSeconds: number = 3600
  ) {}

  /**
   * Creates a new transaction session after validating items against the catalog.
   *
   * For fixed-price transactions, auto-transitions through "context_set" immediately.
   */
  async createSession(
    agentContext: VerifiedAgentContext,
    items: Array<{ sku: string; quantity: number }>,
    transactionType: string,
    vendorId: string
  ): Promise<TransactionSession> {
    // Validate items against catalog
    const cartItems: CartItem[] = [];
    for (const item of items) {
      const catalogItem = this.catalog.find((c) => c.sku === item.sku);
      if (!catalogItem) {
        throw new InvalidItemsError({ sku: item.sku, reason: "not found" });
      }
      if (!catalogItem.available) {
        throw new InvalidItemsError({
          sku: item.sku,
          reason: "unavailable",
        });
      }
      cartItems.push({
        sku: catalogItem.sku,
        name: catalogItem.name,
        price: catalogItem.price,
        category: catalogItem.category,
        quantity: item.quantity,
      });
    }

    const totalAmount = cartItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // Check spending limit
    if (totalAmount > agentContext.spendingLimit) {
      throw new OverLimitError(agentContext.spendingLimit, totalAmount);
    }

    const sessionId = `txn_${randomBytes(8).toString("hex")}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionTtlSeconds * 1000);

    // Fixed-price auto-transitions through context_set
    const status =
      transactionType === "fixed-price" ? "context_set" : "identity_verified";

    const session: TransactionSession = {
      sessionId,
      status,
      agentDid: agentContext.did,
      vendorId,
      items: cartItems,
      totalAmount,
      agentAuthorityChain: agentContext.authorityChain,
      agentSpendingLimit: agentContext.spendingLimit,
      agentTrustScore: agentContext.trustScore,
      jurisdiction: "US",
      transcriptHash: null,
      receiptId: null,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      settledAt: null,
    };

    await this.store.create(session);
    return session;
  }

  /** Retrieves a session by ID. Returns null if not found. */
  async getSession(sessionId: string): Promise<TransactionSession | null> {
    return this.store.get(sessionId);
  }

  /**
   * Settles a transaction session, transitioning it to "complete".
   *
   * Validates ownership, status, and expiry before proceeding.
   */
  async settleSession(
    sessionId: string,
    agentDid: string
  ): Promise<TransactionSession> {
    const session = await this.store.get(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    // Check expiry
    if (new Date(session.expiresAt) < new Date()) {
      await this.store.update(sessionId, { status: "cancelled" });
      throw new SessionExpiredError();
    }

    // Check status
    if (session.status === "complete" || session.status === "cancelled") {
      throw new SessionInvalidStateError(session.status);
    }

    if (
      session.status !== "context_set" &&
      session.status !== "identity_verified"
    ) {
      throw new SessionInvalidStateError(session.status);
    }

    // Verify ownership
    if (session.agentDid !== agentDid) {
      throw new SessionInvalidStateError(session.status, {
        reason: "agent DID mismatch",
      });
    }

    // Transition: settling → complete
    const settledAt = new Date().toISOString();
    await this.store.update(sessionId, {
      status: "complete",
      settledAt,
    });

    return {
      ...session,
      status: "complete",
      settledAt,
    };
  }
}
