import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { SignJWT, jwtVerify, decodeJwt, importJWK } from "jose";
import type { JWTPayload, CryptoKey as JoseCryptoKey } from "jose";

/** Agent token claims embedded in the JWT payload. */
export interface AgentTokenClaims extends JWTPayload {
  sub: string;
  iss: string;
  iat: number;
  exp: number;
  agentId: string;
  spendingLimit: number;
  dailySpendLimit: number;
  categories: string[];
  approvedVendors: string[];
  authorityChain: string[];
}

/** PKCS8 DER prefix for wrapping a raw 32-byte Ed25519 seed. */
const ED25519_PKCS8_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex"
);

/**
 * Derives a 32-byte Ed25519 seed from a string, matching the sidecar's
 * `hashlib.sha256(seed.encode()).digest()` exactly.
 */
function deriveSeedBytes(seed: string): Uint8Array {
  return createHash("sha256").update(seed).digest();
}

/**
 * Derives a DID from raw public key bytes, matching the sidecar's logic:
 * SHA-256 of the raw public key bytes -> hex -> first 40 chars.
 */
function deriveDid(publicKeyBytes: Uint8Array): string {
  const hash = createHash("sha256").update(publicKeyBytes).digest("hex");
  return `did:mesh:${hash.slice(0, 40)}`;
}

/**
 * Imports raw Ed25519 public key bytes as a CryptoKey for jose verification.
 */
async function importEd25519PublicKey(
  publicKeyBytes: Uint8Array
): Promise<JoseCryptoKey | Uint8Array> {
  const x = Buffer.from(publicKeyBytes).toString("base64url");
  return importJWK({ kty: "OKP", crv: "Ed25519", x }, "EdDSA");
}

/**
 * Imports a raw 32-byte Ed25519 seed + public key as a CryptoKey for jose signing.
 */
async function importEd25519PrivateKey(
  seedBytes: Uint8Array,
  publicKeyBytes: Uint8Array
): Promise<JoseCryptoKey | Uint8Array> {
  const d = Buffer.from(seedBytes).toString("base64url");
  const x = Buffer.from(publicKeyBytes).toString("base64url");
  return importJWK({ kty: "OKP", crv: "Ed25519", x, d }, "EdDSA");
}

/**
 * Gets the raw Ed25519 public key bytes for a given seed string.
 *
 * Uses Node.js crypto to derive the keypair from the SHA-256 seed,
 * matching the sidecar's deterministic key derivation.
 */
export function getTestPublicKey(seed: string): Uint8Array {
  const seedBytes = deriveSeedBytes(seed);

  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seedBytes]),
    format: "der",
    type: "pkcs8",
  });

  const publicKey = createPublicKey(privateKey);
  const rawPublicKey = publicKey.export({ type: "spki", format: "der" });
  // SPKI for Ed25519 has a 12-byte header, raw key starts at offset 12
  return new Uint8Array((rawPublicKey as Buffer).subarray(12));
}

/**
 * Decodes and verifies a JWT using an Ed25519 public key.
 *
 * @param token - The raw JWT string
 * @param publicKeyBytes - Raw 32-byte Ed25519 public key
 * @returns The decoded agent token claims
 * @throws On invalid signature, expired token, or malformed JWT
 */
export async function decodeAndVerifyJWT(
  token: string,
  publicKeyBytes: Uint8Array
): Promise<AgentTokenClaims> {
  const key = await importEd25519PublicKey(publicKeyBytes);
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["EdDSA"],
  });
  return payload as AgentTokenClaims;
}

/**
 * Decodes a JWT payload without verifying the signature.
 * Used in the verification pipeline to extract the DID before
 * looking up the public key from the registry.
 */
export function decodeJWTUnsafe(token: string): AgentTokenClaims {
  return decodeJwt(token) as AgentTokenClaims;
}

/**
 * Creates a signed test JWT for use in unit tests.
 *
 * Key derivation matches the sidecar exactly:
 * SHA-256(seed) -> 32-byte Ed25519 seed -> deterministic keypair.
 *
 * @param claims - Partial claims to override defaults
 * @param seed - Seed string for deterministic key derivation
 */
export async function createTestToken(
  claims: Partial<AgentTokenClaims>,
  seed: string
): Promise<string> {
  const seedBytes = deriveSeedBytes(seed);
  const publicKeyBytes = getTestPublicKey(seed);
  const privateKey = await importEd25519PrivateKey(seedBytes, publicKeyBytes);

  const did = deriveDid(publicKeyBytes);
  const now = Math.floor(Date.now() / 1000);

  const defaultClaims: AgentTokenClaims = {
    sub: did,
    iss: "warranted-sidecar",
    iat: now,
    exp: now + 86400,
    agentId: "openclaw-agent-001",
    spendingLimit: 5000,
    dailySpendLimit: 10000,
    categories: ["compute"],
    approvedVendors: ["aws", "gcp", "azure"],
    authorityChain: ["did:mesh:cfo", "did:mesh:vp-eng", did],
  };

  const merged = { ...defaultClaims, ...claims };

  const token = await new SignJWT(merged as unknown as JWTPayload)
    .setProtectedHeader({ alg: "EdDSA" })
    .sign(privateKey as Parameters<SignJWT["sign"]>[0]);

  return token;
}

/**
 * Creates an expired test JWT for testing expiry checks.
 */
export async function createExpiredTestToken(seed: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return createTestToken(
    {
      iat: now - 7200,
      exp: now - 3600,
    },
    seed
  );
}
