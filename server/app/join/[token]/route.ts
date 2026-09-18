// GET /join/:token — the one URL every email in this app points at.
//
// It handles two kinds of token and decides which by trying them in order:
//
//   1. a magic sign-in token  → burn it, open a session, continue to `next`
//   2. an invite token        → if signed in, join the house; if not, send the
//                               person to /invite/:token to identify themselves
//
// WHY A ROUTE HANDLER, NOT A PAGE. Next 15 only allows cookies to be written
// from a Route Handler or a Server Action — a Server Component that calls
// cookies().set() throws at render. Since the whole job here is "set a session
// cookie and redirect", this is a handler, and the human-facing invite screen
// lives at /invite/:token.

import { NextResponse } from "next/server";
import { consumeLoginToken, createSession, currentUser, setSessionCookie } from "@/lib/auth";
import { previewInvite, redeemInvite } from "@/lib/invites";
import { originFrom } from "@/lib/http";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

export async function GET(req: Request, { params }: Params) {
  const { token } = await params;
  const origin = originFrom(req);

  try {
    // 1. A sign-in link.
    const login = await consumeLoginToken(token);
    if (login) {
      const sessionToken = await createSession(login.user.id, req.headers.get("user-agent"));
      // `next` was validated to be a relative path when the token was minted,
      // so this cannot be turned into an open redirect.
      const dest = login.nextPath ?? "/";
      return setSessionCookie(NextResponse.redirect(`${origin}${dest}`), sessionToken);
    }

    // 2. An invite link.
    const invite = await previewInvite(token);
    if (invite) {
      const user = await currentUser(req);
      if (!user) {
        // Not signed in — show them who invited them before asking for an
        // email address. A bare "enter your email" from an unexplained page is
        // how invites get ignored.
        return NextResponse.redirect(`${origin}/invite/${token}`);
      }
      const joined = await redeemInvite(token, user);
      return NextResponse.redirect(`${origin}/?house=${joined.houseId}`);
    }

    // 3. Neither — expired, already used, or nonsense. /invite renders the
    //    friendly version of that.
    return NextResponse.redirect(`${origin}/invite/${token}`);
  } catch (e) {
    console.error("[join] failed", e);
    return NextResponse.redirect(`${origin}/invite/${token}?error=1`);
  }
}
