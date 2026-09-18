// Money and date arithmetic. Pure — no imports, no I/O.
//
// MIRRORED FILE — keep in sync with server/lib/money.ts, and run
// `npm --prefix mobile run test` after any change. If these two drift, the app
// shows one number and the server stores another.
//
// INVARIANT: money is integer cents everywhere. Never introduce a float into a
// total. `allocate()` uses largest-remainder rounding so the parts always sum
// back to the whole, exactly — a naive `Math.round(total * w / W)` per person
// loses or invents pennies, and over a season of plow bills that is a real
// argument between real people.

export function toCents(dollars: number | string): number {
  const n = typeof dollars === "string" ? parseFloat(dollars) : dollars;
  if (!isFinite(n)) return 0;
  // Round the scaled value rather than multiplying a rounded float: 19.99*100
  // is 1998.9999999999998 in IEEE 754.
  return Math.round(n * 100);
}

export function toDollars(cents: number): number {
  return cents / 100;
}

/** "$1,234.56" — negative renders as "−$4.20" with a real minus sign. */
export function formatMoney(cents: number, currency = "USD"): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const body = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(abs / 100);
  return neg ? `−${body}` : body;
}

/**
 * Split `total` across `weights` so that the result sums to exactly `total`.
 *
 * Largest-remainder: every part gets its floor, then the leftover pennies go
 * one each to the parts with the biggest fractional remainder (ties broken by
 * original order, so the result is deterministic).
 *
 * Weights that sum to zero fall back to an even split — a house where nobody
 * has been assigned a share should still be able to record an expense.
 */
export function allocate(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];

  // Work on the magnitude so negative totals (credits, refunds) distribute the
  // same way, then flip the signs back at the end.
  const sign = total < 0 ? -1 : 1;
  const amount = Math.abs(Math.trunc(total));

  const w = weights.map((x) => (isFinite(x) && x > 0 ? x : 0));
  let sum = w.reduce((a, b) => a + b, 0);
  const even = sum <= 0;
  const eff = even ? new Array(n).fill(1) : w;
  if (even) sum = n;

  const out = new Array<number>(n);
  const rema = new Array<{ i: number; frac: number }>(n);
  let assigned = 0;

  for (let i = 0; i < n; i++) {
    const exact = (amount * eff[i]) / sum;
    const floor = Math.floor(exact);
    out[i] = floor;
    rema[i] = { i, frac: exact - floor };
    assigned += floor;
  }

  let left = amount - assigned;
  // Stable: bigger remainder first, earlier index wins a tie.
  rema.sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k++, left--) out[rema[k % n].i] += 1;

  return sign === 1 ? out : out.map((x) => -x);
}

export type ShareWeight = { userId: string; shareBps: number };

/** `allocate()` over a member roster, returning per-person cents. */
export function allocateByShares(
  total: number,
  members: ShareWeight[],
): Array<{ userId: string; amountCents: number }> {
  const parts = allocate(total, members.map((m) => m.shareBps));
  return members.map((m, i) => ({ userId: m.userId, amountCents: parts[i] }));
}

/** Even split across a roster (`split_mode: 'equal'`). */
export function allocateEqually(
  total: number,
  userIds: string[],
): Array<{ userId: string; amountCents: number }> {
  const parts = allocate(total, userIds.map(() => 1));
  return userIds.map((userId, i) => ({ userId, amountCents: parts[i] }));
}

// --- calendar ---------------------------------------------------------------
//
// Dates are ISO `YYYY-MM-DD` and are parsed as UTC. A ski day is a day, not an
// instant: parsing "2027-01-15" in local time makes it the 14th for anyone west
// of Greenwich, which would quietly mis-price a Friday night as a weeknight.

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDay(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function isValidDay(iso: unknown): iso is string {
  return typeof iso === "string" && !isNaN(parseDay(iso));
}

export function formatDayISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Nights between two dates. Arriving and leaving the same day is 0 nights. */
export function nightsBetween(arriveOn: string, departOn: string): number {
  const a = parseDay(arriveOn);
  const d = parseDay(departOn);
  if (isNaN(a) || isNaN(d)) return 0;
  return Math.max(0, Math.round((d - a) / DAY_MS));
}

/** The date of each night slept, i.e. every day from arrival up to departure. */
export function nightsIn(arriveOn: string, departOn: string): string[] {
  const n = nightsBetween(arriveOn, departOn);
  const start = parseDay(arriveOn);
  return Array.from({ length: n }, (_, i) => formatDayISO(start + i * DAY_MS));
}

/**
 * A "weekend night" is one you sleep through into a non-working morning:
 * Friday and Saturday. Sunday night is a weeknight — you are driving home.
 */
export function isWeekendNight(iso: string): boolean {
  const d = new Date(parseDay(iso)).getUTCDay(); // 0 Sun … 6 Sat
  return d === 5 || d === 6;
}

export type RateRow = {
  centsPerPersonPerNight: number;
  appliesTo: "any" | "weekend" | "weekday" | "holiday";
};

/**
 * Price a guest stay against the house's rate schedule.
 *
 * Each night is charged at the most specific matching rate: a `weekend` or
 * `weekday` rate beats the `any` fallback. `holiday` rates are never matched
 * automatically — there is no holiday calendar — so they exist for a manager to
 * apply by hand via a fee override. Returns 0 when no rate matches, which the
 * UI shows as "not priced yet" rather than "free".
 */
export function quoteGuestStay(
  arriveOn: string,
  departOn: string,
  partySize: number,
  rates: RateRow[],
): number {
  const people = Math.max(1, Math.trunc(partySize));
  const any = rates.find((r) => r.appliesTo === "any");
  const weekend = rates.find((r) => r.appliesTo === "weekend");
  const weekday = rates.find((r) => r.appliesTo === "weekday");

  let total = 0;
  for (const night of nightsIn(arriveOn, departOn)) {
    const specific = isWeekendNight(night) ? weekend : weekday;
    const rate = specific ?? any;
    if (rate) total += rate.centsPerPersonPerNight * people;
  }
  return total;
}
