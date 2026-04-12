import { eq, inArray } from "drizzle-orm";
import type { CedarEngine } from "./cedar-wasm";
import type { DrizzleDB } from "./envelope";
import type { CheckRequest, CheckResponse } from "./types";
import { mapEngineToSdkCode } from "./errors";
import type { EngineErrorCode } from "./errors";
import { buildEntityStore } from "./entity-store";
import * as schema from "./schema";

// ---------------------------------------------------------------------------
// CedarEvaluator
// ---------------------------------------------------------------------------

/**
 * Wraps the Phase 1 `CedarEngine` WASM interface with:
 * - Policy loading from the database
 * - Entity hierarchy for `principal in Group` support
 * - Error code mapping (engine → SDK dual codes)
 * - Bundle hash computation for audit trails
 */
export class CedarEvaluator {
  private engine: CedarEngine;
  private currentVersion: number = -1;

  constructor(engine: CedarEngine) {
    this.engine = engine;
  }

  /**
   * Load all active policy versions' Cedar source into the WASM engine.
   * Also loads the entity store for group hierarchy support.
   */
  async loadPolicySet(db: DrizzleDB, orgId: string): Promise<void> {
    // 1. Get all policies with active versions for this org
    const policyRows = await db
      .select({
        policyId: schema.policies.id,
        activeVersionId: schema.policies.activeVersionId,
      })
      .from(schema.policies)
      .where(eq(schema.policies.orgId, orgId));

    const activeVersionIds = policyRows
      .map((p) => p.activeVersionId)
      .filter((id): id is string => id !== null);

    // 2. Load Cedar source from active versions
    let sources: string[] = [];
    if (activeVersionIds.length > 0) {
      const versions = await db
        .select({ cedarSource: schema.policyVersions.cedarSource })
        .from(schema.policyVersions)
        .where(inArray(schema.policyVersions.id, activeVersionIds));

      sources = versions.map((v) => v.cedarSource);
    }

    // 3. Load into WASM engine
    this.engine.loadPolicies(sources);

    // 4. Build and load entity store
    const entities = await buildEntityStore(db, orgId);
    this.engine.loadEntities(entities);

    // 5. Update current version from org
    const orgRows = await db
      .select({ policyVersion: schema.organizations.policyVersion })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId));

    this.currentVersion = orgRows[0]?.policyVersion ?? 0;
  }

  /**
   * Evaluate an authorization request.
   * Returns CheckResponse with dual error codes (engine + SDK).
   */
  check(request: CheckRequest): CheckResponse {
    const result = this.engine.check(request);

    if (result.decision === "Allow") {
      return result;
    }

    // Deny — enrich with error codes
    const engineCode: EngineErrorCode = result.engineCode === "ENGINE_ERROR"
      ? "ENGINE_ERROR"
      : "POLICY_DENIED";

    const { sdkCode } = mapEngineToSdkCode(engineCode);

    return {
      decision: "Deny",
      diagnostics: result.diagnostics,
      engineCode,
      sdkCode,
      details: result.details,
    };
  }

  /**
   * Get the bundle hash (SHA-256 of all loaded policy sources).
   */
  getBundleHash(): string {
    return this.engine.getBundleHash();
  }

  /**
   * Reload policies and entities if the org's policyVersion has changed.
   * Returns true if reloaded, false if already current.
   */
  async reload(db: DrizzleDB, orgId: string): Promise<boolean> {
    const orgRows = await db
      .select({ policyVersion: schema.organizations.policyVersion })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId));

    const dbVersion = orgRows[0]?.policyVersion ?? 0;

    if (dbVersion <= this.currentVersion) {
      return false;
    }

    await this.loadPolicySet(db, orgId);
    return true;
  }
}
