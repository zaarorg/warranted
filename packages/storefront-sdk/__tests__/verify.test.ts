import { describe, it, expect } from "vitest";
import { verifyIdentity, verifyAuthorization } from "../src/verify";
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

describe("verifyAuthorization", () => {
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

  it("returns authorized: true when all checks pass", () => {
    const result = verifyAuthorization(
      baseAgent,
      { amount: 2500, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result.authorized).toBe(true);
  });

  it("returns TRUST_SCORE_LOW when score below minimum", () => {
    const agent = { ...baseAgent, trustScore: 400 };
    const result = verifyAuthorization(
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
    const result = verifyAuthorization(
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
    const result = verifyAuthorization(
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
    const result = verifyAuthorization(
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
    // Both would fail, but trust score should be checked first
    const agent = { ...baseAgent, trustScore: 100 };
    const result = verifyAuthorization(
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
    const result = verifyAuthorization(
      baseAgent,
      { amount: 5000, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result.authorized).toBe(true);
  });

  it("allows minimum trust score exactly", () => {
    const agent = { ...baseAgent, trustScore: 600 };
    const result = verifyAuthorization(
      agent,
      { amount: 100, vendorId: "aws", category: "compute" },
      storefrontConfig
    );
    expect(result.authorized).toBe(true);
  });
});
