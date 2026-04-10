import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MockRegistryClient,
  SidecarRegistryClient,
} from "../src/registry-client";
import type { RegistryAgentRecord } from "../src/registry-client";
import { RegistryUnreachableError } from "../src/errors";

const MOCK_AGENT: RegistryAgentRecord = {
  did: "did:mesh:abc123",
  publicKey: "dGVzdC1wdWJsaWMta2V5", // base64 of "test-public-key"
  trustScore: 850,
  lifecycleState: "active",
  owner: "test-agent-001",
  spendingLimit: 5000,
  approvedVendors: ["aws", "gcp"],
  categories: ["compute"],
};

describe("MockRegistryClient", () => {
  it("returns record for known DID", async () => {
    const agents = new Map<string, RegistryAgentRecord>();
    agents.set("did:mesh:abc123", MOCK_AGENT);
    const client = new MockRegistryClient(agents);

    const result = await client.lookupAgent("did:mesh:abc123");
    expect(result).toEqual(MOCK_AGENT);
  });

  it("returns null for unknown DID", async () => {
    const agents = new Map<string, RegistryAgentRecord>();
    agents.set("did:mesh:abc123", MOCK_AGENT);
    const client = new MockRegistryClient(agents);

    const result = await client.lookupAgent("did:mesh:unknown");
    expect(result).toBeNull();
  });

  it("returns null for empty registry", async () => {
    const client = new MockRegistryClient(new Map());
    const result = await client.lookupAgent("did:mesh:abc123");
    expect(result).toBeNull();
  });
});

describe("SidecarRegistryClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns mapped record on successful fetch", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          agent_id: "openclaw-agent-001",
          did: "did:mesh:abc123",
          public_key: "dGVzdC1wdWJsaWMta2V5",
          trust_score: 850,
          lifecycle_state: "active",
          spending_limit: 5000,
          approved_vendors: ["aws", "gcp"],
          permitted_categories: ["compute"],
          authority_chain: ["did:mesh:cfo", "did:mesh:abc123"],
          status: "verified",
        }),
        { status: 200 }
      )
    );

    const client = new SidecarRegistryClient("http://localhost:8100");
    const result = await client.lookupAgent("did:mesh:abc123");

    expect(result).not.toBeNull();
    expect(result!.did).toBe("did:mesh:abc123");
    expect(result!.publicKey).toBe("dGVzdC1wdWJsaWMta2V5");
    expect(result!.trustScore).toBe(850);
    expect(result!.lifecycleState).toBe("active");
    expect(result!.spendingLimit).toBe(5000);
    expect(result!.approvedVendors).toEqual(["aws", "gcp"]);
    expect(result!.categories).toEqual(["compute"]);
  });

  it("returns null when DID does not match sidecar response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          agent_id: "openclaw-agent-001",
          did: "did:mesh:different-did",
          public_key: "dGVzdC1wdWJsaWMta2V5",
          trust_score: 850,
          lifecycle_state: "active",
          spending_limit: 5000,
          approved_vendors: [],
          permitted_categories: [],
        }),
        { status: 200 }
      )
    );

    const client = new SidecarRegistryClient("http://localhost:8100");
    const result = await client.lookupAgent("did:mesh:abc123");
    expect(result).toBeNull();
  });

  it("throws RegistryUnreachableError on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const client = new SidecarRegistryClient("http://localhost:8100");
    await expect(
      client.lookupAgent("did:mesh:abc123")
    ).rejects.toBeInstanceOf(RegistryUnreachableError);
  });

  it("throws RegistryUnreachableError on non-OK response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", { status: 500 })
    );

    const client = new SidecarRegistryClient("http://localhost:8100");
    await expect(
      client.lookupAgent("did:mesh:abc123")
    ).rejects.toBeInstanceOf(RegistryUnreachableError);
  });
});
