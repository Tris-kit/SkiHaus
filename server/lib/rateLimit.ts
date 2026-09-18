// Fixed-window per-key rate limiter backed by the `rate_limits` table.
//
// It FAILS OPEN: if the database is unreachable the request is allowed. This is
// a safeguard against accidental hammering and email-bombing, not a security
// control — treating it as a hard dependency would mean a DB blip takes the
// whole app down.

import { db } from "./db";
import { HttpError } from "./http";

export type LimitResult = { ok: boolean; remaining: number; resetSeconds: number };

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function rateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<LimitResult> {
  const now = Date.now();
  const expiresAt = now + windowSeconds * 1000;

  try {
    const c = await db();
    // Reset the window in the same statement that increments, so two concurrent
    // requests at the boundary can't both see a stale row and both reset it.
    await c.execute({
      sql: `INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)
            ON CONFLICT(key) DO UPDATE SET
              count = CASE WHEN rate_limits.expires_at < ? THEN 1 ELSE rate_limits.count + 1 END,
              expires_at = CASE WHEN rate_limits.expires_at < ? THEN ? ELSE rate_limits.expires_at END`,
      args: [key, expiresAt, now, now, expiresAt],
    });

    const res = await c.execute({
      sql: "SELECT count, expires_at FROM rate_limits WHERE key = ?",
      args: [key],
    });
    const row = res.rows[0];
    if (!row) return { ok: true, remaining: max - 1, resetSeconds: windowSeconds };

    const count = Number(row.count);
    const resetSeconds = Math.max(0, Math.ceil((Number(row.expires_at) - now) / 1000));
    return { ok: count <= max, remaining: Math.max(0, max - count), resetSeconds };
  } catch (e) {
    console.error("[rateLimit] failing open:", e);
    return { ok: true, remaining: max, resetSeconds: 0 };
  }
}

/** Rate-limit or throw a 429. */
export async function limitOrThrow(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<void> {
  const r = await rateLimit(key, max, windowSeconds);
  if (!r.ok) {
    throw new HttpError(429, `Too many requests. Try again in ${r.resetSeconds}s.`);
  }
}
