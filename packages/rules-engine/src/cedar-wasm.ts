import { isAuthorized } from "@cedar-policy/cedar-wasm/nodejs";
import type {
  AuthorizationCall,
  EntityJson,
  EntityUidJson,
} from "@cedar-policy/cedar-wasm/nodejs";
import { createHash } from "crypto";
import type { CedarEntity, CheckRequest, CheckResponse } from "./types";

// ---------------------------------------------------------------------------
// CedarEngine Interface
// ---------------------------------------------------------------------------

export interface CedarEngine {
  /** Load a policy set from Cedar source strings. */
  loadPolicies(sources: string[]): void;

  /** Load entity relationships for group hierarchy support. */
  loadEntities(entities: CedarEntity[]): void;

  /** Evaluate an authorization request. */
  check(request: CheckRequest): CheckResponse;

  /** Get the bundle hash (SHA-256 of all loaded policy sources). */
  getBundleHash(): string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseEntityUid(uid: string): EntityUidJson {
  const match = uid.match(/^(\w+)::"(.+)"$/);
  if (!match) {
    throw new Error(`Invalid entity UID format: ${uid}. Expected Type::"id".`);
  }
  return { type: match[1]!, id: match[2]! };
}

function toCedarEntities(entities: CedarEntity[]): EntityJson[] {
  return entities.map((e) => ({
    uid: parseEntityUid(e.uid),
    attrs: e.attrs as Record<string, never>,
    parents: e.parents.map((p) => parseEntityUid(p)),
  }));
}

// ---------------------------------------------------------------------------
// CedarEngine Implementation
// ---------------------------------------------------------------------------

class CedarEngineImpl implements CedarEngine {
  private policySources: string[] = [];
  private entities: EntityJson[] = [];

  loadPolicies(sources: string[]): void {
    this.policySources = sources;
  }

  loadEntities(entities: CedarEntity[]): void {
    this.entities = toCedarEntities(entities);
  }

  check(request: CheckRequest): CheckResponse {
    const call: AuthorizationCall = {
      principal: parseEntityUid(request.principal),
      action: parseEntityUid(request.action),
      resource: parseEntityUid(request.resource),
      context: request.context as Record<string, never>,
      policies: { staticPolicies: this.policySources.join("\n") },
      entities: this.entities,
    };

    const result = isAuthorized(call);

    if (result.type === "failure") {
      const errorMessages = result.errors.map((e) => e.message);
      return {
        decision: "Deny",
        diagnostics: errorMessages,
        engineCode: "ENGINE_ERROR",
        sdkCode: null,
        details: { errors: errorMessages },
      };
    }

    const response = result.response;
    const reasons = response.diagnostics.reason;
    const errors = response.diagnostics.errors.map((e) => e.error.message);

    return {
      decision: response.decision === "allow" ? "Allow" : "Deny",
      diagnostics: [...reasons, ...errors],
      engineCode: null,
      sdkCode: null,
      details: {},
    };
  }

  getBundleHash(): string {
    const sorted = [...this.policySources].sort();
    return createHash("sha256").update(sorted.join("\n")).digest("hex");
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the Cedar engine.
 * Uses the @cedar-policy/cedar-wasm npm package which handles WASM loading internally.
 */
export async function initCedar(): Promise<CedarEngine> {
  return new CedarEngineImpl();
}
