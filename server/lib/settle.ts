// "Who pays whom" — turning a column of balances into a short list of
// transfers.
//
// MIRRORED FILE — keep in sync with mobile/src/settle.ts.
//
// Greedy largest-debtor-to-largest-creditor. It is not guaranteed to be the
// theoretical minimum number of transfers (that problem is NP-hard), but it
// never produces more than n-1 and in practice lands on the obvious answer.
// The important property is that it is *deterministic*: the same balances
// always yield the same instructions, so the list doesn't reshuffle every time
// someone opens the app.

import type { Balance } from "./types";

export type Transfer = { fromUserId: string; toUserId: string; amountCents: number };

export function settleUp(balances: Balance[]): Transfer[] {
  // Positive = the house owes them. Sort both sides by size, biggest first,
  // then break ties on userId so the order never depends on row order.
  const creditors = balances
    .filter((b) => b.netCents > 0)
    .map((b) => ({ id: b.userId, amt: b.netCents }))
    .sort((a, b) => b.amt - a.amt || a.id.localeCompare(b.id));

  const debtors = balances
    .filter((b) => b.netCents < 0)
    .map((b) => ({ id: b.userId, amt: -b.netCents }))
    .sort((a, b) => b.amt - a.amt || a.id.localeCompare(b.id));

  const out: Transfer[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const take = Math.min(creditors[ci].amt, debtors[di].amt);
    if (take > 0) {
      out.push({ fromUserId: debtors[di].id, toUserId: creditors[ci].id, amountCents: take });
    }
    creditors[ci].amt -= take;
    debtors[di].amt -= take;
    if (creditors[ci].amt === 0) ci++;
    if (debtors[di].amt === 0) di++;
  }

  return out;
}
