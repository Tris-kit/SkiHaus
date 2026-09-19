// /privacy — required for the App Store listing, and linked from the guest
// page. Keep it accurate: every claim here is checkable against lib/db.ts.

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy · SkiHaus" };

export default function PrivacyPage() {
  return (
    <main className="page">
      <div className="card">
        <div className="brand">SkiHaus</div>
        <h1>Privacy</h1>
        <p className="faint">Last updated 18 September 2026</p>

        <h2>What we store</h2>
        <p>
          Your email address, your name if you give one, and the contents of the houses you
          belong to: expenses, payments you record, votes you cast, guest stays, documents you
          upload, and the nights you claim.
        </p>

        <h2>What we don&apos;t</h2>
        <p>
          No passwords — sign-in is a one-time emailed link. No payment card details; SkiHaus
          records who owes what and never moves money. No location tracking, no advertising
          identifiers, no third-party analytics.
        </p>

        <h2>Who can see it</h2>
        <p>
          Only people in the same house, and only as much as their role allows. Managers see
          everything in their house. Members see the ledger and the roster. Guests see their own
          stay and any document explicitly shared with guests.
        </p>
        <p>
          Guest links contain a random secret and are not indexed by search engines. Anyone you
          forward one to can see that stay, so treat it like a door code.
        </p>

        <h2>Sub-processors</h2>
        <p>
          Hosting and database: Vercel and Turso. Transactional email: Resend. That is the whole
          list.
        </p>

        <h2>Deleting your data</h2>
        <p>
          A house manager can remove you from a house at any time. To delete your account and
          everything attached to it, email the address below and we&apos;ll do it within 30 days.
        </p>

        <h2>Contact</h2>
        <p>
          <a href="mailto:skihaus@spwit.com">skihaus@spwit.com</a>
        </p>
      </div>
    </main>
  );
}
