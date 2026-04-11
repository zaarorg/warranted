import { describe, it, expect, vi } from "vitest";
import {
  verifyIdentity,
  verifyAuthorization,
  localAuthorizationCheck,
  engineAuthorizationCheck,
} from "../src/verify";
import type { EngineAuthorizationDeps } from "../src/verify";
import { MockRegistryClient } from "../src/registry-client";
import type { RegistryAgentRecord } from "../src/registry-client";
import type { VerifiedAgentContext } from "../src/types";
import {
  InvalidTokenError,
  TokenExpiredError,
  UnknownAgentError,
  InvalidSignatureError,
  AgentInactiveError,
} from "../src/errors";
import {
  createTestToken,
  createExpiredTestToken,
  getTestPublicKey,
} from "../src/jwt";

const TEST_SEED = "test-seed-123";
const DIFFERENT_SEED = "different-seed-456";
const KNOWN_DID = "did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6";

const pubKeyBytes = getTestPublicKey(TEST_SEED);
const pubKeyB64 = Buffer.from(pubKeyBytes).toString("base64");

function createActiveAgent(
  overrides?: Partial<RegistryAgentRecord>
): RegistryAgentRecord {
  return {
    did: KNOWN_DID,
    publicKey: pubKeyB64,
    trustScore: 850,
    lifecycleState: "active",
    owner: "openclaw-agent-001",
    spendingLimit: 5000,
    approvedVendors: ["aws", "gcp", "azure"],
    categories: ["compute", "software-licenses"],
    ...overrides,
  };
}

function createRegistryWith(
  ...agents: RegistryAgentRecord[]
): MockRegistryClient {
  const map = new Map<string, RegistryAgentRecord>();
  for (const agent of agents) {
    map.set(agent.did, agent);
  }
  return new MockRegistryClient(map);
}

describe("verifyIdentity", () => {
  it("returns VerifiedAgentContext for valid token and registry match", async () => {
    const token = await createTestToken({}, TEST_SEED);
    const registry = createRegistryWith(createActiveAgent());

    const ctx = await verifyIdentity(token, registry);

    expect(ctx.did).toBe(KNOWN_DID);
    expect(ctx.agentId).toBe("openclaw-agent-001");
    expect(ctx.trustScore).toBe(850);
    expect(ctx.lifecycleState).toBe("active");
    expect(ctx.publicKey).toBe(pubKeyB64);
    expect(ctx.spendingLimit).toBe(5000);
    expect(ctx.categories).toContain("compute");
    expect(ctx.approvedVendors).toContain("aws");
    expect(ctx.authorityChain).toHaveLength(3);
  });

  it("throws InvalidTokenError for malformed token", async () => {
    const registry = createRegistryWith(createActiveAgent());
    await expect(
      verifyIdentity("not-a-jwt", registry)
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("throws TokenExpiredError for expired token", async () => {
    const token = await createExpiredTestToken(TEST_SEED);
    const registry = createRegistryWith(createActiveAgent());

    await expect(
      verifyIdentity(token, registry)
    ).rejects.toBeInstanceOf(TokenExpiredError);
  });

  it("throws InvalidTokenError for future iat (clock skew attack)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await createTestToken(
      { iat: now + 90000 }, // 25 hours in future
      TEST_SEED
    );
    const registry = createRegistryWith(createActiveAgent());

    await expect(
      verifyIdentity(token, registry)
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("throws UnknownAgentError when DID not in registry", async () => {
    const token = await createTestToken({}, TEST_SEED);
    const registry = createRegistryWith(); // empty registry

    await expect(
      verifyIdentity(token, registry)
    ).rejects.toBeInstanceOf(UnknownAgentError);
  });

  it("throws InvalidSignatureError for wrong key", async () => {
    // Create token signed with DIFFERENT_SEED but registry has TEST_SEED's public key
    const differentPubKey = getTestPublicKey(DIFFERENT_SEED);
    const differentDid = (() => {
      const { createHash } = require("node:crypto");
      const hash = createHash("sha256")
        .update(differentPubKey)
        .digest("hex");
      return `did:mesh:${hash.slice(0, 40)}`;
    })();

    const token = await createTestToken({ sub: differentDid }, DIFFERENT_SEED);
    // Registry has the agent but with TEST_SEED's public key (mismatch)
    const registry = createRegistryWith(
      createActiveAgent({
        did: differentDid,
        publicKey: pubKeyB64, // wrong key for this token
      })
    );

    await expect(
      verifyIdentity(token, registry)
    ).rejects.toBeInstanceOf(InvalidSignatureError);
  });

  it("throws AgentInactiveError for suspended agent", async () => {
    const token = await createTestToken({}, TEST_SEED);
    const registry = createRegistryWith(
      createActiveAgent({ lifecycleState: "suspended" })
    );

    await expect(
      verifyIdentity(token, registry)
    ).rejects.toBeInstanceOf(AgentInactiveError);
  });

  it("throws AgentInactiveError for revoked agent", async () => {
    const token = await createTestToken({}, TEST_SEED);
    const registry = createRegistryWith(
      createActiveAgent({ lifecycleState: "revoked" })
    );

    await expect(
      verifyIdentity(token, registry)
    ).rejects.toBeInstanceOf(AgentInactiveError);
  });
});

// ---------------------------------------------------------------------------
// Shared agent fixture
// ---------------------------------------------------------------------------

const baseAgent: VerifiedAgentContext = {
  did: KNOWN_DID,
  agentId: "openclaw-agent-001",
  owner: "openclaw-agent-001",
  authorityChain: ["did:mesh:cfo", "did:mesh:vp-eng", KNOWN_DID],
  spendingLimit: 5000,
  dailySpendLimit: 10000,
  categories: ["compute", "software-licenses"],
  approvedVendors: ["aws", "gcp", "azure"],
  trustScore: 850,
  lifecycleState: "active",
  publicKey: pubKeyB64,
  tokenExp: Math.floor(Date.now() / 1000) + 86400,
};

const storefrontConfig = { minTrustScore: 600, vendorId: "aws" };

// ---------------------------------------------------------------------------
// localAuthorizationCheck (Phase 1 — unchanged logic from old verifyAuthorization)
// ---------------------------------------------------------------------------

describe("localAuthorizationCheck", () => {
  it("returns authorized: true when all checks pass", () => {
    const result = localAuthorizationCheck(
      baseAgent,
      { amount: 2500, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result.authorized).toBe(true);
  });

  it("returns TRUST_SCORE_LOW when score below minimum", () => {
    const agent = { ...baseAgent, trustScore: 400 };
    const result = localAuthorizationCheck(
      agent,
      { amount: 100, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("TRUST_SCORE_LOW");
      expect(result.details.score).toBe(400);
      expect(result.details.min).toBe(600);
    }
  });

  it("returns OVER_LIMIT when amount exceeds spending limit", () => {
    const result = localAuthorizationCheck(
      baseAgent,
      { amount: 6000, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("OVER_LIMIT");
      expect(result.details.limit).toBe(5000);
      expect(result.details.requested).toBe(6000);
    }
  });

  it("returns VENDOR_NOT_APPROVED when vendor not in agent's list", () => {
    const result = localAuthorizationCheck(
      baseAgent,
      { amount: 100, vendorId: "aws", category: "compute" },
      { minTrustScore: 0, vendorId: "sketchy-vendor" }
    );
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("VENDOR_NOT_APPROVED");
      expect(result.details.vendor).toBe("sketchy-vendor");
    }
  });

  it("returns CATEGORY_DENIED when category not in agent's list", () => {
    const result = localAuthorizationCheck(
      baseAgent,
      { amount: 100, vendorId: "aws", category: "weapons" },
      storefrontConfig
    );
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("CATEGORY_DENIED");
      expect(result.details.category).toBe("weapons");
    }
  });

  it("checks trust score before spending limit", () => {
    const agent = { ...baseAgent, trustScore: 100 };
    const result = localAuthorizationCheck(
      agent,
      { amount: 99999, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("TRUST_SCORE_LOW");
    }
  });

  it("allows exact spending limit amount", () => {
    const result = localAuthorizationCheck(
      baseAgent,
      { amount: 5000, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result.authorized).toBe(true);
  });

  it("allows minimum trust score exactly", () => {
    const agent = { ...baseAgent, trustScore: 600 };
    const result = localAuthorizationCheck(
      agent,
      { amount: 100, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result.authorized).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyAuthorization (two-phase, async)
// ---------------------------------------------------------------------------

describe("verifyAuthorization", () => {
  it("is async and returns a Promise", () => {
    const result = verifyAuthorization(
      baseAgent,
      { amount: 100, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result).toBeInstanceOf(Promise);
  });

  it("returns authorized: true when all local checks pass (no engine deps)", async () => {
    const result = await verifyAuthorization(
      baseAgent,
      { amount: 2500, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result.authorized).toBe(true);
  });

  it("fast local check rejects obvious violations without engine call", async () => {
    const mockResolveEnvelope = vi.fn();
    const mockMapEngineToSdkCode = vi.fn();

    const engineDeps: EngineAuthorizationDeps = {
      resolveEnvelope: mockResolveEnvelope,
      mapEngineToSdkCode: mockMapEngineToSdkCode,
      db: {},
      orgId: "test-org",
    };

    // Amount exceeds JWT claims spending limit → denied immediately, no engine call
    const result = await verifyAuthorization(
      baseAgent,
      { amount: 6000, vendorId: "aws", category: "compute" },
      storefrontConfig,
      engineDeps
    );

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("OVER_LIMIT");
    }
    // Engine was NOT called
    expect(mockResolveEnvelope).not.toHaveBeenCalled();
  });

  it("engine check runs when local check passes", async () => {
    const mockResolveEnvelope = vi.fn().mockResolvedValue({
      agentDid: KNOWN_DID,
      actions: [
        {
          actionId: "test",
          actionName: "purchase.initiate",
          denied: false,
          denySource: null,
          dimensions: [
            { name: "amount", kind: "numeric", resolved: 5000, sources: [] },
            { name: "vendor", kind: "set", resolved: ["aws", "gcp", "azure"], sources: [] },
            { name: "category", kind: "set", resolved: ["compute", "software-licenses"], sources: [] },
          ],
        },
      ],
      policyVersion: 1,
      resolvedAt: new Date().toISOString(),
    });
    const mockMapEngineToSdkCode = vi.fn();

    const engineDeps: EngineAuthorizationDeps = {
      resolveEnvelope: mockResolveEnvelope,
      mapEngineToSdkCode: mockMapEngineToSdkCode,
      db: {},
      orgId: "test-org",
    };

    const result = await verifyAuthorization(
      baseAgent,
      { amount: 500, vendorId: "aws", category: "compute" },
      storefrontConfig,
      engineDeps
    );

    expect(result.authorized).toBe(true);
    expect(mockResolveEnvelope).toHaveBeenCalledOnce();
  });

  it("retryHint included when local passes but engine denies on amount", async () => {
    // JWT claims say $5000 limit, engine says $1000 (cascading narrowed it)
    const mockResolveEnvelope = vi.fn().mockResolvedValue({
      agentDid: KNOWN_DID,
      actions: [
        {
          actionId: "test",
          actionName: "purchase.initiate",
          denied: false,
          denySource: null,
          dimensions: [
            {
              name: "amount",
              kind: "numeric",
              resolved: 1000,
              sources: [{ policyName: "platform-team-spending", groupName: "Platform", level: "team", value: 1000 }],
            },
            { name: "vendor", kind: "set", resolved: ["aws", "gcp", "azure"], sources: [] },
            { name: "category", kind: "set", resolved: ["compute", "software-licenses"], sources: [] },
          ],
        },
      ],
      policyVersion: 1,
      resolvedAt: new Date().toISOString(),
    });

    const engineDeps: EngineAuthorizationDeps = {
      resolveEnvelope: mockResolveEnvelope,
      mapEngineToSdkCode: (_code: string, _dim?: string) => ({ sdkCode: "OVER_LIMIT", httpStatus: 403 }),
      db: {},
      orgId: "test-org",
    };

    // $2000 passes local check (JWT limit = $5000) but fails engine (limit = $1000)
    const result = await verifyAuthorization(
      baseAgent,
      { amount: 2000, vendorId: "aws", category: "compute" },
      storefrontConfig,
      engineDeps
    );

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("OVER_LIMIT");
      expect(result.retryHint).toBeDefined();
      expect(result.retryHint?.reason).toBe("policy_updated");
    }
  });

  it("engine denial includes engine-specific detail block", async () => {
    const mockResolveEnvelope = vi.fn().mockResolvedValue({
      agentDid: KNOWN_DID,
      actions: [
        {
          actionId: "test",
          actionName: "purchase.initiate",
          denied: false,
          denySource: null,
          dimensions: [
            {
              name: "amount",
              kind: "numeric",
              resolved: 1000,
              sources: [{ policyName: "platform-team-spending", groupName: "Platform", level: "team", value: 1000 }],
            },
            { name: "vendor", kind: "set", resolved: ["aws"], sources: [] },
            { name: "category", kind: "set", resolved: ["compute"], sources: [] },
          ],
        },
      ],
      policyVersion: 1,
      resolvedAt: new Date().toISOString(),
    });

    const engineDeps: EngineAuthorizationDeps = {
      resolveEnvelope: mockResolveEnvelope,
      mapEngineToSdkCode: (_code: string, _dim?: string) => ({ sdkCode: "OVER_LIMIT", httpStatus: 403 }),
      db: {},
      orgId: "test-org",
    };

    const result = await verifyAuthorization(
      baseAgent,
      { amount: 2000, vendorId: "aws", category: "compute" },
      storefrontConfig,
      engineDeps
    );

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.engine).toBeDefined();
      expect(result.engine?.code).toBe("DIMENSION_EXCEEDED");
      expect(result.engine?.dimension).toBe("amount");
      expect(result.engine?.resolved).toBe(1000);
      expect(result.engine?.requested).toBe(2000);
      expect(result.engine?.sources).toHaveLength(1);
    }
  });

  it("deny override from engine blocks even valid local checks", async () => {
    const mockResolveEnvelope = vi.fn().mockResolvedValue({
      agentDid: KNOWN_DID,
      actions: [
        {
          actionId: "test",
          actionName: "purchase.initiate",
          denied: true,
          denySource: "sanctioned-vendors",
          dimensions: [],
        },
      ],
      policyVersion: 1,
      resolvedAt: new Date().toISOString(),
    });

    const engineDeps: EngineAuthorizationDeps = {
      resolveEnvelope: mockResolveEnvelope,
      mapEngineToSdkCode: (_code: string, _dim?: string) => ({ sdkCode: "VENDOR_NOT_APPROVED", httpStatus: 403 }),
      db: {},
      orgId: "test-org",
    };

    const result = await verifyAuthorization(
      baseAgent,
      { amount: 100, vendorId: "aws", category: "compute" },
      storefrontConfig,
      engineDeps
    );

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.engine?.code).toBe("DENY_OVERRIDE");
    }
  });

  it("empty envelope returns ENVELOPE_EMPTY with retryHint", async () => {
    const mockResolveEnvelope = vi.fn().mockResolvedValue({
      agentDid: KNOWN_DID,
      actions: [],
      policyVersion: 1,
      resolvedAt: new Date().toISOString(),
    });

    const engineDeps: EngineAuthorizationDeps = {
      resolveEnvelope: mockResolveEnvelope,
      mapEngineToSdkCode: (_code: string, _dim?: string) => ({ sdkCode: "CATEGORY_DENIED", httpStatus: 403 }),
      db: {},
      orgId: "test-org",
    };

    const result = await verifyAuthorization(
      baseAgent,
      { amount: 100, vendorId: "aws", category: "compute" },
      storefrontConfig,
      engineDeps
    );

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.retryHint).toBeDefined();
    }
  });

  // Backward-compatible tests (same as old verifyAuthorization but now async)
  it("returns TRUST_SCORE_LOW when score below minimum", async () => {
    const agent = { ...baseAgent, trustScore: 400 };
    const result = await verifyAuthorization(
      agent,
      { amount: 100, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("TRUST_SCORE_LOW");
    }
  });

  it("returns OVER_LIMIT when amount exceeds spending limit", async () => {
    const result = await verifyAuthorization(
      baseAgent,
      { amount: 6000, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("OVER_LIMIT");
    }
  });

  it("returns VENDOR_NOT_APPROVED when vendor not in agent's list", async () => {
    const result = await verifyAuthorization(
      baseAgent,
      { amount: 100, vendorId: "aws", category: "compute" },
      { minTrustScore: 0, vendorId: "sketchy-vendor" }
    );
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("VENDOR_NOT_APPROVED");
    }
  });

  it("returns CATEGORY_DENIED when category not in agent's list", async () => {
    const result = await verifyAuthorization(
      baseAgent,
      { amount: 100, vendorId: "aws", category: "weapons" },
      storefrontConfig
    );
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("CATEGORY_DENIED");
    }
  });

  it("allows exact spending limit amount", async () => {
    const result = await verifyAuthorization(
      baseAgent,
      { amount: 5000, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result.authorized).toBe(true);
  });

  it("allows minimum trust score exactly", async () => {
    const agent = { ...baseAgent, trustScore: 600 };
    const result = await verifyAuthorization(
      agent,
      { amount: 100, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result.authorized).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// engineAuthorizationCheck (Phase 2 only)
// ---------------------------------------------------------------------------

describe("engineAuthorizationCheck", () => {
  it("returns authorized: true when all dimensions pass", async () => {
    const mockResolveEnvelope = vi.fn().mockResolvedValue({
      agentDid: KNOWN_DID,
      actions: [
        {
          actionId: "test",
          actionName: "purchase.initiate",
          denied: false,
          denySource: null,
          dimensions: [
            { name: "amount", kind: "numeric", resolved: 5000, sources: [] },
            { name: "vendor", kind: "set", resolved: ["aws", "gcp"], sources: [] },
            { name: "category", kind: "set", resolved: ["compute"], sources: [] },
          ],
        },
      ],
      policyVersion: 1,
      resolvedAt: new Date().toISOString(),
    });

    const deps: EngineAuthorizationDeps = {
      resolveEnvelope: mockResolveEnvelope,
      mapEngineToSdkCode: () => ({ sdkCode: "OVER_LIMIT", httpStatus: 403 }),
      db: {},
      orgId: "test-org",
    };

    const result = await engineAuthorizationCheck(
      baseAgent,
      { amount: 500, vendorId: "aws", category: "compute" },
      { vendorId: "aws" },
      deps
    );
    expect(result.authorized).toBe(true);
  });

  it("detects vendor not in engine's set", async () => {
    const mockResolveEnvelope = vi.fn().mockResolvedValue({
      agentDid: KNOWN_DID,
      actions: [
        {
          actionId: "test",
          actionName: "purchase.initiate",
          denied: false,
          denySource: null,
          dimensions: [
            { name: "amount", kind: "numeric", resolved: 5000, sources: [] },
            { name: "vendor", kind: "set", resolved: ["gcp"], sources: [] },
            { name: "category", kind: "set", resolved: ["compute"], sources: [] },
          ],
        },
      ],
      policyVersion: 1,
      resolvedAt: new Date().toISOString(),
    });

    const deps: EngineAuthorizationDeps = {
      resolveEnvelope: mockResolveEnvelope,
      mapEngineToSdkCode: (_code: string, dim?: string) => {
        if (dim === "vendor") return { sdkCode: "VENDOR_NOT_APPROVED", httpStatus: 403 };
        return { sdkCode: "CATEGORY_DENIED", httpStatus: 403 };
      },
      db: {},
      orgId: "test-org",
    };

    const result = await engineAuthorizationCheck(
      baseAgent,
      { amount: 500, vendorId: "aws", category: "compute" },
      { vendorId: "aws" },
      deps
    );
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("VENDOR_NOT_APPROVED");
      expect(result.engine?.dimension).toBe("vendor");
    }
  });

  it("detects category not in engine's set", async () => {
    const mockResolveEnvelope = vi.fn().mockResolvedValue({
      agentDid: KNOWN_DID,
      actions: [
        {
          actionId: "test",
          actionName: "purchase.initiate",
          denied: false,
          denySource: null,
          dimensions: [
            { name: "amount", kind: "numeric", resolved: 5000, sources: [] },
            { name: "category", kind: "set", resolved: ["cloud-services"], sources: [] },
            { name: "vendor", kind: "set", resolved: ["aws"], sources: [] },
          ],
        },
      ],
      policyVersion: 1,
      resolvedAt: new Date().toISOString(),
    });

    const deps: EngineAuthorizationDeps = {
      resolveEnvelope: mockResolveEnvelope,
      mapEngineToSdkCode: (_code: string, dim?: string) => {
        if (dim === "category") return { sdkCode: "CATEGORY_DENIED", httpStatus: 403 };
        return { sdkCode: "OVER_LIMIT", httpStatus: 403 };
      },
      db: {},
      orgId: "test-org",
    };

    const result = await engineAuthorizationCheck(
      baseAgent,
      { amount: 500, vendorId: "aws", category: "compute" },
      { vendorId: "aws" },
      deps
    );
    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.code).toBe("CATEGORY_DENIED");
      expect(result.engine?.dimension).toBe("category");
    }
  });
});
