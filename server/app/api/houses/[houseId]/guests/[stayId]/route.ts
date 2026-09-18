// PATCH  /api/houses/:houseId/guests/:stayId
//   { status?, feeCents?, paid?, partySize?, arriveOn?, departOn?, note? }
//   -> { stay, guestUrl? }
// DELETE /api/houses/:houseId/guests/:stayId -> { ok: true }
//
// Who may change what:
//   host   — their own stay's dates/party/note, and cancelling it
//   admin  — all of the above, plus status, fee, and marking it paid
//
// Approving mints a fresh guest link and emails it (see rotateGuestToken()).

import { announce } from "@/lib/announce";
import { db } from "@/lib/db";
import { audit, requireRole } from "@/lib/guard";
import { badRequest, body, forbidden, handle, json, notFound, originFrom } from "@/lib/http";
import { getGuestStay, notifyGuest, quote, rotateGuestToken } from "@/lib/guests";
import { formatMoney } from "@/lib/money";
import { bool, cents, dateRange, int, oneOf, optStr } from "@/lib/validate";
import type { GuestStatus } from "@/lib/types";

export const runtime = "nodejs";

const STATUSES = ["pending", "approved", "declined", "cancelled"] as const;

type Params = { params: Promise<{ houseId: string; stayId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId, stayId } = await params;
    const ctx = await requireRole(req, houseId, "member");

    const before = await getGuestStay(houseId, stayId);
    if (!before) throw notFound("Guest stay not found.");

    const isHost = before.hostUserId === ctx.user.id;
    if (!isHost && !ctx.isAdmin) throw forbidden("That's not your guest.");

    const raw = await body<Record<string, unknown>>(req);
    const fields: Record<string, string | number | null> = {};

    // --- things the host may change ---
    let arriveOn = before.arriveOn;
    let departOn = before.departOn;
    if (raw.arriveOn !== undefined || raw.departOn !== undefined) {
      const range = dateRange(raw.arriveOn ?? before.arriveOn, raw.departOn ?? before.departOn);
      arriveOn = range.arriveOn;
      departOn = range.departOn;
      fields.arrive_on = arriveOn;
      fields.depart_on = departOn;
    }

    let partySize = before.partySize;
    if (raw.partySize !== undefined) {
      partySize = int(raw.partySize, "Party size", { min: 1, max: 20 });
      fields.party_size = partySize;
    }

    if (raw.note !== undefined) fields.note = optStr(raw.note, "Note", 1000);

    // Dates or headcount changed → re-quote, unless a manager has pinned the
    // fee by hand. An override is a decision, not a cached value.
    if ((fields.arrive_on !== undefined || fields.party_size !== undefined) && !before.feeIsOverride) {
      fields.fee_cents = await quote(houseId, arriveOn, departOn, partySize);
    }

    // --- things only an admin may change ---
    let nextStatus: GuestStatus = before.status;

    if (raw.status !== undefined) {
      const requested = oneOf<GuestStatus>(raw.status, "Status", STATUSES);
      // A host may cancel their own guest and nothing else; approving your own
      // request would make manager approval meaningless.
      if (!ctx.isAdmin && requested !== "cancelled") {
        throw forbidden("Only a manager can approve or price a guest stay.");
      }
      nextStatus = requested;
      fields.status = requested;
    }

    if (raw.feeCents !== undefined) {
      if (!ctx.isAdmin) throw forbidden("Only a manager can set the fee.");
      fields.fee_cents = cents(raw.feeCents, "Fee");
      fields.fee_is_override = 1;
    }

    if (raw.paid !== undefined) {
      if (!ctx.isAdmin) throw forbidden("Only a manager can mark a fee paid.");
      fields.paid_at = bool(raw.paid, "Paid") ? Date.now() : null;
    }

    fields.updated_at = Date.now();

    const keys = Object.keys(fields);
    const c = await db();
    await c.execute({
      sql: `UPDATE guest_stays SET ${keys.map((k) => `${k} = ?`).join(", ")}
            WHERE id = ? AND house_id = ?`,
      args: [...keys.map((k) => fields[k]), stayId, houseId],
    });

    // Newly approved: mint a link and tell the guest.
    let guestUrl: string | undefined;
    if (nextStatus === "approved" && before.status !== "approved") {
      guestUrl = await rotateGuestToken(stayId, originFrom(req));
      const after = await getGuestStay(houseId, stayId);
      await notifyGuest({
        guestUrl,
        houseId,
        hostName: ctx.user.name,
        guestEmail: before.guestEmail,
        arriveOn,
        departOn,
        feeCents: after?.feeCents ?? before.feeCents,
      });
      await announce({
        houseId,
        title: `Guest approved: ${before.guestName}`,
        body: `${arriveOn} → ${departOn}${
          (after?.feeCents ?? 0) > 0 ? ` · ${formatMoney(after?.feeCents ?? 0)}` : ""
        }`,
        kind: "guest",
        linkPath: `/guests/${stayId}`,
        actorId: ctx.user.id,
      });
    }

    await audit(ctx, "guest.update", "guest_stay", stayId, fields);

    return json({ stay: await getGuestStay(houseId, stayId), guestUrl });
  });
}

export async function DELETE(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId, stayId } = await params;
    const ctx = await requireRole(req, houseId, "member");

    const stay = await getGuestStay(houseId, stayId);
    if (!stay) throw notFound("Guest stay not found.");
    if (stay.hostUserId !== ctx.user.id && !ctx.isAdmin) throw forbidden("That's not your guest.");
    if (stay.paidAt != null) {
      throw badRequest("That fee is already recorded as paid — cancel it instead of deleting.");
    }

    const c = await db();
    await c.execute({ sql: "DELETE FROM guest_stays WHERE id = ? AND house_id = ?", args: [stayId, houseId] });
    await audit(ctx, "guest.delete", "guest_stay", stayId);

    return json({ ok: true });
  });
}
