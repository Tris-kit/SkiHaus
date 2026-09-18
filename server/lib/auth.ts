// Passwordless auth: email magic link in, session token out.
//
// WHY NO PASSWORDS. The hard product constraint is that a member or a guest can
// get in from a link in their inbox with no download and no signup form (see
// CONTEXT.md §6). Passwords would add a reset flow, a strength meter, a
// breach-response obligation, and one more reason for someone's dad to give up
// before seeing the ledger. A magic link is the whole account system.
//
// Two credential shapes reach this module:
//   - web  → the `sh_session` cookie (HttpOnly, SameSite=Lax)
//   - app  → `Authorization: Bearer <token>`, because a native WebView-free
//            client has nowhere good to keep a cookie
// Both resolve to the same row in `sessions`.

import { NextResponse } from "next/server";
import { db } from "./db";
import { hashToken, secretToken, shortId } from "./ids";
import { unauthorized } from "./http";
import { rowToHouse, rowToUser } from "./rows";
import type { Role, Session, User } from "./types";

export const SESSION_COOKIE = "sh_session";

const LOGIN_TOKEN_MINUTES = 20;
const SESSION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// --- users ------------------------------------------------------------------

/**
 * Find or create the account for an email. Called on every magic-link
 * consumption and on invite acceptance, so "sign up" and "sign in" are the same
 * code path — there is no separate registration.
 */
export async function upsertUserByEmail(email: string, name = ""): Promise<User> {
  const c = await db();
  const lower = email.toLowerCase();

  const existing = await c.execute({
    sql: "SELECT * FROM users WHERE email = ?",
    args: [lower],
  });
  if (existing.rows[0]) {
    const user = rowToUser(existing.rows[0] as Record<string, unknown>);
    // Fill in a name we didn't have before, but never overwrite one the person
    // set themselves with a name an inviter typed for them.
    if (name && !user.name) {
      await c.execute({ sql: "UPDATE users SET name = ? WHERE id = ?", args: [name, user.id] });
      user.name = name;
    }
    return user;
  }

  const id = shortId(12);
  await c.execute({
    sql: "INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)",
    args: [id, lower, name, Date.now()],
  });
  return { id, email: lower, name, avatarEmoji: null, avatarColor: null };
}

export async function getUser(id: string): Promise<User | null> {
  const c = await db();
  const res = await c.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  const row = res.rows[0];
  return row ? rowToUser(row as Record<string, unknown>) : null;
}

// --- magic links ------------------------------------------------------------

/**
 * Mint a single-use sign-in token. Returns the *raw* token for the email; only
 * its hash is stored.
 */
export async function createLoginToken(
  email: string,
  nextPath: string | null,
): Promise<{ token: string; minutes: number }> {
  const c = await db();
  const token = secretToken();
  const now = Date.now();

  await c.execute({
    sql: `INSERT INTO login_tokens (token_hash, email, next_path, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      hashToken(token),
      email.toLowerCase(),
      nextPath,
      now,
      now + LOGIN_TOKEN_MINUTES * 60 * 1000,
    ],
  });

  return { token, minutes: LOGIN_TOKEN_MINUTES };
}

/**
 * Burn a sign-in token and return the account it belongs to.
 *
 * The UPDATE is the gate, not the SELECT: marking the row consumed with
 * `consumed_at IS NULL` in the WHERE clause means two clicks on the same link
 * race for one row, and exactly one wins. Checking-then-updating would let a
 * forwarded email be redeemed twice.
 */
export async function consumeLoginToken(
  token: string,
): Promise<{ user: User; nextPath: string | null } | null> {
  const c = await db();
  const hash = hashToken(token);
  const now = Date.now();

  const claimed = await c.execute({
    sql: `UPDATE login_tokens SET consumed_at = ?
          WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
    args: [now, hash, now],
  });
  if (claimed.rowsAffected === 0) return null;

  const res = await c.execute({
    sql: "SELECT email, next_path FROM login_tokens WHERE token_hash = ?",
    args: [hash],
  });
  const row = res.rows[0];
  if (!row) return null;

  const user = await upsertUserByEmail(String(row.email));
  return { user, nextPath: row.next_path == null ? null : String(row.next_path) };
}

// --- sessions ---------------------------------------------------------------

export async function createSession(userId: string, userAgent?: string | null): Promise<string> {
  const c = await db();
  const token = secretToken();
  const now = Date.now();

  await c.execute({
    sql: `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      hashToken(token),
      userId,
      now,
      now + SESSION_DAYS * DAY_MS,
      now,
      (userAgent ?? "").slice(0, 200),
    ],
  });

  return token;
}

export async function destroySession(token: string): Promise<void> {
  const c = await db();
  await c.execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [hashToken(token)] });
}

/** Read a cookie off a plain `Request` — works in route handlers and pages. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function bearerFrom(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

export function sessionTokenFrom(req: Request): string | null {
  return bearerFrom(req) ?? readCookie(req, SESSION_COOKIE);
}

/** Resolve a session token to its user, or null. Expired sessions are swept. */
export async function userForToken(token: string): Promise<User | null> {
  const c = await db();
  const hash = hashToken(token);
  const now = Date.now();

  const res = await c.execute({
    sql: "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
    args: [hash],
  });
  const row = res.rows[0];
  if (!row) return null;

  if (Number(row.expires_at) < now) {
    await c.execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [hash] });
    return null;
  }

  // Sliding expiry, but only written once the session is past halfway. Touching
  // the row on every request would mean a write per API call for no benefit.
  const halfway = now + (SESSION_DAYS / 2) * DAY_MS;
  if (Number(row.expires_at) < halfway) {
    await c.execute({
      sql: "UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?",
      args: [now + SESSION_DAYS * DAY_MS, now, hash],
    });
  }

  return getUser(String(row.user_id));
}

/** The signed-in user, or null. */
export async function currentUser(req: Request): Promise<User | null> {
  const token = sessionTokenFrom(req);
  return token ? userForToken(token) : null;
}

/** The signed-in user, or a 401. */
export async function requireUser(req: Request): Promise<User> {
  const user = await currentUser(req);
  if (!user) throw unauthorized();
  return user;
}

// --- cookie plumbing --------------------------------------------------------

export function setSessionCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    // Lax, not Strict: the whole point is that you arrive by clicking a link in
    // your email client, which is a cross-site navigation. Strict would drop
    // the cookie on exactly the flow this app is built around.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return res;
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}

// --- memberships ------------------------------------------------------------

export type MembershipRow = { houseId: string; role: Role; shareBps: number };

export async function membershipsFor(userId: string): Promise<MembershipRow[]> {
  const c = await db();
  const res = await c.execute({
    sql: `SELECT house_id, role, share_bps FROM memberships
          WHERE user_id = ? AND status = 'active'`,
    args: [userId],
  });
  return res.rows.map((r) => ({
    houseId: String(r.house_id),
    role: String(r.role) as Role,
    shareBps: Number(r.share_bps),
  }));
}

/**
 * The `Session` payload: who you are and which houses you're in. Returned by
 * both /api/auth/verify and /api/auth/session so the client only ever has to
 * understand one shape.
 */
export async function sessionPayload(user: User): Promise<Session> {
  const c = await db();
  const res = await c.execute({
    sql: `SELECT h.*, m.role, m.share_bps FROM memberships m
          JOIN houses h ON h.id = m.house_id
          WHERE m.user_id = ? AND m.status = 'active' AND h.archived_at IS NULL
          ORDER BY m.joined_at`,
    args: [user.id],
  });

  const houses = res.rows.map((r) => ({
    house: rowToHouse(r as Record<string, unknown>),
    role: String(r.role) as Role,
    shareBps: Number(r.share_bps),
  }));

  return { user, houses };
}
