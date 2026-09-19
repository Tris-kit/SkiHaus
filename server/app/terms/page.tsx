// /terms — linked from the App Store listing. Short on purpose.

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms · SkiHaus" };

export default function TermsPage() {
  return (
    <main className="page">
      <div className="card">
        <div className="brand">SkiHaus</div>
        <h1>Terms</h1>
        <p className="faint">Last updated 18 September 2026</p>

        <h2>What this is</h2>
        <p>
          SkiHaus is a record-keeping tool for people sharing a seasonal lease. It tracks what
          was spent, what was decided, and who is staying when.
        </p>

        <h2>What it isn&apos;t</h2>
        <p>
          It is not a payment processor, an escrow service, a booking platform, or a party to
          your lease. Balances shown in the app are a convenience calculation from entries your
          house put in — they are not an invoice, and they are not legal or tax advice.
        </p>

        <h2>Your house&apos;s data</h2>
        <p>
          You own what you put in. Managers are responsible for what they record and for who they
          invite. Don&apos;t upload documents you don&apos;t have the right to share.
        </p>

        <h2>Availability</h2>
        <p>
          SkiHaus is provided as-is, with no warranty. We&apos;ll try to keep it up and keep
          your data intact, but keep your lease agreement somewhere else too.
        </p>

        <h2>Contact</h2>
        <p>
          <a href="mailto:skihaus@spwit.com">skihaus@spwit.com</a>
        </p>
      </div>
    </main>
  );
}
