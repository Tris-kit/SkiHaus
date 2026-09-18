// GET    /api/houses/:houseId  -> { house, role, shareBps }
// PATCH  /api/houses/:houseId  -> { house }        (admin)
// DELETE /api/houses/:houseId  -> { ok: true }     (admin — archives, never drops rows)

import { db } from "@/lib/db";
import { audit, getHouse, requireAdmin, requireMember } from "@/lib/guard";
import { body, handle, json, notFound } from "@/lib/http";
import { rowToHouse } from "@/lib/rows";
import { day, optStr, str } from "@/lib/validate";

export const runtime = "nodejs";

type Params = { params: Promise<{ houseId: string }> };

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireMember(req, houseId);
    const house = await getHouse(houseId);
    if (!house) throw notFound("House not found.");
    return json({ house, role: ctx.role, shareBps: ctx.shareBps });
  });
}

export async function PATCH(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireAdmin(req, houseId);
    const raw = await body<Record<string, unknown>>(req);

    const fields: Record<string, string | null> = {};
    if (raw.name !== undefined) fields.name = str(raw.name, "House name", { max: 80 });
    if (raw.season !== undefined) fields.season = optStr(raw.season, "Season", 20) ?? "";
    if (raw.location !== undefined) fields.location = optStr(raw.location, "Location", 120) ?? "";
    if (raw.address !== undefined) fields.address = optStr(raw.address, "Address", 300) ?? "";
    if (raw.timezone !== undefined) fields.timezone = optStr(raw.timezone, "Timezone", 64) ?? "America/New_York";
    if (raw.leaseStart !== undefined) {
      fields.lease_start = raw.leaseStart == null ? null : day(raw.leaseStart, "Lease start");
    }
    if (raw.leaseEnd !== undefined) {
      fields.lease_end = raw.leaseEnd == null ? null : day(raw.leaseEnd, "Lease end");
    }

    const keys = Object.keys(fields);
    if (keys.length > 0) {
      const c = await db();
      await c.execute({
        sql: `UPDATE houses SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
        args: [...keys.map((k) => fields[k]), houseId],
      });
      await audit(ctx, "house.update", "house", houseId, fields);
    }

    const house = await getHouse(houseId);
    if (!house) throw notFound("House not found.");
    return json({ house });
  });
}

export async function DELETE(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireAdmin(req, houseId);

    // Archive, never DELETE. A season's ledger is the record of who paid what;
    // one misplaced tap must not be able to destroy it. Archived houses drop
    // out of every query via the `archived_at IS NULL` filter in getHouse()
    // and requireMember().
    const c = await db();
    await c.execute({
      sql: "UPDATE houses SET archived_at = ? WHERE id = ?",
      args: [Date.now(), houseId],
    });
    await audit(ctx, "house.archive", "house", houseId);

    return json({ ok: true });
  });
}
