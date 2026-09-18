// The only place this app talks to the network.
//
// Plain fetch — no axios, no generated client, no tRPC. Types come from
// src/types.ts, which is hand-mirrored from server/lib/types.ts (see the
// header there for why).
//
// Auth is handled once, here: a bearer token on native, the HttpOnly cookie on
// web. No screen should ever set an Authorization header itself.

import { getSessionToken, isWeb, setSessionToken } from "./storage";
import type {
  Announcement,
  Balance,
  Category,
  Dinner,
  Expense,
  GuestRate,
  GuestStay,
  Health,
  House,
  HouseDocument,
  Member,
  Mountain,
  Payment,
  Poll,
  PollResult,
  Role,
  Session,
  SkiDay,
  Stay,
  Venue,
} from "./types";
import type { Transfer } from "./settle";

// Inlined by Metro at BUILD time. Which backend a build talks to is fixed when
// it is built — changing .env needs a rebuild, not a reload.
const BASE = (process.env.EXPO_PUBLIC_API_BASE ?? "").replace(/\/$/, "");

export const isBackendEnabled = (): boolean => BASE.length > 0;

function requireBase(): string {
  if (!BASE) throw new Error("EXPO_PUBLIC_API_BASE is not set.");
  return BASE;
}

/** Thrown for any non-2xx. `status` lets callers treat 401 as "sign in". */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";

  const token = await getSessionToken();
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${requireBase()}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    // Sends the sh_session cookie on web. A no-op on native, where there is
    // no cookie jar and the bearer token above does the work.
    credentials: isWeb ? "include" : "omit",
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body });
const patch = <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body });
const del = <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body });

// --- health -----------------------------------------------------------------

/** Ping on startup. Null means unset, unreachable or slow — show the banner. */
export async function pingBackend(timeoutMs = 4000): Promise<Health | null> {
  if (!BASE) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as Health;
    return data?.ok ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- auth -------------------------------------------------------------------

type AuthResponse = Session & { sessionToken: string };

export type EmailCheck = {
  exists: boolean;
  hasPassword: boolean;
  /** Registered but never confirmed the address. */
  needsVerification: boolean;
};

/**
 * Email-first step one: does this address have an account?
 *
 * Yes, this tells anyone who asks. See the note in
 * server/app/api/auth/check/route.ts — it's a deliberate trade for the flow,
 * not an oversight, and it's the only endpoint here that leaks it.
 */
export const checkEmail = (email: string) => post<EmailCheck>("/api/auth/check", { email });

/** Sign in with email and password. Throws ApiError(401) on a bad pair. */
export async function signIn(email: string, password: string): Promise<Session> {
  const res = await post<AuthResponse>("/api/auth/login", { email, password });
  await setSessionToken(res.sessionToken);
  return { user: res.user, houses: res.houses };
}

/**
 * Create an account. Does NOT sign you in — the address has to be confirmed
 * first, so the caller should show "check your email".
 * Throws ApiError(400) if the email is already taken.
 */
export async function register(
  email: string,
  password: string,
  name?: string,
): Promise<{ verificationRequired: true }> {
  await post<{ ok: true }>("/api/auth/register", { email, password, name });
  return { verificationRequired: true };
}

/** Ask for a password-reset link. Always resolves, account or not. */
export async function requestPasswordReset(email: string): Promise<void> {
  await post("/api/auth/reset/request", { email });
}

/** Finish a reset with the token from the emailed link. Signs you in. */
export async function resetPassword(token: string, password: string): Promise<Session> {
  const res = await post<AuthResponse>("/api/auth/reset", { token, password });
  await setSessionToken(res.sessionToken);
  return { user: res.user, houses: res.houses };
}

export const hasPassword = () => get<{ hasPassword: boolean }>("/api/auth/password");

/** Set or change your password. `currentPassword` is required only if one is set. */
export async function setAccountPassword(
  password: string,
  currentPassword?: string,
): Promise<void> {
  const res = await post<{ ok: true; sessionToken?: string }>("/api/auth/password", {
    password,
    currentPassword,
  });
  // Changing a password evicts every other session. If the server couldn't
  // tell which one is ours — no cookie and no bearer — it issues a fresh one
  // rather than signing us out of the change we just made.
  if (res.sessionToken) await setSessionToken(res.sessionToken);
}

/**
 * Exchange an emailed confirmation token for a session.
 *
 * Native only: on web, /join/:token sets the cookie during navigation. Here
 * the person pastes the link, because universal links aren't configured yet.
 */
export async function verifyToken(token: string): Promise<Session> {
  const res = await post<Session & { sessionToken: string }>("/api/auth/verify", { token });
  await setSessionToken(res.sessionToken);
  return { user: res.user, houses: res.houses };
}

/** Current session, or null when signed out. 401 here is normal. */
export async function fetchSession(): Promise<Session | null> {
  try {
    return await get<Session>("/api/auth/session");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export async function signOut(): Promise<void> {
  try {
    await post("/api/auth/logout");
  } finally {
    // Drop the local token even if the call failed — the user asked to be
    // signed out, and a network error must not leave them signed in.
    await setSessionToken(null);
  }
}

export function updateProfile(patchBody: {
  name?: string;
  avatarEmoji?: string | null;
  avatarColor?: string | null;
}): Promise<Session> {
  return patch<Session>("/api/auth/session", patchBody);
}

// --- houses -----------------------------------------------------------------

export type HouseEntry = { house: House; role: Role; shareBps: number };

export const listHouses = () => get<{ houses: HouseEntry[] }>("/api/houses");

export const createHouse = (input: {
  name: string;
  season?: string;
  location?: string;
  address?: string;
  timezone?: string;
}) => post<HouseEntry>("/api/houses", input);

export const getHouse = (houseId: string) =>
  get<{ house: House; role: Role; shareBps: number }>(`/api/houses/${houseId}`);

export const updateHouse = (houseId: string, input: Partial<House>) =>
  patch<{ house: House }>(`/api/houses/${houseId}`, input);

// --- people -----------------------------------------------------------------

export const listMembers = (houseId: string) =>
  get<{ members: Member[] }>(`/api/houses/${houseId}/members`);

export const updateMember = (
  houseId: string,
  userId: string,
  input: { role?: Role; shareBps?: number; nickname?: string | null },
) => patch<{ ok: true }>(`/api/houses/${houseId}/members/${userId}`, input);

export const removeMember = (houseId: string, userId: string) =>
  del<{ ok: true }>(`/api/houses/${houseId}/members/${userId}`);

export const createInvite = (
  houseId: string,
  input: { email?: string | null; role: Role; shareBps?: number; maxUses?: number },
) => post<{ url: string; role: Role; email: string | null }>(`/api/houses/${houseId}/invites`, input);

// --- money ------------------------------------------------------------------

export const listExpenses = (houseId: string) =>
  get<{ expenses: Expense[] }>(`/api/houses/${houseId}/expenses`);

export const createExpense = (
  houseId: string,
  input: {
    description: string;
    amountCents: number;
    incurredOn: string;
    splitMode?: Expense["splitMode"];
    categoryId?: string | null;
    paidBy?: string | null;
    note?: string | null;
    shares?: Array<{ userId: string; amountCents: number }>;
  },
) => post<{ expense: Expense }>(`/api/houses/${houseId}/expenses`, input);

export const updateExpense = (houseId: string, expenseId: string, input: Record<string, unknown>) =>
  patch<{ expense: Expense }>(`/api/houses/${houseId}/expenses/${expenseId}`, input);

export const deleteExpense = (houseId: string, expenseId: string) =>
  del<{ ok: true }>(`/api/houses/${houseId}/expenses/${expenseId}`);

export const listCategories = (houseId: string) =>
  get<{ categories: Category[] }>(`/api/houses/${houseId}/categories`);

export const createCategory = (houseId: string, input: { name: string; color?: string }) =>
  post<Category>(`/api/houses/${houseId}/categories`, input);

export type LedgerResponse = {
  balances: Balance[];
  totalSpentCents: number;
  guestIncomeCents: number;
  unpaidGuestCents: number;
  settleUp: Transfer[];
};

export const fetchBalances = (houseId: string) =>
  get<LedgerResponse>(`/api/houses/${houseId}/balances`);

export const listPayments = (houseId: string) =>
  get<{ payments: Payment[] }>(`/api/houses/${houseId}/payments`);

export const recordPayment = (
  houseId: string,
  input: {
    fromUser: string;
    toUser?: string | null;
    amountCents: number;
    method?: Payment["method"];
    paidOn: string;
    note?: string | null;
  },
) => post<{ payment: Payment }>(`/api/houses/${houseId}/payments`, input);

// --- guests -----------------------------------------------------------------

export const listGuestStays = (houseId: string) =>
  get<{ stays: GuestStay[] }>(`/api/houses/${houseId}/guests`);

export const requestGuestStay = (
  houseId: string,
  input: {
    guestName: string;
    guestEmail?: string | null;
    partySize?: number;
    arriveOn: string;
    departOn: string;
    note?: string | null;
  },
) => post<{ stay: GuestStay; guestUrl: string }>(`/api/houses/${houseId}/guests`, input);

export const updateGuestStay = (
  houseId: string,
  stayId: string,
  input: { status?: GuestStay["status"]; feeCents?: number; paid?: boolean; note?: string | null },
) => patch<{ stay: GuestStay; guestUrl?: string }>(`/api/houses/${houseId}/guests/${stayId}`, input);

export const listGuestRates = (houseId: string) =>
  get<{ rates: GuestRate[] }>(`/api/houses/${houseId}/guest-rates`);

export const createGuestRate = (
  houseId: string,
  input: { name: string; centsPerPersonPerNight: number; appliesTo?: GuestRate["appliesTo"] },
) => post<GuestRate>(`/api/houses/${houseId}/guest-rates`, input);

// --- votes ------------------------------------------------------------------

export const listPolls = (houseId: string) => get<{ polls: Poll[] }>(`/api/houses/${houseId}/polls`);

export const createPoll = (
  houseId: string,
  input: {
    question: string;
    detail?: string | null;
    kind?: Poll["kind"];
    options?: string[];
    eligibleRoles?: Role[];
    quorumBps?: number;
    passBps?: number;
    anonymous?: boolean;
  },
) => post<{ poll: Poll }>(`/api/houses/${houseId}/polls`, input);

export const fetchPoll = (houseId: string, pollId: string) =>
  get<PollResult>(`/api/houses/${houseId}/polls/${pollId}`);

export const castBallot = (houseId: string, pollId: string, optionIds: string[], comment?: string) =>
  post<PollResult>(`/api/houses/${houseId}/polls/${pollId}/ballot`, { optionIds, comment });

export const closePoll = (houseId: string, pollId: string) =>
  patch<PollResult>(`/api/houses/${houseId}/polls/${pollId}`, { action: "close" });

// --- logistics --------------------------------------------------------------

export const listStays = (houseId: string) => get<{ stays: Stay[] }>(`/api/houses/${houseId}/stays`);

export const claimStay = (
  houseId: string,
  input: { arriveOn: string; departOn: string; bed?: string | null; note?: string | null },
) => post<{ stay: Stay }>(`/api/houses/${houseId}/stays`, input);

export const releaseStay = (houseId: string, id: string) =>
  del<{ ok: true }>(`/api/houses/${houseId}/stays`, { id });

export const listMountains = (houseId: string) =>
  get<{ mountains: Mountain[] }>(`/api/houses/${houseId}/mountains`);

export const addMountain = (houseId: string, input: { name: string; driveMinutes?: number }) =>
  post<Mountain>(`/api/houses/${houseId}/mountains`, input);

export const listSkiDays = (houseId: string, from?: string, to?: string) => {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  const qs = q.toString();
  return get<{ skiDays: SkiDay[] }>(`/api/houses/${houseId}/ski-days${qs ? `?${qs}` : ""}`);
};

/** `mountainId: null` clears the day (a rest day). */
export const setSkiDay = (houseId: string, day: string, mountainId: string | null, note?: string) =>
  post<{ skiDay: SkiDay | null }>(`/api/houses/${houseId}/ski-days`, { day, mountainId, note });

export const listVenues = (houseId: string) => get<{ venues: Venue[] }>(`/api/houses/${houseId}/venues`);

export const addVenue = (houseId: string, input: { name: string; cuisine?: string; url?: string }) =>
  post<Venue>(`/api/houses/${houseId}/venues`, input);

export const listDinners = (houseId: string, from?: string, to?: string) => {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  const qs = q.toString();
  return get<{ dinners: Dinner[] }>(`/api/houses/${houseId}/dinners${qs ? `?${qs}` : ""}`);
};

export const planDinner = (
  houseId: string,
  input: {
    day: string;
    kind?: "in" | "out";
    venueId?: string | null;
    cookUserId?: string | null;
    timeLocal?: string | null;
    note?: string | null;
  },
) => post<{ dinner: Dinner }>(`/api/houses/${houseId}/dinners`, input);

export const rsvpDinner = (houseId: string, id: string, rsvp: "in" | "out" | "maybe", plusOnes = 0) =>
  patch<{ dinner: Dinner }>(`/api/houses/${houseId}/dinners`, { id, rsvp, plusOnes });

// --- documents and notifications --------------------------------------------

export const listDocuments = (houseId: string) =>
  get<{ documents: HouseDocument[] }>(`/api/houses/${houseId}/documents`);

export const createDocument = (
  houseId: string,
  input: {
    title: string;
    kind?: HouseDocument["kind"];
    bodyMd?: string | null;
    url?: string | null;
    visibleTo?: Role[];
  },
) => post<{ ok: true; id: string }>(`/api/houses/${houseId}/documents`, input);

export const ackDocument = (houseId: string, docId: string) =>
  post<{ ok: true; version: number }>(`/api/houses/${houseId}/documents/${docId}`, { ack: true });

export const listAnnouncements = (houseId: string) =>
  get<{ announcements: Announcement[]; unread: number }>(`/api/houses/${houseId}/announcements`);

export const postAnnouncement = (
  houseId: string,
  input: { title: string; body?: string; kind?: Announcement["kind"]; audience?: Role[] },
) => post<{ ok: true }>(`/api/houses/${houseId}/announcements`, input);

export const markAnnouncementsRead = (houseId: string) =>
  patch<{ ok: true }>(`/api/houses/${houseId}/announcements`, { readAll: true });
