// GET  /api/invites/:token -> { invite } | 404   (public preview — no session)
// POST /api/invites/:token -> { houseId, houseName, role }  (requires a session)
//
// Split into preview and accept so the client can show "Dave invited you to
// Cabin 12 as a member" *before* asking anyone to sign in. Being asked for
// your email by a page that won't say what it's for is how invites die.

import { requireUser } from "@/lib/auth";
import { handle, json, notFound } from "@/lib/http";
import { previewInvite, redeemInvite } from "@/lib/invites";
import { clientIp, limitOrThrow } from "@/lib/rateLimit";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { token } = await params;
    // The token is 256 bits so guessing is hopeless, but an unauthenticated
    // endpoint that hits the DB still gets a limiter.
    await limitOrThrow(`invite:peek:${clientIp(req)}`, 60, 15 * 60);

    const invite = await previewInvite(token);
    if (!invite) throw notFound("That invite link has expired or was already used.");

    // houseId is deliberately withheld from the preview: knowing an invite is
    // valid shouldn't hand over an id that other endpoints key off.
    return json({
      invite: {
        houseName: invite.houseName,
        season: invite.season,
        role: invite.role,
        email: invite.email,
        inviterName: invite.inviterName,
      },
    });
  });
}

export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const { token } = await params;
    const user = await requireUser(req);
    return json(await redeemInvite(token, user));
  });
}
