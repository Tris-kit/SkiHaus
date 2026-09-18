// GET  /api/auth/password              -> { hasPassword }
// POST /api/auth/password  { password, currentPassword? } -> { ok: true }
//
// Set or change your own password. Requires a session, so this is also the
// route someone takes after arriving by magic link: click the emailed link,
// then set a password and never need email again.
//
// `currentPassword` is required only if one is already set. An account that
// got in by magic link has none, and demanding a current password it doesn't
// have would lock it out of ever setting one.

import { createSession, hasPassword, requireUser, setPassword, setSessionCookie, sessionTokenFrom, authenticate } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/ids";
import { body, forbidden, handle, json } from "@/lib/http";
import { limitOrThrow } from "@/lib/rateLimit";
import { password as parsePassword, str } from "@/lib/validate";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    return json({ hasPassword: await hasPassword(user.id) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    await limitOrThrow(`setpw:${user.id}`, 10, 60 * 60);

    const raw = await body<Record<string, unknown>>(req);
    const next = parsePassword(raw.password);

    if (await hasPassword(user.id)) {
      const current = str(raw.currentPassword, "Current password", { max: 200 });
      // Only the credential matters here; the caller already holds a valid
      // session, so their verification state is not this endpoint's business.
      if (!(await authenticate(user.email, current))) {
        throw forbidden("That's not your current password.");
      }
    }

    await setPassword(user.id, next);

    // Changing a password should evict every other session — that is the
    // whole point of changing it after someone else has had your phone. The
    // caller's own session is spared so they aren't signed out mid-action.
    const c = await db();
    const keep = sessionTokenFrom(req);
    if (keep) {
      await c.execute({
        sql: "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
        args: [user.id, hashToken(keep)],
      });
      return json({ ok: true });
    }

    await c.execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [user.id] });
    const fresh = await createSession(user.id, req.headers.get("user-agent"));
    return setSessionCookie(json({ ok: true, sessionToken: fresh }), fresh);
  });
}
