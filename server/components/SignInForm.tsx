"use client";

// The only interactive widget on the Next side. Everything else here is
// server-rendered — this needs client state purely to swap the form for a
// "check your inbox" confirmation without a round trip.

import { useState } from "react";

export function SignInForm({
  next,
  presetEmail,
  cta = "Email me a link",
}: {
  /** Where /join should send them after the link is clicked. */
  next: string;
  /** Locks the field when the invite is addressed to one person. */
  presetEmail?: string | null;
  cta?: string;
}) {
  const [email, setEmail] = useState(presetEmail ?? "");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, next }),
      });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div>
        <p style={{ fontWeight: 600 }}>Check your email.</p>
        <p className="dim">
          We sent a link to <strong>{email}</strong>. It works once and expires in 20 minutes.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <input
        type="email"
        required
        value={email}
        // A personal invite is locked to the address it was sent to; letting
        // someone edit it here would only produce a link that then bounces off
        // the email check in redeemInvite().
        readOnly={Boolean(presetEmail)}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        autoComplete="email"
        style={{
          width: "100%",
          fontSize: 16, // < 16px makes iOS Safari zoom on focus
          padding: "12px 14px",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          background: presetEmail ? "var(--surface-alt)" : "var(--surface)",
          color: "var(--text)",
          marginBottom: 12,
        }}
      />
      <button className="btn" type="submit" disabled={state === "sending"} style={{ width: "100%" }}>
        {state === "sending" ? "Sending…" : cta}
      </button>
      {state === "error" && (
        <p className="dim" style={{ marginTop: 12, color: "var(--danger)" }}>
          That didn&apos;t go through. Try again in a moment.
        </p>
      )}
      <p className="faint" style={{ marginTop: 16 }}>
        No password, no app download. The link signs you in.
      </p>
    </form>
  );
}
