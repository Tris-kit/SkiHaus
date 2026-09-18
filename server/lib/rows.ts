// Row → wire-type mappers that more than one module needs.
//
// These live here rather than next to their queries to keep `auth.ts` and
// `guard.ts` from importing each other: guard needs the user, auth needs the
// house, and a cycle between the two would be a nasty thing to debug at cold
// start.
//
// libSQL returns `Value` (string | number | bigint | ArrayBuffer | null), so
// every field goes through an explicit String()/Number() rather than a cast.

import type { House, User } from "./types";

export function rowToUser(r: Record<string, unknown>): User {
  return {
    id: String(r.id),
    email: String(r.email),
    name: String(r.name ?? ""),
    avatarEmoji: r.avatar_emoji == null ? null : String(r.avatar_emoji),
    avatarColor: r.avatar_color == null ? null : String(r.avatar_color),
  };
}

export function rowToHouse(r: Record<string, unknown>): House {
  return {
    id: String(r.id),
    name: String(r.name),
    season: String(r.season ?? ""),
    location: String(r.location ?? ""),
    address: String(r.address ?? ""),
    timezone: String(r.timezone ?? "America/New_York"),
    currency: String(r.currency ?? "USD"),
    leaseStart: r.lease_start == null ? null : String(r.lease_start),
    leaseEnd: r.lease_end == null ? null : String(r.lease_end),
  };
}
