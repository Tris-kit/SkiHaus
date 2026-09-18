// POST /api/auth/login  { email, password }
//   -> { user, houses, sessionToken }
//
// One failure message for every reason — wrong password, no such account, an
// account that only ever used a magic link. `authenticate()` also equalises
// the timing. Anything more specific tells a stranger which of your
// housemates have accounts.

import { authenticate, createSession, sessionPayload, setSessionCookie } from "@/lib/auth";
import { body, handle, json, unauthorized } from "@/lib/http";
import { clientIp, limitOrThrow } from "@/lib/rateLimit";
import { email as parseEmail, str } from "@/lib/validate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    const raw = await body<Record<string, unknown>>(req);
    const email = parseEmail(raw.email);
    // Not validated against the password rules: the rules may have changed
    // since this password was set, and rejecting a *correct* password for
    // being too short would be absurd.
    const password = str(raw.password, "Password", { max: 200 });

    // Per-account first, so one person being attacked can't be masked by a
    // botnet spreading attempts across IPs; per-IP second, to blunt spraying
    // across many accounts.
    await limitOrThrow(`login:acct:${email}`, 10, 15 * 60);
    await limitOrThrow(`login:ip:${clientIp(req)}`, 50, 15 * 60);

    const user = await authenticate(email, password);
    if (!user) throw unauthorized("That email and password don't match.");

    const sessionToken = await createSession(user.id, req.headers.get("user-agent"));
    const session = await sessionPayload(user);

    return setSessionCookie(json({ ...session, sessionToken }), sessionToken);
  });
}
