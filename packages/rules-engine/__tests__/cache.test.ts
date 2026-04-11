import { describe, it, expect } from "vitest";
import { NoOpEnvelopeCache } from "../src/cache";
import type { EnvelopeCache } from "../src/cache";
import type { ResolvedEnvelope } from "../src/types";

describe("envelope cache", () => {
  const mockEnvelope: ResolvedEnvelope = {
    agentDid: "did:mesh:test",
    actions: [],
    policyVersion: 1,
    resolvedAt: new Date().toISOString(),
  };

  it("NoOpEnvelopeCache.get() always returns null", () => {
    const cache: EnvelopeCache = new NoOpEnvelopeCache();
    cache.set("did:mesh:test", mockEnvelope);
    expect(cache.get("did:mesh:test")).toBeNull();
  });

  it("NoOpEnvelopeCache.set() is a no-op", () => {
    const cache = new NoOpEnvelopeCache();
    // Should not throw
    cache.set("did:mesh:test", mockEnvelope);
    expect(cache.get("did:mesh:test")).toBeNull();
  });

  it("NoOpEnvelopeCache.invalidate() is a no-op", () => {
    const cache = new NoOpEnvelopeCache();
    // Should not throw
    cache.invalidate("did:mesh:test");
  });

  it("NoOpEnvelopeCache.invalidateAll() is a no-op", () => {
    const cache = new NoOpEnvelopeCache();
    // Should not throw
    cache.invalidateAll();
  });

  it("NoOpEnvelopeCache implements EnvelopeCache interface", () => {
    const cache: EnvelopeCache = new NoOpEnvelopeCache();
    expect(typeof cache.get).toBe("function");
    expect(typeof cache.set).toBe("function");
    expect(typeof cache.invalidate).toBe("function");
    expect(typeof cache.invalidateAll).toBe("function");
  });
});
