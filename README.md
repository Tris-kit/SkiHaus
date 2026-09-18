# SkiHaus

Run a ski lease without the group text.

Expenses, votes, guest fees, the lease agreement, and who's skiing what — in
one place everyone in the house can actually see. **No download required**:
the whole app runs in a browser, and the iPhone app is the same code packaged
for the App Store.

- **Why it exists and what it does:** [CONTEXT.md](CONTEXT.md)
- **How it's built and the rules of the codebase:** [CLAUDE.md](CLAUDE.md)
- **How to ship it:** [RELEASING.md](RELEASING.md)

## How the pieces fit

```
mobile/    Expo app — React Native for iOS, react-native-web for the browser.
           This is the entire user interface.
             │
             │  expo export -p web   (server/scripts/build-web.mjs)
             ▼
server/    Next.js on Vercel. Serves the exported web app from public/ at "/",
public/    and owns /api/*, the invite flow, the guest page, privacy and terms.
             │
             ▼
Turso      libSQL/SQLite. Schema lives in server/lib/db.ts and is created
           lazily on first use — there is no migration tool.
```

One deployment serves the API, the web app and the public pages. The App Store
build is a convenience wrapper around the same UI.

## Running it locally

```bash
npm --prefix mobile install && npm --prefix server install

cp server/.env.example server/.env        # then fill in Turso credentials
npm run server                            # API at localhost:3000
npm run web                               # app at localhost:8081
```

Two servers on purpose: in dev the Expo dev server serves the UI with fast
refresh, and Next serves the API. In production `build-web.mjs` collapses them
into one deployment.

Without `RESEND_API_KEY`, sign-in links are printed to the `npm run server`
terminal instead of emailed. Copy the URL from there — that's the intended
local flow, and `/api/health` will report `mail: false` so you can tell it
apart from a real misconfiguration.

For the iPhone app:

```bash
npm run ios
```

## Checks

```bash
npm run check   # typecheck both packages
npm run test    # the money and settle-up test scripts
```

Both run in CI on every push (`.github/workflows/check.yml`). There's no test
framework — `*.test.ts` files are plain scripts that log each check and exit 1
on failure.

## The three roles

| | guest | member | admin |
| --- | :-: | :-: | :-: |
| Own stay, house rules, dinner plan | ● | ● | ● |
| The ledger, balances, voting, claiming nights | | ● | ● |
| Recording expenses, setting guest fees, running votes, inviting people | | | ● |

A guest never makes an account — each stay gets a private link. Members and
admins sign in with an email and password. Enter your address, SkiHaus looks
it up, and you either type your password or pick a name and create one.

## Status

Initial scaffold: the data model, auth, permissions, the ledger, votes, guest
fees, documents and logistics are implemented end to end. See
**[CLAUDE.md § Known gaps](CLAUDE.md#known-gaps-accurate-as-of-the-initial-scaffold)**
for what still has to happen before a production deploy — chiefly a domain, an
App Store Connect record, and real icon artwork.
