// POST /api/auth/register  { email, password, name? }
//   -> { user, houses, sessionToken }   201
//
// Creates an account and signs it in. Registration is open, exactly as the
// magic-link path already was — anyone who can request a sign-in link can
// create an account, so requiring an invite here would add friction without
// adding a boundary. What actually gates access is house membership, and that
// still only comes from an invite.
//
// NOTE ON UNVERIFIED EMAIL. An account made this way has no proof it controls
// the address. An invite addressed to a specific person is matched on email
// (redeemInvite), so in principle someone who knew both a housemate's address
// and that an invite was coming could register it first and take the seat.
// Accepted for now: it needs a targeted attacker who already knows both facts,
// against a twelve-person ski house. `email_verified_at` is recorded when a
// magic link is used, so tightening redemption to verified addresses later is
// a one-line change and needs no backfill.

import { createSession, emailExists, sessionPayload, setPassword, setSessionCookie, upsertUserByEmail } from "@/lib/auth";
import { badRequest, body, handle, json } from "@/lib/http";
import { clientIp, limitOrThrow } from "@/lib/rateLimit";
import { email as parseEmail, optStr, password as parsePassword } from "@/lib/validate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    await limitOrThrow(`register:ip:${clientIp(req)}`, 10, 60 * 60);

    const raw = await body<Record<string, unknown>>(req);
    const email = parseEmail(raw.email);
    const password = parsePassword(raw.password);
    const name = optStr(raw.name, "Name", 80) ?? "";

    // Unlike the sign-in endpoints, this one may say the address is taken:
    // "pick another email" is unavoidable information, and every signup form
    // on the internet leaks it. The endpoints that *aren't* allowed to leak it
    // are /login and /auth/request, and they don't.
    if (await emailExists(email)) {
      throw badRequest("There's already an account with that email. Try signing in.");
    }

    const user = await upsertUserByEmail(email, name);
    await setPassword(user.id, password);

    const sessionToken = await createSession(user.id, req.headers.get("user-agent"));
    const session = await sessionPayload(user);

    return setSessionCookie(json({ ...session, sessionToken }, 201), sessionToken);
  });
}
