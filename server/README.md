# server/

Next.js 15 (App Router) on Vercel. Three jobs in one deployment:

1. **The API** — `/api/*`, everything the app does.
2. **The public pages** — the invite flow, the guest page, privacy and terms.
   These are the only screens Next actually renders.
3. **Hosting the web app** — `scripts/build-web.mjs` exports the Expo bundle
   into `public/`, and `next.config.mjs` rewrites `/` → `/index.html`.

Four runtime dependencies: `next`, `react`, `react-dom`, `@libsql/client`. No
ORM, no zod, no auth library, no CSS framework.

## Local development

```bash
npm install
cp .env.example .env     # fill in Turso credentials
npm run dev              # localhost:3000
```

`/` will 404 until `npm run build:web` has populated `public/`. That's
expected — in dev, run the UI from `mobile/` with `npm run web` (`:8081`) and
let this serve the API.

Without `RESEND_API_KEY`, confirmation and reset links print to this terminal
instead of sending. `/api/health` reports `mail: false` so you can tell that apart from a
production misconfiguration.

```bash
npm run check            # tsc --noEmit
```

## Layout

```
app/
  api/                 route handlers — see the table in ../CLAUDE.md
  join/[token]/        route handler: burns a confirmation or invite token,
                       sets the cookie, redirects
  invite/[token]/      page: "Dave invited you to Cabin 12", + email form
  g/[token]/           page: a guest's no-login view of their stay
  privacy/  terms/     App Store requirements
  layout.tsx           wraps the Next-rendered pages only
  globals.css          design tokens — MIRRORS mobile/src/theme.ts
components/
  SignInForm.tsx       the only client component on this side
lib/
  db.ts                the entire schema, created lazily at runtime
  auth.ts              passwords, emailed tokens, sessions, cookies
  password.ts          scrypt hashing — parameters and format documented there
  guard.ts             requireMember / requireRole — THE authorisation layer
  guests.ts            guest stays + guestView(), the guest privacy boundary
  invites.ts           invite preview and redemption
  ledger.ts            expense allocation, balance computation
  polls.ts             tallying, quorum, closing
  money.ts             integer-cent maths — MIRRORS mobile/src/money.ts
  settle.ts            who-pays-whom — MIRRORS mobile/src/settle.ts
  types.ts             wire types — MIRRORS mobile/src/types.ts
  validate.ts          hand-rolled input validation
  collection.ts        factory for the four behaviourless lookup tables
  http.ts              json/error/handle helpers
  rateLimit.ts         DB-backed fixed window, fails open
  announce.ts          the notification feed
  ids.ts  rows.ts      token generation + shared row mappers
middleware.ts          CORS. The only place CORS is set.
scripts/
  build-web.mjs        exports the Expo web bundle into public/
  gen-icons.mjs        regenerates the icon set
pwa/                   manifest + icons, copied into public/ at build time
public/                GENERATED, gitignored
```

## Conventions

Every route handler follows the same shape:

```ts
export const runtime = "nodejs";

export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;          // Next 15: params is a Promise
    const ctx = await requireAdmin(req, houseId);
    const raw = await body<Record<string, unknown>>(req);
    const name = str(raw.name, "Name", { max: 80 });
    // ...
    return json({ ok: true }, 201);
  });
}
```

- `handle()` catches `HttpError` from the guards and validators and turns it
  into `{ error: string }` with the right status. Anything else is logged and
  reported as a generic 500.
- Guards come first. Always. See ../CLAUDE.md § "The authorisation rule".
- No `OPTIONS` export is needed — `middleware.ts` answers preflight.

## Smoke test

```bash
curl -s localhost:3000/api/health | jq
# {"ok":true,"service":"skihaus","storage":true,"mail":false}

# Request a link, then read the URL out of the `npm run dev` terminal.
curl -s -X POST localhost:3000/api/auth/request \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com"}'

# Open that /join/<token> URL in a browser to get a session cookie, or:
curl -s -X POST localhost:3000/api/auth/verify \
  -H 'content-type: application/json' \
  -d '{"token":"<token>"}' | jq

# Then use the returned sessionToken as a bearer.
curl -s localhost:3000/api/houses \
  -H 'authorization: Bearer <sessionToken>' | jq
```

## Database

Turso (libSQL/SQLite) via the Vercel integration. The schema is a list of
`CREATE TABLE IF NOT EXISTS` statements in `lib/db.ts`, run once per process
on first use — so `next build` never needs credentials and there is no
migration tool.

Adding a column to a table that already exists in production means appending
an `ALTER TABLE` to the `MIGRATIONS` array in that file. It will fail with
"duplicate column name" on every run after the first; that specific error is
swallowed, anything else re-throws.

## Environment

See `.env.example`. `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are required
for anything that touches data; `RESEND_API_KEY` and `MAIL_FROM` are required
to actually send mail; `NEXT_PUBLIC_BASE_URL` is optional and should be left
unset on Preview so links point at the branch URL.
