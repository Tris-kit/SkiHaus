// GET  /api/houses/:houseId/documents -> { documents }  (filtered by visible_to)
// POST /api/houses/:houseId/documents -> { document }    (admin)
//
// The lease agreement, house rules, insurance. Either inline markdown
// (`bodyMd`) or a link to a file somewhere else (`url`) — there is no upload,
// because blob storage is a decision this app hasn't had to make yet
// (CONTEXT.md §5).
//
// `visibleTo` is the reason this isn't just a wiki page: house rules go to
// everyone including guests, while the lease with the rent figure on it stays
// with admins and members.

import { db } from "@/lib/db";
import { audit, requireAdmin, requireMember } from "@/lib/guard";
import { badRequest, body, handle, json } from "@/lib/http";
import { shortId } from "@/lib/ids";
import { oneOf, optStr, parseRoles, rolesCsv, str } from "@/lib/validate";
import type { DocumentKind, HouseDocument } from "@/lib/types";

export const runtime = "nodejs";

const KINDS = ["lease", "rules", "insurance", "other"] as const;

type Params = { params: Promise<{ houseId: string }> };

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireMember(req, houseId);

    const c = await db();
    const [docs, acks] = await Promise.all([
      c.execute({
        sql: `SELECT * FROM documents WHERE house_id = ?
              ORDER BY CASE kind WHEN 'lease' THEN 0 WHEN 'rules' THEN 1 ELSE 2 END, title`,
        args: [houseId],
      }),
      c.execute({
        sql: `SELECT a.document_id, a.version FROM document_acks a
              JOIN documents d ON d.id = a.document_id
              WHERE d.house_id = ? AND a.user_id = ?`,
        args: [houseId, ctx.user.id],
      }),
    ]);

    // Acks are per-version: republishing the lease clears everyone's "read it"
    // without erasing the fact that they read v1.
    const acked = new Set(acks.rows.map((r) => `${r.document_id}:${r.version}`));

    const documents: HouseDocument[] = docs.rows
      .map((r) => ({
        id: String(r.id),
        houseId,
        title: String(r.title),
        kind: String(r.kind) as DocumentKind,
        bodyMd: r.body_md == null ? null : String(r.body_md),
        url: r.url == null ? null : String(r.url),
        version: Number(r.version),
        visibleTo: parseRoles(String(r.visible_to)),
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        ackedByMe: acked.has(`${r.id}:${r.version}`),
      }))
      .filter((d) => d.visibleTo.includes(ctx.role));

    return json({ documents });
  });
}

export async function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    const ctx = await requireAdmin(req, houseId);
    const raw = await body<Record<string, unknown>>(req);

    const title = str(raw.title, "Title", { max: 160 });
    const kind = oneOf<DocumentKind>(raw.kind ?? "other", "Kind", KINDS);
    const bodyMd = optStr(raw.bodyMd, "Body", 200_000);
    const url = optStr(raw.url, "Link", 1000);
    const visibleTo = rolesCsv(raw.visibleTo, "Visible to", ["admin", "member"]);

    if (!bodyMd && !url) throw badRequest("A document needs either text or a link.");

    const id = shortId(12);
    const now = Date.now();
    const c = await db();

    await c.execute({
      sql: `INSERT INTO documents (id, house_id, title, kind, body_md, url, version, visible_to, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      args: [id, houseId, title, kind, bodyMd, url, visibleTo, ctx.user.id, now, now],
    });
    await audit(ctx, "document.create", "document", id, { title, kind });

    return json({ ok: true, id }, 201);
  });
}
