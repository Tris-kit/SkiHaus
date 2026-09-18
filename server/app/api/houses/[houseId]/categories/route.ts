// GET  /api/houses/:houseId/categories -> { categories }  (member)
// POST /api/houses/:houseId/categories -> Category        (admin)
//
// Categorising spending is the manager's job, so writes are admin-only.

import { houseCollection } from "@/lib/collection";
import { int, optStr, str } from "@/lib/validate";
import type { Category } from "@/lib/types";

export const runtime = "nodejs";

export const { GET, POST } = houseCollection({
  table: "categories",
  plural: "categories",
  orderBy: "sort_order, name",
  readRole: "member",
  writeRole: "admin",
  fields: [
    { key: "name", column: "name", label: "Category name", parse: (v, l) => str(v, l, { max: 60 }) },
    { key: "color", column: "color", label: "Colour", parse: (v, l) => optStr(v, l, 16) },
    { key: "sortOrder", column: "sort_order", label: "Order", parse: (v, l) => int(v, l, { min: 0, max: 999 }), fallback: 0 },
  ],
  toWire: (r): Category => ({
    id: String(r.id),
    houseId: String(r.house_id),
    name: String(r.name),
    color: r.color == null ? null : String(r.color),
    sortOrder: Number(r.sort_order),
  }),
});
