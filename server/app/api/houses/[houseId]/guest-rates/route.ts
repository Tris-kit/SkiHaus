// GET  /api/houses/:houseId/guest-rates -> { rates }  (member — members need
//                                                      to quote a friend before
//                                                      inviting them)
// POST /api/houses/:houseId/guest-rates -> GuestRate  (admin)
//
// The fee schedule that quoteGuestStay() prices against. `appliesTo` of
// 'weekend' / 'weekday' beats the 'any' fallback; 'holiday' is never matched
// automatically — there is no holiday calendar, so it's there for a manager to
// apply by hand as a fee override.

import { houseCollection } from "@/lib/collection";
import { cents, int, oneOf, str } from "@/lib/validate";
import type { GuestRate } from "@/lib/types";

export const runtime = "nodejs";

const APPLIES = ["any", "weekend", "weekday", "holiday"] as const;

export const { GET, POST } = houseCollection({
  table: "guest_rates",
  plural: "rates",
  orderBy: "sort_order, name",
  readRole: "member",
  writeRole: "admin",
  fields: [
    { key: "name", column: "name", label: "Rate name", parse: (v, l) => str(v, l, { max: 60 }) },
    {
      key: "centsPerPersonPerNight",
      column: "cents_per_person_per_night",
      label: "Rate",
      parse: (v, l) => cents(v, l),
    },
    {
      key: "appliesTo",
      column: "applies_to",
      label: "Applies to",
      parse: (v, l) => oneOf(v, l, APPLIES),
      fallback: "any",
    },
    { key: "sortOrder", column: "sort_order", label: "Order", parse: (v, l) => int(v, l, { min: 0, max: 999 }), fallback: 0 },
  ],
  toWire: (r): GuestRate => ({
    id: String(r.id),
    houseId: String(r.house_id),
    name: String(r.name),
    centsPerPersonPerNight: Number(r.cents_per_person_per_night),
    appliesTo: String(r.applies_to) as GuestRate["appliesTo"],
    sortOrder: Number(r.sort_order),
  }),
});
