// Guest stays: the request → price → approve flow, and the capability link
// that lets a guest see their own stay without an account.
//
// This is the one place Split's model carries over almost unchanged. A guest
// coming for one weekend should not have to make an account to find out the
// address and what they owe, so each stay mints a 256-bit token and
// /g/<token> renders exactly that guest's slice. Possession of the URL IS the
// credential; only its hash is stored.

import { db } from "./db";
import { getHouse } from "./guard";
import { hashToken, secretToken } from "./ids";
import { guestStayEmail, sendMail } from "./mail";
import { formatMoney, nightsBetween, quoteGuestStay, type RateRow } from "./money";
import type { GuestStatus, GuestStay, GuestView, HouseDocument } from "./types";

export function rowToGuestStay(r: Record<string, unknown>): GuestStay {
  const arriveOn = String(r.arrive_on);
  const departOn = String(r.depart_on);
  return {
    id: String(r.id),
    houseId: String(r.house_id),
    hostUserId: String(r.host_user_id),
    guestName: String(r.guest_name),
    guestEmail: r.guest_email == null ? null : String(r.guest_email),
    partySize: Number(r.party_size),
    arriveOn,
    departOn,
    nights: nightsBetween(arriveOn, departOn),
    feeCents: Number(r.fee_cents),
    feeIsOverride: Number(r.fee_is_override) === 1,
    status: String(r.status) as GuestStatus,
    paidAt: r.paid_at == null ? null : Number(r.paid_at),
    note: r.note == null ? null : String(r.note),
  };
}

/** The house's live fee schedule, in the shape quoteGuestStay() wants. */
export async function ratesFor(houseId: string): Promise<RateRow[]> {
  const c = await db();
  const res = await c.execute({
    sql: `SELECT cents_per_person_per_night, applies_to FROM guest_rates
          WHERE house_id = ? AND archived_at IS NULL
          ORDER BY sort_order`,
    args: [houseId],
  });
  return res.rows.map((r) => ({
    centsPerPersonPerNight: Number(r.cents_per_person_per_night),
    appliesTo: String(r.applies_to) as RateRow["appliesTo"],
  }));
}

/** Price a stay against the schedule. 0 means "no rate matched", not "free". */
export async function quote(
  houseId: string,
  arriveOn: string,
  departOn: string,
  partySize: number,
): Promise<number> {
  return quoteGuestStay(arriveOn, departOn, partySize, await ratesFor(houseId));
}

export async function getGuestStay(houseId: string, stayId: string): Promise<GuestStay | null> {
  const c = await db();
  const res = await c.execute({
    sql: "SELECT * FROM guest_stays WHERE id = ? AND house_id = ?",
    args: [stayId, houseId],
  });
  const row = res.rows[0];
  return row ? rowToGuestStay(row as Record<string, unknown>) : null;
}

/**
 * Mint a fresh guest token and return the raw value.
 *
 * WHY ROTATE INSTEAD OF RE-SENDING. Only the hash is stored, so once the
 * creation response is gone the original link is unrecoverable — by design.
 * When a manager approves a stay a member requested, there is therefore no old
 * link to email, and we mint a new one. The pleasant side effect is that
 * approval invalidates any link that leaked while the stay was pending.
 */
export async function rotateGuestToken(stayId: string, origin: string): Promise<string> {
  const token = secretToken();
  const c = await db();
  await c.execute({
    sql: "UPDATE guest_stays SET token_hash = ?, updated_at = ? WHERE id = ?",
    args: [hashToken(token), Date.now(), stayId],
  });
  return `${origin}/g/${token}`;
}

/** Email a guest their link. No-op when we have no address for them. */
export async function notifyGuest(opts: {
  guestUrl: string;
  houseId: string;
  hostName: string;
  guestEmail: string | null;
  arriveOn: string;
  departOn: string;
  feeCents: number;
}): Promise<void> {
  if (!opts.guestEmail) return;
  const house = await getHouse(opts.houseId);
  const feeLine =
    opts.feeCents > 0
      ? `Your share is ${formatMoney(opts.feeCents)}.`
      : "There's no fee for this stay.";

  await sendMail({
    to: opts.guestEmail,
    ...guestStayEmail(
      opts.guestUrl,
      house?.name ?? "the house",
      opts.hostName || "Your host",
      `${opts.arriveOn} → ${opts.departOn}`,
      feeLine,
    ),
  });
}

/** Resolve a /g/<token> link to its stay, or null. */
export async function guestStayByToken(token: string): Promise<GuestStay | null> {
  const c = await db();
  const res = await c.execute({
    sql: "SELECT * FROM guest_stays WHERE token_hash = ?",
    args: [hashToken(token)],
  });
  const row = res.rows[0];
  if (!row) return null;
  // Cancelled and declined stays stop resolving: the link should go dead when
  // the stay does, without the guest having to be told twice.
  const stay = rowToGuestStay(row as Record<string, unknown>);
  return stay.status === "cancelled" || stay.status === "declined" ? null : stay;
}

/**
 * Everything /g/<token> is allowed to render — and nothing else.
 *
 * This function IS the guest authorisation boundary. There is no session and
 * no role check downstream of it, so anything it returns is public to whoever
 * holds the link. Adding a field here is a privacy decision: no balances, no
 * other guests' fees, no member email addresses, no expenses.
 */
export async function guestView(token: string): Promise<GuestView | null> {
  const stay = await guestStayByToken(token);
  if (!stay) return null;

  const c = await db();
  const [houseRes, hostRes, docRes, dinnerRes] = await Promise.all([
    c.execute({
      sql: "SELECT name, season, location, address, timezone FROM houses WHERE id = ? AND archived_at IS NULL",
      args: [stay.houseId],
    }),
    c.execute({ sql: "SELECT name FROM users WHERE id = ?", args: [stay.hostUserId] }),
    c.execute({
      // Only documents explicitly shared with guests. The lease with the rent
      // figure on it defaults to admin,member and stays there.
      sql: `SELECT title, kind, body_md, url FROM documents
            WHERE house_id = ? AND visible_to LIKE '%guest%'
            ORDER BY CASE kind WHEN 'rules' THEN 0 ELSE 1 END, title`,
      args: [stay.houseId],
    }),
    c.execute({
      // Dinners that overlap their stay, and only those.
      sql: `SELECT d.day, d.kind, d.time_local, d.note, v.name AS venue_name
            FROM dinners d LEFT JOIN venues v ON v.id = d.venue_id
            WHERE d.house_id = ? AND d.day >= ? AND d.day <= ?
            ORDER BY d.day`,
      args: [stay.houseId, stay.arriveOn, stay.departOn],
    }),
  ]);

  const h = houseRes.rows[0];
  if (!h) return null;

  return {
    house: {
      name: String(h.name),
      season: String(h.season ?? ""),
      location: String(h.location ?? ""),
      // The address is the single most useful thing on this page and the whole
      // reason the link exists.
      address: String(h.address ?? ""),
      timezone: String(h.timezone ?? "America/New_York"),
    },
    stay: {
      id: stay.id,
      guestName: stay.guestName,
      partySize: stay.partySize,
      arriveOn: stay.arriveOn,
      departOn: stay.departOn,
      nights: stay.nights,
      feeCents: stay.feeCents,
      feeIsOverride: stay.feeIsOverride,
      status: stay.status,
      paidAt: stay.paidAt,
      note: stay.note,
    },
    hostName: String(hostRes.rows[0]?.name ?? "your host"),
    documents: docRes.rows.map((r) => ({
      title: String(r.title),
      kind: String(r.kind) as HouseDocument["kind"],
      bodyMd: r.body_md == null ? null : String(r.body_md),
      url: r.url == null ? null : String(r.url),
    })),
    dinners: dinnerRes.rows.map((r) => ({
      day: String(r.day),
      kind: String(r.kind) as "in" | "out",
      timeLocal: r.time_local == null ? null : String(r.time_local),
      note: r.note == null ? null : String(r.note),
      venueName: r.venue_name == null ? null : String(r.venue_name),
    })),
  };
}
