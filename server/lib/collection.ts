// A factory for the house-scoped *lookup* tables — categories, mountains,
// venues, guest rates. Four tables whose entire behaviour is "list the live
// ones, insert a new one, archive an old one".
//
// SCOPE NOTE: this exists only for tables with no behaviour. Anything with
// rules of its own — expenses, polls, guest stays, documents — is written out
// longhand in its own route, because the interesting part of those endpoints
// is exactly the part a factory would hide. Resist the urge to grow this into
// a general-purpose ORM; Split's whole backend is five dependencies and that
// is a feature.

import { NextResponse } from "next/server";
import { db } from "./db";
import { audit, requireRole } from "./guard";
import { body, handle, json, notFound } from "./http";
import { shortId } from "./ids";
import type { Role } from "./types";

export type Field = {
  /** Name on the wire (camelCase). */
  key: string;
  /** Column in the table (snake_case). */
  column: string;
  label: string;
  parse: (v: unknown, label: string) => string | number | null;
  /** Used when the client omits the key on create. */
  fallback?: string | number | null;
};

type Opts = {
  table: string;
  /** Response key, e.g. "categories". */
  plural: string;
  fields: Field[];
  orderBy: string;
  readRole: Role;
  writeRole: Role;
  toWire: (r: Record<string, unknown>) => unknown;
};

type Params = { params: Promise<{ houseId: string }> };

export function houseCollection(opts: Opts) {
  async function GET(req: Request, { params }: Params): Promise<NextResponse> {
    return handle(async () => {
      const { houseId } = await params;
      await requireRole(req, houseId, opts.readRole);

      const c = await db();
      const res = await c.execute({
        sql: `SELECT * FROM ${opts.table}
              WHERE house_id = ? AND archived_at IS NULL
              ORDER BY ${opts.orderBy}`,
        args: [houseId],
      });

      return json({
        [opts.plural]: res.rows.map((r) => opts.toWire(r as Record<string, unknown>)),
      });
    });
  }

  async function POST(req: Request, { params }: Params): Promise<NextResponse> {
    return handle(async () => {
      const { houseId } = await params;
      const ctx = await requireRole(req, houseId, opts.writeRole);
      const raw = await body<Record<string, unknown>>(req);

      const id = shortId(10);
      const cols = ["id", "house_id"];
      const args: Array<string | number | null> = [id, houseId];

      for (const f of opts.fields) {
        const supplied = raw[f.key];
        cols.push(f.column);
        args.push(supplied === undefined ? (f.fallback ?? null) : f.parse(supplied, f.label));
      }

      const c = await db();
      await c.execute({
        sql: `INSERT INTO ${opts.table} (${cols.join(", ")})
              VALUES (${cols.map(() => "?").join(", ")})`,
        args,
      });
      await audit(ctx, `${opts.table}.create`, opts.table, id);

      const res = await c.execute({
        sql: `SELECT * FROM ${opts.table} WHERE id = ?`,
        args: [id],
      });
      if (!res.rows[0]) throw notFound();

      return json(opts.toWire(res.rows[0] as Record<string, unknown>), 201);
    });
  }

  return { GET, POST };
}
