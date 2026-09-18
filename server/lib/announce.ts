// The notification feed.
//
// v1 is in-app only: rows here, an unread badge in the client. Email digests
// and push are v1.1 (CONTEXT.md §8) and will read from this same table, so
// everything worth notifying about should call `announce()` now even though
// nothing pushes yet.
//
// Never throws. A feed entry failing to write must not fail the action that
// triggered it — closing a vote matters, telling people about it is best
// effort.

import { db } from "./db";
import { shortId } from "./ids";
import type { Announcement, Role } from "./types";

export type AnnounceKind = Announcement["kind"];

export async function announce(opts: {
  houseId: string;
  title: string;
  body?: string;
  kind?: AnnounceKind;
  linkPath?: string | null;
  audience?: Role[];
  actorId?: string | null;
}): Promise<void> {
  try {
    const c = await db();
    await c.execute({
      sql: `INSERT INTO announcements
              (id, house_id, title, body, kind, link_path, audience, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        shortId(12),
        opts.houseId,
        opts.title.slice(0, 200),
        (opts.body ?? "").slice(0, 4000),
        opts.kind ?? "note",
        opts.linkPath ?? null,
        (opts.audience ?? ["admin", "member"]).join(","),
        opts.actorId ?? null,
        Date.now(),
      ],
    });
  } catch (e) {
    console.error("[announce] failed", e);
  }
}
