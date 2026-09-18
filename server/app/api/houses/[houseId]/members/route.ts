// GET /api/houses/:houseId/members -> { members: Member[] }
//
// The roster, visible to everyone in the house including guests — a guest
// should be able to see whose house they're in. Email addresses are redacted
// for guests: knowing who is around is different from getting everyone's
// contact details.

import { db } from "@/lib/db";
import { requireMember } from "@/lib/guard";
import { handle, json } from "@/lib/http";
import { rowToUser } from "@/lib/rows";
import type { Member, Role } from "@/lib/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ houseId: string }> };

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireMember(req, houseId);

    const c = await db();
    const res = await c.execute({
      sql: `SELECT m.*, u.id AS u_id, u.email, u.name, u.avatar_emoji, u.avatar_color
            FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.house_id = ? AND m.status = 'active'
            ORDER BY
              CASE m.role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END,
              m.joined_at`,
      args: [houseId],
    });

    const members: Member[] = res.rows.map((r) => {
      const user = rowToUser({
        id: r.u_id,
        email: ctx.role === "guest" ? "" : r.email,
        name: r.name,
        avatar_emoji: r.avatar_emoji,
        avatar_color: r.avatar_color,
      });
      return {
        houseId,
        userId: String(r.user_id),
        role: String(r.role) as Role,
        shareBps: Number(r.share_bps),
        status: "active",
        nickname: r.nickname == null ? null : String(r.nickname),
        joinedAt: Number(r.joined_at),
        user,
      };
    });

    return json({ members });
  });
}
