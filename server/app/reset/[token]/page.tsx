// /reset/:token — choose a new password.
//
// A page rather than a route handler, because unlike /join this one has to
// collect something from the user before it can do anything. The token is
// peeked (not consumed) to render, so a dead link says so immediately instead
// of after someone has typed a password twice.

import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { peekEmailToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset your password · SkiHaus",
  // A live credential sits in this URL. Keep it out of search indexes and out
  // of link previews.
  robots: { index: false, follow: false },
};

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const peeked = await peekEmailToken(token);
  const valid = peeked !== null && peeked.purpose === "reset";

  return (
    <main className="page">
      <div className="card">
        <div className="brand">SkiHaus</div>

        {valid ? (
          <>
            <h1>Choose a new password</h1>
            <p className="dim">
              For <strong>{peeked.email}</strong>.
            </p>
            <div style={{ marginTop: 24 }}>
              <ResetPasswordForm token={token} />
            </div>
          </>
        ) : (
          <>
            <h1>This link has expired</h1>
            <p className="dim">
              Reset links work once and last 20 minutes. Ask for a new one from the sign-in
              screen and it&apos;ll be in your inbox shortly.
            </p>
            <p style={{ marginTop: 24 }}>
              <a className="btn" href="/">
                Back to sign in
              </a>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
