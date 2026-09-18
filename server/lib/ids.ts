import { createHash, randomBytes, timingSafeEqual } from "crypto";

// No `l`, `o`, `1` or `0`: these ids get read aloud and typed by hand.
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";

/** Short, URL-safe, unguessable id (houses, expenses, polls, …). */
export function shortId(len = 10): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/**
 * A secret handed out in a URL or an email — session cookies, magic links,
 * invite links, guest links. 32 bytes of entropy, base64url so it stays short.
 */
export function secretToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Secrets are stored hashed, never in plaintext. A leaked database backup then
 * hands over no live sessions and no working invite links.
 *
 * SHA-256 with no salt and no stretching is correct *here* and would be wrong
 * for a password: these tokens are 256 random bits, so there is no dictionary
 * to attack and nothing for a slow hash to buy.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time compare for anything secret. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
