import { describe, it, expect } from "vitest";
import {
  createAgentIdentity,
  deriveAgentIdentity,
  deriveAgentId,
  deriveDid,
  encryptSeed,
  decryptSeed,
  validateNarrowing,
} from "../src/index";
import type { PolicyConstraint, ResolvedEnvelope } from "@warranted/rules-engine";

describe("identity generation", () => {
  it("createAgentIdentity generates valid Ed25519 identity", async () => {
    const identity = await createAgentIdentity();

    expect(identity.agentId).toMatch(/^agent_/);
    expect(identity.did).toMatch(/^did:mesh:/);
    expect(identity.publicKey).toHaveLength(32);
    expect(identity.seed).toHaveLength(32);
  });

  it("deriveAgentIdentity is deterministic", async () => {
    const seed = new Uint8Array(32);
    seed[0] = 42;

    const id1 = await deriveAgentIdentity(seed);
    const id2 = await deriveAgentIdentity(seed);

    expect(id1.agentId).toBe(id2.agentId);
    expect(id1.did).toBe(id2.did);
    expect(id1.publicKey).toEqual(id2.publicKey);
  });

  it("deriveAgentId is deterministic", async () => {
    const identity = await createAgentIdentity();
    const id1 = deriveAgentId(identity.publicKey);
    const id2 = deriveAgentId(identity.publicKey);
    expect(id1).toBe(id2);
  });

  it("deriveDid is deterministic", async () => {
    const identity = await createAgentIdentity();
    const did1 = deriveDid(identity.publicKey);
    const did2 = deriveDid(identity.publicKey);
    expect(did1).toBe(did2);
  });

  it("different seeds produce different identities", async () => {
    const seed1 = new Uint8Array(32);
    seed1[0] = 1;
    const seed2 = new Uint8Array(32);
    seed2[0] = 2;

    const id1 = await deriveAgentIdentity(seed1);
    const id2 = await deriveAgentIdentity(seed2);

    expect(id1.agentId).not.toBe(id2.agentId);
    expect(id1.did).not.toBe(id2.did);
  });
});

describe("seed encryption", () => {
  const masterKey = "test-master-key-for-encryption-32b";

  it("encrypt/decrypt round-trip preserves seed", async () => {
    const identity = await createAgentIdentity();
    const orgId = "org-123";

    const encrypted = encryptSeed(identity.seed, orgId, masterKey);
    const decrypted = decryptSeed(encrypted, orgId, masterKey);

    expect(decrypted).toEqual(identity.seed);
  });

  it("decrypted seed derives same identity", async () => {
    const identity = await createAgentIdentity();
    const orgId = "org-456";

    const encrypted = encryptSeed(identity.seed, orgId, masterKey);
    const decrypted = decryptSeed(encrypted, orgId, masterKey);
    const recovered = await deriveAgentIdentity(decrypted);

    expect(recovered.agentId).toBe(identity.agentId);
    expect(recovered.did).toBe(identity.did);
  });

  it("different orgs derive different ciphertext", async () => {
    const seed = new Uint8Array(32);
    seed[0] = 99;

    const encrypted1 = encryptSeed(seed, "org-A", masterKey);
    const encrypted2 = encryptSeed(seed, "org-B", masterKey);

    // Ciphertexts should differ (different nonces + different org keys)
    expect(Buffer.from(encrypted1).toString("hex")).not.toBe(
      Buffer.from(encrypted2).toString("hex"),
    );
  });

  it("wrong org key fails to decrypt", () => {
    const seed = new Uint8Array(32);
    seed[0] = 77;

    const encrypted = encryptSeed(seed, "org-X", masterKey);

    expect(() => decryptSeed(encrypted, "org-Y", masterKey)).toThrow();
  });
});

describe("narrowing invariant", () => {
  function makeSponsorEnvelope(
    actions: {
      actionName: string;
      dimensions: { name: string; kind: string; resolved: unknown }[];
      denied?: boolean;
    }[],
  ): ResolvedEnvelope {
    return {
      agentDid: "did:mesh:sponsor",
      actions: actions.map((a) => ({
        actionId: "action-id",
        actionName: a.actionName,
        denied: a.denied ?? false,
        denySource: a.denied ? "deny-policy" : null,
        dimensions: a.dimensions.map((d) => ({
          name: d.name,
          kind: d.kind as "numeric" | "rate" | "set" | "boolean" | "temporal",
          resolved: d.resolved,
          sources: [],
        })),
      })),
      policyVersion: 1,
      resolvedAt: new Date().toISOString(),
    };
  }

  it("numeric passes when agent value <= sponsor", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: "action-id",
        actionName: "purchase.initiate",
        dimensions: [{ name: "amount", kind: "numeric", max: 3000 }],
      },
    ];
    const envelope = makeSponsorEnvelope([
      {
        actionName: "purchase.initiate",
        dimensions: [{ name: "amount", kind: "numeric", resolved: 5000 }],
      },
    ]);

    const result = validateNarrowing(constraints, envelope);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("numeric fails when agent value > sponsor", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: "action-id",
        actionName: "purchase.initiate",
        dimensions: [{ name: "amount", kind: "numeric", max: 6000 }],
      },
    ];
    const envelope = makeSponsorEnvelope([
      {
        actionName: "purchase.initiate",
        dimensions: [{ name: "amount", kind: "numeric", resolved: 5000 }],
      },
    ]);

    const result = validateNarrowing(constraints, envelope);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.dimension).toBe("amount");
    expect(result.violations[0]!.type).toBe("numeric");
    expect(result.violations[0]!.message).toContain("6000");
    expect(result.violations[0]!.message).toContain("5000");
  });

  it("set passes when agent set is subset of sponsor", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: "action-id",
        actionName: "purchase.initiate",
        dimensions: [{ name: "categories", kind: "set", members: ["compute"] }],
      },
    ];
    const envelope = makeSponsorEnvelope([
      {
        actionName: "purchase.initiate",
        dimensions: [
          { name: "categories", kind: "set", resolved: ["compute", "storage"] },
        ],
      },
    ]);

    const result = validateNarrowing(constraints, envelope);
    expect(result.valid).toBe(true);
  });

  it("set fails when agent has extra members", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: "action-id",
        actionName: "purchase.initiate",
        dimensions: [
          { name: "categories", kind: "set", members: ["compute", "ml"] },
        ],
      },
    ];
    const envelope = makeSponsorEnvelope([
      {
        actionName: "purchase.initiate",
        dimensions: [
          { name: "categories", kind: "set", resolved: ["compute", "storage"] },
        ],
      },
    ]);

    const result = validateNarrowing(constraints, envelope);
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.message).toContain("ml");
  });

  it("boolean passes when agent keeps restriction", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: "action-id",
        actionName: "purchase.initiate",
        dimensions: [
          { name: "require_approval", kind: "boolean", value: true, restrictive: true },
        ],
      },
    ];
    const envelope = makeSponsorEnvelope([
      {
        actionName: "purchase.initiate",
        dimensions: [
          { name: "require_approval", kind: "boolean", resolved: true },
        ],
      },
    ]);

    const result = validateNarrowing(constraints, envelope);
    expect(result.valid).toBe(true);
  });

  it("boolean fails when agent relaxes restriction", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: "action-id",
        actionName: "purchase.initiate",
        dimensions: [
          { name: "require_approval", kind: "boolean", value: false, restrictive: true },
        ],
      },
    ];
    const envelope = makeSponsorEnvelope([
      {
        actionName: "purchase.initiate",
        dimensions: [
          { name: "require_approval", kind: "boolean", resolved: true },
        ],
      },
    ]);

    const result = validateNarrowing(constraints, envelope);
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.type).toBe("boolean");
  });

  it("temporal passes when agent expiry is earlier", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: "action-id",
        actionName: "purchase.initiate",
        dimensions: [
          { name: "expiry", kind: "temporal", expiry: "2025-06-30" },
        ],
      },
    ];
    const envelope = makeSponsorEnvelope([
      {
        actionName: "purchase.initiate",
        dimensions: [
          { name: "expiry", kind: "temporal", resolved: "2025-12-31" },
        ],
      },
    ]);

    const result = validateNarrowing(constraints, envelope);
    expect(result.valid).toBe(true);
  });

  it("temporal fails when agent expiry exceeds sponsor", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: "action-id",
        actionName: "purchase.initiate",
        dimensions: [
          { name: "expiry", kind: "temporal", expiry: "2025-12-31" },
        ],
      },
    ];
    const envelope = makeSponsorEnvelope([
      {
        actionName: "purchase.initiate",
        dimensions: [
          { name: "expiry", kind: "temporal", resolved: "2025-06-30" },
        ],
      },
    ]);

    const result = validateNarrowing(constraints, envelope);
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.type).toBe("temporal");
  });

  it("rate passes when agent rate <= sponsor", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: "action-id",
        actionName: "purchase.initiate",
        dimensions: [
          { name: "rate", kind: "rate", limit: 50, window: "1h" },
        ],
      },
    ];
    const envelope = makeSponsorEnvelope([
      {
        actionName: "purchase.initiate",
        dimensions: [{ name: "rate", kind: "rate", resolved: 100 }],
      },
    ]);

    const result = validateNarrowing(constraints, envelope);
    expect(result.valid).toBe(true);
  });

  it("rate fails when agent rate > sponsor", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: "action-id",
        actionName: "purchase.initiate",
        dimensions: [
          { name: "rate", kind: "rate", limit: 200, window: "1h" },
        ],
      },
    ];
    const envelope = makeSponsorEnvelope([
      {
        actionName: "purchase.initiate",
        dimensions: [{ name: "rate", kind: "rate", resolved: 100 }],
      },
    ]);

    const result = validateNarrowing(constraints, envelope);
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.type).toBe("rate");
  });

  it("rejects action not in sponsor envelope", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: "action-id",
        actionName: "agent.create",
        dimensions: [{ name: "amount", kind: "numeric", max: 100 }],
      },
    ];
    const envelope = makeSponsorEnvelope([
      {
        actionName: "purchase.initiate",
        dimensions: [{ name: "amount", kind: "numeric", resolved: 5000 }],
      },
    ]);

    const result = validateNarrowing(constraints, envelope);
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.message).toContain("agent.create");
  });

  it("rejects action that is denied for sponsor", () => {
    const constraints: PolicyConstraint[] = [
      {
        actionTypeId: "action-id",
        actionName: "purchase.initiate",
        dimensions: [{ name: "amount", kind: "numeric", max: 100 }],
      },
    ];
    const envelope = makeSponsorEnvelope([
      {
        actionName: "purchase.initiate",
        dimensions: [],
        denied: true,
      },
    ]);

    const result = validateNarrowing(constraints, envelope);
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.message).toContain("denied");
  });
});
