// POST /api/auth/logout -> { ok: true }
//
// Deletes the session row and clears the cookie. Always 200, even with no
// session — "sign me out" should never fail.

import { clearSessionCookie, destroySession, sessionTokenFrom } from "@/lib/auth";
import { handle, json } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    const token = sessionTokenFrom(req);
    if (token) await destroySession(token);
    return clearSessionCookie(json({ ok: true }));
  });
}
