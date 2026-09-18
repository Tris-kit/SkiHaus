// GET  /api/houses/:houseId/expenses -> { expenses }            (member)
// POST /api/houses/:houseId/expenses -> { expense }              (admin)
//
// Recording spending is a manager job — that asymmetry is the product, not an
// oversight (CONTEXT.md §4). Members see every line; only an admin writes one.

import { audit, requireAdmin, requireRole } from "@/lib/guard";
import { db } from "@/lib/db";
import { shortId } from "@/lib/ids";
import { badRequest, body, handle, json } from "@/lib/http";
import { getExpense, listExpenses, parseCustomShares, writeExpenseShares } from "@/lib/ledger";
import { cents, day, oneOf, optStr, str } from "@/lib/validate";
import type { SplitMode } from "@/lib/types";

export const runtime = "nodejs";

const SPLIT_MODES = ["shares", "equal", "custom", "none"] as const;

type Params = { params: Promise<{ houseId: string }> };

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    // Guests never see the ledger.
    await requireRole(req, houseId, "member");
    return json({ expenses: await listExpenses(houseId) });
  });
}

export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireAdmin(req, houseId);
    const raw = await body<Record<string, unknown>>(req);

    const description = str(raw.description, "Description", { max: 200 });
    const amountCents = cents(raw.amountCents, "Amount");
    const incurredOn = day(raw.incurredOn, "Date");
    const splitMode = oneOf<SplitMode>(raw.splitMode ?? "shares", "Split mode", SPLIT_MODES);
    const categoryId = optStr(raw.categoryId, "Category", 20);
    const paidBy = optStr(raw.paidBy, "Paid by", 20);
    const receiptUrl = optStr(raw.receiptUrl, "Receipt URL", 1000);
    const note = optStr(raw.note, "Note", 2000);

    if (amountCents === 0) throw badRequest("An expense needs an amount.");

    const custom =
      splitMode === "custom" ? parseCustomShares(raw.shares, amountCents) : undefined;

    const id = shortId(12);
    const now = Date.now();
    const c = await db();

    await c.execute({
      sql: `INSERT INTO expenses
              (id, house_id, category_id, description, amount_cents, paid_by, incurred_on,
               split_mode, receipt_url, note, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, houseId, categoryId, description, amountCents, paidBy, incurredOn,
        splitMode, receiptUrl, note, ctx.user.id, now, now,
      ],
    });

    await writeExpenseShares(id, houseId, amountCents, splitMode, custom);
    await audit(ctx, "expense.create", "expense", id, { description, amountCents });

    return json({ expense: await getExpense(houseId, id) }, 201);
  });
}
