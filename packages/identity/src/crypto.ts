import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const INFO = "warranted-agent-seeds-v1";
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Derive a per-org AES-256 encryption key via HKDF.
 */
function deriveOrgKey(masterKey: string, orgId: string): Uint8Array {
  const masterKeyBytes = new TextEncoder().encode(masterKey);
  const orgIdBytes = new TextEncoder().encode(orgId);
  return hkdf(sha256, masterKeyBytes, orgIdBytes, INFO, 32);
}

/**
 * Encrypt a 32-byte seed for storage using per-org HKDF-derived key.
 * Returns AES-256-GCM ciphertext with 12-byte nonce prepended.
 */
export function encryptSeed(
  seed: Uint8Array,
  orgId: string,
  masterKey: string,
): Uint8Array {
  const key = deriveOrgKey(masterKey, orgId);
  const nonce = randomBytes(NONCE_LENGTH);

  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(seed), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Layout: [nonce (12)] [ciphertext (32)] [tag (16)]
  const result = new Uint8Array(NONCE_LENGTH + encrypted.length + TAG_LENGTH);
  result.set(nonce, 0);
  result.set(encrypted, NONCE_LENGTH);
  result.set(tag, NONCE_LENGTH + encrypted.length);
  return result;
}

/**
 * Decrypt a stored seed.
 * Input format: [nonce (12)] [ciphertext] [tag (16)]
 */
export function decryptSeed(
  encrypted: Uint8Array,
  orgId: string,
  masterKey: string,
): Uint8Array {
  const key = deriveOrgKey(masterKey, orgId);
  const nonce = encrypted.slice(0, NONCE_LENGTH);
  const tag = encrypted.slice(encrypted.length - TAG_LENGTH);
  const ciphertext = encrypted.slice(NONCE_LENGTH, encrypted.length - TAG_LENGTH);

  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return new Uint8Array(decrypted);
}
