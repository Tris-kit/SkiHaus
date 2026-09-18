// POST   /api/houses/:houseId/polls/:pollId/ballot  { optionIds, comment? } -> PollResult
// DELETE /api/houses/:houseId/polls/:pollId/ballot                          -> PollResult
//
// One ballot per person. Re-posting replaces it — changing your mind while a
// vote is open is normal house politics, and forcing someone to delete first
// would just produce accidental blank ballots.

import { db } from "@/lib/db";
import { requireMember } from "@/lib/guard";
import { badRequest, body, forbidden, handle, json, notFound } from "@/lib/http";
import { getPoll, tally } from "@/lib/polls";
import { arr, optStr, str } from "@/lib/validate";

export const runtime = "nodejs";

type Params = { params: Promise<{ houseId: string; pollId: string }> };

export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId, pollId } = await params;
    const ctx = await requireMember(req, houseId);

    const poll = await getPoll(houseId, pollId);
    if (!poll) throw notFound("Vote not found.");
    if (poll.status !== "open") throw badRequest("That vote isn't open.");

    // Eligibility is by role, and admins are NOT automatically eligible here —
    // an admin can read any poll (to run it) but can only vote in one they
    // actually belong to. A manager quietly adding a vote to a members-only
    // poll would undermine the whole mechanism.
    if (!poll.eligibleRoles.includes(ctx.role)) {
      throw forbidden("This vote isn't open to you.");
    }

    const raw = await body<Record<string, unknown>>(req);
    const ids = arr<unknown>(raw.optionIds, "Choices", 20).map((v, i) =>
      str(v, `Choice ${i + 1}`, { max: 40 }),
    );
    const comment = optStr(raw.comment, "Comment", 1000);

    if (ids.length === 0) throw badRequest("Pick an option.");
    if (poll.kind !== "multi" && ids.length > 1) throw badRequest("Pick one option.");

    const valid = new Set(poll.options.map((o) => o.id));
    const unique = [...new Set(ids)];
    if (unique.some((id) => !valid.has(id))) throw badRequest("That option isn't on this poll.");

    const c = await db();
    await c.execute({
      sql: `INSERT INTO ballots (poll_id, user_id, option_ids, comment, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(poll_id, user_id) DO UPDATE SET
              option_ids = excluded.option_ids,
              comment = excluded.comment,
              created_at = excluded.created_at`,
      args: [pollId, ctx.user.id, JSON.stringify(unique), comment, Date.now()],
    });

    return json(await tally(poll, ctx.user.id));
  });
}

export async function DELETE(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId, pollId } = await params;
    const ctx = await requireMember(req, houseId);

    const poll = await getPoll(houseId, pollId);
    if (!poll) throw notFound("Vote not found.");
    if (poll.status !== "open") throw badRequest("That vote isn't open.");

    const c = await db();
    await c.execute({
      sql: "DELETE FROM ballots WHERE poll_id = ? AND user_id = ?",
      args: [pollId, ctx.user.id],
    });

    return json(await tally(poll, ctx.user.id));
  });
}
