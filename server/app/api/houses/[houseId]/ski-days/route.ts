// GET  /api/houses/:houseId/ski-days?from=&to= -> { skiDays }  (guest)
// POST /api/houses/:houseId/ski-days -> { skiDay }              (member, own only)
//
// "Who's going to what mountain what day." One declaration per person per day
// — posting again overwrites, which is why the unique index exists and why
// this is an upsert rather than an insert. Changing your mind at 6am is the
// normal case, not an error.
//
// Posting with `mountainId: null` clears the day (you're taking a rest day).

import { db } from "@/lib/db";
import { requireMember, requireRole, requireSelfOrAdmin } from "@/lib/guard";
import { body, handle, json } from "@/lib/http";
import { shortId } from "@/lib/ids";
import { day as parseDay, optStr, str } from "@/lib/validate";
import type { SkiDay } from "@/lib/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ houseId: string }> };

function rowToSkiDay(r: Record<string, unknown>): SkiDay {
  return {
    id: String(r.id),
    houseId: String(r.house_id),
    userId: String(r.user_id),
    day: String(r.day),
    mountainId: r.mountain_id == null ? null : String(r.mountain_id),
    note: r.note == null ? null : String(r.note),
  };
}

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    await requireMember(req, houseId);

    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const c = await db();
    const res = await c.execute({
      sql: `SELECT * FROM ski_days WHERE house_id = ?
              AND (? IS NULL OR day >= ?)
              AND (? IS NULL OR day <= ?)
            ORDER BY day LIMIT 1000`,
      args: [houseId, from, from, to, to],
    });

    return json({ skiDays: res.rows.map((r) => rowToSkiDay(r as Record<string, unknown>)) });
  });
}

export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireRole(req, houseId, "member");
    const raw = await body<Record<string, unknown>>(req);

    const userId = raw.userId === undefined ? ctx.user.id : str(raw.userId, "Member", { max: 20 });
    requireSelfOrAdmin(ctx, userId);

    const day = parseDay(raw.day, "Day");
    const mountainId = optStr(raw.mountainId, "Mountain", 20);
    const note = optStr(raw.note, "Note", 300);

    const c = await db();

    if (mountainId === null && raw.mountainId !== undefined) {
      // Explicit null = rest day. Remove the row rather than storing a
      // mountainless entry, so "nobody declared" and "declared no mountain"
      // don't both need rendering.
      await c.execute({
        sql: "DELETE FROM ski_days WHERE house_id = ? AND user_id = ? AND day = ?",
        args: [houseId, userId, day],
      });
      return json({ skiDay: null });
    }

    await c.execute({
      sql: `INSERT INTO ski_days (id, house_id, user_id, day, mountain_id, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(house_id, user_id, day) DO UPDATE SET
              mountain_id = excluded.mountain_id,
              note = excluded.note`,
      args: [shortId(12), houseId, userId, day, mountainId, note, Date.now()],
    });

    const res = await c.execute({
      sql: "SELECT * FROM ski_days WHERE house_id = ? AND user_id = ? AND day = ?",
      args: [houseId, userId, day],
    });
    return json({ skiDay: rowToSkiDay(res.rows[0] as Record<string, unknown>) }, 201);
  });
}
