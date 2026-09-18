// Exports the Expo app for web and drops it into server/public, so one Vercel
// deployment serves both the API and the whole application UI.
//
// THIS SCRIPT IS THE "NO DOWNLOAD REQUIRED" PROMISE (CONTEXT.md §6). Without
// it there is no web app — only an API and an App Store listing.
//
// Runs as part of `vercel-build`, before `next build`.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, "..");
const rootDir = join(serverDir, "..");
const mobileDir = join(rootDir, "mobile");
const distDir = join(mobileDir, "dist");
const publicDir = join(serverDir, "public");
const pwaDir = join(serverDir, "pwa");

/**
 * On Vercel, point the web bundle at *its own* deployment.
 *
 * EXPO_PUBLIC_API_BASE is inlined by Metro at build time, and `mobile/.env`
 * sets it to localhost for local development. Without this, a Vercel build
 * would happily ship a web app that calls the developer's laptop — it fails
 * silently for every user and looks like a backend outage.
 *
 * Deriving it instead of hard-coding a domain means the web app is always
 * same-origin with its own API, so it works on `*.vercel.app` with no domain
 * registered and keeps working after you add one.
 *
 *   preview    → VERCEL_BRANCH_URL (stable per branch, unlike VERCEL_URL),
 *                so the dev branch never ships a UI that mutates production.
 *   production → VERCEL_PROJECT_PRODUCTION_URL, the canonical domain.
 *
 * Setting EXPO_PUBLIC_API_BASE explicitly in the Vercel dashboard overrides
 * all of this — that's the escape hatch if the API ever moves off-origin.
 */
function vercelApiBase() {
  if (!process.env.VERCEL) return null;

  const explicit = process.env.EXPO_PUBLIC_API_BASE;
  if (explicit && !explicit.includes("localhost")) return explicit.replace(/\/$/, "");

  const host =
    process.env.VERCEL_ENV === "preview"
      ? process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL
      : process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;

  return host ? `https://${host}` : null;
}

const apiBase = vercelApiBase();
if (apiBase) {
  console.log(`[build-web] ${process.env.VERCEL_ENV} build → API base ${apiBase}`);
} else if (process.env.VERCEL) {
  // Better to fail the build than to ship a bundle pointed at localhost.
  throw new Error(
    "[build-web] On Vercel but could not determine the API base URL. " +
      "Set EXPO_PUBLIC_API_BASE in the Vercel project's environment variables.",
  );
}

const run = (cmd, cwd) =>
  execSync(cmd, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=4096`.trim(),
      // Set as a real process env var so it wins over mobile/.env — dotenv
      // does not override variables already present in the environment.
      ...(apiBase ? { EXPO_PUBLIC_API_BASE: apiBase } : {}),
    },
  });

const onCI = Boolean(process.env.VERCEL || process.env.CI);
if (onCI || !existsSync(join(mobileDir, "node_modules"))) {
  // `npm install --omit=dev`, not `npm ci`: the web export needs runtime deps
  // only, and the two packages install independently (no workspace hoisting).
  run("npm install --omit=dev --no-audit --no-fund", mobileDir);
}

run("npx expo export -p web --output-dir dist", mobileDir);

// public/ is generated and gitignored — always rebuild it from scratch so a
// deleted asset doesn't linger from a previous build.
rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });
cpSync(distDir, publicDir, { recursive: true });
cpSync(pwaDir, publicDir, { recursive: true });

// Expo's exported index.html knows nothing about PWA installability, so the
// head tags are injected here rather than maintained in a custom template.
const PWA_HEAD = `
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#1D6FE0" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="Ski House" />
    <meta property="og:title" content="Ski House — run the lease, not the group text" />
    <meta property="og:description" content="Expenses, votes, guest fees and who's skiing what. No download required." />
    <meta property="og:type" content="website" />
  `;

const indexPath = join(publicDir, "index.html");
let html = readFileSync(indexPath, "utf8");
if (!html.includes('rel="manifest"')) {
  html = html.replace("</head>", `${PWA_HEAD}</head>`);
  writeFileSync(indexPath, html);
}

console.log("[build-web] web app exported into server/public");
