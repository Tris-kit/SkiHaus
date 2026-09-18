// /invite/:token — the human-facing half of the invite flow.
//
// Says who invited you, to what, and as what, BEFORE asking for an email
// address. /join/:token bounces here whenever it needs the person to identify
// themselves, and renders the expired case too.

import { SignInForm } from "@/components/SignInForm";
import { previewInvite } from "@/lib/invites";
import type { Metadata } from "next";

export const runtime = "nodejs";
// The token is looked up live; a cached render would show a stale invite.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Join a house · Ski House" };

const ROLE_COPY: Record<string, string> = {
  admin: "a manager — you'll be able to record expenses, set guest fees and run votes",
  member: "a member — you'll see the ledger, vote on house decisions and claim nights",
  guest: "a guest — you'll see your stay, the house rules and the dinner plan",
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await previewInvite(token);

  if (!invite) {
    return (
      <main className="page">
        <div className="card">
          <div className="brand">Ski House</div>
          <h1>This link has expired</h1>
          <p className="dim">
            Invite links last 30 days, and personal ones work only once. Ask whoever sent it to
            issue a new one.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="card">
        <div className="brand">Ski House</div>
        <h1>
          {invite.inviterName} invited you to {invite.houseName}
        </h1>
        {invite.season && <p className="faint">{invite.season} season</p>}
        <p className="dim">You&apos;re joining as {ROLE_COPY[invite.role] ?? invite.role}.</p>

        <div style={{ marginTop: 24 }}>
          {/* After the emailed link is clicked, /join burns the login token and
              forwards here again — this time signed in, so the invite redeems. */}
          <SignInForm next={`/join/${token}`} presetEmail={invite.email} cta="Join the house" />
        </div>
      </div>
    </main>
  );
}
