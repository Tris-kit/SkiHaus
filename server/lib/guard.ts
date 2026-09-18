// Authorisation. This is the only place that decides who may do what.
//
// THE RULE: every handler that touches house-scoped data starts with
// `requireMember(req, houseId)` or `requireRole(req, houseId, "admin")`. There
// is no other path to a house's rows. If you find yourself querying by
// `house_id` without having gone through here first, that is the bug.
//
// The guards return a `Ctx` carrying the caller and their role in *that* house,
// because the same person is an admin of one lease and a guest of another.

import { requireUser } from "./auth";
import { db } from "./db";
import { forbidden, notFound } from "./http";
import { rowToHouse } from "./rows";
import { shortId } from "./ids";
import { ROLE_RANK, type House, type Role, type User } from "./types";

export type Ctx = {
  user: User;
  houseId: string;
  role: Role;
  shareBps: number;
  isAdmin: boolean;
};

export async function getHouse(houseId: string): Promise<House | null> {
  const c = await db();
  const res = await c.execute({
    sql: "SELECT * FROM houses WHERE id = ? AND archived_at IS NULL",
    args: [houseId],
  });
  const row = res.rows[0];
  return row ? rowToHouse(row as Record<string, unknown>) : null;
}

/**
 * Caller must belong to this house in any role.
 *
 * A non-member gets 404, not 403 — "you may not see this house" and "this
 * house does not exist" must be indistinguishable, or the id space becomes
 * enumerable and anyone can discover which leases exist.
 */
export async function requireMember(req: Request, houseId: string): Promise<Ctx> {
  const user = await requireUser(req);
  const c = await db();

  const res = await c.execute({
    sql: `SELECT m.role, m.share_bps FROM memberships m
          JOIN houses h ON h.id = m.house_id
          WHERE m.house_id = ? AND m.user_id = ? AND m.status = 'active'
            AND h.archived_at IS NULL`,
    args: [houseId, user.id],
  });
  const row = res.rows[0];
  if (!row) throw notFound("House not found.");

  const role = String(row.role) as Role;
  return { user, houseId, role, shareBps: Number(row.share_bps), isAdmin: role === "admin" };
}

/** Caller must be at least `min` in this house (guest < member < admin). */
export async function requireRole(req: Request, houseId: string, min: Role): Promise<Ctx> {
  const ctx = await requireMember(req, houseId);
  if (ROLE_RANK[ctx.role] < ROLE_RANK[min]) {
    throw forbidden(
      min === "admin"
        ? "Only a house manager can do that."
        : "Guests can't do that — ask a member.",
    );
  }
  return ctx;
}

/** Shorthand for the many manager-only endpoints. */
export function requireAdmin(req: Request, houseId: string): Promise<Ctx> {
  return requireRole(req, houseId, "admin");
}

/** Caller may act on `targetUserId`'s row: it's theirs, or they're a manager. */
export function requireSelfOrAdmin(ctx: Ctx, targetUserId: string): void {
  if (ctx.user.id !== targetUserId && !ctx.isAdmin) {
    throw forbidden("You can only change your own entries.");
  }
}

/**
 * The roster used to split an expense: every active admin and member.
 *
 * Guests are excluded by design — a guest owes a flat fee, they are not a
 * shareholder in the plow bill.
 */
export async function splitRoster(
  houseId: string,
): Promise<Array<{ userId: string; shareBps: number }>> {
  const c = await db();
  const res = await c.execute({
    sql: `SELECT user_id, share_bps FROM memberships
          WHERE house_id = ? AND status = 'active' AND role IN ('admin','member')
          ORDER BY joined_at, user_id`,
    args: [houseId],
  });
  return res.rows.map((r) => ({
    userId: String(r.user_id),
    shareBps: Number(r.share_bps),
  }));
}

/** Append to the house's audit trail. Never throws — logging must not 500. */
export async function audit(
  ctx: Pick<Ctx, "houseId" | "user">,
  action: string,
  entity: string,
  entityId: string | null,
  detail?: unknown,
): Promise<void> {
  try {
    const c = await db();
    await c.execute({
      sql: `INSERT INTO audit_log (id, house_id, actor_id, action, entity, entity_id, detail, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        shortId(12),
        ctx.houseId,
        ctx.user.id,
        action,
        entity,
        entityId,
        detail === undefined ? null : JSON.stringify(detail).slice(0, 4000),
        Date.now(),
      ],
    });
  } catch (e) {
    console.error("[audit] failed", e);
  }
}
