// POST /api/auth/verify  { token }  -> { user, houses, sessionToken }
//
// Exchanges a magic-link token for a session. Sets the `sh_session` cookie for
// the web client AND returns `sessionToken` in the body for the native app,
// which has no cookie jar. Both name the same row in `sessions`.
//
// The browser flow normally goes through the /join/<token> page instead; this
// endpoint exists for the native app, which opens the link, extracts the token
// and posts it here.

import { consumeLoginToken, createSession, sessionPayload, setSessionCookie } from "@/lib/auth";
import { body, handle, json, unauthorized } from "@/lib/http";
import { clientIp, limitOrThrow } from "@/lib/rateLimit";
import { str } from "@/lib/validate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    await limitOrThrow(`verify:ip:${clientIp(req)}`, 30, 15 * 60);

    const raw = await body<{ token?: unknown }>(req);
    const token = str(raw.token, "Token", { max: 200 });

    const consumed = await consumeLoginToken(token);
    if (!consumed) throw unauthorized("That sign-in link has expired or was already used.");

    const sessionToken = await createSession(consumed.user.id, req.headers.get("user-agent"));
    const session = await sessionPayload(consumed.user);

    return setSessionCookie(
      json({ ...session, sessionToken, next: consumed.nextPath }),
      sessionToken,
    );
  });
}
