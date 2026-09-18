# mobile/

The Expo app — and, via `react-native-web`, the entire web UI too. There is no
separate web frontend: `server/scripts/build-web.mjs` exports this package and
Next serves the result at `/`.

**Read [AGENTS.md](AGENTS.md) before touching native or config code.**

## Commands

```bash
npm install

npm run web       # browser at :8081 (point it at a running `npm run server`)
npm run ios       # iOS — needs Xcode
npm run check     # tsc --noEmit
npm run test      # money.test.ts + settle.test.ts
```

`EXPO_PUBLIC_API_BASE` in `.env` decides which backend a build talks to. Metro
inlines it at **build** time, so changing it needs a restart, not a reload.
Local overrides go in `.env.local` (gitignored).

**If Metro prints "Waiting for Watchman `watch-project`" and never finishes**,
you have a Watchman binary on PATH whose daemon is dead. Metro falls back to
node fs watching when Watchman is missing, but blocks forever when it's
present and broken. Prefix the command:

```bash
EXPO_USE_WATCHMAN=0 npm run web
```

See the comment in `metro.config.js`.

## Layout

```
App.tsx              one useState<Step> machine — this is the router
index.ts             registerRootComponent
src/
  api.ts             the only place this app talks to the network
  hooks.ts           useLoad / useAction — the entire data layer
  storage.ts         session token: Keychain on native, cookie on web
  theme.ts           every colour, space and radius. MIRRORS server/app/globals.css
  ui.tsx             the component kit — Screen, Card, Row, Button, Field, …
  types.ts           MIRRORS server/lib/types.ts
  money.ts           MIRRORS server/lib/money.ts
  settle.ts          MIRRORS server/lib/settle.ts
  *.test.ts          plain scripts, run with tsx
  screens/
    SignInScreen     email → magic link
    HousesScreen     pick a house, or start one
    HomeScreen       the dashboard: balance, what needs you, navigation
    ExpensesScreen   the ledger + balances + settle up
    VotesScreen      open votes, tallies, closing
    GuestsScreen     guest stays, approval, fees, links
    CalendarScreen   nights, mountains, dinner — by day
    DocumentsScreen  lease and house rules, with acknowledgement
    PeopleScreen     roster, roles, shares, invites
plugins/
  withIosDeploymentTarget.js   forces every pod to iOS 16.0 on prebuild
assets/              generated placeholder icons — replace before shipping
```

## Navigation

There isn't a navigation library. `App.tsx` holds a `Step` and a render
branch:

```
signin → houses → home ─┬─ expenses
                        ├─ votes
                        ├─ guests
                        ├─ calendar
                        ├─ documents
                        └─ people
```

Adding a screen means adding a `Step`, a case in the switch, and a `Row` on
`HomeScreen` that navigates to it. Screens take `{ entry, session, onBack }`.

## State

`useLoad(fn, deps)` from `src/hooks.ts` and `useState`. That's the ceiling. If
a screen wants more, the screen is doing too much — that isn't a signal to add
Redux.

## Style

Everything comes from `src/theme.ts`. **Never hard-code a colour.** Use
`withAlpha(colors.x, a)` rather than a literal `rgba()`, so changing a token
propagates. New visual treatment goes into `src/ui.tsx` as a variant, not into
a screen as a one-off.

On web, `Screen` centres a 460px column — the app is phone-shaped everywhere,
rather than a list of expenses stretched across a monitor.

One gotcha worth knowing: it's `fontVariant: ["tabular-nums"]`, not
`fontVariantNumeric`. The latter is the CSS name and doesn't exist in React
Native's `TextStyle`.

## Mirrored files

`types.ts`, `money.ts` and `settle.ts` are copies of their `server/lib/`
counterparts. The packages don't share `node_modules`, so they're duplicated
on purpose — **change both sides together**, and run `npm run test` after
touching the maths.
