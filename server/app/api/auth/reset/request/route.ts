// POST /api/auth/reset/request  { email }  -> { ok: true }
//
// Always 200 with the same body, whether or not an account exists. A "no such
// account" here would turn forgot-password into a free membership oracle for
// anyone curious about which of their housemates use the app.
//
// The email is only actually sent when there's an account to reset. Someone
// who typed the wrong address gets silence, which is the correct outcome —
// the alternative is mailing strangers about accounts they don't have.

import { createEmailToken, emailExists } from "@/lib/auth";
import { body, handle, json, originFrom } from "@/lib/http";
import { resetPasswordEmail, sendMail } from "@/lib/mail";
import { clientIp, limitOrThrow } from "@/lib/rateLimit";
import { email as parseEmail } from "@/lib/validate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    const raw = await body<{ email?: unknown }>(req);
    const email = parseEmail(raw.email);

    // Per-address so one person can't be mailbombed; per-IP so one script
    // can't walk a list.
    await limitOrThrow(`reset:email:${email}`, 5, 15 * 60);
    await limitOrThrow(`reset:ip:${clientIp(req)}`, 30, 60 * 60);

    if (await emailExists(email)) {
      const { token, minutes } = await createEmailToken(email, "reset");
      await sendMail({
        to: email,
        ...resetPasswordEmail(`${originFrom(req)}/reset/${token}`, minutes),
      });
    }

    return json({ ok: true });
  });
}
