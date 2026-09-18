// GET  /api/houses/:houseId/venues -> { venues }  (guest)
// POST /api/houses/:houseId/venues -> Venue       (member)
//
// The running list of dinner spots. Anyone in the house can add one — this is
// the least consequential table in the app and gatekeeping it would be absurd.

import { houseCollection } from "@/lib/collection";
import { int, optStr, str } from "@/lib/validate";
import type { Venue } from "@/lib/types";

export const runtime = "nodejs";

export const { GET, POST } = houseCollection({
  table: "venues",
  plural: "venues",
  orderBy: "name",
  readRole: "guest",
  writeRole: "member",
  fields: [
    { key: "name", column: "name", label: "Name", parse: (v, l) => str(v, l, { max: 80 }) },
    { key: "cuisine", column: "cuisine", label: "Cuisine", parse: (v, l) => optStr(v, l, 40) },
    { key: "url", column: "url", label: "Website", parse: (v, l) => optStr(v, l, 500) },
    { key: "phone", column: "phone", label: "Phone", parse: (v, l) => optStr(v, l, 40) },
    { key: "address", column: "address", label: "Address", parse: (v, l) => optStr(v, l, 300) },
    { key: "priceLevel", column: "price_level", label: "Price", parse: (v, l) => int(v, l, { min: 1, max: 4 }) },
    { key: "note", column: "note", label: "Note", parse: (v, l) => optStr(v, l, 500) },
  ],
  toWire: (r): Venue => ({
    id: String(r.id),
    houseId: String(r.house_id),
    name: String(r.name),
    cuisine: r.cuisine == null ? null : String(r.cuisine),
    url: r.url == null ? null : String(r.url),
    phone: r.phone == null ? null : String(r.phone),
    address: r.address == null ? null : String(r.address),
    priceLevel: r.price_level == null ? null : Number(r.price_level),
    note: r.note == null ? null : String(r.note),
  }),
});
