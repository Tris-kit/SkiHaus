// Voting: reading polls, tallying ballots, closing a poll.
//
// The model is deliberately plain — one ballot per eligible member, one row,
// options as a JSON array so single-choice and multi-choice share a shape.
// What makes it useful for a ski lease is the two thresholds:
//
//   quorum_bps — how much of the eligible roster must vote at all
//   pass_bps   — what fraction of *cast* votes the winner needs
//
// A "should we re-up the lease?" vote with quorum 7500 / pass 6667 cannot be
// decided by the three people who happened to read the group text.

import { db } from "./db";
import { parseRoles } from "./validate";
import type { Poll, PollKind, PollResult, PollStatus, Role } from "./types";

export function rowToPoll(
  r: Record<string, unknown>,
  options: Array<{ id: string; label: string; sortOrder: number }>,
): Poll {
  return {
    id: String(r.id),
    houseId: String(r.house_id),
    question: String(r.question),
    detail: r.detail == null ? null : String(r.detail),
    kind: String(r.kind) as PollKind,
    status: String(r.status) as PollStatus,
    eligibleRoles: parseRoles(String(r.eligible_roles)),
    quorumBps: Number(r.quorum_bps),
    passBps: Number(r.pass_bps),
    anonymous: Number(r.anonymous) === 1,
    closesAt: r.closes_at == null ? null : Number(r.closes_at),
    closedAt: r.closed_at == null ? null : Number(r.closed_at),
    outcome: r.outcome == null ? null : String(r.outcome),
    createdBy: String(r.created_by),
    createdAt: Number(r.created_at),
    options,
  };
}

async function optionsFor(pollIds: string[]) {
  if (pollIds.length === 0) return new Map<string, Array<{ id: string; label: string; sortOrder: number }>>();
  const c = await db();
  const placeholders = pollIds.map(() => "?").join(",");
  const res = await c.execute({
    sql: `SELECT * FROM poll_options WHERE poll_id IN (${placeholders}) ORDER BY sort_order, id`,
    args: pollIds,
  });
  const map = new Map<string, Array<{ id: string; label: string; sortOrder: number }>>();
  for (const r of res.rows) {
    const key = String(r.poll_id);
    const list = map.get(key) ?? [];
    list.push({ id: String(r.id), label: String(r.label), sortOrder: Number(r.sort_order) });
    map.set(key, list);
  }
  return map;
}

export async function listPolls(houseId: string, viewerRole: Role): Promise<Poll[]> {
  const c = await db();
  const res = await c.execute({
    sql: `SELECT * FROM polls WHERE house_id = ? ORDER BY created_at DESC LIMIT 200`,
    args: [houseId],
  });

  const opts = await optionsFor(res.rows.map((r) => String(r.id)));
  return res.rows
    .map((r) => rowToPoll(r as Record<string, unknown>, opts.get(String(r.id)) ?? []))
    // A draft is the manager's scratch pad; nobody else sees it exists.
    .filter((p) => p.status !== "draft" || viewerRole === "admin")
    .filter((p) => p.eligibleRoles.includes(viewerRole) || viewerRole === "admin");
}

export async function getPoll(houseId: string, pollId: string): Promise<Poll | null> {
  const c = await db();
  const res = await c.execute({
    sql: "SELECT * FROM polls WHERE id = ? AND house_id = ?",
    args: [pollId, houseId],
  });
  const row = res.rows[0];
  if (!row) return null;
  const opts = await optionsFor([pollId]);
  return rowToPoll(row as Record<string, unknown>, opts.get(pollId) ?? []);
}

/** How many people are entitled to vote in this poll. */
async function eligibleCount(houseId: string, roles: Role[]): Promise<number> {
  if (roles.length === 0) return 0;
  const c = await db();
  const placeholders = roles.map(() => "?").join(",");
  const res = await c.execute({
    sql: `SELECT COUNT(*) AS n FROM memberships
          WHERE house_id = ? AND status = 'active' AND role IN (${placeholders})`,
    args: [houseId, ...roles],
  });
  return Number(res.rows[0]?.n ?? 0);
}

/**
 * Tally a poll for one viewer.
 *
 * `voters` is populated only for non-anonymous polls — an anonymous poll must
 * not leak who voted for what through the API even if the UI hides it. The
 * ballot row still carries `user_id`, because one-person-one-vote needs it;
 * anonymity here means "not shown", not "not recorded", and CONTEXT.md is
 * explicit that this is a house-politics feature, not a secret ballot.
 */
export async function tally(poll: Poll, viewerId: string): Promise<PollResult> {
  const c = await db();
  const res = await c.execute({
    sql: "SELECT user_id, option_ids FROM ballots WHERE poll_id = ?",
    args: [poll.id],
  });

  const counts = new Map<string, { votes: number; voters: string[] }>();
  for (const o of poll.options) counts.set(o.id, { votes: 0, voters: [] });

  let myChoice: string[] | null = null;

  for (const r of res.rows) {
    const userId = String(r.user_id);
    let ids: string[];
    try {
      const parsed = JSON.parse(String(r.option_ids));
      ids = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      ids = [];
    }
    if (userId === viewerId) myChoice = ids;

    for (const id of ids) {
      const slot = counts.get(id);
      if (!slot) continue; // option was deleted after the vote was cast
      slot.votes += 1;
      if (!poll.anonymous) slot.voters.push(userId);
    }
  }

  const ballotCount = res.rows.length;
  const eligible = await eligibleCount(poll.houseId, poll.eligibleRoles);
  const quorumMet =
    poll.quorumBps === 0 || (eligible > 0 && (ballotCount * 10000) / eligible >= poll.quorumBps);

  // The winner must clear pass_bps of *cast* votes, and clear it alone — a tie
  // is not a decision, so winnerOptionId stays null and the manager has to
  // break it or re-run the vote.
  let winnerOptionId: string | null = null;
  if (quorumMet && ballotCount > 0) {
    const ranked = [...counts.entries()].sort((a, b) => b[1].votes - a[1].votes);
    const [topId, top] = ranked[0];
    const tied = ranked.length > 1 && ranked[1][1].votes === top.votes;
    if (!tied && (top.votes * 10000) / ballotCount >= poll.passBps) winnerOptionId = topId;
  }

  return {
    poll,
    eligibleCount: eligible,
    ballotCount,
    quorumMet,
    counts: [...counts.entries()].map(([optionId, v]) => ({ optionId, ...v })),
    winnerOptionId,
    myChoice,
  };
}

/** Close a poll and freeze its outcome as human-readable text. */
export async function closePoll(poll: Poll): Promise<string> {
  const c = await db();
  const result = await tally(poll, "");

  const winner = result.winnerOptionId
    ? poll.options.find((o) => o.id === result.winnerOptionId)?.label
    : null;

  const outcome = !result.quorumMet
    ? `No quorum — ${result.ballotCount} of ${result.eligibleCount} voted.`
    : winner
      ? `${winner} (${result.counts.find((x) => x.optionId === result.winnerOptionId)?.votes ?? 0} of ${result.ballotCount} votes)`
      : `No result — no option reached the threshold.`;

  await c.execute({
    sql: "UPDATE polls SET status = 'closed', closed_at = ?, outcome = ? WHERE id = ?",
    args: [Date.now(), outcome, poll.id],
  });

  return outcome;
}
