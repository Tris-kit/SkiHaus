// GET  /api/houses/:houseId/stays -> { stays }  (guest — knowing who else is
//                                                around is the point)
// POST /api/houses/:houseId/stays -> { stay }    (member, own only)
//
// "Who's at the house which nights." Deliberately not a booking system: it
// does not check bed capacity and it does not stop two people claiming the
// same room. A ski house sorts that out in the group text; the app's job is to
// make it visible, not to arbitrate it.

import { db } from "@/lib/db";
import { requireMember, requireRole, requireSelfOrAdmin } from "@/lib/guard";
import { body, handle, json } from "@/lib/http";
import { shortId } from "@/lib/ids";
import { dateRange, optStr, str } from "@/lib/validate";
import type { Stay } from "@/lib/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ houseId: string }> };

function rowToStay(r: Record<string, unknown>): Stay {
  return {
    id: String(r.id),
    houseId: String(r.house_id),
    userId: String(r.user_id),
    arriveOn: String(r.arrive_on),
    departOn: String(r.depart_on),
    bed: r.bed == null ? null : String(r.bed),
    note: r.note == null ? null : String(r.note),
  };
}

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    await requireMember(req, houseId);

    const c = await db();
    const res = await c.execute({
      sql: "SELECT * FROM stays WHERE house_id = ? ORDER BY arrive_on LIMIT 500",
      args: [houseId],
    });
    return json({ stays: res.rows.map((r) => rowToStay(r as Record<string, unknown>)) });
  });
}

export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireRole(req, houseId, "member");
    const raw = await body<Record<string, unknown>>(req);

    // Admins can claim nights on someone else's behalf (people text the
    // manager rather than opening the app); everyone else, only their own.
    const userId = raw.userId === undefined ? ctx.user.id : str(raw.userId, "Member", { max: 20 });
    requireSelfOrAdmin(ctx, userId);

    const { arriveOn, departOn } = dateRange(raw.arriveOn, raw.departOn);
    const bed = optStr(raw.bed, "Bed", 60);
    const note = optStr(raw.note, "Note", 500);

    const id = shortId(12);
    const c = await db();
    await c.execute({
      sql: `INSERT INTO stays (id, house_id, user_id, arrive_on, depart_on, bed, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, houseId, userId, arriveOn, departOn, bed, note, Date.now()],
    });

    const res = await c.execute({ sql: "SELECT * FROM stays WHERE id = ?", args: [id] });
    return json({ stay: rowToStay(res.rows[0] as Record<string, unknown>) }, 201);
  });
}

export async function DELETE(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireRole(req, houseId, "member");
    const raw = await body<{ id?: unknown }>(req);
    const id = str(raw.id, "Stay", { max: 20 });

    const c = await db();
    const cur = await c.execute({
      sql: "SELECT user_id FROM stays WHERE id = ? AND house_id = ?",
      args: [id, houseId],
    });
    if (cur.rows[0]) {
      requireSelfOrAdmin(ctx, String(cur.rows[0].user_id));
      await c.execute({ sql: "DELETE FROM stays WHERE id = ?", args: [id] });
    }
    return json({ ok: true });
  });
}
