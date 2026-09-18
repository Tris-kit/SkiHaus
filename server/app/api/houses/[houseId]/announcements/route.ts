// GET   /api/houses/:houseId/announcements -> { announcements, unread }
// POST  /api/houses/:houseId/announcements -> { ok }    (admin)
// PATCH /api/houses/:houseId/announcements { readAll: true } -> { ok }
//
// The v1 notification surface. Push and email digests will read from this
// same table (CONTEXT.md §8), so the feed is the source of truth for "what
// happened" regardless of how it eventually gets delivered.

import { announce } from "@/lib/announce";
import { db } from "@/lib/db";
import { requireAdmin, requireMember } from "@/lib/guard";
import { body, handle, json } from "@/lib/http";
import { bool, oneOf, optStr, parseRoles, rolesCsv, str } from "@/lib/validate";
import type { Announcement } from "@/lib/types";

export const runtime = "nodejs";

const KINDS = ["note", "urgent", "vote", "expense", "guest"] as const;

type Params = { params: Promise<{ houseId: string }> };

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireMember(req, houseId);

    const c = await db();
    const res = await c.execute({
      sql: `SELECT a.*, r.read_at FROM announcements a
            LEFT JOIN announcement_reads r
              ON r.announcement_id = a.id AND r.user_id = ?
            WHERE a.house_id = ?
            ORDER BY a.created_at DESC LIMIT 200`,
      args: [ctx.user.id, houseId],
    });

    const announcements: Announcement[] = res.rows
      .map((r) => ({
        id: String(r.id),
        houseId,
        title: String(r.title),
        body: String(r.body ?? ""),
        kind: String(r.kind) as Announcement["kind"],
        linkPath: r.link_path == null ? null : String(r.link_path),
        audience: parseRoles(String(r.audience)),
        createdBy: r.created_by == null ? null : String(r.created_by),
        createdAt: Number(r.created_at),
        readByMe: r.read_at != null,
      }))
      // Audience is filtered here rather than in SQL: it's a CSV column and a
      // LIKE against it would match 'member' inside 'non-member' if the vocab
      // ever grows.
      .filter((a) => a.audience.includes(ctx.role));

    return json({
      announcements,
      unread: announcements.filter((a) => !a.readByMe).length,
    });
  });
}

export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireAdmin(req, houseId);
    const raw = await body<Record<string, unknown>>(req);

    await announce({
      houseId,
      title: str(raw.title, "Title", { max: 200 }),
      body: optStr(raw.body, "Message", 4000) ?? "",
      kind: oneOf(raw.kind ?? "note", "Kind", KINDS),
      audience: parseRoles(rolesCsv(raw.audience, "Audience", ["admin", "member"])),
      actorId: ctx.user.id,
    });

    return json({ ok: true }, 201);
  });
}

export async function PATCH(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireMember(req, houseId);
    const raw = await body<Record<string, unknown>>(req);
    if (!bool(raw.readAll, "Read all", false)) return json({ ok: true });

    // Mark-all-read as one INSERT…SELECT rather than a round trip per row.
    const c = await db();
    await c.execute({
      sql: `INSERT INTO announcement_reads (announcement_id, user_id, read_at)
            SELECT a.id, ?, ? FROM announcements a WHERE a.house_id = ?
            ON CONFLICT(announcement_id, user_id) DO NOTHING`,
      args: [ctx.user.id, Date.now(), houseId],
    });

    return json({ ok: true });
  });
}
