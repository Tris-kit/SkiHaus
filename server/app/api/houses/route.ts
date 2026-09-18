// GET  /api/houses                     -> { houses: [{ house, role, shareBps }] }
// POST /api/houses  { name, season?, location?, address?, timezone?, leaseStart?, leaseEnd? }
//                                      -> { house, role: "admin" }
//
// Creating a house makes you its admin. There is no "claim an existing house"
// flow — you get in by being invited.

import { requireUser, sessionPayload } from "@/lib/auth";
import { db } from "@/lib/db";
import { shortId } from "@/lib/ids";
import { body, handle, json } from "@/lib/http";
import { limitOrThrow } from "@/lib/rateLimit";
import { rowToHouse } from "@/lib/rows";
import { day, optStr, str } from "@/lib/validate";

export const runtime = "nodejs";

// Seeded on create so the first expense has somewhere to go. A manager who
// hates these can rename or archive them; a blank category list is a worse
// first run than an opinionated one.
const DEFAULT_CATEGORIES: Array<[string, string]> = [
  ["Rent", "#1D6FE0"],
  ["Utilities", "#3B8AE8"],
  ["Firewood & heat", "#B45309"],
  ["Plowing", "#5B7185"],
  ["Supplies", "#0E9F6E"],
  ["Repairs", "#D4342C"],
  ["Groceries", "#7C5CD6"],
];

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const { houses } = await sessionPayload(user);
    return json({ houses });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    await limitOrThrow(`house:create:${user.id}`, 10, 24 * 60 * 60);

    const raw = await body<Record<string, unknown>>(req);
    const name = str(raw.name, "House name", { max: 80 });
    const season = optStr(raw.season, "Season", 20) ?? "";
    const location = optStr(raw.location, "Location", 120) ?? "";
    const address = optStr(raw.address, "Address", 300) ?? "";
    const timezone = optStr(raw.timezone, "Timezone", 64) ?? "America/New_York";
    const leaseStart = raw.leaseStart == null ? null : day(raw.leaseStart, "Lease start");
    const leaseEnd = raw.leaseEnd == null ? null : day(raw.leaseEnd, "Lease end");

    const id = shortId(10);
    const now = Date.now();
    const c = await db();

    await c.batch(
      [
        {
          sql: `INSERT INTO houses (id, name, season, location, address, timezone, lease_start, lease_end, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [id, name, season, location, address, timezone, leaseStart, leaseEnd, user.id, now],
        },
        {
          // 10000 bps = the whole house. A solo founder owns all of it until
          // they invite people and redistribute.
          sql: `INSERT INTO memberships (house_id, user_id, role, share_bps, status, joined_at)
                VALUES (?, ?, 'admin', 10000, 'active', ?)`,
          args: [id, user.id, now],
        },
        ...DEFAULT_CATEGORIES.map(([catName, color], i) => ({
          sql: `INSERT INTO categories (id, house_id, name, color, sort_order) VALUES (?, ?, ?, ?, ?)`,
          args: [shortId(10), id, catName, color, i],
        })),
      ],
      "write",
    );

    const res = await c.execute({ sql: "SELECT * FROM houses WHERE id = ?", args: [id] });
    return json(
      { house: rowToHouse(res.rows[0] as Record<string, unknown>), role: "admin", shareBps: 10000 },
      201,
    );
  });
}
