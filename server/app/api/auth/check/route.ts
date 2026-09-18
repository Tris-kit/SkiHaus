// POST /api/auth/check  { email }
//   -> { exists, hasPassword, needsVerification }
//
// Powers the email-first sign-in: type an address, and the next screen is
// either "enter your password" or "pick a name and a password".
//
// THIS IS AN ACCOUNT-ENUMERATION ORACLE, DELIBERATELY. It answers "does this
// address have an account here?" to anyone who asks. Every other endpoint in
// this app is careful not to — /api/auth/login gives one message for every
// credential failure, /api/auth/reset/request always returns ok — and this one
// gives it away by design.
//
// That is the price of the flow, and it is the same price Google, Slack,
// Notion and Vercel all pay. What it leaks about a ski house is "this person
// has an account", which is not much. It is written down here so nobody later
// mistakes it for an oversight and the other endpoints don't get "fixed" to
// match.
//
// Mitigation is rate limiting, not secrecy: tight enough that nobody walks a
// list of addresses through it.

import { db } from "@/lib/db";
import { body, handle, json } from "@/lib/http";
import { clientIp, limitOrThrow } from "@/lib/rateLimit";
import { email as parseEmail } from "@/lib/validate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    // A person signs in a handful of times; a script enumerating a mailing
    // list needs thousands. 30 per 15 minutes is invisible to the first and
    // useless to the second.
    await limitOrThrow(`check:ip:${clientIp(req)}`, 30, 15 * 60);

    const raw = await body<{ email?: unknown }>(req);
    const email = parseEmail(raw.email);

    const c = await db();
    const res = await c.execute({
      sql: "SELECT password_hash, email_verified_at FROM users WHERE email = ?",
      args: [email],
    });
    const row = res.rows[0];

    if (!row) return json({ exists: false, hasPassword: false, needsVerification: false });

    return json({
      exists: true,
      hasPassword: row.password_hash != null,
      // Registered but never confirmed. The client sends them back to the
      // check-your-email panel rather than to a password box that is going
      // to 403.
      needsVerification: row.email_verified_at == null,
    });
  });
}
