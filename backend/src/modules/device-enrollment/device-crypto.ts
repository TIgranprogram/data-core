import { createHash, randomBytes } from 'crypto';

/**
 * TZ-AUTH-303 — credential crypto for device invites and browser grants.
 *
 * Invariants:
 *   - plaintext secrets are NEVER persisted; only the SHA-256 hex digest is
 *     stored (unique) so a DB leak cannot replay a device credential.
 *   - `secretPrefix` is a short (12-char) display-only fragment of the RAW
 *     secret used to help an admin recognise an invite in a list without
 *     storing the plaintext. It is deliberately NOT usable for lookup
 *     (lookup always goes through the full hash) and reveals no more than
 *     a password-manager-style prefix.
 *   - `randomSecret(bytes)` enforces >= 24 bytes (192 bits) so callers
 *     cannot accidentally mint low-entropy tokens.
 */

export const MIN_SECRET_BYTES = 24;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function randomSecret(bytes: number): string {
  const n = Number.isInteger(bytes) && bytes >= MIN_SECRET_BYTES ? bytes : 32;
  return randomBytes(n).toString('base64url');
}

export function secretPrefix(secret: string, length = 12): string {
  return secret.slice(0, length);
}
