import type { ResolvedEnvelope } from "./types";

// ---------------------------------------------------------------------------
// Envelope Cache Interface
// ---------------------------------------------------------------------------

export interface CachedEnvelopeEntry {
  envelope: ResolvedEnvelope;
  policyVersion: number;
  cachedAt: number;
}

export interface EnvelopeCache {
  get(agentDid: string): CachedEnvelopeEntry | null;
  set(agentDid: string, envelope: ResolvedEnvelope): void;
  invalidate(agentDid: string): void;
  invalidateAll(): void;
}

// ---------------------------------------------------------------------------
// No-Op Implementation
// ---------------------------------------------------------------------------

/**
 * Default no-op cache. Always returns null, forcing fresh envelope resolution
 * on every request. Sufficient for demo/early-stage usage.
 */
export class NoOpEnvelopeCache implements EnvelopeCache {
  get(_agentDid: string): CachedEnvelopeEntry | null {
    return null;
  }
  set(_agentDid: string, _envelope: ResolvedEnvelope): void {}
  invalidate(_agentDid: string): void {}
  invalidateAll(): void {}
}
