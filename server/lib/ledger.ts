// The ledger: expense allocation and balance computation.
//
// INVARIANT: a balance is never stored, only derived. Every number the app
// shows can be walked back to visible rows — `netCents` is exactly
// `paid - owed + received - sent`, and each term is a sum over `expenses`,
// `expense_shares` and `payments`. Caching a running total is how spreadsheets
// end up disagreeing with reality in March.

import { db } from "./db";
import { splitRoster } from "./guard";
import { badRequest } from "./http";
import { allocateByShares, allocateEqually } from "./money";
import { arr, cents, str } from "./validate";
import type { Balance, Expense, SplitMode } from "./types";

export type CustomShare = { userId: string; amountCents: number };

/**
 * Validate a client-supplied `split_mode: 'custom'` allocation.
 *
 * Lives here rather than in the route because Next only permits HTTP-verb
 * exports from a `route.ts`.
 */
export function parseCustomShares(raw: unknown, total: number): CustomShare[] {
  const list = arr<{ userId?: unknown; amountCents?: unknown }>(raw, "Shares", 100);
  const shares = list.map((s) => ({
    userId: str(s.userId, "Share user"),
    amountCents: cents(s.amountCents, "Share amount", { allowNegative: true }),
  }));

  const sum = shares.reduce((a, b) => a + b.amountCents, 0);
  if (sum !== total) {
    // Refusing to auto-balance is deliberate: silently absorbing a $3
    // discrepancy into one person's column is exactly the kind of quiet error
    // that makes people stop trusting the ledger.
    throw badRequest(`Custom shares add up to ${sum} cents but the expense is ${total}.`);
  }
  return shares;
}

/**
 * Recompute and persist the per-person allocation of one expense.
 *
 * The result is materialised into `expense_shares` rather than derived on read,
 * because share_bps changes over a season: someone joins in January, someone
 * drops to a half share. Freezing the allocation at write time means December's
 * heating bill keeps December's split, which is what actually happened.
 */
export async function writeExpenseShares(
  expenseId: string,
  houseId: string,
  amountCents: number,
  splitMode: SplitMode,
  custom?: CustomShare[],
): Promise<Array<{ userId: string; amountCents: number }>> {
  const c = await db();
  await c.execute({ sql: "DELETE FROM expense_shares WHERE expense_id = ?", args: [expenseId] });

  let shares: Array<{ userId: string; amountCents: number }> = [];

  if (splitMode === "none") {
    shares = [];
  } else if (splitMode === "custom") {
    shares = (custom ?? []).filter((s) => s.amountCents !== 0);
  } else {
    const roster = await splitRoster(houseId);
    shares =
      splitMode === "equal"
        ? allocateEqually(amountCents, roster.map((m) => m.userId))
        : allocateByShares(amountCents, roster);
  }

  if (shares.length > 0) {
    await c.batch(
      shares.map((s) => ({
        sql: "INSERT INTO expense_shares (expense_id, user_id, amount_cents) VALUES (?, ?, ?)",
        args: [expenseId, s.userId, s.amountCents],
      })),
      "write",
    );
  }

  return shares;
}

export function rowToExpense(
  r: Record<string, unknown>,
  shares: Array<{ userId: string; amountCents: number }>,
): Expense {
  return {
    id: String(r.id),
    houseId: String(r.house_id),
    categoryId: r.category_id == null ? null : String(r.category_id),
    description: String(r.description),
    amountCents: Number(r.amount_cents),
    paidBy: r.paid_by == null ? null : String(r.paid_by),
    incurredOn: String(r.incurred_on),
    splitMode: String(r.split_mode) as SplitMode,
    receiptUrl: r.receipt_url == null ? null : String(r.receipt_url),
    note: r.note == null ? null : String(r.note),
    createdBy: String(r.created_by),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    shares,
  };
}

/** Every live expense in a house, newest first, with allocations attached. */
export async function listExpenses(houseId: string, limit = 500): Promise<Expense[]> {
  const c = await db();

  const [exp, sh] = await Promise.all([
    c.execute({
      sql: `SELECT * FROM expenses WHERE house_id = ? AND deleted_at IS NULL
            ORDER BY incurred_on DESC, created_at DESC LIMIT ?`,
      args: [houseId, limit],
    }),
    // One query for all shares rather than N+1 — a season is a few hundred
    // expenses and the join table is small enough to pull whole.
    c.execute({
      sql: `SELECT s.* FROM expense_shares s
            JOIN expenses e ON e.id = s.expense_id
            WHERE e.house_id = ? AND e.deleted_at IS NULL`,
      args: [houseId],
    }),
  ]);

  const byExpense = new Map<string, Array<{ userId: string; amountCents: number }>>();
  for (const r of sh.rows) {
    const key = String(r.expense_id);
    const list = byExpense.get(key) ?? [];
    list.push({ userId: String(r.user_id), amountCents: Number(r.amount_cents) });
    byExpense.set(key, list);
  }

  return exp.rows.map((r) =>
    rowToExpense(r as Record<string, unknown>, byExpense.get(String(r.id)) ?? []),
  );
}

export async function getExpense(houseId: string, expenseId: string): Promise<Expense | null> {
  const c = await db();
  const res = await c.execute({
    sql: "SELECT * FROM expenses WHERE id = ? AND house_id = ? AND deleted_at IS NULL",
    args: [expenseId, houseId],
  });
  const row = res.rows[0];
  if (!row) return null;

  const sh = await c.execute({
    sql: "SELECT user_id, amount_cents FROM expense_shares WHERE expense_id = ?",
    args: [expenseId],
  });
  return rowToExpense(
    row as Record<string, unknown>,
    sh.rows.map((s) => ({ userId: String(s.user_id), amountCents: Number(s.amount_cents) })),
  );
}

/**
 * Every member's position, plus the house's own totals.
 *
 * `netCents > 0` means the house owes that person — they fronted more than
 * their share. Guest fees are counted as house income and reduce the total
 * everyone is on the hook for; they are not credited to the member who hosted
 * (see CONTEXT.md §10, which flags this as an open question).
 */
export type LedgerSummary = {
  balances: Balance[];
  totalSpentCents: number;
  guestIncomeCents: number;
  unpaidGuestCents: number;
};

export async function computeLedger(houseId: string): Promise<LedgerSummary> {
  const c = await db();
  const roster = await splitRoster(houseId);

  const [paidRes, owedRes, payRes, guestRes, totalRes] = await Promise.all([
    c.execute({
      sql: `SELECT paid_by, SUM(amount_cents) AS total FROM expenses
            WHERE house_id = ? AND deleted_at IS NULL AND paid_by IS NOT NULL
            GROUP BY paid_by`,
      args: [houseId],
    }),
    c.execute({
      sql: `SELECT s.user_id, SUM(s.amount_cents) AS total
            FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
            WHERE e.house_id = ? AND e.deleted_at IS NULL
            GROUP BY s.user_id`,
      args: [houseId],
    }),
    c.execute({
      sql: `SELECT from_user, to_user, amount_cents FROM payments
            WHERE house_id = ? AND deleted_at IS NULL`,
      args: [houseId],
    }),
    c.execute({
      sql: `SELECT fee_cents, paid_at FROM guest_stays
            WHERE house_id = ? AND status = 'approved'`,
      args: [houseId],
    }),
    // Separate from the paid_by roll-up: expenses paid straight out of the
    // house account have paid_by NULL and would otherwise vanish from the
    // season total.
    c.execute({
      sql: `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM expenses
            WHERE house_id = ? AND deleted_at IS NULL`,
      args: [houseId],
    }),
  ]);

  const paid = new Map<string, number>();
  for (const r of paidRes.rows) paid.set(String(r.paid_by), Number(r.total));

  const owed = new Map<string, number>();
  for (const r of owedRes.rows) owed.set(String(r.user_id), Number(r.total));

  const sent = new Map<string, number>();
  const received = new Map<string, number>();
  for (const r of payRes.rows) {
    const amt = Number(r.amount_cents);
    const from = String(r.from_user);
    sent.set(from, (sent.get(from) ?? 0) + amt);
    // to_user NULL means "paid into the house account", which settles the
    // payer's debt without crediting any individual.
    if (r.to_user != null) {
      const to = String(r.to_user);
      received.set(to, (received.get(to) ?? 0) + amt);
    }
  }

  let guestIncomeCents = 0;
  let unpaidGuestCents = 0;
  for (const r of guestRes.rows) {
    const fee = Number(r.fee_cents);
    if (r.paid_at != null) guestIncomeCents += fee;
    else unpaidGuestCents += fee;
  }

  const balances: Balance[] = roster.map((m) => {
    const p = paid.get(m.userId) ?? 0;
    const o = owed.get(m.userId) ?? 0;
    const s = sent.get(m.userId) ?? 0;
    const rcv = received.get(m.userId) ?? 0;
    return {
      userId: m.userId,
      paidCents: p,
      owedCents: o,
      sentCents: s,
      receivedCents: rcv,
      netCents: p - o + rcv - s,
    };
  });

  const totalSpentCents = Number(totalRes.rows[0]?.total ?? 0);

  return { balances, totalSpentCents, guestIncomeCents, unpaidGuestCents };
}
