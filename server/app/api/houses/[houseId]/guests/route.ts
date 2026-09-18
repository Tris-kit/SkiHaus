// GET  /api/houses/:houseId/guests -> { stays }            (member)
// POST /api/houses/:houseId/guests -> { stay, guestUrl }    (member)
//
// A member invites a friend; the stay lands as `pending` with an auto-quoted
// fee. A manager prices and approves it. An admin posting here skips straight
// to `approved`, because making the manager approve their own request is
// theatre.
//
// The guest URL comes back exactly once, at creation — only its hash is
// stored. Re-issuing means POSTing the stay again.

import { announce } from "@/lib/announce";
import { db } from "@/lib/db";
import { audit, requireRole } from "@/lib/guard";
import { hashToken, secretToken, shortId } from "@/lib/ids";
import { body, handle, json, originFrom } from "@/lib/http";
import { getGuestStay, notifyGuest, quote, rowToGuestStay } from "@/lib/guests";
import { limitOrThrow } from "@/lib/rateLimit";
import { dateRange, email as parseEmail, int, optStr, str } from "@/lib/validate";

export const runtime = "nodejs";

type Params = { params: Promise<{ houseId: string }> };

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    await requireRole(req, houseId, "member");

    const c = await db();
    const res = await c.execute({
      sql: `SELECT * FROM guest_stays WHERE house_id = ?
            ORDER BY arrive_on DESC LIMIT 300`,
      args: [houseId],
    });

    return json({ stays: res.rows.map((r) => rowToGuestStay(r as Record<string, unknown>)) });
  });
}

export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireRole(req, houseId, "member");
    await limitOrThrow(`guest:create:${ctx.user.id}`, 30, 24 * 60 * 60);

    const raw = await body<Record<string, unknown>>(req);
    const guestName = str(raw.guestName, "Guest name", { max: 80 });
    const guestEmail = raw.guestEmail == null || raw.guestEmail === "" ? null : parseEmail(raw.guestEmail);
    const partySize = int(raw.partySize ?? 1, "Party size", { min: 1, max: 20 });
    const { arriveOn, departOn } = dateRange(raw.arriveOn, raw.departOn);
    const note = optStr(raw.note, "Note", 1000);

    const feeCents = await quote(houseId, arriveOn, departOn, partySize);
    const status = ctx.isAdmin ? "approved" : "pending";

    const id = shortId(12);
    const token = secretToken();
    const now = Date.now();
    const c = await db();

    await c.execute({
      sql: `INSERT INTO guest_stays
              (id, house_id, token_hash, host_user_id, guest_name, guest_email, party_size,
               arrive_on, depart_on, fee_cents, status, note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, houseId, hashToken(token), ctx.user.id, guestName, guestEmail, partySize,
        arriveOn, departOn, feeCents, status, note, now, now,
      ],
    });

    const guestUrl = `${originFrom(req)}/g/${token}`;

    if (status === "approved") {
      await notifyGuest({
        guestUrl,
        houseId,
        hostName: ctx.user.name,
        guestEmail,
        arriveOn,
        departOn,
        feeCents,
      });
    } else {
      await announce({
        houseId,
        title: `${ctx.user.name || "A member"} requested a guest: ${guestName}`,
        body: `${arriveOn} → ${departOn}, ${partySize} ${partySize === 1 ? "person" : "people"}.`,
        kind: "guest",
        linkPath: `/guests/${id}`,
        audience: ["admin"],
        actorId: ctx.user.id,
      });
    }

    await audit(ctx, "guest.create", "guest_stay", id, { guestName, status });

    return json({ stay: await getGuestStay(houseId, id), guestUrl }, 201);
  });
}
