// CORS for /api/*. THE ONLY PLACE CORS IS SET — lib/http.ts deliberately does
// not touch Access-Control-* headers. (Split set them in both places and the
// handler's wildcard silently defeated the middleware's allowlist.)
//
// In production this barely matters: the web app is served from the same
// origin as the API, so those requests aren't cross-origin at all. It matters
// for `expo start --web` on :8081 talking to a Next dev server on :3000, and
// for Vercel preview deployments.
//
// Because the web client authenticates with a cookie, `Allow-Credentials` must
// be true — which means `Allow-Origin` must echo one exact origin and can
// never be `*`. A wildcard here would silently break sign-in rather than
// loosen it.

import { NextResponse, type NextRequest } from "next/server";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:8081", // expo start --web
  "http://localhost:3000", // next dev
  // Add the production web origin here once the domain is registered.
]);

function isAllowed(origin: string | null): origin is string {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    return new URL(origin).hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function applyCors(res: NextResponse, origin: string): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "content-type,authorization");
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  const origin = req.headers.get("origin");

  // Same-origin requests and the native app send no Origin (or one we don't
  // recognise). Pass them straight through — CORS is a browser mechanism and
  // blocking here would only break non-browser clients.
  if (!isAllowed(origin)) return NextResponse.next();

  if (req.method === "OPTIONS") {
    return applyCors(new NextResponse(null, { status: 204 }), origin);
  }
  return applyCors(NextResponse.next(), origin);
}

export const config = { matcher: "/api/:path*" };
