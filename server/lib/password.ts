// Password hashing with scrypt.
//
// WHY SCRYPT. It is in Node core, so this costs zero dependencies — the same
// discipline as the rest of server/. bcrypt and argon2 are native modules,
// which is a build-time liability on serverless. scrypt is memory-hard and
// OWASP-approved for password storage; the parameters below are their
// recommended floor (N=2^14, r=8, p=1 → ~16 MB and ~50-100 ms per hash).
//
// NEVER compare hashes with ===. Use verify(), which is constant-time.
//
// The stored format carries its own parameters:
//
//   scrypt$16384$8$1$<salt base64url>$<key base64url>
//
// so raising the cost later doesn't invalidate existing passwords — old rows
// keep verifying against the parameters they were written with, and
// needsRehash() tells you which ones to upgrade on next successful login.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;
// Node's default maxmem (32 MB) is uncomfortably close to 128*N*r = 16 MB.
// Set it explicitly so a future parameter bump fails loudly here rather than
// intermittently at runtime.
const MAXMEM = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 8;
// Bounded so nobody can pin a serverless function by posting a 10 MB
// "password" and making us scrypt it.
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Unicode-normalise before hashing. Without this, a password typed with a
 * composed é on one keyboard and a decomposed é on another produces different
 * bytes and the login silently fails.
 */
function normalize(password: string): Buffer {
  return Buffer.from(password.normalize("NFKC"), "utf8");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(normalize(password), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Refuse to honour absurd parameters read back from the database — a
  // tampered row must not be able to turn a login into a denial of service.
  if (n > 1 << 20 || r > 32 || p > 16) return false;

  const expected = Buffer.from(parts[5], "base64url");
  if (expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await scrypt(normalize(password), Buffer.from(parts[4], "base64url"), expected.length, {
      N: n,
      r,
      p,
      maxmem: MAXMEM,
    });
  } catch {
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** True when a stored hash uses weaker parameters than we now write. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return Number(parts[1]) < N || Number(parts[2]) < R || Number(parts[3]) < P;
}

/**
 * Burn roughly the time a real verification would, for an email that has no
 * account. Without this, "no such user" returns in 1 ms while a wrong password
 * takes 80 ms, and the difference is a reliable oracle for which of your
 * housemates' addresses are registered.
 */
export async function fakeVerify(): Promise<void> {
  try {
    await scrypt(normalize("timing-equalisation"), randomBytes(SALT_BYTES), KEYLEN, {
      N,
      r: R,
      p: P,
      maxmem: MAXMEM,
    });
  } catch {
    // Never let the dummy hash surface as an error.
  }
}
