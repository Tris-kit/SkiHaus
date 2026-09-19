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
import { fakeVerify, hashPassword, needsRehash, verifyPassword } from "./password";
import { rowToHouse, rowToUser } from "./rows";
import type { Role, Session, User } from "./types";

export const SESSION_COOKIE = "sh_session";

const LOGIN_TOKEN_MINUTES = 20;
const VERIFY_TOKEN_MINUTES = 60 * 24; // a day — people confirm later, elsewhere
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

// --- passwords --------------------------------------------------------------
//
// Passwords sit alongside magic links rather than replacing them: an account
// may have a password, a verified email, both, or (briefly, at invite time)
// neither. See CONTEXT.md §6.

/**
 * Check an email and password. Returns the user, or null.
 *
 * Deliberately gives the same answer — and takes roughly the same time — for
 * "no such account", "account has no password" and "wrong password". Any
 * difference between those three is an oracle for which addresses are
 * registered.
 */
export type Authenticated = { user: User; emailVerified: boolean };

export async function authenticate(
  email: string,
  password: string,
): Promise<Authenticated | null> {
  const c = await db();
  const res = await c.execute({
    sql: "SELECT * FROM users WHERE email = ?",
    args: [email.toLowerCase()],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;

  if (!row || row.password_hash == null) {
    await fakeVerify();
    return null;
  }

  const stored = String(row.password_hash);
  if (!(await verifyPassword(password, stored))) return null;

  const user = rowToUser(row);
  const emailVerified = row.email_verified_at != null;

  // Opportunistic upgrade: if the stored hash predates a cost increase, we
  // have the plaintext right now and will never have a better moment.
  if (needsRehash(stored)) {
    try {
      await setPassword(user.id, password);
    } catch (e) {
      console.error("[auth] rehash failed", e);
    }
  }

  return { user, emailVerified };
}

export async function setPassword(userId: string, password: string): Promise<void> {
  const c = await db();
  await c.execute({
    sql: "UPDATE users SET password_hash = ? WHERE id = ?",
    args: [await hashPassword(password), userId],
  });
}

export async function hasPassword(userId: string): Promise<boolean> {
  const c = await db();
  const res = await c.execute({
    sql: "SELECT password_hash FROM users WHERE id = ?",
    args: [userId],
  });
  return res.rows[0]?.password_hash != null;
}

/**
 * Record that someone proved control of their address by following a link
 * we emailed them. Nothing enforces this yet — it exists so that tightening
 * invite redemption later doesn't need a backfill.
 */
export async function markEmailVerified(userId: string): Promise<void> {
  const c = await db();
  await c.execute({
    sql: "UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?",
    args: [Date.now(), userId],
  });
}

export async function emailExists(email: string): Promise<boolean> {
  const c = await db();
  const res = await c.execute({
    sql: "SELECT 1 FROM users WHERE email = ?",
    args: [email.toLowerCase()],
  });
  return res.rows.length > 0;
}

// --- magic links ------------------------------------------------------------

// 'signin' is retired — magic-link sign-in was removed in favour of
// email-first password auth. The value stays in the union because rows with
// that purpose may still exist in the database, and consumeEmailToken has to
// be able to describe what it found. Nothing mints them any more.
export type TokenPurpose = "signin" | "verify" | "reset";

/**
 * Mint a single-use emailed token. Returns the *raw* token for the email; only
 * its hash is stored, so a leaked database backup contains no working links.
 */
export async function createEmailToken(
  email: string,
  purpose: TokenPurpose,
  nextPath: string | null = null,
): Promise<{ token: string; minutes: number }> {
  const c = await db();
  const token = secretToken();
  const now = Date.now();
  // A verification link is often opened hours later, from a different device,
  // after the tab was closed. A reset link is a live credential and gets the
  // short window.
  const minutes = purpose === "verify" ? VERIFY_TOKEN_MINUTES : LOGIN_TOKEN_MINUTES;

  await c.execute({
    sql: `INSERT INTO login_tokens (token_hash, email, purpose, next_path, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      hashToken(token),
      email.toLowerCase(),
      purpose,
      nextPath,
      now,
      now + minutes * 60 * 1000,
    ],
  });

  return { token, minutes };
}

export type PeekedToken = { email: string; purpose: TokenPurpose; nextPath: string | null };

/**
 * Read a token without burning it.
 *
 * The reset page needs this: it has to render a "choose a new password" form
 * before it can know the new password, and consuming the token to draw a form
 * would mean the submit had nothing left to redeem.
 */
export async function peekEmailToken(token: string): Promise<PeekedToken | null> {
  const c = await db();
  const res = await c.execute({
    sql: `SELECT email, purpose, next_path FROM login_tokens
          WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
    args: [hashToken(token), Date.now()],
  });
  const row = res.rows[0];
  if (!row) return null;
  return {
    email: String(row.email),
    purpose: String(row.purpose) as TokenPurpose,
    nextPath: row.next_path == null ? null : String(row.next_path),
  };
}

/**
 * Burn an emailed token and return the account it belongs to.
 *
 * The UPDATE is the gate, not the SELECT: marking the row consumed with
 * `consumed_at IS NULL` in the WHERE clause means two clicks on the same link
 * race for one row and exactly one wins. Check-then-update would let a
 * forwarded email be redeemed twice.
 *
 * `purpose` is matched in the same statement, so a sign-in link can never be
 * spent as a password reset.
 */
export async function consumeEmailToken(
  token: string,
  purpose?: TokenPurpose,
): Promise<{ user: User; purpose: TokenPurpose; nextPath: string | null } | null> {
  const c = await db();
  const hash = hashToken(token);
  const now = Date.now();

  const claimed = await c.execute({
    sql: `UPDATE login_tokens SET consumed_at = ?
          WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
            AND (? IS NULL OR purpose = ?)`,
    args: [now, hash, now, purpose ?? null, purpose ?? null],
  });
  if (claimed.rowsAffected === 0) return null;

  const res = await c.execute({
    sql: "SELECT email, purpose, next_path FROM login_tokens WHERE token_hash = ?",
    args: [hash],
  });
  const row = res.rows[0];
  if (!row) return null;

  const user = await upsertUserByEmail(String(row.email));
  // Any of these arrived by email, so all of them prove control of the
  // address — including a reset, which is the point of resetting by email.
  await markEmailVerified(user.id);

  // Now that the address is proven, apply anything addressed to it. This is
  // what puts someone straight into a house when a manager invited them
  // before they had an account. Imported lazily to keep auth.ts and
  // invites.ts from importing each other.
  try {
    const { claimPendingInvites } = await import("./invites");
    await claimPendingInvites(user);
  } catch (e) {
    console.error("[auth] claiming invites failed", e);
  }

  return {
    user,
    purpose: String(row.purpose) as TokenPurpose,
    nextPath: row.next_path == null ? null : String(row.next_path),
  };
}

/**
 * Finish a password reset: set the new password and evict every existing
 * session.
 *
 * Total eviction is the difference between reset and change. Someone resets
 * because they think an account is compromised, or because they lost the
 * device it was signed in on — leaving those sessions alive would defeat the
 * exercise.
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
): Promise<User | null> {
  const claimed = await consumeEmailToken(token, "reset");
  if (!claimed) return null;

  await setPassword(claimed.user.id, newPassword);

  const c = await db();
  await c.execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [claimed.user.id] });
  // Any other outstanding reset or sign-in link is now stale too.
  await c.execute({
    sql: `UPDATE login_tokens SET consumed_at = ?
          WHERE email = ? AND consumed_at IS NULL`,
    args: [Date.now(), claimed.user.email],
  });

  return claimed.user;
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
