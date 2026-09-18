# SkiHaus — product context

The single source of truth for *what this app is and why*. Architecture and
conventions live in [CLAUDE.md](CLAUDE.md); release mechanics in
[RELEASING.md](RELEASING.md).

---

## 1. The problem

A ski lease is a small organisation that nobody wants to run. Eight to twenty
people share a house for a season. One of them — the manager — ends up holding
a shoebox of receipts, a group text with 400 unread messages, a spreadsheet
only they understand, and a lease agreement nobody else has read.

The recurring failures are always the same:

| Failure | What it looks like today |
| --- | --- |
| Nobody knows what anything costs | Manager fronts the plow bill, chases people in March |
| Guest fees are improvised | "I think it's $50 a night?" — collected inconsistently, or not at all |
| Decisions never close | "Should we re-up next season?" dies in a group text |
| The lease is invisible | The actual document is a PDF in one person's email |
| Logistics are guesswork | Who's driving up Friday? Is anyone at the house? Where are we eating? |

SkiHaus replaces the group text and the spreadsheet with one place that has a
memory.

## 2. What it is

A season-long management app for a shared ski lease: a ledger, a decision log,
a guest-fee system, and a lightweight logistics board — with a manager who can
actually enforce structure.

**It is not** a payments processor, a booking engine, or a social network. It
records what happened and what was decided. Money moves over Venmo/Zelle like
it already does.

## 3. Principles

1. **Web first, app optional.** Every feature works in a browser with no
   download and no account creation friction. The iPhone app is the same code,
   packaged. Nothing is ever behind "install the app." *(This is a hard
   constraint, not a preference — see §6.)*
2. **The manager is a real role, not a badge.** Admins can do things members
   structurally cannot. That asymmetry is the product.
3. **Guests are first-class but low-privilege.** A guest coming for one weekend
   should get a link, see what they owe and where to park, and never make an
   account.
4. **Every number is traceable.** A balance is always the sum of visible
   entries. No magic totals.
5. **Clean and minimal.** Blue and white, lots of air, no chrome for chrome's
   sake. If a screen needs a legend, it's wrong.

## 4. Roles

Three levels, set per-house. A person can be an admin of one house and a guest
of another.

### `admin` — the manager

Runs the lease. Everything a member can do, plus:

- Create and edit **expenses**, categories, and the settlement ledger
- Set the **guest fee schedule**; approve, decline, or price a guest stay
- Open, close, and publish the outcome of **votes**
- Publish and version **documents** (the lease agreement, house rules)
- **Invite** people and set their role and ownership share
- Post **announcements**
- See the **audit log**

### `member` — a shareholder on the lease

Reads everything financial; writes only their own stuff:

- See all expenses, every balance, the full ledger, and what they personally owe
- **Vote** on any open poll they're eligible for
- Claim **nights at the house** and post which mountain they're skiing
- Propose and RSVP to **dinners**
- **Request a guest stay** — which lands as `pending` for the manager to price
  and approve
- Read the lease agreement and acknowledge it

Cannot: edit expenses, change anyone's role, close a vote, or set fees.

### `guest` — someone's friend for a weekend

Sees a narrow slice, usually without ever signing in (§6):

- Their own stay: dates, the fee they owe, who invited them
- House rules and any document marked guest-visible
- The dinner plan and who else is around
- Nothing else — no ledger, no balances, no votes, no other members' business

### Permission matrix

| | guest | member | admin |
| --- | :-: | :-: | :-: |
| View own stay + fee | ● | ● | ● |
| View guest-visible documents | ● | ● | ● |
| View dinner plan / who's at the house | ● | ● | ● |
| View all expenses + balances | | ● | ● |
| Vote in polls | | ● | ● |
| Claim nights / ski days / RSVP | | ● | ● |
| Request a guest stay | | ● | ● |
| Create + edit expenses | | | ● |
| Set guest fee schedule | | | ● |
| Approve / price guest stays | | | ● |
| Open + close votes | | | ● |
| Publish documents | | | ● |
| Invite people, set roles + shares | | | ● |

## 5. Scope

### MVP — what ships first

1. **Accounts and houses.** Email-first sign-in with a password, confirmed by
   email on registration. Create a house, invite
   people at a role, accept an invite.
2. **Expenses and the ledger.** Manager categorises and records spending;
   everyone sees their share and their running balance. Settlements recorded by
   hand.
3. **Guest stays and fees.** A rate schedule, a request flow, manager approval
   and pricing, and a no-login page for the guest.
4. **Votes.** Yes/no and multiple-choice polls with quorum and a pass threshold,
   opened and closed by the manager.
5. **The lease agreement.** A document store with versions and per-member
   acknowledgement.
6. **Logistics.** Who's at the house which nights, who's skiing which mountain
   which day, and where dinner is.
7. **Notifications.** An in-app announcement feed. Push and email digests land
   in v1.1 (§8).

### Explicitly deferred

- **Photos of the house.** Wanted eventually, not now. The schema leaves room
  (`documents.url` already takes an external file); a real photo feature means
  blob storage, which is a separate decision.
- **In-app payments.** Decided against for v1 — see §7.
- **Multi-season rollover / archiving a house and cloning it.**
- **Android.** The Expo app builds for it; nobody has asked.

## 6. The no-paywall constraint

> "Most of this stuff doesn't need the app to be downloaded, because we don't
> want to lock it behind a paywall."

This drove the single biggest architectural choice, inherited from Split: **the
web app and the iPhone app are the same codebase.** The Expo app is exported
with `react-native-web` into the Next.js `public/` directory, so
`https://<domain>/` serves the complete application — installable as a PWA,
fully functional, no App Store required. The native build is a convenience
wrapper for people who want an icon on their home screen.

Access follows the same philosophy, in two tiers:

- **Members and admins** sign in with an email and password, or with a magic
  link — either works, on the same account.
- **Guests** don't sign in at all. Each guest stay mints an unguessable
  capability token; `/g/<token>` is a public page showing that guest their
  dates, their fee, and the house rules. This is Split's proven share-link
  model, scoped down.

### Why both

The original design was magic-link only: no passwords to forget, no reset
flow, no breach-response obligation.

It has one hard failure mode, which showed up the first time the app was
deployed: **it cannot work at all until transactional email does.** No Resend
key meant nobody could get through the front door, including the person
setting it up. That is a bad property for a tool a ski house self-hosts in an
afternoon.

Passwords don't remove the email dependency, they relocate it — sign-in stops
needing email, password *reset* starts needing it. The point is that the
dependency moves off the critical path. You can stand the whole app up with a
database and nothing else.

So: an account may have a password, a verified email, or both. Neither is
required. Nothing is ever gated on having a password.

## 7. Money model

**SkiHaus is a ledger, not a payment processor.** No Stripe, no card data, no
PCI scope, no App Store in-app-purchase entanglement.

- All money is **integer cents**, never floats.
- An expense is allocated across members by `split_mode`:
  - `shares` — proportional to each member's `share_bps` (ownership basis
    points). The default; this is how a lease actually works.
  - `equal` — even split across active members
  - `custom` — explicit per-person amounts
  - `none` — informational only, allocated to nobody (e.g. a guest fee that a
    guest owes the house, not the members)
- Allocation uses **largest-remainder rounding**, so per-person amounts always
  sum back to the exact total. This is the same invariant Split protects, and
  the implementation is deliberately mirrored in `server/lib/money.ts` and
  `mobile/src/money.ts`.
- A **balance** is `(what you paid for the house) − (what you were allocated) +
  (settlements you received) − (settlements you sent)`. Positive means the house
  owes you.
- **Settlements** are recorded, not executed. Someone Venmos someone, then one
  of them writes it down.

The schema is deliberately payment-provider-shaped (`payments.method`,
`guest_stays.paid_at`) so a Stripe integration could be added later without
touching the ledger. That is not planned.

## 8. Notifications

Split has no notification infrastructure at all, so this is net-new.

- **v1 — announcement feed.** Admins post announcements with an audience
  (`admin,member,guest`); the app shows an unread badge. Votes opening, guest
  stays being approved, and large expenses auto-generate feed entries.
- **v1.1 — email.** Transactional email already exists for confirmation and
  password resets (Resend);
  extending it to a weekly digest and vote-closing reminders is small.
- **v1.1 — push.** Requires `expo-notifications`, an `aps-environment`
  entitlement, an APNs key on the existing Apple team, and the `push_tokens`
  table (already in the schema). Deliberately not wired up until the feed proves
  what's worth pushing.

## 9. Data model

Full DDL lives in `server/lib/db.ts` (created lazily at runtime — there is no
migration tool, matching Split). The shape:

```
users ──< memberships >── houses
                            │
        ┌───────────────────┼────────────────────┬──────────────┐
        │                   │                    │              │
   categories          guest_rates            polls         documents
        │                   │                    │              │
   expenses            guest_stays          poll_options   document_acks
        │                                         │
  expense_shares                              ballots

  payments · stays · ski_days(→mountains) · dinners(→venues)·dinner_rsvps
  announcements · announcement_reads · push_tokens · audit_log
  invites · login_tokens · sessions · rate_limits
```

Every domain table carries `house_id`. That is the multi-tenancy boundary and
it is enforced in one place: `requireMember()` in `server/lib/guard.ts` resolves
`(session, houseId) → role` and every handler goes through it.

## 10. Open questions

Things a future session should not silently decide:

- **Ownership shares.** `share_bps` defaults to equal split on invite. Does a
  half-share member get a half vote? Currently **no** — one member, one vote —
  but the `polls.quorum_bps` / `pass_bps` fields are basis-point-shaped so
  share-weighted voting is a small change if wanted.
- **Guest fees and the ledger.** A guest fee is currently revenue to the house
  that offsets the season total. Alternative: it credits the specific member who
  hosted them. The first is implemented; the second is arguably fairer.
- **Who can see the lease?** `documents.visible_to` defaults to `admin,member`.
  Guests probably need house rules but not the rent figure — hence two documents
  rather than one.
- **Domain name.** Split runs on `spwit.app`. SkiHaus has no domain yet;
  `NEXT_PUBLIC_BASE_URL` and the EAS profiles need one before the first
  production build.
