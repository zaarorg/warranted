import { RegistryUnreachableError } from "./errors";

/** Agent identity record returned by the registry. */
export interface RegistryAgentRecord {
  did: string;
  publicKey: string;
  trustScore: number;
  lifecycleState: "active" | "suspended" | "revoked";
  owner: string;
  spendingLimit: number;
  approvedVendors: string[];
  categories: string[];
}

/** Interface for looking up agent identity in a registry. */
export interface RegistryClient {
  lookupAgent(did: string): Promise<RegistryAgentRecord | null>;
}

/**
 * Registry client that calls the governance sidecar's `/check_identity` endpoint.
 *
 * The current sidecar always returns the same agent. For the demo, this client
 * verifies the DID matches what the sidecar reports. A real registry would
 * look up agents by DID.
 */
export class SidecarRegistryClient implements RegistryClient {
  constructor(private readonly registryUrl: string) {}

  async lookupAgent(did: string): Promise<RegistryAgentRecord | null> {
    let response: Response;
    try {
      response = await fetch(`${this.registryUrl}/check_identity`);
    } catch {
      throw new RegistryUnreachableError({
        registryUrl: this.registryUrl,
      });
    }

    if (!response.ok) {
      throw new RegistryUnreachableError({
        registryUrl: this.registryUrl,
        status: response.status,
      });
    }

    const data = await response.json();

    // Verify the DID matches what the sidecar reports
    if (data.did !== did) {
      return null;
    }

    return {
      did: data.did,
      publicKey: data.public_key,
      trustScore: data.trust_score,
      lifecycleState: data.lifecycle_state,
      owner: data.agent_id,
      spendingLimit: data.spending_limit,
      approvedVendors: data.approved_vendors ?? [],
      categories: data.permitted_categories ?? data.categories ?? [],
    };
  }
}

/**
 * In-memory registry client for unit tests. Looks up agents from a provided map.
 */
export class MockRegistryClient implements RegistryClient {
  constructor(private readonly agents: Map<string, RegistryAgentRecord>) {}

  async lookupAgent(did: string): Promise<RegistryAgentRecord | null> {
    return this.agents.get(did) ?? null;
  }
}
