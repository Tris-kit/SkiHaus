// GET   /api/houses/:houseId/polls/:pollId -> PollResult   (eligible voters + admin)
// PATCH /api/houses/:houseId/polls/:pollId { action: "open" | "close" } -> PollResult  (admin)
//
// Closing is explicit and one-way. `closes_at` is advisory — a deadline shown
// in the UI, not a cron job — because a poll that silently closed itself at
// 3am and declared a result nobody saw would be worse than one that waits.

import { announce } from "@/lib/announce";
import { db } from "@/lib/db";
import { audit, requireAdmin, requireMember } from "@/lib/guard";
import { badRequest, body, forbidden, handle, json, notFound } from "@/lib/http";
import { closePoll, getPoll, tally } from "@/lib/polls";
import { oneOf } from "@/lib/validate";

export const runtime = "nodejs";

type Params = { params: Promise<{ houseId: string; pollId: string }> };

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId, pollId } = await params;
    const ctx = await requireMember(req, houseId);

    const poll = await getPoll(houseId, pollId);
    if (!poll) throw notFound("Vote not found.");
    if (poll.status === "draft" && !ctx.isAdmin) throw notFound("Vote not found.");
    if (!poll.eligibleRoles.includes(ctx.role) && !ctx.isAdmin) {
      throw forbidden("This vote isn't open to you.");
    }

    return json(await tally(poll, ctx.user.id));
  });
}

export async function PATCH(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId, pollId } = await params;
    const ctx = await requireAdmin(req, houseId);

    const poll = await getPoll(houseId, pollId);
    if (!poll) throw notFound("Vote not found.");

    const raw = await body<Record<string, unknown>>(req);
    const action = oneOf(raw.action, "Action", ["open", "close"] as const);

    const c = await db();

    if (action === "open") {
      if (poll.status === "closed") {
        // Reopening would invalidate a published outcome people have already
        // acted on. Run a new vote instead.
        throw badRequest("That vote is closed. Start a new one.");
      }
      await c.execute({ sql: "UPDATE polls SET status = 'open' WHERE id = ?", args: [pollId] });
      await audit(ctx, "poll.open", "poll", pollId);
    } else {
      if (poll.status !== "open") throw badRequest("That vote isn't open.");
      const outcome = await closePoll(poll);
      await announce({
        houseId,
        title: `Vote closed: ${poll.question}`,
        body: outcome,
        kind: "vote",
        linkPath: `/polls/${pollId}`,
        audience: poll.eligibleRoles,
        actorId: ctx.user.id,
      });
      await audit(ctx, "poll.close", "poll", pollId, { outcome });
    }

    const updated = await getPoll(houseId, pollId);
    if (!updated) throw notFound("Vote not found.");
    return json(await tally(updated, ctx.user.id));
  });
}
