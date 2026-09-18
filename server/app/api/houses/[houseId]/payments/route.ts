// GET  /api/houses/:houseId/payments -> { payments }  (member)
// POST /api/houses/:houseId/payments -> { payment }    (member — see below)
//
// Settlements are RECORDED, never executed (CONTEXT.md §7). Someone Venmos
// someone, then one of them writes it down here.
//
// A member may only record a payment they sent. That keeps the ledger honest
// in the direction that matters: you can say "I paid you", you cannot say
// "they paid me" and quietly wipe your own debt. An admin can record any leg,
// because reconciling the house account is their job.

import { db } from "@/lib/db";
import { audit, requireRole } from "@/lib/guard";
import { badRequest, body, forbidden, handle, json } from "@/lib/http";
import { shortId } from "@/lib/ids";
import { cents, day, oneOf, optStr, str } from "@/lib/validate";
import type { Payment, PaymentMethod } from "@/lib/types";

export const runtime = "nodejs";

const METHODS = ["venmo", "zelle", "cash", "check", "other"] as const;

type Params = { params: Promise<{ houseId: string }> };

function rowToPayment(r: Record<string, unknown>): Payment {
  return {
    id: String(r.id),
    houseId: String(r.house_id),
    fromUser: String(r.from_user),
    toUser: r.to_user == null ? null : String(r.to_user),
    amountCents: Number(r.amount_cents),
    method: String(r.method) as PaymentMethod,
    paidOn: String(r.paid_on),
    note: r.note == null ? null : String(r.note),
    recordedBy: String(r.recorded_by),
    createdAt: Number(r.created_at),
  };
}

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    await requireRole(req, houseId, "member");

    const c = await db();
    const res = await c.execute({
      sql: `SELECT * FROM payments WHERE house_id = ? AND deleted_at IS NULL
            ORDER BY paid_on DESC, created_at DESC LIMIT 300`,
      args: [houseId],
    });

    return json({ payments: res.rows.map((r) => rowToPayment(r as Record<string, unknown>)) });
  });
}

export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireRole(req, houseId, "member");
    const raw = await body<Record<string, unknown>>(req);

    const fromUser = str(raw.fromUser, "From", { max: 20 });
    // null = paid into the house account: settles the payer's debt without
    // crediting any individual.
    const toUser = optStr(raw.toUser, "To", 20);
    const amountCents = cents(raw.amountCents, "Amount");
    const method = oneOf<PaymentMethod>(raw.method ?? "other", "Method", METHODS);
    const paidOn = day(raw.paidOn, "Date");
    const note = optStr(raw.note, "Note", 500);

    if (amountCents <= 0) throw badRequest("A payment needs an amount.");
    if (fromUser === toUser) throw badRequest("A payment needs two different people.");
    if (!ctx.isAdmin && fromUser !== ctx.user.id) {
      throw forbidden("You can only record a payment you sent.");
    }

    const id = shortId(12);
    const c = await db();
    await c.execute({
      sql: `INSERT INTO payments (id, house_id, from_user, to_user, amount_cents, method, paid_on, note, recorded_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, houseId, fromUser, toUser, amountCents, method, paidOn, note, ctx.user.id, Date.now()],
    });
    await audit(ctx, "payment.create", "payment", id, { fromUser, toUser, amountCents });

    const res = await c.execute({ sql: "SELECT * FROM payments WHERE id = ?", args: [id] });
    return json({ payment: rowToPayment(res.rows[0] as Record<string, unknown>) }, 201);
  });
}
