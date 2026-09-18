// Wire types shared by the API and both clients.
//
// MIRRORED FILE — keep in sync with server/lib/types.ts. The two packages have
// separate node_modules and cannot import from each other, so this file is
// duplicated on purpose. Drift here means the app and the server disagree about
// the shape of a response, which fails silently at runtime.
//
// Rules for this file: no imports, no runtime code beyond plain constants.

export type Role = "admin" | "member" | "guest";

/** Ordered weakest → strongest. Used for `atLeast` comparisons. */
export const ROLE_RANK: Record<Role, number> = { guest: 0, member: 1, admin: 2 };

export type User = {
  id: string;
  email: string;
  name: string;
  avatarEmoji: string | null;
  avatarColor: string | null;
};

export type House = {
  id: string;
  name: string;
  season: string;
  location: string;
  address: string;
  timezone: string;
  currency: string;
  leaseStart: string | null;
  leaseEnd: string | null;
};

export type Membership = {
  houseId: string;
  userId: string;
  role: Role;
  shareBps: number;
  status: "active" | "removed";
  nickname: string | null;
  joinedAt: number;
};

/** A membership joined with the person it belongs to — the roster row. */
export type Member = Membership & { user: User };

export type Session = {
  user: User;
  houses: Array<{ house: House; role: Role; shareBps: number }>;
};

// --- money ------------------------------------------------------------------

export type SplitMode = "shares" | "equal" | "custom" | "none";

export type Expense = {
  id: string;
  houseId: string;
  categoryId: string | null;
  description: string;
  amountCents: number;
  paidBy: string | null;
  incurredOn: string; // YYYY-MM-DD
  splitMode: SplitMode;
  receiptUrl: string | null;
  note: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  shares: Array<{ userId: string; amountCents: number }>;
};

export type Category = {
  id: string;
  houseId: string;
  name: string;
  color: string | null;
  sortOrder: number;
};

export type PaymentMethod = "venmo" | "zelle" | "cash" | "check" | "other";

export type Payment = {
  id: string;
  houseId: string;
  fromUser: string;
  toUser: string | null;
  amountCents: number;
  method: PaymentMethod;
  paidOn: string;
  note: string | null;
  recordedBy: string;
  createdAt: number;
};

/**
 * One member's position in the ledger. `net` is positive when the house owes
 * them. Always: net === paid - owed + received - sent.
 */
export type Balance = {
  userId: string;
  paidCents: number;
  owedCents: number;
  sentCents: number;
  receivedCents: number;
  netCents: number;
};

// --- guests -----------------------------------------------------------------

export type GuestStatus = "pending" | "approved" | "declined" | "cancelled";

export type GuestRate = {
  id: string;
  houseId: string;
  name: string;
  centsPerPersonPerNight: number;
  appliesTo: "any" | "weekend" | "weekday" | "holiday";
  sortOrder: number;
};

export type GuestStay = {
  id: string;
  houseId: string;
  hostUserId: string;
  guestName: string;
  guestEmail: string | null;
  partySize: number;
  arriveOn: string;
  departOn: string;
  nights: number;
  feeCents: number;
  feeIsOverride: boolean;
  status: GuestStatus;
  paidAt: number | null;
  note: string | null;
  /** Only ever returned to the admin who created it, at creation time. */
  guestUrl?: string;
};

// --- votes ------------------------------------------------------------------

export type PollKind = "single" | "multi" | "yesno";
export type PollStatus = "draft" | "open" | "closed";

export type PollOption = { id: string; label: string; sortOrder: number };

export type Poll = {
  id: string;
  houseId: string;
  question: string;
  detail: string | null;
  kind: PollKind;
  status: PollStatus;
  eligibleRoles: Role[];
  quorumBps: number;
  passBps: number;
  anonymous: boolean;
  closesAt: number | null;
  closedAt: number | null;
  outcome: string | null;
  createdBy: string;
  createdAt: number;
  options: PollOption[];
};

/** Tally for a poll. `myChoice` is the caller's own ballot, if any. */
export type PollResult = {
  poll: Poll;
  eligibleCount: number;
  ballotCount: number;
  quorumMet: boolean;
  counts: Array<{ optionId: string; votes: number; voters: string[] }>;
  winnerOptionId: string | null;
  myChoice: string[] | null;
};

// --- logistics --------------------------------------------------------------

export type Stay = {
  id: string;
  houseId: string;
  userId: string;
  arriveOn: string;
  departOn: string;
  bed: string | null;
  note: string | null;
};

export type Mountain = {
  id: string;
  houseId: string;
  name: string;
  url: string | null;
  driveMinutes: number | null;
  sortOrder: number;
};

export type SkiDay = {
  id: string;
  houseId: string;
  userId: string;
  day: string;
  mountainId: string | null;
  note: string | null;
};

export type Venue = {
  id: string;
  houseId: string;
  name: string;
  cuisine: string | null;
  url: string | null;
  phone: string | null;
  address: string | null;
  priceLevel: number | null;
  note: string | null;
};

export type RsvpStatus = "in" | "out" | "maybe";

export type Dinner = {
  id: string;
  houseId: string;
  day: string;
  kind: "in" | "out";
  venueId: string | null;
  cookUserId: string | null;
  timeLocal: string | null;
  reservationStatus: "none" | "requested" | "confirmed";
  pollId: string | null;
  note: string | null;
  rsvps: Array<{ userId: string; status: RsvpStatus; plusOnes: number }>;
};

// --- documents and notifications --------------------------------------------

export type DocumentKind = "lease" | "rules" | "insurance" | "other";

export type HouseDocument = {
  id: string;
  houseId: string;
  title: string;
  kind: DocumentKind;
  bodyMd: string | null;
  url: string | null;
  version: number;
  visibleTo: Role[];
  createdAt: number;
  updatedAt: number;
  ackedByMe: boolean;
};

export type Announcement = {
  id: string;
  houseId: string;
  title: string;
  body: string;
  kind: "note" | "urgent" | "vote" | "expense" | "guest";
  linkPath: string | null;
  audience: Role[];
  createdBy: string | null;
  createdAt: number;
  readByMe: boolean;
};

// --- misc -------------------------------------------------------------------

export type Health = {
  ok: boolean;
  service: string;
  storage: boolean;
  mail: boolean;
};

/** Everything the guest page at /g/<token> is allowed to see. */
export type GuestView = {
  house: Pick<House, "name" | "season" | "location" | "address" | "timezone">;
  stay: Omit<GuestStay, "houseId" | "hostUserId" | "guestEmail">;
  hostName: string;
  documents: Array<Pick<HouseDocument, "title" | "kind" | "bodyMd" | "url">>;
  dinners: Array<Pick<Dinner, "day" | "kind" | "timeLocal" | "note"> & { venueName: string | null }>;
};
