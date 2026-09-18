// Response helpers. Every API handler returns through `json()` / `error()`, so
// failures always have the shape `{ error: string }`.
//
// CORS lives in exactly one place: middleware.ts. Do not set
// Access-Control-* headers here. (Split set them in both, with the handler's
// `*` silently defeating the middleware's allowlist; that bug is not worth
// inheriting.)

import { NextResponse } from "next/server";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function error(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Thrown by guards; caught by `handle()` and turned into a response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (m = "Bad request.") => new HttpError(400, m);
export const unauthorized = (m = "Sign in to continue.") => new HttpError(401, m);
export const forbidden = (m = "You don't have access to that.") => new HttpError(403, m);
export const notFound = (m = "Not found.") => new HttpError(404, m);

/**
 * Wrap a handler body so guards can `throw forbidden()` instead of threading
 * error returns back up through every call site.
 *
 * Unexpected errors are logged server-side and reported generically — a stack
 * trace or a raw libSQL message must never reach the client.
 */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return error(e.message, e.status);
    console.error("[api] unhandled", e);
    return error("Something went wrong.", 500);
  }
}

/** Parse a JSON body, or throw a 400. */
export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw badRequest("Invalid JSON body.");
  }
}

/** Absolute origin for building links — env override, else the request host. */
export function originFrom(req: Request): string {
  const env = process.env.NEXT_PUBLIC_BASE_URL;
  if (env) return env.replace(/\/$/, "");
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto =
    req.headers.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
