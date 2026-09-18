// PATCH  /api/houses/:houseId/members/:userId  { role?, shareBps?, nickname? }  (admin)
// DELETE /api/houses/:houseId/members/:userId                                    (admin)
//
// Both guard against the house losing its last manager — an admin demoting or
// removing themselves when nobody else can run the lease would lock everyone
// out of their own ledger with no recovery path.

import { db } from "@/lib/db";
import { audit, requireAdmin } from "@/lib/guard";
import { badRequest, body, handle, json, notFound } from "@/lib/http";
import { int, optStr, role as parseRole } from "@/lib/validate";

export const runtime = "nodejs";

type Params = { params: Promise<{ houseId: string; userId: string }> };

async function adminCount(houseId: string): Promise<number> {
  const c = await db();
  const res = await c.execute({
    sql: `SELECT COUNT(*) AS n FROM memberships
          WHERE house_id = ? AND role = 'admin' AND status = 'active'`,
    args: [houseId],
  });
  return Number(res.rows[0]?.n ?? 0);
}

export async function PATCH(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId, userId } = await params;
    const ctx = await requireAdmin(req, houseId);
    const raw = await body<Record<string, unknown>>(req);

    const c = await db();
    const cur = await c.execute({
      sql: "SELECT role FROM memberships WHERE house_id = ? AND user_id = ? AND status = 'active'",
      args: [houseId, userId],
    });
    if (!cur.rows[0]) throw notFound("That person isn't in this house.");
    const currentRole = String(cur.rows[0].role);

    const fields: Record<string, string | number | null> = {};

    if (raw.role !== undefined) {
      const next = parseRole(raw.role);
      if (currentRole === "admin" && next !== "admin" && (await adminCount(houseId)) <= 1) {
        throw badRequest("Promote someone else to manager first — a house needs one.");
      }
      fields.role = next;
    }

    if (raw.shareBps !== undefined) {
      // Not validated to sum to 10000 across the roster. Shares drift mid-season
      // as people join and leave, and allocate() normalises by the actual sum
      // anyway — forcing them to balance would just block a manager mid-edit.
      fields.share_bps = int(raw.shareBps, "Share", { min: 0, max: 10000 });
    }

    if (raw.nickname !== undefined) fields.nickname = optStr(raw.nickname, "Nickname", 40);

    const keys = Object.keys(fields);
    if (keys.length === 0) return json({ ok: true });

    await c.execute({
      sql: `UPDATE memberships SET ${keys.map((k) => `${k} = ?`).join(", ")}
            WHERE house_id = ? AND user_id = ?`,
      args: [...keys.map((k) => fields[k]), houseId, userId],
    });
    await audit(ctx, "member.update", "membership", userId, fields);

    return json({ ok: true });
  });
}

export async function DELETE(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId, userId } = await params;
    const ctx = await requireAdmin(req, houseId);

    const c = await db();
    const cur = await c.execute({
      sql: "SELECT role FROM memberships WHERE house_id = ? AND user_id = ? AND status = 'active'",
      args: [houseId, userId],
    });
    if (!cur.rows[0]) throw notFound("That person isn't in this house.");

    if (String(cur.rows[0].role) === "admin" && (await adminCount(houseId)) <= 1) {
      throw badRequest("That's the only manager — promote someone else first.");
    }

    // Soft-remove. Their name still has to render on last month's expenses.
    await c.execute({
      sql: "UPDATE memberships SET status = 'removed' WHERE house_id = ? AND user_id = ?",
      args: [houseId, userId],
    });
    await audit(ctx, "member.remove", "membership", userId);

    return json({ ok: true });
  });
}
