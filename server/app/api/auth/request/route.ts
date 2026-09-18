// POST /api/auth/request  { email, next? }  -> { ok: true }
//
// Sends a magic sign-in link. Always answers 200 with the same body, whether
// or not the address has an account: a different response for a known address
// turns this endpoint into a membership oracle.

import { createLoginToken } from "@/lib/auth";
import { body, handle, json, originFrom } from "@/lib/http";
import { sendMail, signInEmail } from "@/lib/mail";
import { clientIp, limitOrThrow } from "@/lib/rateLimit";
import { email as parseEmail, optStr } from "@/lib/validate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    const raw = await body<{ email?: unknown; next?: unknown }>(req);
    const email = parseEmail(raw.email);

    // Two limits, both needed. Per-address stops someone mailbombing one
    // person; per-IP stops one script walking a list of addresses.
    await limitOrThrow(`login:email:${email}`, 5, 15 * 60);
    await limitOrThrow(`login:ip:${clientIp(req)}`, 30, 60 * 60);

    // Only ever a path, never a full URL — an attacker-supplied `next` of
    // https://evil.example would turn our own sign-in mail into an open
    // redirect carrying a freshly minted session.
    const nextRaw = optStr(raw.next, "Next path", 300);
    const next = nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : null;

    const { token, minutes } = await createLoginToken(email, next);
    const url = `${originFrom(req)}/join/${token}`;

    await sendMail({ to: email, ...signInEmail(url, minutes) });

    return json({ ok: true });
  });
}
