// /g/:token — a guest's whole view of the house. No account, no download, no
// paywall (CONTEXT.md §6). Possession of this URL is the credential.
//
// Everything rendered here comes from guestView(), which is the authorisation
// boundary. Do not query the database directly from this file: if a field
// isn't in GuestView, a guest isn't meant to see it.

import type { Metadata } from "next";
import { guestView } from "@/lib/guests";
import { formatMoney, parseDay } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your stay · Ski House",
  // A private capability link must never be indexed, and the OS share sheet
  // shouldn't produce a preview card with someone's dates in it.
  robots: { index: false, follow: false },
};

function longDate(iso: string): string {
  return new Date(parseDay(iso)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC", // days are stored as UTC midnight; see money.ts
  });
}

export default async function GuestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await guestView(token);

  if (!view) {
    return (
      <main className="page">
        <div className="card">
          <div className="brand">Ski House</div>
          <h1>This link isn&apos;t active</h1>
          <p className="dim">
            The stay may have been cancelled or the link replaced. Ask your host for a new one.
          </p>
        </div>
      </main>
    );
  }

  const { house, stay, hostName, documents, dinners } = view;
  const pending = stay.status === "pending";

  return (
    <main className="page">
      <div className="card">
        <div className="brand">Ski House</div>
        <h1>{house.name}</h1>
        <p className="faint" style={{ marginBottom: 20 }}>
          {[house.location, house.season].filter(Boolean).join(" · ")}
        </p>

        {pending && (
          <p
            className="pill warn"
            style={{ display: "block", padding: "10px 14px", marginBottom: 20 }}
          >
            Not confirmed yet — {hostName} has asked the house manager to approve this stay.
          </p>
        )}

        <div className="row">
          <span className="dim">Guest</span>
          <strong>
            {stay.guestName}
            {stay.partySize > 1 && ` +${stay.partySize - 1}`}
          </strong>
        </div>
        <div className="row">
          <span className="dim">Arrive</span>
          <strong>{longDate(stay.arriveOn)}</strong>
        </div>
        <div className="row">
          <span className="dim">Depart</span>
          <strong>{longDate(stay.departOn)}</strong>
        </div>
        <div className="row">
          <span className="dim">Nights</span>
          <strong className="num">{stay.nights}</strong>
        </div>
        <div className="row">
          <span className="dim">Your share</span>
          <strong className="num">
            {stay.feeCents > 0 ? formatMoney(stay.feeCents) : "—"}{" "}
            {stay.paidAt != null && <span className="pill ok">Paid</span>}
          </strong>
        </div>
        {stay.feeCents > 0 && stay.paidAt == null && (
          <p className="faint" style={{ marginTop: 12 }}>
            Settle up with {hostName} directly — Ski House only keeps the record.
          </p>
        )}

        {house.address && (
          <>
            <h2>Where</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{house.address}</p>
            <p>
              <a
                href={`https://maps.apple.com/?q=${encodeURIComponent(house.address)}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in Maps
              </a>
            </p>
          </>
        )}

        {dinners.length > 0 && (
          <>
            <h2>Dinner</h2>
            {dinners.map((d) => (
              <div className="row" key={d.day}>
                <span className="dim">{longDate(d.day)}</span>
                <span>
                  {d.kind === "in" ? "Cooking in" : (d.venueName ?? "TBD")}
                  {d.timeLocal && ` · ${d.timeLocal}`}
                </span>
              </div>
            ))}
          </>
        )}

        {documents.map((doc) => (
          <section key={doc.title}>
            <h2>{doc.title}</h2>
            {/* Rendered as pre-wrapped text, not parsed markdown. Adding a
                markdown parser would mean shipping an HTML sanitiser too, and
                house rules are a bulleted list, not a document format. */}
            {doc.bodyMd && (
              <p style={{ whiteSpace: "pre-wrap" }} className="dim">
                {doc.bodyMd}
              </p>
            )}
            {doc.url && (
              <p>
                <a href={doc.url} target="_blank" rel="noreferrer">
                  Open document
                </a>
              </p>
            )}
          </section>
        ))}

        {stay.note && (
          <>
            <h2>Note from {hostName}</h2>
            <p className="dim" style={{ whiteSpace: "pre-wrap" }}>
              {stay.note}
            </p>
          </>
        )}

        <p className="faint" style={{ marginTop: 32 }}>
          This page is yours — bookmark it. Nothing to download, nothing to sign up for.
        </p>
      </div>
    </main>
  );
}
