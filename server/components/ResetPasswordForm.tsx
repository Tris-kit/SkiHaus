"use client";

import { useState } from "react";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Checked here purely so the mismatch is caught before a round trip — the
  // server never sees a confirmation field, because it has nothing to
  // validate it against.
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length >= 8 && password === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || state === "saving") return;
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        setState("done");
        // Straight into the app — POST /api/auth/reset already set the
        // session cookie, so there is nothing further to sign in with.
        window.location.href = "/";
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? "That didn't work. Try again.");
      setState("error");
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
      setState("error");
    }
  }

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

  return (
    <form onSubmit={submit}>
      <label htmlFor="pw" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-dim)" }}>
        New password
      </label>
      <input
        id="pw"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="At least 8 characters"
        style={{ ...input, marginTop: 6 }}
      />

      <label htmlFor="pw2" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-dim)" }}>
        Again, to be sure
      </label>
      <input
        id="pw2"
        type="password"
        required
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        style={{
          ...input,
          marginTop: 6,
          borderColor: mismatch ? "var(--danger)" : "var(--border)",
        }}
      />

      {mismatch && (
        <p className="faint" style={{ color: "var(--danger)", marginTop: -4 }}>
          These don&apos;t match.
        </p>
      )}
      {error && (
        <p className="faint" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <button className="btn" type="submit" disabled={!ready || state === "saving"} style={{ width: "100%" }}>
        {state === "saving" ? "Saving…" : "Set password and sign in"}
      </button>

      <p className="faint" style={{ marginTop: 16 }}>
        This signs you out everywhere else.
      </p>
    </form>
  );
}
