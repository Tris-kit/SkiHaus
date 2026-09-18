// GET /api/auth/session -> { user, houses } | 401
//
// The client's first call on boot. A 401 here is normal, not an error — it
// means "show the sign-in screen".
//
// PATCH /api/auth/session  { name?, avatarEmoji?, avatarColor? } -> { user, houses }
// Edit your own profile. There is no separate /api/me.

import { currentUser, requireUser, sessionPayload } from "@/lib/auth";
import { db } from "@/lib/db";
import { body, handle, json, unauthorized } from "@/lib/http";
import { optStr } from "@/lib/validate";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await currentUser(req);
    if (!user) throw unauthorized();
    return json(await sessionPayload(user));
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const raw = await body<Record<string, unknown>>(req);

    const name = optStr(raw.name, "Name", 80);
    const avatarEmoji = optStr(raw.avatarEmoji, "Avatar", 8);
    const avatarColor = optStr(raw.avatarColor, "Avatar colour", 16);

    const c = await db();
    await c.execute({
      // COALESCE so omitting a field leaves it alone; sending null clears it.
      sql: `UPDATE users SET
              name = COALESCE(?, name),
              avatar_emoji = ?,
              avatar_color = ?
            WHERE id = ?`,
      args: [name, avatarEmoji, avatarColor, user.id],
    });

    return json(await sessionPayload({ ...user, name: name ?? user.name, avatarEmoji, avatarColor }));
  });
}
