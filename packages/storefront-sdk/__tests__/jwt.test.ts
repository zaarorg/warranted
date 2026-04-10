import { describe, it, expect } from "vitest";
import {
  createTestToken,
  createExpiredTestToken,
  decodeAndVerifyJWT,
  decodeJWTUnsafe,
  getTestPublicKey,
} from "../src/jwt";

const TEST_SEED = "test-seed-123";
const DIFFERENT_SEED = "different-seed-456";
const KNOWN_DID = "did:mesh:8ae56e6f93037f8ab8adefd7ee076e66bc3c98c6";

describe("getTestPublicKey", () => {
  it("returns a 32-byte Uint8Array", () => {
    const key = getTestPublicKey(TEST_SEED);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it("is deterministic — same seed produces same key", () => {
    const key1 = getTestPublicKey(TEST_SEED);
    const key2 = getTestPublicKey(TEST_SEED);
    expect(Buffer.from(key1).toString("hex")).toBe(
      Buffer.from(key2).toString("hex")
    );
  });

  it("different seed produces different key", () => {
    const key1 = getTestPublicKey(TEST_SEED);
    const key2 = getTestPublicKey(DIFFERENT_SEED);
    expect(Buffer.from(key1).toString("hex")).not.toBe(
      Buffer.from(key2).toString("hex")
    );
  });

  it("matches sidecar DID derivation for test-seed-123", () => {
    const pubKey = getTestPublicKey(TEST_SEED);
    const { createHash } = require("node:crypto");
    const hash = createHash("sha256").update(pubKey).digest("hex");
    const did = `did:mesh:${hash.slice(0, 40)}`;
    expect(did).toBe(KNOWN_DID);
  });
});

describe("createTestToken", () => {
  it("produces a valid JWT string (three dot-separated parts)", async () => {
    const token = await createTestToken({}, TEST_SEED);
    expect(token.split(".")).toHaveLength(3);
  });

  it("includes default claims when no overrides provided", async () => {
    const token = await createTestToken({}, TEST_SEED);
    const claims = decodeJWTUnsafe(token);

    expect(claims.sub).toBe(KNOWN_DID);
    expect(claims.iss).toBe("warranted-sidecar");
    expect(claims.agentId).toBe("openclaw-agent-001");
    expect(claims.spendingLimit).toBe(5000);
    expect(claims.categories).toContain("compute");
    expect(claims.approvedVendors).toContain("aws");
    expect(claims.authorityChain).toHaveLength(3);
    expect(typeof claims.iat).toBe("number");
    expect(typeof claims.exp).toBe("number");
  });

  it("applies custom claims overrides", async () => {
    const token = await createTestToken(
      {
        spendingLimit: 10000,
        categories: ["compute", "hardware"],
        agentId: "custom-agent",
      },
      TEST_SEED
    );
    const claims = decodeJWTUnsafe(token);

    expect(claims.spendingLimit).toBe(10000);
    expect(claims.categories).toEqual(["compute", "hardware"]);
    expect(claims.agentId).toBe("custom-agent");
    // Sub should still be derived from seed
    expect(claims.sub).toBe(KNOWN_DID);
  });

  it("allows overriding sub claim", async () => {
    const token = await createTestToken(
      { sub: "did:mesh:custom" },
      TEST_SEED
    );
    const claims = decodeJWTUnsafe(token);
    expect(claims.sub).toBe("did:mesh:custom");
  });

  it("is verifiable with getTestPublicKey for the same seed", async () => {
    const token = await createTestToken({}, TEST_SEED);
    const pubKey = getTestPublicKey(TEST_SEED);
    const claims = await decodeAndVerifyJWT(token, pubKey);
    expect(claims.sub).toBe(KNOWN_DID);
  });
});

describe("createExpiredTestToken", () => {
  it("creates a token with exp in the past", async () => {
    const token = await createExpiredTestToken(TEST_SEED);
    const claims = decodeJWTUnsafe(token);
    const now = Math.floor(Date.now() / 1000);
    expect(claims.exp).toBeLessThan(now);
  });
});

describe("decodeAndVerifyJWT", () => {
  it("returns claims for a valid token with correct key", async () => {
    const token = await createTestToken({}, TEST_SEED);
    const pubKey = getTestPublicKey(TEST_SEED);
    const claims = await decodeAndVerifyJWT(token, pubKey);

    expect(claims.sub).toBe(KNOWN_DID);
    expect(claims.iss).toBe("warranted-sidecar");
    expect(claims.spendingLimit).toBe(5000);
  });

  it("throws for valid token with wrong key", async () => {
    const token = await createTestToken({}, TEST_SEED);
    const wrongKey = getTestPublicKey(DIFFERENT_SEED);
    await expect(decodeAndVerifyJWT(token, wrongKey)).rejects.toThrow();
  });

  it("throws for expired token", async () => {
    const token = await createExpiredTestToken(TEST_SEED);
    const pubKey = getTestPublicKey(TEST_SEED);
    await expect(decodeAndVerifyJWT(token, pubKey)).rejects.toThrow();
  });

  it("throws for malformed string", async () => {
    const pubKey = getTestPublicKey(TEST_SEED);
    await expect(decodeAndVerifyJWT("not-a-jwt", pubKey)).rejects.toThrow();
  });

  it("throws for completely invalid base64", async () => {
    const pubKey = getTestPublicKey(TEST_SEED);
    await expect(
      decodeAndVerifyJWT("aaa.bbb.ccc", pubKey)
    ).rejects.toThrow();
  });
});

describe("decodeJWTUnsafe", () => {
  it("decodes claims without verifying signature", async () => {
    const token = await createTestToken({}, TEST_SEED);
    const claims = decodeJWTUnsafe(token);
    expect(claims.sub).toBe(KNOWN_DID);
    expect(claims.spendingLimit).toBe(5000);
  });

  it("throws for non-JWT string", () => {
    expect(() => decodeJWTUnsafe("not-a-jwt")).toThrow();
  });
});
