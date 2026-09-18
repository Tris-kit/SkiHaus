// Turso (libSQL / SQLite) client. Lazy on purpose: importing this during
// `next build` must not require credentials, so the connection and the schema
// are created on first use at runtime.
//
// There is no migration tool. Every statement below is idempotent
// (`IF NOT EXISTS`) and runs once per process on cold start. Adding a column to
// an existing table means an explicit `ALTER TABLE` in `MIGRATIONS` — see the
// note there before you change a table.

import { createClient, type Client } from "@libsql/client";

let _client: Client | null = null;
let _schema: Promise<void> | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL);
}

function raw(): Client {
  if (_client) return _client;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not set — connect the Turso database in Vercel.",
    );
  }
  _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return _client;
}

// Timestamps are epoch milliseconds (INTEGER). Calendar days are ISO
// `YYYY-MM-DD` strings (TEXT) — a ski day is a day, not an instant, and storing
// it as a timestamp invites timezone bugs when the house is in one zone and the
// member booking the night is in another.
const SCHEMA: string[] = [
  // --- identity -------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL DEFAULT '',
     avatar_emoji TEXT,
     avatar_color TEXT,
     phone TEXT,
     created_at INTEGER NOT NULL,
     last_seen_at INTEGER
   )`,

  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     last_seen_at INTEGER NOT NULL,
     user_agent TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,

  // Single-use email sign-in tokens.
  `CREATE TABLE IF NOT EXISTS login_tokens (
     token_hash TEXT PRIMARY KEY,
     email TEXT NOT NULL,
     next_path TEXT,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     consumed_at INTEGER
   )`,

  // --- houses and roles -----------------------------------------------------
  `CREATE TABLE IF NOT EXISTS houses (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     season TEXT NOT NULL DEFAULT '',
     location TEXT NOT NULL DEFAULT '',
     address TEXT NOT NULL DEFAULT '',
     timezone TEXT NOT NULL DEFAULT 'America/New_York',
     currency TEXT NOT NULL DEFAULT 'USD',
     lease_start TEXT,
     lease_end TEXT,
     created_by TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     archived_at INTEGER
   )`,

  // The multi-tenancy boundary. role is 'admin' | 'member' | 'guest'.
  // share_bps is ownership in basis points (10000 = 100%); it drives the
  // default 'shares' expense split.
  `CREATE TABLE IF NOT EXISTS memberships (
     house_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     role TEXT NOT NULL,
     share_bps INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'active',
     nickname TEXT,
     joined_at INTEGER NOT NULL,
     PRIMARY KEY (house_id, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id)`,

  `CREATE TABLE IF NOT EXISTS invites (
     token_hash TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     email TEXT,
     role TEXT NOT NULL,
     share_bps INTEGER NOT NULL DEFAULT 0,
     created_by TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     max_uses INTEGER NOT NULL DEFAULT 1,
     used_count INTEGER NOT NULL DEFAULT 0,
     revoked_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_invites_house ON invites(house_id)`,

  // --- money ----------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS categories (
     id TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     name TEXT NOT NULL,
     color TEXT,
     sort_order INTEGER NOT NULL DEFAULT 0,
     archived_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_categories_house ON categories(house_id)`,

  // split_mode: 'shares' | 'equal' | 'custom' | 'none'
  // paid_by NULL means it came out of the house account, not a person's pocket.
  `CREATE TABLE IF NOT EXISTS expenses (
     id TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     category_id TEXT,
     description TEXT NOT NULL,
     amount_cents INTEGER NOT NULL,
     paid_by TEXT,
     incurred_on TEXT NOT NULL,
     split_mode TEXT NOT NULL DEFAULT 'shares',
     receipt_url TEXT,
     note TEXT,
     created_by TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     deleted_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_house ON expenses(house_id, incurred_on)`,

  // Materialised allocation. Recomputed whenever the expense changes, so a
  // later change to someone's share_bps does not silently rewrite history.
  `CREATE TABLE IF NOT EXISTS expense_shares (
     expense_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     amount_cents INTEGER NOT NULL,
     PRIMARY KEY (expense_id, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_expense_shares_user ON expense_shares(user_id)`,

  // Settlements: recorded, never executed. to_user NULL = paid into the house.
  `CREATE TABLE IF NOT EXISTS payments (
     id TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     from_user TEXT NOT NULL,
     to_user TEXT,
     amount_cents INTEGER NOT NULL,
     method TEXT NOT NULL DEFAULT 'other',
     paid_on TEXT NOT NULL,
     note TEXT,
     recorded_by TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     deleted_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_payments_house ON payments(house_id, paid_on)`,

  // --- guests ---------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS guest_rates (
     id TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     name TEXT NOT NULL,
     cents_per_person_per_night INTEGER NOT NULL,
     applies_to TEXT NOT NULL DEFAULT 'any',
     sort_order INTEGER NOT NULL DEFAULT 0,
     archived_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_guest_rates_house ON guest_rates(house_id)`,

  // token_hash backs /g/<token>: the guest's no-login view of their own stay.
  // status: 'pending' | 'approved' | 'declined' | 'cancelled'
  `CREATE TABLE IF NOT EXISTS guest_stays (
     id TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     token_hash TEXT NOT NULL,
     host_user_id TEXT NOT NULL,
     guest_name TEXT NOT NULL,
     guest_email TEXT,
     party_size INTEGER NOT NULL DEFAULT 1,
     arrive_on TEXT NOT NULL,
     depart_on TEXT NOT NULL,
     fee_cents INTEGER NOT NULL DEFAULT 0,
     fee_is_override INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'pending',
     paid_at INTEGER,
     note TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_guest_stays_house ON guest_stays(house_id, arrive_on)`,
  `CREATE INDEX IF NOT EXISTS idx_guest_stays_token ON guest_stays(token_hash)`,

  // --- logistics ------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS stays (
     id TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     arrive_on TEXT NOT NULL,
     depart_on TEXT NOT NULL,
     bed TEXT,
     note TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_stays_house ON stays(house_id, arrive_on)`,

  `CREATE TABLE IF NOT EXISTS mountains (
     id TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     name TEXT NOT NULL,
     url TEXT,
     drive_minutes INTEGER,
     sort_order INTEGER NOT NULL DEFAULT 0,
     archived_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mountains_house ON mountains(house_id)`,

  `CREATE TABLE IF NOT EXISTS ski_days (
     id TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     day TEXT NOT NULL,
     mountain_id TEXT,
     note TEXT,
     created_at INTEGER NOT NULL
   )`,
  // One declaration per person per day — re-declaring updates in place.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ski_days_unique ON ski_days(house_id, user_id, day)`,

  `CREATE TABLE IF NOT EXISTS venues (
     id TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     name TEXT NOT NULL,
     cuisine TEXT,
     url TEXT,
     phone TEXT,
     address TEXT,
     price_level INTEGER,
     note TEXT,
     archived_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_venues_house ON venues(house_id)`,

  // kind: 'in' (cooking) | 'out' (going somewhere). poll_id links a dinner whose
  // venue is still being voted on.
  `CREATE TABLE IF NOT EXISTS dinners (
     id TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     day TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'out',
     venue_id TEXT,
     cook_user_id TEXT,
     time_local TEXT,
     reservation_status TEXT NOT NULL DEFAULT 'none',
     poll_id TEXT,
     note TEXT,
     created_by TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_dinners_day ON dinners(house_id, day)`,

  `CREATE TABLE IF NOT EXISTS dinner_rsvps (
     dinner_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     status TEXT NOT NULL,
     plus_ones INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (dinner_id, user_id)
   )`,

  // --- votes ----------------------------------------------------------------
  // quorum_bps: fraction of eligible voters who must vote for the result to
  // count. pass_bps: fraction of cast votes the winner needs (5000 = simple
  // majority). Both are basis points so share-weighted voting is a later
  // change, not a schema change.
  `CREATE TABLE IF NOT EXISTS polls (
     id TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     question TEXT NOT NULL,
     detail TEXT,
     kind TEXT NOT NULL DEFAULT 'single',
     status TEXT NOT NULL DEFAULT 'open',
     eligible_roles TEXT NOT NULL DEFAULT 'admin,member',
     quorum_bps INTEGER NOT NULL DEFAULT 0,
     pass_bps INTEGER NOT NULL DEFAULT 5000,
     anonymous INTEGER NOT NULL DEFAULT 0,
     closes_at INTEGER,
     closed_at INTEGER,
     outcome TEXT,
     created_by TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_polls_house ON polls(house_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS poll_options (
     id TEXT PRIMARY KEY,
     poll_id TEXT NOT NULL,
     label TEXT NOT NULL,
     sort_order INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id)`,

  // One ballot per voter per poll; option_ids is a JSON array so multi-select
  // and single-select share a row shape.
  `CREATE TABLE IF NOT EXISTS ballots (
     poll_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     option_ids TEXT NOT NULL,
     comment TEXT,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (poll_id, user_id)
   )`,

  // --- documents ------------------------------------------------------------
  // kind: 'lease' | 'rules' | 'insurance' | 'other'
  // visible_to is a role CSV — the lease is usually admin,member while house
  // rules are admin,member,guest.
  `CREATE TABLE IF NOT EXISTS documents (
     id TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     title TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'other',
     body_md TEXT,
     url TEXT,
     version INTEGER NOT NULL DEFAULT 1,
     visible_to TEXT NOT NULL DEFAULT 'admin,member',
     created_by TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_documents_house ON documents(house_id)`,

  // Acknowledgement is per-version: re-publishing the lease clears everyone's
  // "I've read it" without deleting the record that they read v1.
  `CREATE TABLE IF NOT EXISTS document_acks (
     document_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     version INTEGER NOT NULL,
     acked_at INTEGER NOT NULL,
     PRIMARY KEY (document_id, user_id, version)
   )`,

  // --- notifications --------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS announcements (
     id TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL DEFAULT '',
     kind TEXT NOT NULL DEFAULT 'note',
     link_path TEXT,
     audience TEXT NOT NULL DEFAULT 'admin,member',
     created_by TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_announcements_house ON announcements(house_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS announcement_reads (
     announcement_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     read_at INTEGER NOT NULL,
     PRIMARY KEY (announcement_id, user_id)
   )`,

  // Populated once push ships (v1.1). Present now so the table exists before
  // the client that writes to it.
  `CREATE TABLE IF NOT EXISTS push_tokens (
     token TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     platform TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     last_seen_at INTEGER NOT NULL
   )`,

  // --- infrastructure -------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS audit_log (
     id TEXT PRIMARY KEY,
     house_id TEXT NOT NULL,
     actor_id TEXT,
     action TEXT NOT NULL,
     entity TEXT NOT NULL,
     entity_id TEXT,
     detail TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_house ON audit_log(house_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS rate_limits (
     key TEXT PRIMARY KEY,
     count INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
];

// Additive changes to tables that already exist in production. SQLite has no
// `ADD COLUMN IF NOT EXISTS`, so each of these is expected to fail with
// "duplicate column name" on every run after the first — that error is
// swallowed. Anything else re-throws.
const MIGRATIONS: string[] = [];

async function ensureSchema(c: Client): Promise<void> {
  if (!_schema) {
    _schema = (async () => {
      await c.batch(SCHEMA, "write");
      for (const sql of MIGRATIONS) {
        try {
          await c.execute(sql);
        } catch (e) {
          if (!/duplicate column name/i.test(String(e))) throw e;
        }
      }
    })().catch((e) => {
      _schema = null; // let a later request retry
      throw e;
    });
  }
  return _schema;
}

/** The client, with the schema guaranteed to exist. */
export async function db(): Promise<Client> {
  const c = raw();
  await ensureSchema(c);
  return c;
}
