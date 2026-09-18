// GET  /api/houses/:houseId/polls -> { polls }   (guest — filtered by
//                                                 eligible_roles inside)
// POST /api/houses/:houseId/polls -> { poll }     (admin)
//
// Opening a vote is a manager action. Members vote; they don't set the
// question, the quorum or the threshold — otherwise "should we re-up?" gets
// re-asked every time someone dislikes the answer.

import { announce } from "@/lib/announce";
import { db } from "@/lib/db";
import { audit, requireAdmin, requireMember } from "@/lib/guard";
import { badRequest, body, handle, json } from "@/lib/http";
import { shortId } from "@/lib/ids";
import { getPoll, listPolls } from "@/lib/polls";
import { arr, bool, int, oneOf, optStr, parseRoles, rolesCsv, str } from "@/lib/validate";
import type { PollKind } from "@/lib/types";

export const runtime = "nodejs";

const KINDS = ["single", "multi", "yesno"] as const;

type Params = { params: Promise<{ houseId: string }> };

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireMember(req, houseId);
    return json({ polls: await listPolls(houseId, ctx.role) });
  });
}

export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireAdmin(req, houseId);
    const raw = await body<Record<string, unknown>>(req);

    const question = str(raw.question, "Question", { max: 300 });
    const detail = optStr(raw.detail, "Detail", 4000);
    const kind = oneOf<PollKind>(raw.kind ?? "single", "Kind", KINDS);
    const eligibleRoles = rolesCsv(raw.eligibleRoles, "Eligible roles", ["admin", "member"]);
    const quorumBps = int(raw.quorumBps ?? 0, "Quorum", { min: 0, max: 10000 });
    const passBps = int(raw.passBps ?? 5000, "Pass threshold", { min: 1, max: 10000 });
    const anonymous = bool(raw.anonymous, "Anonymous", false);
    const status = raw.draft === true ? "draft" : "open";
    const closesAt = raw.closesAt == null ? null : int(raw.closesAt, "Closes at", { min: 0 });

    // A yes/no poll builds its own options so every client renders the same
    // two labels in the same order.
    const labels =
      kind === "yesno"
        ? ["Yes", "No"]
        : arr<unknown>(raw.options, "Options", 20).map((o, i) => str(o, `Option ${i + 1}`, { max: 120 }));

    if (kind !== "yesno" && labels.length < 2) {
      throw badRequest("A poll needs at least two options.");
    }

    const id = shortId(12);
    const now = Date.now();
    const c = await db();

    await c.batch(
      [
        {
          sql: `INSERT INTO polls
                  (id, house_id, question, detail, kind, status, eligible_roles,
                   quorum_bps, pass_bps, anonymous, closes_at, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            id, houseId, question, detail, kind, status, eligibleRoles,
            quorumBps, passBps, anonymous ? 1 : 0, closesAt, ctx.user.id, now,
          ],
        },
        ...labels.map((label, i) => ({
          sql: `INSERT INTO poll_options (id, poll_id, label, sort_order) VALUES (?, ?, ?, ?)`,
          args: [shortId(10), id, label, i],
        })),
      ],
      "write",
    );

    if (status === "open") {
      await announce({
        houseId,
        title: `New vote: ${question}`,
        kind: "vote",
        linkPath: `/polls/${id}`,
        audience: parseRoles(eligibleRoles),
        actorId: ctx.user.id,
      });
    }

    await audit(ctx, "poll.create", "poll", id, { question, kind });

    return json({ poll: await getPoll(houseId, id) }, 201);
  });
}
