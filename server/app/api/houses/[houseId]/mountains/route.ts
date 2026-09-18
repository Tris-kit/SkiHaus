// GET  /api/houses/:houseId/mountains -> { mountains }  (guest — a guest needs
//                                                        to know where everyone
//                                                        is going)
// POST /api/houses/:houseId/mountains -> Mountain       (member)

import { houseCollection } from "@/lib/collection";
import { int, optStr, str } from "@/lib/validate";
import type { Mountain } from "@/lib/types";

export const runtime = "nodejs";

export const { GET, POST } = houseCollection({
  table: "mountains",
  plural: "mountains",
  orderBy: "sort_order, name",
  readRole: "guest",
  writeRole: "member",
  fields: [
    { key: "name", column: "name", label: "Mountain name", parse: (v, l) => str(v, l, { max: 80 }) },
    { key: "url", column: "url", label: "Website", parse: (v, l) => optStr(v, l, 500) },
    { key: "driveMinutes", column: "drive_minutes", label: "Drive time", parse: (v, l) => int(v, l, { min: 0, max: 1440 }) },
    { key: "sortOrder", column: "sort_order", label: "Order", parse: (v, l) => int(v, l, { min: 0, max: 999 }), fallback: 0 },
  ],
  toWire: (r): Mountain => ({
    id: String(r.id),
    houseId: String(r.house_id),
    name: String(r.name),
    url: r.url == null ? null : String(r.url),
    driveMinutes: r.drive_minutes == null ? null : Number(r.drive_minutes),
    sortOrder: Number(r.sort_order),
  }),
});
