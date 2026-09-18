// Invite redemption. Shared by the /join/<token> page and
// POST /api/invites/<token> so the browser flow and the native-app flow can
// never diverge on who ends up in which house at which role.

import { db } from "./db";
import { hashToken } from "./ids";
import { badRequest, forbidden } from "./http";
import type { Role, User } from "./types";

export type InvitePreview = {
  houseId: string;
  houseName: string;
  season: string;
  role: Role;
  /** Set when the invite is locked to one address. */
  email: string | null;
  inviterName: string;
};

export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const c = await db();
  const res = await c.execute({
    sql: `SELECT i.*, h.name AS house_name, h.season, h.archived_at AS house_archived_at,
                 u.name AS inviter_name
          FROM invites i
          JOIN houses h ON h.id = i.house_id
          LEFT JOIN users u ON u.id = i.created_by
          WHERE i.token_hash = ?`,
    args: [hashToken(token)],
  });
  const r = res.rows[0];
  if (!r) return null;

  const live =
    r.revoked_at == null &&
    r.house_archived_at == null &&
    Number(r.expires_at) > Date.now() &&
    Number(r.used_count) < Number(r.max_uses);
  if (!live) return null;

  return {
    houseId: String(r.house_id),
    houseName: String(r.house_name),
    season: String(r.season ?? ""),
    role: String(r.role) as Role,
    email: r.email == null ? null : String(r.email),
    inviterName: String(r.inviter_name ?? "A manager"),
  };
}

export type RedeemResult = { houseId: string; houseName: string; role: Role };

/**
 * Add `user` to the invite's house.
 *
 * Re-redeeming is a no-op rather than an error: people click the link in the
 * email twice, and "you're already in" should land them in the house, not on
 * an error page. The use counter only moves when someone actually joins.
 *
 * An existing membership is never downgraded — an admin who happens to click a
 * guest link keeps their keys.
 */
export async function redeemInvite(token: string, user: User): Promise<RedeemResult> {
  const c = await db();
  const hash = hashToken(token);

  const preview = await previewInvite(token);
  if (!preview) throw badRequest("That invite link has expired or was already used.");

  if (preview.email && preview.email !== user.email.toLowerCase()) {
    throw forbidden(`That invite was sent to ${preview.email}. Sign in with that address.`);
  }

  const existing = await c.execute({
    sql: "SELECT role FROM memberships WHERE house_id = ? AND user_id = ?",
    args: [preview.houseId, user.id],
  });

  if (existing.rows[0]) {
    const rank: Record<Role, number> = { guest: 0, member: 1, admin: 2 };
    const current = String(existing.rows[0].role) as Role;
    const role = rank[preview.role] > rank[current] ? preview.role : current;
    await c.execute({
      sql: `UPDATE memberships SET status = 'active', role = ? WHERE house_id = ? AND user_id = ?`,
      args: [role, preview.houseId, user.id],
    });
    return { houseId: preview.houseId, houseName: preview.houseName, role };
  }

  const inviteShare = await c.execute({
    sql: "SELECT share_bps FROM invites WHERE token_hash = ?",
    args: [hash],
  });

  await c.batch(
    [
      {
        sql: `INSERT INTO memberships (house_id, user_id, role, share_bps, status, joined_at)
              VALUES (?, ?, ?, ?, 'active', ?)`,
        args: [
          preview.houseId,
          user.id,
          preview.role,
          Number(inviteShare.rows[0]?.share_bps ?? 0),
          Date.now(),
        ],
      },
      {
        // Guarded increment: two people opening the same open link at once
        // can't both slip past max_uses.
        sql: `UPDATE invites SET used_count = used_count + 1
              WHERE token_hash = ? AND used_count < max_uses`,
        args: [hash],
      },
    ],
    "write",
  );

  return { houseId: preview.houseId, houseName: preview.houseName, role: preview.role };
}
