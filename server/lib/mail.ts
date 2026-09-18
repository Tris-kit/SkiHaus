// Transactional email via Resend, called with plain `fetch` rather than the
// SDK — one less dependency, and the API is three fields wide.
//
// When RESEND_API_KEY is unset, mail is logged to the server console instead of
// sent. That is the intended local-dev path: run `npm run server`, request a
// sign-in link, and copy the URL out of the terminal. `GET /api/health` reports
// `mail: false` so you can tell the difference from a production misconfig.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function isMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

type Mail = { to: string; subject: string; text: string; html?: string };

export async function sendMail({ to, subject, text, html }: Mail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM ?? "Ski House <onboarding@resend.dev>";

  if (!key) {
    console.log(
      `\n──────── mail (not sent — RESEND_API_KEY unset) ────────\n` +
        `To: ${to}\nSubject: ${subject}\n\n${text}\n` +
        `────────────────────────────────────────────────────────\n`,
    );
    return;
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject, text, html: html ?? undefined }),
  });

  if (!res.ok) {
    // Log and swallow. A failed send must not 500 the sign-in endpoint —
    // that would let an attacker probe which addresses exist by watching
    // status codes, and it strands the user with a scary error for something
    // they can just retry.
    console.error("[mail] send failed", res.status, await res.text().catch(() => ""));
  }
}

// --- templates --------------------------------------------------------------
//
// Plain text, no images, no tracking pixels. These land in an inbox next to a
// hundred marketing emails; the job is to be unmistakably the thing the person
// just asked for.

function shell(heading: string, bodyHtml: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f5f9ff;padding:32px 16px;color:#0b1b2b">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #dce7f5;border-radius:18px;padding:28px">
    <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1d6fe0">Ski House</div>
    <h1 style="font-size:20px;margin:12px 0 16px">${heading}</h1>
    ${bodyHtml}
  </div>
</div>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#1d6fe0;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:12px">${label}</a></p>
<p style="font-size:13px;color:#5b7185;word-break:break-all">Or paste this into your browser:<br>${url}</p>`;
}

export function signInEmail(url: string, minutes: number): Omit<Mail, "to"> {
  return {
    subject: "Your Ski House sign-in link",
    text: `Tap to sign in to Ski House:\n\n${url}\n\nThis link works once and expires in ${minutes} minutes.\nIf you didn't ask for it, you can ignore this email.`,
    html: shell(
      "Sign in to Ski House",
      button(url, "Sign in") +
        `<p style="font-size:13px;color:#5b7185">This link works once and expires in ${minutes} minutes. If you didn't ask for it, ignore this email.</p>`,
    ),
  };
}

export function inviteEmail(
  url: string,
  houseName: string,
  inviterName: string,
  role: string,
): Omit<Mail, "to"> {
  const asRole = role === "guest" ? "a guest" : role === "admin" ? "a manager" : "a member";
  return {
    subject: `${inviterName} invited you to ${houseName}`,
    text: `${inviterName} added you to ${houseName} as ${asRole}.\n\nOpen it here:\n\n${url}\n\nNo app download needed — it works in your browser.`,
    html: shell(
      `${inviterName} invited you to ${houseName}`,
      `<p style="margin:0;color:#5b7185">You've been added as ${asRole}.</p>` +
        button(url, "Open Ski House") +
        `<p style="font-size:13px;color:#5b7185">No app download needed — it works in your browser.</p>`,
    ),
  };
}

export function guestStayEmail(
  url: string,
  houseName: string,
  hostName: string,
  dates: string,
  feeLine: string,
): Omit<Mail, "to"> {
  return {
    subject: `Your stay at ${houseName}`,
    text: `${hostName} has you down for ${houseName}, ${dates}.\n${feeLine}\n\nEverything you need — address, house rules, the dinner plan — is here:\n\n${url}\n\nNo sign-in, no app.`,
    html: shell(
      `Your stay at ${houseName}`,
      `<p style="margin:0;color:#5b7185">${hostName} has you down for <strong style="color:#0b1b2b">${dates}</strong>.<br>${feeLine}</p>` +
        button(url, "View your stay") +
        `<p style="font-size:13px;color:#5b7185">No sign-in, no app — this link is yours.</p>`,
    ),
  };
}
