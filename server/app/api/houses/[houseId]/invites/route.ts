// GET  /api/houses/:houseId/invites -> { invites }                       (admin)
// POST /api/houses/:houseId/invites { email?, role, shareBps?, maxUses? }
//                                   -> { url, token }                    (admin)
//
// Two flavours, same table:
//   email set  → a personal invite, emailed, single use, locked to that address
//   email null → an open link the manager can paste into the group text
//
// The raw token is returned exactly once, at creation. Only its hash is stored,
// so a lost link has to be reissued — there is no "show me that link again".

import { db } from "@/lib/db";
import { audit, getHouse, requireAdmin } from "@/lib/guard";
import { hashToken, secretToken } from "@/lib/ids";
import { body, handle, json, originFrom } from "@/lib/http";
import { inviteEmail, sendMail } from "@/lib/mail";
import { limitOrThrow } from "@/lib/rateLimit";
import { email as parseEmail, int, role as parseRole } from "@/lib/validate";

export const runtime = "nodejs";

const INVITE_DAYS = 30;

type Params = { params: Promise<{ houseId: string }> };

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    await requireAdmin(req, houseId);

    const c = await db();
    const res = await c.execute({
      sql: `SELECT house_id, email, role, share_bps, created_at, expires_at, max_uses, used_count, revoked_at
            FROM invites WHERE house_id = ? ORDER BY created_at DESC LIMIT 100`,
      args: [houseId],
    });

    // No token_hash in the response — it is not useful to the client and there
    // is no reason to move it over the wire.
    return json({
      invites: res.rows.map((r) => ({
        email: r.email == null ? null : String(r.email),
        role: String(r.role),
        shareBps: Number(r.share_bps),
        createdAt: Number(r.created_at),
        expiresAt: Number(r.expires_at),
        maxUses: Number(r.max_uses),
        usedCount: Number(r.used_count),
        revokedAt: r.revoked_at == null ? null : Number(r.revoked_at),
      })),
    });
  });
}

export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireAdmin(req, houseId);
    await limitOrThrow(`invite:${houseId}`, 50, 24 * 60 * 60);

    const raw = await body<Record<string, unknown>>(req);
    const role = parseRole(raw.role);
    const email = raw.email == null || raw.email === "" ? null : parseEmail(raw.email);
    const shareBps = raw.shareBps === undefined ? 0 : int(raw.shareBps, "Share", { min: 0, max: 10000 });
    // An open link is capped: it ends up in a group text and that text gets
    // forwarded. A personal invite is always single-use.
    const maxUses = email ? 1 : int(raw.maxUses ?? 20, "Max uses", { min: 1, max: 100 });

    const token = secretToken();
    const now = Date.now();
    const c = await db();

    await c.execute({
      sql: `INSERT INTO invites (token_hash, house_id, email, role, share_bps, created_by, created_at, expires_at, max_uses)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        hashToken(token),
        houseId,
        email,
        role,
        shareBps,
        ctx.user.id,
        now,
        now + INVITE_DAYS * 24 * 60 * 60 * 1000,
        maxUses,
      ],
    });

    const url = `${originFrom(req)}/join/${token}`;

    if (email) {
      const house = await getHouse(houseId);
      await sendMail({
        to: email,
        ...inviteEmail(url, house?.name ?? "the house", ctx.user.name || "A manager", role),
      });
    }

    await audit(ctx, "invite.create", "invite", null, { email, role, maxUses });

    return json({ url, token, role, email, expiresAt: now + INVITE_DAYS * 24 * 60 * 60 * 1000 }, 201);
  });
}
