// GET   /api/houses/:houseId/dinners?from=&to= -> { dinners }   (guest)
// POST  /api/houses/:houseId/dinners -> { dinner }               (member)
// PATCH /api/houses/:houseId/dinners { id, rsvp | ...fields } -> { dinner }
//
// One dinner per night per house — the unique index enforces it, and POST
// upserts. "Where are we eating Saturday?" has one answer, and letting two
// people create two competing Saturdays is how you get two reservations.
//
// RSVPs are open to guests: someone's friend being in or out for dinner is
// exactly the thing the cook needs to know.

import { db } from "@/lib/db";
import { requireMember, requireRole } from "@/lib/guard";
import { badRequest, body, handle, json, notFound } from "@/lib/http";
import { shortId } from "@/lib/ids";
import { day as parseDay, int, oneOf, optStr, str } from "@/lib/validate";
import type { Dinner, RsvpStatus } from "@/lib/types";

export const runtime = "nodejs";

const KINDS = ["in", "out"] as const;
const RESERVATION = ["none", "requested", "confirmed"] as const;
const RSVPS = ["in", "out", "maybe"] as const;

type Params = { params: Promise<{ houseId: string }> };

async function loadDinners(houseId: string, from: string | null, to: string | null): Promise<Dinner[]> {
  const c = await db();
  const [dRes, rRes] = await Promise.all([
    c.execute({
      sql: `SELECT * FROM dinners WHERE house_id = ?
              AND (? IS NULL OR day >= ?) AND (? IS NULL OR day <= ?)
            ORDER BY day LIMIT 400`,
      args: [houseId, from, from, to, to],
    }),
    c.execute({
      sql: `SELECT r.* FROM dinner_rsvps r JOIN dinners d ON d.id = r.dinner_id
            WHERE d.house_id = ?`,
      args: [houseId],
    }),
  ]);

  const byDinner = new Map<string, Dinner["rsvps"]>();
  for (const r of rRes.rows) {
    const key = String(r.dinner_id);
    const list = byDinner.get(key) ?? [];
    list.push({
      userId: String(r.user_id),
      status: String(r.status) as RsvpStatus,
      plusOnes: Number(r.plus_ones),
    });
    byDinner.set(key, list);
  }

  return dRes.rows.map((r) => ({
    id: String(r.id),
    houseId,
    day: String(r.day),
    kind: String(r.kind) as "in" | "out",
    venueId: r.venue_id == null ? null : String(r.venue_id),
    cookUserId: r.cook_user_id == null ? null : String(r.cook_user_id),
    timeLocal: r.time_local == null ? null : String(r.time_local),
    reservationStatus: String(r.reservation_status) as Dinner["reservationStatus"],
    pollId: r.poll_id == null ? null : String(r.poll_id),
    note: r.note == null ? null : String(r.note),
    rsvps: byDinner.get(String(r.id)) ?? [],
  }));
}

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    await requireMember(req, houseId);
    const url = new URL(req.url);
    return json({
      dinners: await loadDinners(houseId, url.searchParams.get("from"), url.searchParams.get("to")),
    });
  });
}

export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireRole(req, houseId, "member");
    const raw = await body<Record<string, unknown>>(req);

    const day = parseDay(raw.day, "Day");
    const kind = oneOf(raw.kind ?? "out", "Kind", KINDS);
    const venueId = optStr(raw.venueId, "Venue", 20);
    const cookUserId = optStr(raw.cookUserId, "Cook", 20);
    const timeLocal = optStr(raw.timeLocal, "Time", 10);
    const reservationStatus = oneOf(raw.reservationStatus ?? "none", "Reservation", RESERVATION);
    const note = optStr(raw.note, "Note", 500);

    const c = await db();
    await c.execute({
      sql: `INSERT INTO dinners (id, house_id, day, kind, venue_id, cook_user_id, time_local, reservation_status, note, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(house_id, day) DO UPDATE SET
              kind = excluded.kind,
              venue_id = excluded.venue_id,
              cook_user_id = excluded.cook_user_id,
              time_local = excluded.time_local,
              reservation_status = excluded.reservation_status,
              note = excluded.note`,
      args: [
        shortId(12), houseId, day, kind, venueId, cookUserId, timeLocal,
        reservationStatus, note, ctx.user.id, Date.now(),
      ],
    });

    const [dinner] = await loadDinners(houseId, day, day);
    return json({ dinner }, 201);
  });
}

export async function PATCH(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    // Guests may RSVP — that's the one write in the whole app they get.
    const ctx = await requireMember(req, houseId);
    const raw = await body<Record<string, unknown>>(req);

    const id = str(raw.id, "Dinner", { max: 20 });
    if (raw.rsvp === undefined) throw badRequest("Nothing to change.");

    const status = oneOf<RsvpStatus>(raw.rsvp, "RSVP", RSVPS);
    const plusOnes = raw.plusOnes === undefined ? 0 : int(raw.plusOnes, "Plus ones", { min: 0, max: 10 });

    const c = await db();
    const cur = await c.execute({
      sql: "SELECT day FROM dinners WHERE id = ? AND house_id = ?",
      args: [id, houseId],
    });
    if (!cur.rows[0]) throw notFound("Dinner not found.");

    await c.execute({
      sql: `INSERT INTO dinner_rsvps (dinner_id, user_id, status, plus_ones, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(dinner_id, user_id) DO UPDATE SET
              status = excluded.status,
              plus_ones = excluded.plus_ones,
              updated_at = excluded.updated_at`,
      args: [id, ctx.user.id, status, plusOnes, Date.now()],
    });

    const dayStr = String(cur.rows[0].day);
    const [dinner] = await loadDinners(houseId, dayStr, dayStr);
    return json({ dinner });
  });
}
