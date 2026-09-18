// Hand-rolled input validation. No zod — the dependency list stays at four
// runtime packages, the same discipline Split kept.
//
// Every helper throws `HttpError(400)` with a message written for a person, not
// a parser: "Amount must be a positive number." beats "expected number".

import { badRequest } from "./http";
import { isValidDay } from "./money";
import { ROLE_RANK, type Role } from "./types";

const MAX_TEXT = 2000;

export function str(v: unknown, field: string, opts: { max?: number; min?: number } = {}): string {
  if (typeof v !== "string") throw badRequest(`${field} is required.`);
  const s = v.trim();
  const min = opts.min ?? 1;
  const max = opts.max ?? 200;
  if (s.length < min) throw badRequest(`${field} is required.`);
  if (s.length > max) throw badRequest(`${field} must be ${max} characters or fewer.`);
  return s;
}

export function optStr(
  v: unknown,
  field: string,
  max = MAX_TEXT,
): string | null {
  if (v === undefined || v === null || v === "") return null;
  return str(v, field, { max });
}

export function int(v: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !isFinite(n) || Math.trunc(n) !== n) {
    throw badRequest(`${field} must be a whole number.`);
  }
  if (opts.min !== undefined && n < opts.min) {
    throw badRequest(`${field} must be at least ${opts.min}.`);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw badRequest(`${field} must be at most ${opts.max}.`);
  }
  return n;
}

export function bool(v: unknown, field: string, fallback?: boolean): boolean {
  if (v === undefined || v === null) {
    if (fallback !== undefined) return fallback;
    throw badRequest(`${field} is required.`);
  }
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "true") return true;
  if (v === 0 || v === "false") return false;
  throw badRequest(`${field} must be true or false.`);
}

/** Money always arrives as integer cents; dollars are a client concern. */
export function cents(v: unknown, field: string, opts: { allowNegative?: boolean } = {}): number {
  const n = int(v, field);
  if (!opts.allowNegative && n < 0) throw badRequest(`${field} can't be negative.`);
  // A ski house is not a hedge fund. Cap at $10M to make a fat-fingered paste
  // an error rather than a season-destroying ledger entry.
  if (Math.abs(n) > 1_000_000_000) throw badRequest(`${field} is unreasonably large.`);
  return n;
}

export function day(v: unknown, field: string): string {
  if (!isValidDay(v)) throw badRequest(`${field} must be a date like 2027-01-15.`);
  return v;
}

export function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw badRequest(`${field} must be one of: ${allowed.join(", ")}.`);
  }
  return v as T;
}

export function optOneOf<T extends string>(
  v: unknown,
  field: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (v === undefined || v === null || v === "") return fallback;
  return oneOf(v, field, allowed);
}

/**
 * Deliberately permissive: the only email check that means anything is whether
 * the sign-in link arrives. This rejects obvious typos and nothing else.
 */
export function email(v: unknown, field = "Email"): string {
  const s = str(v, field, { max: 320 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw badRequest(`${field} doesn't look right.`);
  return s;
}

export const ROLES = ["admin", "member", "guest"] as const;

export function role(v: unknown, field = "Role"): Role {
  return oneOf(v, field, ROLES);
}

/** Roles are stored as a CSV string (`"admin,member"`) and used as a set. */
export function parseRoles(csv: string): Role[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Role => s in ROLE_RANK);
}

export function serializeRoles(roles: Role[]): string {
  const seen = ROLES.filter((r) => roles.includes(r));
  return seen.join(",");
}

export function rolesCsv(v: unknown, field: string, fallback: Role[]): string {
  if (v === undefined || v === null) return serializeRoles(fallback);
  if (!Array.isArray(v)) throw badRequest(`${field} must be a list of roles.`);
  const parsed = v.map((r) => role(r, field));
  if (parsed.length === 0) throw badRequest(`${field} can't be empty.`);
  return serializeRoles(parsed);
}

export function arr<T>(v: unknown, field: string, max = 100): T[] {
  if (!Array.isArray(v)) throw badRequest(`${field} must be a list.`);
  if (v.length > max) throw badRequest(`${field} can have at most ${max} entries.`);
  return v as T[];
}

/** Departure must be strictly after arrival — a zero-night stay is a day trip. */
export function dateRange(
  arrive: unknown,
  depart: unknown,
): { arriveOn: string; departOn: string } {
  const arriveOn = day(arrive, "Arrival date");
  const departOn = day(depart, "Departure date");
  if (departOn <= arriveOn) throw badRequest("Departure must be after arrival.");
  return { arriveOn, departOn };
}
