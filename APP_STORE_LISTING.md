# App Store Connect listing

Paste-ready copy. Character limits are Apple's and are enforced in the form —
the counts below are checked.

---

## Name (≤30)

```
SkiHaus
```
`7`

## Subtitle (≤30)

```
Run the lease, not the text
```
`27`

## Promotional text (≤170, editable without a new build)

```
Expenses, votes, guest fees and who's skiing what — one place your whole ski house can see. Works in a browser too, so nobody has to download anything.
```
`152`

## Keywords (≤100, comma separated, no spaces)

```
ski,lease,share,house,expenses,split,rental,chalet,cabin,roommate,housemate,vote,guest,season,winter
```
`99`

## Description

```
SkiHaus is for the person who ends up running the lease — and everyone who'd rather they didn't have to.

A shared ski house is a small organisation nobody wants to manage. One person fronts the plow bill and chases people in March. Guest fees get improvised. "Should we re-up next season?" dies in a group text. The actual lease agreement lives in someone's email.

SkiHaus replaces the group text and the spreadsheet with one place that has a memory.

THE LEDGER
Record what the house spends, categorised, with receipts. Everyone sees their own share and a running balance, and the app works out who owes whom. SkiHaus never touches your money — you settle up however you already do, then write it down.

GUEST FEES THAT ACTUALLY GET COLLECTED
Set a rate schedule once — weekend nights, weeknights, per person. A member requests a guest, the app prices the stay, and the manager approves it. The guest gets a private link with their dates, what they owe, the address and the house rules. They never download anything or make an account.

DECISIONS THAT CLOSE
Put it to the house: re-up the lease, a new plow guy, dogs or no dogs. Set a quorum and a threshold so three people can't decide for twelve. Results are recorded, so nobody relitigates it in February.

THE LEASE, WHERE PEOPLE CAN FIND IT
Keep the lease agreement and the house rules in the app, with versions, and see who has actually read them.

WHO'S AROUND
Claim your nights. Say which mountain you're skiing. Pick where dinner is. Everyone can see the week ahead without asking.

THREE KINDS OF PERSON
Managers run the house: expenses, fees, votes, documents, invites. Members see every number, vote, and bring guests. Guests see their own stay and nothing else.

NO PAYWALL, NO LOCK-IN
Everything works in a browser at the same address. The app is a convenience, not a gate.
```

## What's New (first release)

```
First release.
```

---

## Categories

- **Primary:** Finance
- **Secondary:** Travel

Finance over Lifestyle because the ledger is the spine of the product and it's
what someone searching will be trying to solve.

## Age rating

4+. No user-generated public content, no ads, no third-party analytics, no
in-app purchases.

## URLs

| Field | Value |
| --- | --- |
| Support URL | `https://<domain>/privacy` *(replace with a real support page)* |
| Marketing URL | `https://<domain>` |
| Privacy Policy URL | `https://<domain>/privacy` |

## App Privacy answers

Data collected and **linked to the user**:

- **Contact info — email address.** Used for: App Functionality (it *is* the
  account, and where confirmation and password-reset links are sent). Not used for tracking.
- **Contact info — name.** App Functionality. Optional.
- **User content — other.** Expenses, votes, documents and stays the user
  enters. App Functionality.

Not collected: location, contacts, photos, browsing history, identifiers,
diagnostics, purchases, financial info (SkiHaus records amounts people type
in; it has no payment credentials and no bank connection).

Tracking: **No.** No third-party SDKs, no advertising identifier, no analytics.

## Review notes

```
SkiHaus is a shared-expense and coordination tool for people renting a ski house together for a season.

The whole app also runs at https://<domain> in a browser, so you can review it without a build if that's easier.

To sign in: enter an email address on the first screen. SkiHaus looks it up and then asks for your password, or asks you to pick a name and create one. New accounts confirm the address by email before they can be used.

For review, use the demo account below. It is already confirmed and is a manager of a populated house.

  Demo email:    <set up before submitting>
  Demo password: <set up before submitting>

Note on payments: SkiHaus does not process payments. It records who spent what and computes balances; people settle up outside the app via Venmo, Zelle or cash. There are no in-app purchases and no payment credentials are collected.

Guest links (/g/<token>) are unguessable capability URLs that let a house's guest view their own stay without an account. They expose only that guest's dates, fee and the house rules.
```

## Screenshots

iPhone 6.9" (1320×2868) and 6.5" (1284×2778). No iPad —
`supportsTablet: false`. Store them in `photos/`.

Suggested five, in order:

1. **Home** — the balance card, "needs you", the house nav
2. **Money → Balances** — where everyone stands + settle up
3. **Votes** — an open vote mid-tally with the quorum line
4. **Guests** — a pending stay with its auto-quoted fee
5. **The guest page** — the no-login view, captioned "Your guests don't need
   the app"
