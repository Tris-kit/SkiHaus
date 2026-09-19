// POST /api/auth/login  { email, password }
//   -> { user, houses, sessionToken }
//   -> 403 { error, needsVerification: true } when the address isn't confirmed
//
// One failure message for every *credential* failure — wrong password, no such
// account, account with no password set. `authenticate()` also equalises the
// timing. Anything more specific tells a stranger which of your housemates
// have accounts.
//
// Unconfirmed email is the deliberate exception: it returns a distinct 403.
// That does confirm the address is registered, which is a real if small
// enumeration leak — but it only fires after someone has already supplied the
// correct password, and the alternative is a person with valid credentials
// staring at "wrong password" with no way to learn otherwise.

import { authenticate, createEmailToken, createSession, sessionPayload, setSessionCookie } from "@/lib/auth";
import { HttpError, body, handle, json, originFrom, unauthorized } from "@/lib/http";
import { claimPendingInvites } from "@/lib/invites";
import { sendMail, verifyEmail } from "@/lib/mail";
import { clientIp, limitOrThrow } from "@/lib/rateLimit";
import { email as parseEmail, str } from "@/lib/validate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    const raw = await body<Record<string, unknown>>(req);
    const email = parseEmail(raw.email);
    // Not checked against the password rules: those may have tightened since
    // this password was set, and rejecting a *correct* password for being too
    // short would be absurd.
    const password = str(raw.password, "Password", { max: 200 });

    // Per-account first, so a botnet spreading attempts across IPs can't mask
    // an attack on one person; per-IP second, to blunt spraying.
    await limitOrThrow(`login:acct:${email}`, 10, 15 * 60);
    await limitOrThrow(`login:ip:${clientIp(req)}`, 50, 15 * 60);

    const result = await authenticate(email, password);
    if (!result) throw unauthorized("That email and password don't match.");

    if (!result.emailVerified) {
      // Re-send on the spot. The original link is usually lost by now, and a
      // dead end here is a support request.
      const { token, minutes } = await createEmailToken(email, "verify");
      await sendMail({
        to: email,
        ...verifyEmail(`${originFrom(req)}/join/${token}`, Math.round(minutes / 60)),
      });
      throw new HttpError(403, "Confirm your email first — we've sent you a fresh link.");
    }

    // Pick up anything addressed to this (now proven) email since last time —
    // an invite sent while they were already a user, say. Cheap: one indexed
    // lookup that almost always returns nothing.
    await claimPendingInvites(result.user);

    const sessionToken = await createSession(result.user.id, req.headers.get("user-agent"));
    const session = await sessionPayload(result.user);

    return setSessionCookie(json({ ...session, sessionToken }), sessionToken);
  });
}
