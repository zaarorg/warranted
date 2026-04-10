import { describe, it, expect, beforeAll } from "vitest";
import { createVerificationMiddleware, getVerifiedAgent } from "../src/middleware";
import { MockRegistryClient } from "../src/registry-client";
import type { RegistryAgentRecord } from "../src/registry-client";
import { createTestToken, createExpiredTestToken, getTestPublicKey } from "../src/jwt";
import type { WarrantedSDKConfig } from "../src/types";
import { ErrorResponseSchema } from "../src/types";

const TEST_SEED = "test-seed-123";
const DIFFERENT_SEED = "different-seed-456";
const KNOWN_DID = "did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6";

const pubKeyBytes = getTestPublicKey(TEST_SEED);
const pubKeyB64 = Buffer.from(pubKeyBytes).toString("base64");

const SDK_CONFIG: WarrantedSDKConfig = {
  vendorId: "vendor-acme-001",
  registryUrl: "http://localhost:8100",
  webhookSecret: "whsec_test123",
  minTrustScore: 600,
  acceptedPayment: ["warranted-credits"],
  supportedTransactionTypes: ["fixed-price"],
  jurisdiction: "US",
  sessionTtlSeconds: 3600,
};

function createMockRegistry(
  agents?: RegistryAgentRecord[]
): MockRegistryClient {
  const map = new Map<string, RegistryAgentRecord>();
  for (const agent of agents ?? []) {
    map.set(agent.did, agent);
  }
  return new MockRegistryClient(map);
}

const activeAgent: RegistryAgentRecord = {
  did: KNOWN_DID,
  publicKey: pubKeyB64,
  trustScore: 850,
  lifecycleState: "active",
  owner: "openclaw-agent-001",
  spendingLimit: 5000,
  approvedVendors: ["aws", "gcp", "azure", "vendor-acme-001"],
  categories: ["compute", "software-licenses"],
};

/** Dummy next handler that returns 200 OK */
const okNext = async () =>
  new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

let validToken: string;

beforeAll(async () => {
  validToken = await createTestToken(
    { approvedVendors: ["aws", "gcp", "azure", "vendor-acme-001"] },
    TEST_SEED
  );
});

describe("createVerificationMiddleware", () => {
  const registry = createMockRegistry([activeAgent]);
  const middleware = createVerificationMiddleware(registry, SDK_CONFIG);

  it("returns 401 NO_TOKEN when Authorization header is missing", async () => {
    const req = new Request("http://localhost/agent-checkout/catalog");
    const res = await middleware(req, okNext);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NO_TOKEN");

    // Validates against spec ErrorResponse shape
    const parsed = ErrorResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it("returns 401 INVALID_TOKEN when Authorization is not Bearer", async () => {
    const req = new Request("http://localhost/agent-checkout/catalog", {
      headers: { Authorization: "Basic abc123" },
    });
    const res = await middleware(req, okNext);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  it("returns 401 INVALID_TOKEN when Bearer has no token value", async () => {
    // Note: Request API trims "Bearer " to "Bearer", so it fails the
    // "Bearer " prefix check and gets INVALID_TOKEN
    const req = new Request("http://localhost/agent-checkout/catalog", {
      headers: { Authorization: "Bearer " },
    });
    const res = await middleware(req, okNext);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  it("returns 401 INVALID_TOKEN for malformed JWT", async () => {
    const req = new Request("http://localhost/agent-checkout/catalog", {
      headers: { Authorization: "Bearer not-a-valid-jwt" },
    });
    const res = await middleware(req, okNext);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  it("returns 401 TOKEN_EXPIRED for expired token", async () => {
    const expiredToken = await createExpiredTestToken(TEST_SEED);
    const req = new Request("http://localhost/agent-checkout/catalog", {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    const res = await middleware(req, okNext);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("TOKEN_EXPIRED");
  });

  it("returns 401 UNKNOWN_AGENT when DID not in registry", async () => {
    const emptyRegistry = createMockRegistry();
    const mw = createVerificationMiddleware(emptyRegistry, SDK_CONFIG);

    const req = new Request("http://localhost/agent-checkout/catalog", {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const res = await mw(req, okNext);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNKNOWN_AGENT");
  });

  it("returns 401 INVALID_SIGNATURE when token signed with wrong key", async () => {
    // Token signed with DIFFERENT_SEED, but registry has TEST_SEED pubkey for same DID
    const wrongToken = await createTestToken(
      { sub: KNOWN_DID },
      DIFFERENT_SEED
    );
    const req = new Request("http://localhost/agent-checkout/catalog", {
      headers: { Authorization: `Bearer ${wrongToken}` },
    });
    const res = await middleware(req, okNext);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_SIGNATURE");
  });

  it("returns 403 AGENT_INACTIVE for suspended agent", async () => {
    const suspendedAgent = { ...activeAgent, lifecycleState: "suspended" as const };
    const suspendedRegistry = createMockRegistry([suspendedAgent]);
    const mw = createVerificationMiddleware(suspendedRegistry, SDK_CONFIG);

    const req = new Request("http://localhost/agent-checkout/catalog", {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const res = await mw(req, okNext);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("AGENT_INACTIVE");
  });

  it("passes through to next handler with valid token", async () => {
    const req = new Request("http://localhost/agent-checkout/catalog", {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const res = await middleware(req, okNext);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("attaches VerifiedAgentContext to request", async () => {
    const req = new Request("http://localhost/agent-checkout/catalog", {
      headers: { Authorization: `Bearer ${validToken}` },
    });

    let capturedAgent: ReturnType<typeof getVerifiedAgent> | undefined;
    await middleware(req, async () => {
      capturedAgent = getVerifiedAgent(req);
      return new Response("ok");
    });

    expect(capturedAgent).toBeDefined();
    expect(capturedAgent!.did).toBe(KNOWN_DID);
    expect(capturedAgent!.trustScore).toBe(850);
    expect(capturedAgent!.lifecycleState).toBe("active");
  });

  it("all error responses match ErrorResponse schema", async () => {
    // Test a few error scenarios for schema compliance
    const scenarios = [
      new Request("http://localhost/test"), // no auth
      new Request("http://localhost/test", {
        headers: { Authorization: "Bearer garbage" },
      }),
    ];

    for (const req of scenarios) {
      const res = await middleware(req, okNext);
      if (res.status >= 400) {
        const body = await res.json();
        const parsed = ErrorResponseSchema.safeParse(body);
        expect(parsed.success).toBe(true);
      }
    }
  });
});
