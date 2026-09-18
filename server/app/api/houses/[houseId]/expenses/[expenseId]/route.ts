// GET    /api/houses/:houseId/expenses/:expenseId -> { expense }   (member)
// PATCH  /api/houses/:houseId/expenses/:expenseId -> { expense }   (admin)
// DELETE /api/houses/:houseId/expenses/:expenseId -> { ok: true }  (admin, soft)

import { db } from "@/lib/db";
import { audit, requireAdmin, requireRole } from "@/lib/guard";
import { badRequest, body, handle, json, notFound } from "@/lib/http";
import { getExpense, parseCustomShares, writeExpenseShares } from "@/lib/ledger";
import { cents, day, oneOf, optStr, str } from "@/lib/validate";
import type { SplitMode } from "@/lib/types";

export const runtime = "nodejs";

const SPLIT_MODES = ["shares", "equal", "custom", "none"] as const;

type Params = { params: Promise<{ houseId: string; expenseId: string }> };

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId, expenseId } = await params;
    await requireRole(req, houseId, "member");
    const expense = await getExpense(houseId, expenseId);
    if (!expense) throw notFound("Expense not found.");
    return json({ expense });
  });
}

export async function PATCH(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId, expenseId } = await params;
    const ctx = await requireAdmin(req, houseId);

    const before = await getExpense(houseId, expenseId);
    if (!before) throw notFound("Expense not found.");

    const raw = await body<Record<string, unknown>>(req);
    const fields: Record<string, string | number | null> = {};

    if (raw.description !== undefined) {
      fields.description = str(raw.description, "Description", { max: 200 });
    }
    if (raw.amountCents !== undefined) {
      const amount = cents(raw.amountCents, "Amount");
      if (amount === 0) throw badRequest("An expense needs an amount.");
      fields.amount_cents = amount;
    }
    if (raw.incurredOn !== undefined) fields.incurred_on = day(raw.incurredOn, "Date");
    if (raw.splitMode !== undefined) {
      fields.split_mode = oneOf<SplitMode>(raw.splitMode, "Split mode", SPLIT_MODES);
    }
    if (raw.categoryId !== undefined) fields.category_id = optStr(raw.categoryId, "Category", 20);
    if (raw.paidBy !== undefined) fields.paid_by = optStr(raw.paidBy, "Paid by", 20);
    if (raw.receiptUrl !== undefined) fields.receipt_url = optStr(raw.receiptUrl, "Receipt URL", 1000);
    if (raw.note !== undefined) fields.note = optStr(raw.note, "Note", 2000);

    fields.updated_at = Date.now();

    const keys = Object.keys(fields);
    const c = await db();
    await c.execute({
      sql: `UPDATE expenses SET ${keys.map((k) => `${k} = ?`).join(", ")}
            WHERE id = ? AND house_id = ?`,
      args: [...keys.map((k) => fields[k]), expenseId, houseId],
    });

    // The allocation is materialised, so any change to the amount or the split
    // mode has to rewrite expense_shares — otherwise the shares silently keep
    // adding up to yesterday's total.
    const amountCents = Number(fields.amount_cents ?? before.amountCents);
    const splitMode = (fields.split_mode as SplitMode) ?? before.splitMode;
    const custom =
      splitMode === "custom"
        ? parseCustomShares(raw.shares ?? before.shares, amountCents)
        : undefined;
    await writeExpenseShares(expenseId, houseId, amountCents, splitMode, custom);

    await audit(ctx, "expense.update", "expense", expenseId, fields);

    return json({ expense: await getExpense(houseId, expenseId) });
  });
}

export async function DELETE(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId, expenseId } = await params;
    const ctx = await requireAdmin(req, houseId);

    const c = await db();
    // Soft delete: the row stays so the audit log still resolves, and
    // computeLedger() filters on deleted_at IS NULL.
    const res = await c.execute({
      sql: `UPDATE expenses SET deleted_at = ?, updated_at = ?
            WHERE id = ? AND house_id = ? AND deleted_at IS NULL`,
      args: [Date.now(), Date.now(), expenseId, houseId],
    });
    if (res.rowsAffected === 0) throw notFound("Expense not found.");

    await audit(ctx, "expense.delete", "expense", expenseId);
    return json({ ok: true });
  });
}
