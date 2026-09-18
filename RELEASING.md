# Releasing Ski House

Two branches, two Vercel environments, one App Store app. Same shape as Split.

---

## Before the first deploy

These are the placeholders that must be filled in. Grep for `REPLACE-` to find
them all.

| What | Where | How to get it |
| --- | --- | --- |
| A domain | Vercel dashboard | Register one, add it to the Vercel project |
| `EXPO_PUBLIC_API_BASE` | `mobile/.env`, `mobile/eas.json` (×4 profiles) | The production domain and the dev branch URL |
| Production origin | `server/middleware.ts` → `ALLOWED_ORIGINS` | Same domain |
| `NEXT_PUBLIC_BASE_URL` | Vercel env, Production only | Same domain. Leave it **unset** on Preview so links point at the branch |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Vercel env, Production + Preview | Add the Turso integration in Vercel |
| `RESEND_API_KEY`, `MAIL_FROM` | Vercel env, Production + Preview | Resend dashboard; verify the sending domain first |
| `ascAppId` | `mobile/eas.json` | Create the app in App Store Connect — it's the numeric id in the URL |
| `extra.eas.projectId` | `mobile/app.json` | `cd mobile && npx eas init` |
| Contact email | `server/app/privacy/page.tsx`, `terms/page.tsx` | Apple rejects a privacy policy with no working contact route |
| Real icon artwork | `mobile/assets/`, `server/pwa/` | Replace the generated placeholders |

The Apple ID (`tschwichow@gmail.com`) and team ID (`G327UPP4LL`) in
`mobile/eas.json` are shared with Split and are already correct. The bundle
identifier is `com.tristan.skihaus`.

### One-time Vercel setup

1. Import the GitHub repo. Framework preset auto-detects Next.js; leave Root
   Directory at `./` — the root `package.json`'s `build` script proxies to
   `server`.
2. Add the Turso integration (Production **and** Preview).
3. Add `RESEND_API_KEY` and `MAIL_FROM`.
4. Set the Production Branch to `main`.
5. **Turn off "Auto-assign Custom Production Domains."** This is the whole
   safety model: a push to `main` builds and *stages* at a unique URL, and the
   live domain keeps serving the last promoted deployment.

---

## Day to day

```bash
git checkout dev
# ...work...
git push                      # auto-deploys to the dev branch URL
```

`dev` is safe to push to. **It isolates code, not data** — there is one Turso
database, so the dev deployment reads and writes live houses. Don't exercise
destructive paths against it, and don't test the invite or guest email flow
against a real person's address.

## Shipping the backend

```bash
git checkout main && git merge dev && git push     # builds and stages
npx vercel promote <deployment-url>                # publishes
```

Rollback is promoting an older deployment — instant, no rebuild.

### Smoke test after promoting

```bash
curl -s https://<domain>/api/health
# → {"ok":true,"service":"skihaus","storage":true,"mail":true}
```

Then, in a browser:

1. Request a sign-in link, click it, land signed in.
2. Open a house — balances render, no console errors.
3. Open a guest link (`/g/…`) in a private window — it renders without a
   session, and shows no ledger data.
4. Open an expired invite (`/invite/<garbage>`) — friendly copy, not a stack
   trace.

## Shipping the app

```bash
cd mobile

npx eas build  --platform ios --profile preview      # → dev backend, internal distribution
npx eas build  --platform ios --profile production   # → production domain
npx eas submit --platform ios --profile production   # → TestFlight / App Store
```

`appVersionSource: "remote"` with `autoIncrement` means EAS owns the build
number. The marketing version comes from `expo.version` in `app.json` — bump
it by hand for a release.

**Internal distribution is not TestFlight.** A `preview` build installs
directly on registered devices via a link; a `production` build goes through
`eas submit` to App Store Connect and then TestFlight. Use `preview` for
anything you want to iterate on quickly.

### Ordering

`EXPO_PUBLIC_API_BASE` is inlined by Metro at build time, so a shipped app
talks to whichever backend it was built against, forever.

**Deploy the backend before submitting an app build that depends on it.** An
app in review for two weeks will be talking to whatever is live when it's
approved, not what was live when you built it. Additive API changes only, once
a build is in the store.

---

## What is not set up

- **No fastlane.** EAS Build handles signing and provisioning; credentials
  live on Expo's servers. No `.p8`/`.p12`/`.mobileprovision` belongs in this
  repo (they're gitignored).
- **No separate dev database.** Adding one is: create a second Turso database,
  set `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` on the Preview environment only.
  Nothing else — `server/lib/db.ts` creates the schema lazily on first use, so
  there is no migration step.
- **No universal links.** `app.json` has an empty `associatedDomains`, so the
  native app can't intercept a `/join/…` URL and sign-in requires pasting the
  link. Fixing it: add the domain to `associatedDomains`, serve
  `/.well-known/apple-app-site-association` from the Next app, and drop the
  paste field in `SignInScreen`.
- **No push notifications.** See CONTEXT.md §8.

## App Store screenshots

iPhone 6.9" (1320×2868) and 6.5" (1284×2778). No iPad — the app is
`supportsTablet: false`. Keep them in `photos/`.
