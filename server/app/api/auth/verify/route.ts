// POST /api/auth/verify  { token }  -> { user, houses, sessionToken }
//
// Exchanges an email-confirmation token for a session. Sets the `sh_session`
// cookie for the web client AND returns `sessionToken` in the body for the
// native app, which has no cookie jar. Both name the same row in `sessions`.
//
// The browser never comes here — /join/<token> handles confirmation during
// navigation. This exists for the native app, where the person pastes the
// link because universal links aren't configured yet.
//
// Reset tokens are rejected: they belong to /reset, which has to collect a
// new password first. Redeeming one here would spend it for a bare session
// and leave the account still locked behind a forgotten password.

import { consumeEmailToken, createSession, sessionPayload, setSessionCookie } from "@/lib/auth";
import { body, handle, json, unauthorized } from "@/lib/http";
import { clientIp, limitOrThrow } from "@/lib/rateLimit";
import { str } from "@/lib/validate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    await limitOrThrow(`verify:ip:${clientIp(req)}`, 30, 15 * 60);

    const raw = await body<{ token?: unknown }>(req);
    const token = str(raw.token, "Token", { max: 200 });

    const consumed = await consumeEmailToken(token, "verify");
    if (!consumed) throw unauthorized("That link has expired or was already used.");

    const sessionToken = await createSession(consumed.user.id, req.headers.get("user-agent"));
    const session = await sessionPayload(consumed.user);

    return setSessionCookie(
      json({ ...session, sessionToken, next: consumed.nextPath }),
      sessionToken,
    );
  });
}
