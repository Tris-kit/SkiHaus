// PATCH  /api/houses/:houseId/documents/:docId { title?, bodyMd?, url?, visibleTo?, republish? }
//                                               -> { ok }            (admin)
// POST   /api/houses/:houseId/documents/:docId  { ack: true }        -> { ok }
//        Acknowledge the current version. This is the "everyone has read the
//        lease" record, which is the entire reason documents are versioned.
// DELETE /api/houses/:houseId/documents/:docId                       (admin)

import { announce } from "@/lib/announce";
import { db } from "@/lib/db";
import { audit, requireAdmin, requireMember } from "@/lib/guard";
import { badRequest, body, forbidden, handle, json, notFound } from "@/lib/http";
import { bool, optStr, parseRoles, rolesCsv, str } from "@/lib/validate";

export const runtime = "nodejs";

type Params = { params: Promise<{ houseId: string; docId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId, docId } = await params;
    const ctx = await requireAdmin(req, houseId);
    const raw = await body<Record<string, unknown>>(req);

    const c = await db();
    const cur = await c.execute({
      sql: "SELECT * FROM documents WHERE id = ? AND house_id = ?",
      args: [docId, houseId],
    });
    const row = cur.rows[0];
    if (!row) throw notFound("Document not found.");

    const fields: Record<string, string | number | null> = {};
    if (raw.title !== undefined) fields.title = str(raw.title, "Title", { max: 160 });
    if (raw.bodyMd !== undefined) fields.body_md = optStr(raw.bodyMd, "Body", 200_000);
    if (raw.url !== undefined) fields.url = optStr(raw.url, "Link", 1000);
    if (raw.visibleTo !== undefined) {
      fields.visible_to = rolesCsv(raw.visibleTo, "Visible to", parseRoles(String(row.visible_to)));
    }

    // Republishing is explicit. A typo fix shouldn't reset eight people's
    // acknowledgements; a new lease should.
    const republish = bool(raw.republish, "Republish", false);
    if (republish) fields.version = Number(row.version) + 1;

    fields.updated_at = Date.now();

    const keys = Object.keys(fields);
    await c.execute({
      sql: `UPDATE documents SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND house_id = ?`,
      args: [...keys.map((k) => fields[k]), docId, houseId],
    });

    if (republish) {
      await announce({
        houseId,
        title: `Updated: ${fields.title ?? String(row.title)}`,
        body: "A new version has been published — please read and acknowledge it.",
        kind: "note",
        linkPath: `/documents/${docId}`,
        audience: parseRoles(String(fields.visible_to ?? row.visible_to)),
        actorId: ctx.user.id,
      });
    }

    await audit(ctx, "document.update", "document", docId, { republish });
    return json({ ok: true });
  });
}

export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId, docId } = await params;
    const ctx = await requireMember(req, houseId);

    const raw = await body<Record<string, unknown>>(req);
    if (!bool(raw.ack, "Ack", false)) throw badRequest("Nothing to do.");

    const c = await db();
    const cur = await c.execute({
      sql: "SELECT version, visible_to FROM documents WHERE id = ? AND house_id = ?",
      args: [docId, houseId],
    });
    const row = cur.rows[0];
    if (!row) throw notFound("Document not found.");

    // You can't acknowledge a document you were never shown.
    if (!parseRoles(String(row.visible_to)).includes(ctx.role)) {
      throw forbidden("That document isn't shared with you.");
    }

    await c.execute({
      sql: `INSERT INTO document_acks (document_id, user_id, version, acked_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(document_id, user_id, version) DO NOTHING`,
      args: [docId, ctx.user.id, Number(row.version), Date.now()],
    });

    return json({ ok: true, version: Number(row.version) });
  });
}

export async function DELETE(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId, docId } = await params;
    const ctx = await requireAdmin(req, houseId);

    const c = await db();
    await c.batch(
      [
        { sql: "DELETE FROM document_acks WHERE document_id = ?", args: [docId] },
        { sql: "DELETE FROM documents WHERE id = ? AND house_id = ?", args: [docId, houseId] },
      ],
      "write",
    );
    await audit(ctx, "document.delete", "document", docId);

    return json({ ok: true });
  });
}
