// GET  /api/auth/reset?token=…            -> { valid, email }
// POST /api/auth/reset  { token, password } -> { user, houses, sessionToken }
//
// GET peeks without burning the token, so the reset page can render a form
// (and reject a dead link early) without spending the one redemption.
//
// POST sets the password, kills every existing session, invalidates any other
// outstanding link for that address, and signs the caller in on a fresh
// session.

import { consumeEmailToken, createSession, peekEmailToken, resetPasswordWithToken, sessionPayload, setSessionCookie } from "@/lib/auth";
import { badRequest, body, handle, json } from "@/lib/http";
import { clientIp, limitOrThrow } from "@/lib/rateLimit";
import { password as parsePassword, str } from "@/lib/validate";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handle(async () => {
    await limitOrThrow(`reset:peek:${clientIp(req)}`, 60, 15 * 60);

    const token = new URL(req.url).searchParams.get("token") ?? "";
    const peeked = token ? await peekEmailToken(token) : null;

    if (!peeked || peeked.purpose !== "reset") return json({ valid: false });
    return json({ valid: true, email: peeked.email });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await limitOrThrow(`reset:use:${clientIp(req)}`, 20, 15 * 60);

    const raw = await body<Record<string, unknown>>(req);
    const token = str(raw.token, "Token", { max: 200 });
    const password = parsePassword(raw.password);

    const user = await resetPasswordWithToken(token, password);
    if (!user) throw badRequest("That reset link has expired or was already used.");

    const sessionToken = await createSession(user.id, req.headers.get("user-agent"));
    const session = await sessionPayload(user);

    return setSessionCookie(json({ ...session, sessionToken }), sessionToken);
  });
}
