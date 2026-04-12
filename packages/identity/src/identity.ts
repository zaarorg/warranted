import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import * as ed from "@noble/ed25519";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  // Convert to BigInt
  let num = 0n;
  for (const b of bytes) {
    num = num * 256n + BigInt(b);
  }

  // Encode
  let encoded = "";
  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }

  // Leading zeros
  for (const b of bytes) {
    if (b === 0) {
      encoded = "1" + encoded;
    } else {
      break;
    }
  }

  return encoded || "1";
}

export interface AgentIdentity {
  agentId: string;
  publicKey: Uint8Array;
  seed: Uint8Array;
  did: string;
}

/**
 * Generate a new agent identity from a random 32-byte seed.
 */
export async function createAgentIdentity(): Promise<AgentIdentity> {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  return deriveAgentIdentity(seed);
}

/**
 * Derive an agent identity from an existing 32-byte seed.
 * Deterministic: same seed always produces the same identity.
 */
export async function deriveAgentIdentity(seed: Uint8Array): Promise<AgentIdentity> {
  const publicKey = await ed.getPublicKeyAsync(seed);
  const agentId = deriveAgentId(publicKey);
  const did = deriveDid(publicKey);
  return { agentId, publicKey, seed, did };
}

/**
 * Derive agent ID from public key: "agent_<base58(sha256(pubkey)[0:20])>"
 */
export function deriveAgentId(publicKey: Uint8Array): string {
  const hash = sha256(publicKey);
  const truncated = hash.slice(0, 20);
  return "agent_" + base58Encode(truncated);
}

/**
 * Derive DID from public key.
 * Matches sidecar derivation: "did:mesh:<sha256(pubkey).hex[:40]>"
 */
export function deriveDid(publicKey: Uint8Array): string {
  const hash = sha256(publicKey);
  const hex = bytesToHex(hash);
  return `did:mesh:${hex.slice(0, 40)}`;
}
