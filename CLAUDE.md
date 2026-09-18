# Ski House

Ski-lease management. One manager, a roster of members, and guests who show up
for a weekend — sharing a ledger, a decision log, a fee schedule and a
calendar.

**Web-first.** Every feature works in a browser with no download and no
password. The iPhone app is the same codebase packaged for the App Store, not
a gate in front of the product. Don't propose anything that only works if the
app is installed. Product rationale: **[CONTEXT.md](CONTEXT.md)**.

## Layout

```
SkiHaus/
  mobile/   Expo app (iPhone + web export)   — see mobile/AGENTS.md
  server/   Next.js on Vercel: API, invite + guest pages, and hosts the web app
  photos/   App Store screenshots (6.5" + 6.9")
```

Each package installs independently (own `node_modules`, no workspace
hoisting). Root `package.json` only proxies scripts.

## Commands

```bash
npm --prefix mobile install && npm --prefix server install   # first time

npm run ios      # Expo app on iOS
npm run web      # Expo app in the browser (:8081)
npm run server   # Next.js at localhost:3000
npm run build    # Vercel build: export web app into server/public, then next build

npm run check    # typecheck both packages
npm run test     # the hand-rolled test scripts

cd server && node scripts/gen-icons.mjs   # regenerate the icon set
```

`*.test.ts` files are plain scripts run with `tsx` — they `console.log` each
check and `process.exit(1)` on failure. There is no test framework and no
linter config. There **is** CI (`.github/workflows/check.yml`), which runs
`check` and `test` on both packages; Split had none, and this is the one place
Ski House deliberately diverges from it.

## The one architectural idea

**The web app and the iPhone app are the same code.** `server/scripts/build-web.mjs`
runs `expo export -p web`, drops the bundle into `server/public/`, and
`next.config.mjs` rewrites `/` → `/index.html`. Next.js owns only:

- `/api/*`
- `/join/:token` and `/invite/:token` — the sign-in and invite flow
- `/g/:token` — a guest's no-login view of their stay
- `/privacy`, `/terms`

Everything else the user sees is React Native running through
`react-native-web`. If you add a screen, it goes in `mobile/src/screens/`, not
in `server/app/`.

## Auth and permissions

Two credential systems, on purpose.

**Accounts** (admins, members): email + password, or an email magic link.
Both land on the same account and neither is required — an account may have a
password, a verified email, or both. Nothing is ever gated on having a
password.

- `POST /api/auth/register` / `POST /api/auth/login` — the password path.
  Hashing is scrypt from Node core; `server/lib/password.ts` documents the
  parameters, the self-describing storage format, and why not bcrypt/argon2.
- `POST /api/auth/request` mails a link to `/join/:token`; that route handler
  burns the token, opens a session and redirects.
- `POST /api/auth/password` sets or changes one. `currentPassword` is required
  only if a password is already set — that's the route from "arrived by magic
  link" to "has a password", and demanding a current password it doesn't have
  would lock the account out of ever setting one.

Web holds an HttpOnly `sh_session` cookie; the native app holds a bearer token
in the Keychain. Both resolve to one row in `sessions` — see
`server/lib/auth.ts`.

**Capabilities** (guests): a guest stay mints a 256-bit token; `/g/:token` is a
public page showing that guest their dates, fee and the house rules. No
account, ever. This is Split's share-link model, scoped down.

Roles are `admin` > `member` > `guest`, set **per house** — the same person is
a manager of one lease and a guest of another. The full matrix is in
CONTEXT.md §4.

### The authorisation rule

> Every handler that touches house-scoped data starts with
> `requireMember(req, houseId)` or `requireRole(req, houseId, "admin")` from
> `server/lib/guard.ts`. There is no other path to a house's rows.

If you are writing `WHERE house_id = ?` without having gone through a guard
first, that is the bug. A non-member gets **404, not 403** — "you may not see
this house" and "this house does not exist" have to be indistinguishable or
the id space becomes enumerable.

`guestView()` in `server/lib/guests.ts` is the second boundary: it is the
*entire* definition of what a guest link exposes, since nothing downstream of
it checks anything. Adding a field there is a privacy decision.

## Invariants worth protecting

- **Money is integer cents.** `money.ts` uses largest-remainder allocation so
  per-person amounts always sum back to the exact total. Never introduce a
  float into a total; use `toCents`/`toDollars`. `money.test.ts` asserts the
  sum property directly.
- **A balance is never stored, only derived.** `computeLedger()` recomputes
  from `expenses`, `expense_shares` and `payments` every time. Caching a
  running total is how a spreadsheet ends up disagreeing with reality in March.
- **Expense allocation is materialised at write time.** `expense_shares` is
  written by `writeExpenseShares()` and frozen. Shares drift over a season —
  someone joins in January, someone drops to a half share — and December's
  heating bill must keep December's split. Any change to an expense's amount or
  split mode has to rewrite the shares.
- **Calendar days are `YYYY-MM-DD` strings parsed as UTC**, never timestamps.
  A ski day is a day. Parsing `"2027-01-15"` in local time makes it the 14th
  west of Greenwich, which mis-prices a Friday night as a weeknight.
- **Secrets are stored as SHA-256 hashes, never plaintext** — sessions, magic
  links, invites, guest links. A leaked backup hands over nothing live. Raw
  tokens are returned exactly once, at creation.
- **Soft-delete anything financial.** Expenses, payments and houses get
  `deleted_at`/`archived_at`. A season's ledger is the record of who paid what;
  one tap must not destroy it.
- **A house always has at least one admin.** Enforced in
  `members/[userId]/route.ts` on both demote and remove.

## server/ — Next.js 15 App Router, Turso (libSQL/SQLite)

Four runtime dependencies: `next`, `react`, `react-dom`, `@libsql/client`. No
ORM, no zod, no auth library, no UI library, no Tailwind. Keep it that way
unless there's a reason that survives a second look.

- **Schema:** all of it in `lib/db.ts`, created lazily via
  `CREATE TABLE IF NOT EXISTS` on first use, so `next build` never needs
  credentials. No migration tool. Additive column changes go in the
  `MIGRATIONS` array with the duplicate-column error swallowed.
- **Validation:** hand-rolled in `lib/validate.ts`. Error messages are written
  for a person — "Amount must be a positive number." not "expected number".
- **Errors:** guards `throw` `HttpError`; `handle()` catches and converts.
  Unexpected errors are logged server-side and reported as a generic 500 —
  a stack trace or a raw libSQL message must never reach the client.
- **CORS:** `middleware.ts` only. `lib/http.ts` deliberately does not set
  `Access-Control-*`. Because the web client uses a cookie,
  `Allow-Credentials` is true, so `Allow-Origin` echoes one exact origin and
  can never be `*`.
- **Rate limiting:** `lib/rateLimit.ts`, DB-backed fixed window, **fails
  open**. It's a safeguard against email-bombing, not a security control.
- **`lib/collection.ts`** is a factory for the four behaviourless lookup tables
  (categories, mountains, venues, guest rates). Anything with rules of its own
  is written longhand. Don't grow it into an ORM.

### Routes

| Route | Notes |
| --- | --- |
| `GET /api/health` | `{ ok, service, storage, mail }` — booleans only, never a configured value |
| `POST /api/auth/request` | Mails a magic link. Always 200, even for unknown addresses |
| `POST /api/auth/verify` | Native only — web goes through `/join/:token` |
| `GET\|PATCH /api/auth/session` | Current user + houses; profile edit |
| `GET\|POST /api/houses` | List mine / create (creator becomes admin, categories seeded) |
| `GET\|PATCH\|DELETE /api/houses/:id` | DELETE archives |
| `GET /api/houses/:id/members` | Roster. Emails redacted for guests |
| `PATCH\|DELETE .../members/:userId` | Admin. Last-admin guard |
| `GET\|POST .../invites` | Admin. Raw token returned once |
| `GET\|POST /api/invites/:token` | Public preview / authenticated accept |
| `GET\|POST .../expenses`, `.../expenses/:id` | Read: member. Write: admin |
| `GET .../balances` | Balances + settle-up instructions |
| `GET\|POST .../payments` | Members may only record a payment they *sent* |
| `GET\|POST .../guests`, `PATCH .../guests/:id` | Request → price → approve |
| `GET\|POST .../guest-rates`, `.../categories`, `.../mountains`, `.../venues` | Lookup tables |
| `GET\|POST .../polls`, `.../polls/:id`, `.../polls/:id/ballot` | Admin opens/closes, members vote |
| `GET\|POST .../stays`, `.../ski-days`, `.../dinners` | Logistics. Upserts |
| `GET\|POST .../documents`, `.../documents/:id` | Versioned, per-role visibility, acks |
| `GET\|POST\|PATCH .../announcements` | The v1 notification feed |

## mobile/ — Expo 54, RN 0.81, React 19, TypeScript strict

**Read `mobile/AGENTS.md` before touching native or config code.**

- **Navigation:** none. `App.tsx` is one `useState<Step>` machine. Adding a
  screen means adding a `Step`, a render branch, and a back target.
- **State:** none. `useLoad` in `src/hooks.ts` plus `useState`. If a screen
  needs more than that, the screen is doing too much — that isn't a signal to
  add a state library.
- **`src/theme.ts` holds every colour, space and radius. Never hard-code a
  colour.** Use `withAlpha(colors.x, a)` instead of a literal `rgba()`.
- **`src/ui.tsx` is the component kit.** New visual? Add a variant there, don't
  improvise in a screen.
- `Screen` centres a 460px column on a neutral backdrop, so the web build is a
  phone-width app rather than a stretched one.
- Native module calls are wrapped in try/catch with a "rebuild needed" path —
  the JS package can be present while the native module isn't linked into the
  installed build (see `src/storage.ts`).

## Cross-package rules

**Kept-in-sync duplicates — change both sides together:**

| mobile | server |
| --- | --- |
| `src/types.ts` | `lib/types.ts` |
| `src/money.ts` | `lib/money.ts` |
| `src/settle.ts` | `lib/settle.ts` |
| `src/theme.ts` (hex values) | `app/globals.css` (CSS variables) |

They're duplicated on purpose: the two packages don't share `node_modules`.
Drift in `money.ts` means the app shows one number and the server stores
another. Drift in the theme means the invite and guest pages — often someone's
first sight of the product — don't look like the app.

After touching `money.ts` or `settle.ts`, run `npm run test`.

## Deploying

Two branches, two Vercel environments.

- **`dev`** → auto-deploys to a stable branch URL. Safe to push to.
- **`main`** → production branch with "Auto-assign Custom Production Domains"
  **off**, so a push builds and *stages*. Publishing is a separate manual step
  (`npx vercel promote <url>`); rollback is promoting an older deployment.

`EXPO_PUBLIC_API_BASE` is inlined by Metro at build time, so which backend a
build talks to is fixed when it's built. `build-web.mjs` injects the branch URL
on preview deployments so the dev branch never ships a UI that calls
production.

Full runbook: **[RELEASING.md](RELEASING.md)**.

## Non-obvious decisions (don't "fix" these)

- **`/join/:token` is a Route Handler, not a page.** Next 15 only allows
  cookies to be written from a Route Handler or a Server Action; a Server
  Component calling `cookies().set()` throws at render. The human-facing invite
  screen is a separate page at `/invite/:token`.
- **The session cookie is `SameSite=Lax`, not `Strict`.** The entire flow is
  arriving by clicking a link in an email client, which is a cross-site
  navigation. Strict would drop the cookie on exactly the path the app is built
  around.
- **Approving a guest stay rotates its token.** Only the hash is stored, so
  there is no old link to re-send. The side effect is that approval
  invalidates any link that leaked while the stay was pending.
- **`consumeLoginToken` gates on the UPDATE, not a SELECT.** `WHERE
  consumed_at IS NULL` in the update means two clicks race for one row and
  exactly one wins. Check-then-update would let a forwarded email be redeemed
  twice.
- **Admins are not automatically eligible to vote.** They can read any poll in
  order to run it, but can only cast a ballot in one their role belongs to. A
  manager quietly voting in a members-only poll would undermine the mechanism.
- **A tie is not a decision.** `tally()` returns `winnerOptionId: null` on a
  tie rather than picking the first option.
- **Custom expense shares that don't sum to the total are rejected**, not
  auto-balanced. Silently absorbing a $3 discrepancy into one person's column
  is how people stop trusting the ledger.
- **Guest fees count as house income**, not as a credit to the member who
  hosted. Flagged as an open question in CONTEXT.md §10 — it's a product
  choice, not an accident.
- **`documents.body_md` is rendered as pre-wrapped plain text, not parsed
  markdown.** A parser means shipping an HTML sanitiser too, and house rules
  are a bulleted list, not a document format.
- **`fontVariant: ["tabular-nums"]`, not `fontVariantNumeric`.** The latter is
  the CSS name and does not exist in React Native's `TextStyle`.
- **`/api/auth/register` may say an email is taken; `/api/auth/login` and
  `/api/auth/request` may not.** Signup has to reject a duplicate address, and
  every signup form on the internet leaks that. The sign-in paths give one
  message for wrong-password, no-such-account and no-password-set, and
  `fakeVerify()` equalises the timing — otherwise they become an oracle for
  which of your housemates have accounts.
- **Changing a password evicts every *other* session, not the caller's.**
  Evicting all of them signs you out of the action you just took; evicting
  none defeats the reason people change passwords.
- **The lease list is the landing screen even with one lease.** Auto-opening
  the only lease saves a tap and costs the app its front door — there'd be
  nowhere to create a second one from.

## Known gaps (accurate as of the initial scaffold)

- **No domain yet.** `mobile/.env`, `mobile/eas.json` and
  `server/middleware.ts` all carry `REPLACE-…` placeholders that must be set
  before the first production build.
- **No `ascAppId`** — Ski House needs its own App Store Connect record. The
  Apple ID and team ID are shared with Split and are correct as written.
- **No `eas.extra.projectId`** — run `eas init` in `mobile/`.
- **No push notifications and no email digests.** The `announcements` and
  `push_tokens` tables exist; nothing writes to `push_tokens` yet
  (CONTEXT.md §8).
- **No photo upload.** `documents.url` takes an external link; there is no blob
  storage.
- **Native sign-in requires pasting the link.** Universal links aren't
  configured (`app.json` has an empty `associatedDomains`), so the native app
  shows a paste field. Configuring the domain removes that step.
- **The icon set is generated placeholder art** (`server/scripts/gen-icons.mjs`),
  not a designed brand.
- **`/` 404s in local dev** until `npm run build` has populated
  `server/public/`. Use `npm run web` for the app and `npm run server` for the
  API side by side instead.

## Environment notes

- **Metro hangs on Watchman on this machine.** There's a Watchman binary on
  PATH whose daemon is unreachable (`/opt/facebook/watchman/.../sock`,
  connection refused). Metro falls back to node fs watching when Watchman is
  *absent*, but blocks forever when it's present and broken — you get
  "Waiting for Watchman `watch-project` (10s)… (30s)…" and no bundle, at 0%
  CPU. Prefix any Metro command with `EXPO_USE_WATCHMAN=0`:

  ```bash
  EXPO_USE_WATCHMAN=0 npm run web
  EXPO_USE_WATCHMAN=0 npm run build
  ```

  `mobile/metro.config.js` reads that variable. CI and Vercel are unaffected —
  no Watchman binary there, so Metro takes the fallback by itself.
- Verifying the iOS app means a real build/run — there's no simulator
  screenshotting available from here.
- Without `TURSO_DATABASE_URL`, every API route that touches data throws. `npm
  run server` still boots and `/api/health` reports `storage: false`.
- Without `RESEND_API_KEY`, magic links are printed to the server console
  instead of emailed. That's the intended local-dev path — copy the URL out of
  the terminal.
