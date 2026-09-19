"use client";

// Email-first auth, inline on the invite page.
//
// Same three steps as the app's sign-in screen: type an address, we look it
// up, then you either enter your password or pick a name and create one. The
// invite is redeemed immediately afterwards, so one pass through this form
// takes someone from a link in a group text to being in the house.
//
// Mirrors mobile/src/screens/SignInScreen.tsx. Keep the two in step.

import { useState } from "react";

type Step = "email" | "password" | "create" | "verify";

const input: React.CSSProperties = {
  width: "100%",
  fontSize: 16, // < 16px makes iOS Safari zoom on focus
  padding: "12px 14px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--surface)",
  color: "var(--text)",
  marginBottom: 12,
};

const label: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-dim)",
  marginBottom: 6,
};

export function SignInForm({
  inviteToken,
  presetEmail,
}: {
  /** Redeemed automatically once the person is signed in. */
  inviteToken: string;
  /** Locks the field when the invite is addressed to one person. */
  presetEmail?: string | null;
}) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(presetEmail ?? "");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function api(path: string, payload: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong.");
    return data;
  }

  /** Redeem the invite, then hand off to the app. */
  async function joinAndGo() {
    await api(`/api/invites/${inviteToken}`, {});
    window.location.href = "/";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      if (step === "email") {
        const r = (await api("/api/auth/check", { email })) as {
          exists: boolean;
          hasPassword: boolean;
          needsVerification: boolean;
        };
        if (r.needsVerification) setStep("verify");
        // An account with no password predates password auth. Sending them
        // through "create" lets them set one; the server accepts it because
        // there is no current password to check against.
        else if (r.exists && r.hasPassword) setStep("password");
        else if (r.exists) setStep("create");
        else setStep("create");
      } else if (step === "password") {
        await api("/api/auth/login", { email, password });
        await joinAndGo();
      } else if (step === "create") {
        // inviteToken rides along so the confirmation link comes back to
        // /join/<invite> and drops them straight into the house.
        await api("/api/auth/register", { email, password, name, inviteToken });
        setStep("verify");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "verify") {
    return (
      <div>
        <p style={{ fontWeight: 600 }}>Confirm your email</p>
        <p className="dim">
          We sent a link to <strong>{email}</strong>. Tap it and you&apos;ll land straight in the
          house — this invite is waiting for you.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="email" style={label}>
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        value={email}
        // A personal invite is locked to the address it was sent to; editing
        // it here would only produce an account that then bounces off the
        // email check in redeemInvite().
        readOnly={Boolean(presetEmail) || step !== "email"}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        autoComplete="email"
        style={{
          ...input,
          background: presetEmail || step !== "email" ? "var(--surface-alt)" : "var(--surface)",
        }}
      />

      {step === "create" && (
        <>
          <label htmlFor="name" style={label}>
            Your name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tristan"
            autoComplete="name"
            style={input}
          />
        </>
      )}

      {step !== "email" && (
        <>
          <label htmlFor="pw" style={label}>
            {step === "create" ? "Choose a password" : "Password"}
          </label>
          <input
            id="pw"
            type="password"
            required
            minLength={step === "create" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={step === "create" ? "At least 8 characters" : ""}
            autoComplete={step === "create" ? "new-password" : "current-password"}
            style={input}
            autoFocus
          />
        </>
      )}

      {error && (
        <p className="faint" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <button className="btn" type="submit" disabled={busy} style={{ width: "100%" }}>
        {busy
          ? "…"
          : step === "email"
            ? "Continue"
            : step === "create"
              ? "Create account"
              : "Sign in and join"}
      </button>

      {step === "password" && (
        <p className="faint" style={{ marginTop: 12 }}>
          <a href="/">Forgot your password?</a>
        </p>
      )}
    </form>
  );
}
