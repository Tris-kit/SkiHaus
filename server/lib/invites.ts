// Invite redemption. Shared by the /join/<token> page and
// POST /api/invites/<token> so the browser flow and the native-app flow can
// never diverge on who ends up in which house at which role.

import { db } from "./db";
import { hashToken } from "./ids";
import { badRequest, forbidden } from "./http";
import type { Role, User } from "./types";

// Two ways into a house, both landing here:
//
//   a link   — /invite/<token>, works for anyone who has the URL
//   an email — the invite carries an address, and is applied automatically
//              the moment an account proves it controls that address
//
// The second is why a manager can type twelve addresses and never think
// about it again; see claimPendingInvites().

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
 * Add someone to a house, never downgrading them.
 *
 * An admin who happens to click a guest link keeps their keys, and a
 * previously removed member is reinstated rather than duplicated.
 */
async function grantMembership(
  houseId: string,
  userId: string,
  role: Role,
  shareBps: number,
): Promise<Role> {
  const c = await db();
  const existing = await c.execute({
    sql: "SELECT role FROM memberships WHERE house_id = ? AND user_id = ?",
    args: [houseId, userId],
  });

  if (existing.rows[0]) {
    const rank: Record<Role, number> = { guest: 0, member: 1, admin: 2 };
    const current = String(existing.rows[0].role) as Role;
    const best = rank[role] > rank[current] ? role : current;
    await c.execute({
      sql: "UPDATE memberships SET status = 'active', role = ? WHERE house_id = ? AND user_id = ?",
      args: [best, houseId, userId],
    });
    return best;
  }

  await c.execute({
    sql: `INSERT INTO memberships (house_id, user_id, role, share_bps, status, joined_at)
          VALUES (?, ?, ?, ?, 'active', ?)`,
    args: [houseId, userId, role, shareBps, Date.now()],
  });
  return role;
}

/**
 * Apply every live invite addressed to this person's email.
 *
 * This is what makes "invite by email" work without anyone clicking
 * anything. A manager types their housemates' addresses; whenever each person
 * gets round to making an account, they are already in the house.
 *
 * WHY THIS IS SAFE. The match is on an email the account has *proved* it
 * controls — registration confirms the address, and this only ever runs after
 * that proof. Matching on an unverified address would let anyone claim a seat
 * by typing a housemate's email at signup, which is exactly the hole that
 * enforcing verification closed.
 *
 * Called at two moments: when an address is confirmed (catches invites sent
 * before the account existed) and on each successful sign-in (catches invites
 * sent after).
 */
export async function claimPendingInvites(user: User): Promise<RedeemResult[]> {
  const c = await db();
  const now = Date.now();

  const res = await c.execute({
    sql: `SELECT i.token_hash, i.house_id, i.role, i.share_bps, h.name AS house_name
          FROM invites i
          JOIN houses h ON h.id = i.house_id
          WHERE i.email = ?
            AND i.revoked_at IS NULL
            AND i.expires_at > ?
            AND i.used_count < i.max_uses
            AND h.archived_at IS NULL`,
    args: [user.email.toLowerCase(), now],
  });

  const claimed: RedeemResult[] = [];

  for (const r of res.rows) {
    const houseId = String(r.house_id);
    try {
      const role = await grantMembership(
        houseId,
        user.id,
        String(r.role) as Role,
        Number(r.share_bps),
      );
      await c.execute({
        // Guarded so two concurrent sign-ins can't both consume the same use.
        sql: `UPDATE invites SET used_count = used_count + 1
              WHERE token_hash = ? AND used_count < max_uses`,
        args: [String(r.token_hash)],
      });
      claimed.push({ houseId, houseName: String(r.house_name), role });
    } catch (e) {
      // One bad invite must not block sign-in or the others.
      console.error("[invites] claim failed", houseId, e);
    }
  }

  return claimed;
}

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

  const already = await c.execute({
    sql: "SELECT 1 FROM memberships WHERE house_id = ? AND user_id = ? AND status = 'active'",
    args: [preview.houseId, user.id],
  });

  const shareRes = await c.execute({
    sql: "SELECT share_bps FROM invites WHERE token_hash = ?",
    args: [hash],
  });

  const role = await grantMembership(
    preview.houseId,
    user.id,
    preview.role,
    Number(shareRes.rows[0]?.share_bps ?? 0),
  );

  // Only spend a use when someone actually joins. People click the link in
  // the email twice; that shouldn't burn a seat on an open invite.
  if (!already.rows[0]) {
    await c.execute({
      // Guarded: two people opening the same open link at once can't both
      // slip past max_uses.
      sql: `UPDATE invites SET used_count = used_count + 1
            WHERE token_hash = ? AND used_count < max_uses`,
      args: [hash],
    });
  }

  return { houseId: preview.houseId, houseName: preview.houseName, role };
}
