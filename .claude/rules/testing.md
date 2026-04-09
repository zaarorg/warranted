# Testing Rules

## Philosophy

Test what matters for a compliance platform that will be evaluated on security rigor and correctness. The test suite must prove that policy enforcement is deterministic, token hierarchy is inviolable, and transaction state transitions are correct.

**Test rigorously:** Token issuance/validation, hierarchy enforcement (child cannot widen parent), spending policy evaluation, XState machine transitions, compliance boundary enforcement, receipt generation, storefront SDK verification, sidecar API responses.
**Test lightly:** Dashboard UI components, API route wiring, Docker configuration.
**Don't test:** Third-party library internals (jose JWT signing, Drizzle query generation, XState core), Coinbase/Stripe API behavior (mock them).

Target: Every policy rule has a test. Every token hierarchy constraint has a test. Every XState guard has a test. All deterministic tests pass without external services.

## Framework

- **TypeScript:** Vitest. Use `describe`/`it`/`expect` pattern.
- **Python (sidecar):** pytest with pytest-asyncio for async endpoints.
- **XState:** `@xstate/test` for model-based state machine testing.
- **Run all:** `bun run test`
- **Run specific:** `bun run test -- --run registry`
- **Integration only:** `bun run test:integration`

## Directory Structure

```
packages/
├── registry/
│   └── __tests__/
│       ├── token-issuance.test.ts       # JWT creation with hierarchical claims
│       ├── token-validation.test.ts     # Signature verification, expiry, claim checks
│       ├── hierarchy.test.ts            # Parent-child derivation, scope narrowing, cascade revocation
│       └── verification.test.ts         # Middleware auth checks
├── engine/
│   └── __tests__/
│       ├── machine.test.ts              # XState state transitions (all 5 phases)
│       ├── guards.test.ts              # Compliance boundary guards (price floor, spending limit)
│       ├── negotiation.test.ts          # Structured protocol message validation
│       └── settlement.test.ts           # Receipt generation, transcript capture
├── ledger/
│   └── __tests__/
│       ├── operations.test.ts           # Hold/escrow, deposit/withdrawal, balance checks
│       ├── concurrency.test.ts          # Double-spend prevention, pessimistic locking
│       └── reconcile.test.ts            # Balance reconciliation
├── storefront-sdk/
│   └── __tests__/
│       ├── middleware.test.ts            # Full verification flow (identity → auth → trust)
│       ├── verify.test.ts               # Individual verification functions
│       ├── manifest.test.ts             # Manifest generation and serving
│       ├── session.test.ts              # Transaction session lifecycle
│       └── receipt.test.ts              # Receipt structure and immutability
├── agent-sdk/
│   └── __tests__/
│       ├── client.test.ts               # Transaction initiation, search, negotiate
│       └── auth.test.ts                 # Token attachment, refresh

sidecar/
└── tests/
    ├── test_identity.py                 # AGT identity creation, DID format
    ├── test_authorization.py            # Policy evaluation (approve, deny, escalate)
    ├── test_signing.py                  # Ed25519 sign/verify round-trip
    └── test_endpoints.py                # FastAPI endpoint responses
```

## Required Test Cases

### Token Hierarchy (Deterministic, Critical)

#### 1. Child Cannot Widen Parent Scope
```typescript
describe("token hierarchy", () => {
  it("rejects child token with higher spending limit than parent", async () => {
    const parentToken = await createToken({ spendingLimit: 5000 });
    await expect(
      deriveChildToken(parentToken, { spendingLimit: 10000 })
    ).rejects.toThrow("child cannot widen parent scope");
  });

  it("rejects child token with additional categories", async () => {
    const parentToken = await createToken({ categories: ["compute"] });
    await expect(
      deriveChildToken(parentToken, { categories: ["compute", "hardware"] })
    ).rejects.toThrow("child cannot widen parent scope");
  });

  it("rejects child token with vendors not in parent list", async () => {
    const parentToken = await createToken({ approvedVendors: ["aws"] });
    await expect(
      deriveChildToken(parentToken, { approvedVendors: ["aws", "gcp"] })
    ).rejects.toThrow("child cannot widen parent scope");
  });

  it("allows child token with narrower scope", async () => {
    const parentToken = await createToken({
      spendingLimit: 5000,
      categories: ["compute", "software"],
      approvedVendors: ["aws", "gcp", "azure"],
    });
    const child = await deriveChildToken(parentToken, {
      spendingLimit: 1000,
      categories: ["compute"],
      approvedVendors: ["aws"],
    });
    expect(child.claims.spendingLimit).toBe(1000);
  });
});
```

#### 2. Cascade Revocation
```typescript
describe("cascade revocation", () => {
  it("revoking parent invalidates all children", async () => {
    const parent = await createToken({ agentId: "parent-001" });
    const child = await deriveChildToken(parent, { agentId: "child-001" });
    const grandchild = await deriveChildToken(child, { agentId: "grandchild-001" });

    await revokeToken(parent.id);

    expect(await isTokenValid(child.id)).toBe(false);
    expect(await isTokenValid(grandchild.id)).toBe(false);
  });
});
```

### Transaction Engine — XState (Deterministic, Critical)

#### 3. Phase Transitions
```typescript
describe("transaction state machine", () => {
  it("progresses through all 5 phases in order", () => {
    const machine = createTransactionMachine();
    const actor = createActor(machine);
    actor.start();

    actor.send({ type: "IDENTITY_VERIFIED" });
    expect(actor.getSnapshot().value).toBe("context");

    actor.send({ type: "CONTEXT_SET" });
    expect(actor.getSnapshot().value).toBe("negotiation");

    actor.send({ type: "AGREEMENT_REACHED" });
    expect(actor.getSnapshot().value).toBe("settlement");

    actor.send({ type: "SETTLED" });
    expect(actor.getSnapshot().value).toBe("complete");
  });
});
```

#### 4. Compliance Guards
```typescript
describe("compliance guards", () => {
  it("blocks offer below price floor", () => {
    const machine = createTransactionMachine({
      complianceContext: { priceFloor: 450000 },
    });
    const actor = createActor(machine);
    actor.start();
    // ... advance to negotiation phase
    actor.send({ type: "OFFER", amount: 1 });
    expect(actor.getSnapshot().value).toBe("negotiation"); // stays in negotiation
    expect(actor.getSnapshot().context.lastDenialReason).toContain("price floor");
  });

  it("blocks transaction exceeding spending limit", () => {
    const machine = createTransactionMachine({
      agentContext: { spendingLimit: 5000 },
    });
    // ... attempt $6000 purchase
    expect(actor.getSnapshot().context.lastDenialReason).toContain("spending limit");
  });

  it("blocks unapproved vendor", () => {
    const machine = createTransactionMachine({
      agentContext: { approvedVendors: ["aws", "gcp"] },
    });
    // ... attempt purchase from "sketchy-vendor"
    expect(actor.getSnapshot().context.lastDenialReason).toContain("approved vendor");
  });
});
```

### Spending Policy (Deterministic, Critical)

#### 5. Policy Evaluation
```typescript
describe("spending policy", () => {
  it("approves within-limit purchase from approved vendor", async () => {
    const result = await checkAuthorization({
      vendor: "aws", amount: 2500, category: "compute",
    });
    expect(result.authorized).toBe(true);
  });

  it("denies over-limit purchase", async () => {
    const result = await checkAuthorization({
      vendor: "aws", amount: 6000, category: "compute",
    });
    expect(result.authorized).toBe(false);
    expect(result.reasons).toContain("exceeds limit");
  });

  it("denies unapproved vendor", async () => {
    const result = await checkAuthorization({
      vendor: "sketchy-vendor", amount: 100, category: "compute",
    });
    expect(result.authorized).toBe(false);
    expect(result.reasons).toContain("not on approved list");
  });

  it("escalates high-value transaction", async () => {
    const result = await checkAuthorization({
      vendor: "aws", amount: 3000, category: "compute",
    });
    expect(result.authorized).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });
});
```

### Storefront SDK Verification (Deterministic)

#### 6. Identity Verification
- Valid JWT with matching DID in registry → 200
- Expired JWT → 401
- Valid JWT but DID not in registry → 401
- Valid JWT but revoked lifecycle state → 403
- Missing Authorization header → 401

#### 7. Authorization Checks
- Amount within spending limit → pass
- Amount exceeds spending limit → 403 with reason
- Vendor on approved list → pass
- Vendor not on approved list → 403 with reason
- Category in permitted list → pass
- Category not in permitted list → 403 with reason

#### 8. Trust Score Gate
- Trust score above storefront minimum → pass
- Trust score below storefront minimum → 403

### Sidecar (Python, Deterministic)

#### 9. Identity Endpoint
```python
async def test_check_identity():
    response = await client.get("/check_identity")
    data = response.json()
    assert data["did"].startswith("did:mesh:")
    assert data["status"] == "verified"
    assert isinstance(data["spending_limit"], (int, float))
    assert isinstance(data["approved_vendors"], list)
```

#### 10. Authorization Endpoint
```python
async def test_deny_over_limit():
    response = await client.post(
        "/check_authorization",
        params={"vendor": "aws", "amount": 6000, "category": "compute"}
    )
    data = response.json()
    assert data["authorized"] is False

async def test_deny_unapproved_vendor():
    response = await client.post(
        "/check_authorization",
        params={"vendor": "sketchy", "amount": 100, "category": "compute"}
    )
    data = response.json()
    assert data["authorized"] is False
```

#### 11. Signing Endpoint
- Sign → verify round-trip produces valid Ed25519 signature
- Signing denied transaction returns `signed: false`
- Signed payload includes nonce and timestamp

### Ledger (Deterministic)

#### 12. Double-Spend Prevention
```typescript
describe("concurrency", () => {
  it("prevents concurrent sessions from exceeding balance", async () => {
    await deposit(agentId, 5000);
    const [result1, result2] = await Promise.all([
      reserve(agentId, 3000),
      reserve(agentId, 3000),
    ]);
    // One should succeed, one should fail
    const successes = [result1, result2].filter(r => r.success);
    expect(successes).toHaveLength(1);
  });
});
```

#### 13. Hold/Release Lifecycle
- Reserve → settle → balance decreases
- Reserve → cancel → balance restored
- Reserve → TTL expires → balance restored automatically

### Demo Scenarios (Integration, needs running services)

#### 14. Round 1: Unprotected Exploit
- Two agents negotiate without platform
- Buyer social-engineers seller to accept $1 for $500K asset
- Assert: transaction completes with no guardrails

#### 15. Round 2: Platform Blocks Exploit
- Same agents, through the platform
- Buyer offers $1 → mechanically rejected by price floor guard
- Legitimate negotiation at $460K succeeds
- Assert: full receipt generated with audit trail

#### 16. Round 3: Sophisticated Attacks
- Price just under minimum ($449K with $450K floor) → rejected
- Prompt injection in negotiation messages → treated as data, not instructions
- Assert: all attacks blocked, transcript captures attempts

## Mocking Strategy

### Sidecar Mock (for TypeScript tests)
```typescript
const mockSidecar = {
  checkIdentity: vi.fn().mockResolvedValue({
    agentId: "test-agent-001",
    did: "did:mesh:abc123",
    spendingLimit: 5000,
    approvedVendors: ["aws", "gcp"],
    status: "verified",
  }),
  checkAuthorization: vi.fn().mockResolvedValue({
    authorized: true,
    requiresApproval: false,
  }),
  signTransaction: vi.fn().mockResolvedValue({
    signed: true,
    signature: "mock-ed25519-signature",
  }),
};
```

### Database Mock (for unit tests)
Use Drizzle's `drizzle(new Pool())` with a test Postgres database, or use `pg-mem` for in-memory testing.

## What Not to Test

- Don't test `jose` JWT signing internals — trust the library, test your claim logic.
- Don't test Drizzle's SQL generation — test your query results.
- Don't test XState core — test your machine definition (guards, actions, transitions).
- Don't test Hono's routing — test your handler logic.
- Don't test AGT's Ed25519 implementation — test your identity creation and verification flow.
- Don't test Coinbase/Stripe API behavior — mock it.
- Don't aim for 100% coverage — aim for "every policy rule works, every hierarchy constraint holds, every phase transition is correct."
