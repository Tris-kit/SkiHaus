// POST /api/auth/register  { email, password, name? }
//   -> { ok: true, verificationRequired: true }   202
//
// Creates an account and emails a confirmation link. **Does not sign you in.**
// The account exists but cannot be used until the address is confirmed.
//
// WHY ENFORCE IT. An invite addressed to a specific person is matched on email
// (redeemInvite). If anyone could register any address, someone who knew both
// a housemate's address and that an invite was coming could register it first
// and take the seat. Requiring confirmation closes that: you can only hold an
// address you can actually read mail at.
//
// THE COST, STATED PLAINLY. This puts email back on the critical path.
// Registration is impossible when RESEND_API_KEY is unset — the link is
// logged to the server console instead, which is workable locally and
// awkward on Vercel (it lands in function logs). /api/health reports
// `mail: false` precisely so this is diagnosable.

import { createEmailToken, emailExists, setPassword, upsertUserByEmail } from "@/lib/auth";
import { badRequest, body, handle, json, originFrom } from "@/lib/http";
import { sendMail, verifyEmail } from "@/lib/mail";
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

    // Registration is allowed to reject a duplicate — "pick another email" is
    // unavoidable, and every signup form leaks it. The endpoints that must
    // NOT leak it are /login and /auth/request, and they don't.
    if (await emailExists(email)) {
      throw badRequest("There's already an account with that email. Try signing in.");
    }

    const user = await upsertUserByEmail(email, name);
    await setPassword(user.id, password);

    const { token, minutes } = await createEmailToken(email, "verify");
    await sendMail({
      to: email,
      ...verifyEmail(`${originFrom(req)}/join/${token}`, Math.round(minutes / 60)),
    });

    // 202, not 201: the account is created but deliberately not yet usable.
    return json({ ok: true, verificationRequired: true, email }, 202);
  });
}
